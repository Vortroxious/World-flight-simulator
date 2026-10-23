// Aircraft: assembles the 6-DOF rigid body, aerodynamics, propulsion, landing gear / airframe contacts,
// systems (electrical, fuel, instruments), damage and warnings from a data-driven configuration.
// Runs at a fixed timestep (see SIM_DT) independent of rendering. DOM-free.
import {
  clamp, moveToward, bodyToNed, nedToBody, cross, dot, quatFromEuler, quatToEuler, quatIntegrate, normalize, rng, valueNoise, smoothstep,
} from '../core/math.js';
import { G0, KT } from '../core/units.js';
import { DEG, RAD, radii, wrap360 } from '../geo/wgs84.js';
import { atmosphere, casFromTas } from './atmosphere.js';
import { Aero } from './fdm/aero.js';
import { MAGS } from './fdm/propulsion/piston.js';
import { makeEngine } from './fdm/propulsion/index.js';
import { FlyByWire } from './fdm/fbw.js';
import { Hydraulics } from './systems/hydraulics.js';
import { Pressurization, Apu } from './systems/pressurization.js';
import { Autopilot } from './autopilot/autopilot.js';
import { NavSystem } from './nav/nav.js';
import { Gpws } from './systems/gpws.js';
import { Electrical } from './systems/electrical.js';
import { FuelSystem } from './systems/fuel.js';
import { Instruments } from './systems/instruments.js';
import { DamageModel, DAMAGE_MODES } from './damage/damage.js';
import { surfaceOf } from './collision/surfaces.js';

export const SIM_HZ = 240;
export const SIM_DT = 1 / SIM_HZ;
const RHO_WATER = 1025;

/** Flat ground used when no world is attached (tests). */
export const FLAT_GROUND = { sample: (lat, lon, out = {}) => { out.h = 0; out.surface = 'runway'; out.normal = [0, 0, 1]; return out; } };

/** Normalise legacy single-engine configs (GA-172 JSON) to the engines[] schema. */
export function normalizeConfig(cfg) {
  if (cfg.engines) return cfg;
  return { ...cfg, engines: [{ ...cfg.engine, component: 'engine', propComponent: 'propeller', position: cfg.engine.position ?? [2, 0, 0], thrustAxis: cfg.engine.thrustAxis ?? [1, 0, 0] }], systems: { gpws: false, apu: false, yawDamper: false, ...cfg.systems }, family: cfg.family ?? 'ga' };
}

export class Aircraft {
  constructor(rawCfg, opts = {}) {
    const cfg = (this.cfg = normalizeConfig(rawCfg));
    this.aero = new Aero(cfg);
    this.elec = new Electrical(cfg.electrical);
    this.fuel = new FuelSystem(cfg.fuel);
    this.inst = new Instruments();
    this.damage = new DamageModel(cfg, opts.damageMode ?? DAMAGE_MODES.REALISTIC);
    this.rand = rng(opts.seed ?? 42);
    this.assist = { autoRudder: false, ...opts.assist };
    this.payload = cfg.mass.crewDefault + cfg.mass.payloadDefault;
    this.propToEngine = new Map(cfg.engines.map((e, i) => [e.propComponent, i]));
    this.reset();
  }

  /** First engine (single-engine displays, legacy callers). */
  get engine() { return this.engines[0]; }
  get isPiston() { return this.engines[0].kind === 'piston'; }
  get isJet() { return this.engines[0].kind.startsWith('turbofan'); }

  reset() {
    const c = this.cfg;
    this.lat = 0; this.lon = 0; this.alt = 0;
    this.v = [0, 0, 0]; // NED velocity (m/s)
    this.q = [1, 0, 0, 0];
    this.w = [0, 0, 0]; // body rates p,q,r
    this.controls = {
      elevator: 0, aileron: 0, rudder: 0, throttle: 0, throttles: null, mixture: 1, prop: 1, reverse: 0, flapsLever: 0, trim: 0,
      brakeL: 0, brakeR: 0, parkingBrake: false, gearDown: true, speedbrake: 0, spoilersArmed: false,
    };
    this.gearPos = 1; this.spoilerPos = 0; this.totalDe = 0;
    this.flapDeg = 0;
    this.time = 0;
    this.alphaPrev = 0; this.alphaDot = 0;
    this.wheelState = c.gear.wheels.map(() => ({ compression: 0, contact: false, force: 0, wasContact: false, rot: 0 }));
    this.contactState = c.contacts.map(() => ({ contact: false }));
    this.treeHits = new Set();
    this.onGround = false; this.inWater = false; this.waterTime = 0;
    this.magvar = 0;
    this.out = { F: [0, 0, 0], M: [0, 0, 0] };
    this.nz = 1; this.ay = 0; this.accelBody = [0, 0, 0];
    this.touchdown = null; // last touchdown report
    this.events = [];
    this.windNed = [0, 0, 0];
    this.damage.reset();
    this.engines = c.engines.map((e) => makeEngine(e));
    this.hyd = new Hydraulics(c.systems?.hydraulics);
    this.press = new Pressurization(c.systems?.pressurization);
    this.apu = new Apu(!!c.systems?.apu);
    this.fbw = c.fbw ? new FlyByWire(c.fbw) : null;
    this.autopilot = new Autopilot(c.autopilot || {});
    this.nav = new NavSystem();
    this.gpws = new Gpws(!!c.systems?.gpws, c.family);
    this.alerts = { warnings: [], cautions: [] }; this.masterWarning = false; this.masterCaution = false; this._alertKeys = new Set();
    this.mach = 0; this.radioAlt = 0;
    this.lastSurface = 'runway';
    this.avionics = { com1: 118.0, com1Stby: 121.5, xpdrCode: '1200', xpdrMode: 'STBY' };
    this.hobbs = 0;
  }

  get mass() { return this.cfg.mass.empty + this.payload + this.fuel.massKg; }

  /** Inertia scaled with mass ratio (simple approximation of fuel/payload distribution). */
  get inertia() {
    const I = this.cfg.mass.inertiaAtMtow, r = this.mass / this.cfg.mass.maxTakeoff;
    return [I.Ixx * r, I.Iyy * r, I.Izz * r];
  }

  get euler() { return quatToEuler(this.q); }

  setAttitude(rollDeg, pitchDeg, headingDeg) { this.q = quatFromEuler(rollDeg * DEG, pitchDeg * DEG, headingDeg * DEG); }

  /** Place aircraft on the ground at rest with the gear at static compression. */
  placeOnGround(lat, lon, headingTrue, ground = FLAT_GROUND, opts = {}) {
    this.lat = lat; this.lon = lon;
    const g = ground.sample(lat, lon, {});
    const wheels = this.cfg.gear.wheels;
    const zMax = Math.max(...wheels.map((w) => w.pos[2]));
    this.alt = g.h + zMax - 0.06;
    this.setAttitude(0, 0, headingTrue);
    this.v = [0, 0, 0]; this.w = [0, 0, 0];
    this.controls.parkingBrake = opts.parkingBrake ?? true;
    this.controls.gearDown = true; this.gearPos = 1;
    // Settle onto the gear.
    const saved = this.damage.mode; this.damage.mode = DAMAGE_MODES.OFF;
    for (let i = 0; i < SIM_HZ * 3; i++) this.step(SIM_DT, { ground, settle: true });
    this.damage.mode = saved; this.damage.reset();
    this.time = 0;
  }

  /** Place aircraft in steady, trimmed level flight. */
  placeAirborne(lat, lon, altMsl, headingTrue, iasKt, opts = {}) {
    this.lat = lat; this.lon = lon; this.alt = altMsl;
    const flap = this.cfg.aero.flaps[opts.flapsLever ?? 0].deg;
    this.controls.flapsLever = opts.flapsLever ?? 0; this.flapDeg = flap;
    const atm = atmosphere(altMsl, opts.atmo);
    const V = (iasKt * KT) / Math.sqrt(atm.sigma);
    const W = this.mass * G0, qS = 0.5 * atm.rho * V * V * this.cfg.geometry.wingArea;
    const gamma = (opts.flightPathDeg ?? 0) * DEG;
    // Invert CL(alpha) by bisection over the pre-stall range.
    const f = (al) => this.aero.liftCoefficient(al, flap) * qS - W * Math.cos(gamma);
    let a0 = -8 * DEG, a1 = 15 * DEG;
    for (let i = 0; i < 50; i++) { const mid = (a0 + a1) / 2; if (f(mid) > 0) a1 = mid; else a0 = mid; }
    const alpha = (a0 + a1) / 2;
    const pitch = alpha + gamma;
    this.setAttitude(0, pitch * RAD, headingTrue);
    const hd = headingTrue * DEG;
    this.v = [Math.cos(hd) * Math.cos(gamma) * V, Math.sin(hd) * Math.cos(gamma) * V, -Math.sin(gamma) * V];
    this.w = [0, 0, 0];
    // Gear: down for approach configurations unless told otherwise.
    const gearDown = opts.gearDown ?? (!this.cfg.gear.retractable || (opts.flapsLever ?? 0) >= 2);
    this.controls.gearDown = gearDown; this.gearPos = gearDown ? 1 : 0;
    // Trim: zero pitching moment with elevator neutral.
    const a = this.cfg.aero;
    const cm = a.Cm0 + this.aero.flapValue(flap, 'dCm') + (a.CmAlphaWingBody + a.CmAlphaTail) * Math.sin(alpha);
    this.controls.trim = clamp(-cm / (a.CmDe * this.cfg.controls.trimRangeRad), -1, 1);
    this.totalDe = this.controls.trim * this.cfg.controls.trimRangeRad;
    this.controls.mixture = opts.mixture ?? 1;
    // Throttle for thrust = drag (+ weight component along path) from steady engine equilibrium.
    const mach = V / atm.a;
    const D = (a.CD0 + this.aero.flapValue(flap, 'dCD') + this.aero.k * (W / qS) ** 2 + this.aero.waveDrag(mach) + (gearDown && this.cfg.gear.retractable ? this.cfg.gear.dragCD : 0)) * qS + W * Math.sin(gamma);
    let t0 = 0, t1 = 1;
    for (let k = 0; k < 18; k++) {
      const t = (t0 + t1) / 2;
      if (this.steadyThrust(t, atm, V, mach) > D) t1 = t; else t0 = t;
    }
    this.controls.throttle = (t0 + t1) / 2;
    let T = this.steadyThrust(this.controls.throttle, atm, V, mach);
    // Refine with the full aerodynamic model: solve angle of attack, stabiliser trim and thrust together,
    // including the pitching moment of the thrust line (engines below/above the CG) and Mach effects.
    const g = this.cfg.geometry, S = g.wingArea, out = { F: [0, 0, 0], M: [0, 0, 0] };
    const engArm = this.cfg.engines.reduce((acc, e) => { const p = e.position || [0, 0, 0], ax = e.thrustAxis || [1, 0, 0]; return acc + (p[2] * ax[0] - p[0] * ax[2]); }, 0) / this.cfg.engines.length;
    const CLa = a.generic?.CLalpha ?? 5;
    let al = alpha, de = this.totalDe;
    for (let it = 0; it < 12; it++) {
      const th = al + gamma;
      const r = this.aero.compute({
        alpha: al, beta: 0, V, qbar: qS / S, p: 0, q: 0, r: 0, alphaDot: 0, flapDeg: flap, de, da: 0, dr: 0, agl: 1e4,
        damage: this.damage.aeroFactors, randomGust: 0, mach, liftDump: 0, dragExtra: gearDown && this.cfg.gear.retractable ? this.cfg.gear.dragCD : 0,
      }, out);
      const Treq = Math.max(0, W * Math.sin(th) - r.F[0]);
      al = clamp(al + (r.F[2] + W * Math.cos(th)) / (CLa * qS), -8 * DEG, 16 * DEG);
      de = clamp(de - (r.M[1] + Treq * engArm) / (a.CmDe * qS * g.chord), -0.5, 0.5);
      if (it === 11) {
        t0 = 0; t1 = 1;
        for (let k = 0; k < 16; k++) { const t = (t0 + t1) / 2; if (this.steadyThrust(t, atm, V, mach) > Treq) t1 = t; else t0 = t; }
        this.controls.throttle = (t0 + t1) / 2; T = this.steadyThrust(this.controls.throttle, atm, V, mach);
      }
    }
    this.setAttitude(0, (al + gamma) * RAD, headingTrue);
    this.controls.trim = clamp(de / this.cfg.controls.trimRangeRad, -1, 1);
    this.totalDe = de;
    this.setSystemsOn();
    this.inst.align(this.snapshotForInstruments(atm), true);
    this.press.reset(altMsl / 0.3048);
    this.alphaPrev = al;
    // Air data valid immediately (displays and autopilot read it before the first step).
    this.tas = V; this.iasTrue = iasKt * KT; this.mach = mach; this.alpha = al; this.beta = 0;
    this.qbar = 0.5 * atm.rho * V * V; this.agl = this.radioAlt = Math.max(altMsl - (opts.groundElev ?? 0), 0); // refined on the first step
    this.onGround = false; for (const w of this.wheelState) { w.contact = false; w.compression = 0; w.force = 0; }
    const ap = this.autopilot.sel, e = this.euler;
    ap.alt = Math.round(altMsl / 0.3048 / 100) * 100; ap.hdg = Math.round(wrap360(e.psi * RAD - this.magvar)); ap.spd = Math.round(iasKt); ap.vs = 0;
  }

  /** Run every engine to equilibrium at a throttle setting; returns total thrust along the body x axis. */
  steadyThrust(throttle, atm, V, mach = 0) {
    let T = 0;
    for (const e of this.engines) {
      if (!e.running) e.setRunning(e.kind === 'piston' ? 2000 : throttle);
      e.throttle = throttle; e.mixture = this.controls.mixture; e.propLever = this.controls.prop; e.reverse = 0;
      if (e.kind === 'piston') e.magnetos = MAGS.BOTH;
      for (let i = 0; i < 600; i++) e.update(1 / 60, atm, V, mach, { fuelAvailable: true, busVolts: 28, bleed: true, onGround: false });
      T += e.thrust;
    }
    return T;
  }

  /** Electrical, hydraulic, pneumatic and lighting systems on (engines unaffected). */
  setSystemsOn() {
    const s = this.elec.switches;
    s.battery = s.alternator = s.avionics = s.navLights = s.beacon = s.strobe = true;
    this.hyd.setAll(true); this.press.packs = true;
    this.fuel.selector = 'BOTH';
    for (const e of this.engines) if (e.kind !== 'piston') e.fuelOn = true;
  }

  /** Quick "ready to fly" configuration (engines running at idle, systems on). */
  setReadyState() {
    this.setSystemsOn();
    for (const e of this.engines) e.setRunning(e.kind === 'piston' ? 900 : 0);
    if (this.isPiston) { this.engine.rpm = 900; this.controls.throttle = 0.1; } else this.controls.throttle = 0;
    this.controls.mixture = 1; this.controls.prop = 1;
    this.inst.align(this.snapshotForInstruments(atmosphere(this.alt)), true);
    this.press.reset(this.alt / 0.3048);
    const e = this.euler;
    Object.assign(this.autopilot.sel, { hdg: Math.round(wrap360(e.psi * RAD - this.magvar)), alt: Math.round((this.alt / 0.3048 + 5000) / 1000) * 1000, spd: this.cfg.limits.V2 ?? 120, vs: 0 });
  }

  setColdAndDark() {
    for (const k of Object.keys(this.elec.switches)) this.elec.switches[k] = false;
    for (const e of this.engines) {
      e.running = false; e.rpm = 0;
      if (e.kind === 'piston') e.magnetos = MAGS.OFF; else { e.fuelOn = false; e.n1 = 0; e.n2 = 0; e.ng = 0; e.np = 0; e.power = 0; }
    }
    this.hyd.setAll(false); this.apu.switch = false; this.apu.n = 0;
    this.controls.throttle = 0; this.controls.mixture = this.isPiston ? 0 : 1; this.controls.parkingBrake = true;
    this.inst.align(this.snapshotForInstruments(atmosphere(this.alt)), false);
  }

  snapshotForInstruments(atm) {
    return { q: this.q, atm, magvar: this.magvar, rpm: this.vacuumRpm(), tasFwd: 0, yawRateNed: 0, p: 0, ay: 0 };
  }

  /** Vacuum pump drive for gyros: engine rpm on piston aircraft; AHRS (electrical) on the others. */
  vacuumRpm() { return this.isPiston ? this.engine.rpm : this.elec.busVolts > 18 ? 2500 : 0; }

  /**
   * Control surface deflections (rad) from control positions; sign convention: de + = nose up, da + = roll right,
   * dr + = yaw right. `surf` overrides the pilot controls (fly-by-wire law or autopilot output).
   */
  deflections(surf = null) {
    const c = this.cfg.controls, k = this.controls;
    const el = surf ? surf.elevator : k.elevator, ai = surf ? surf.aileron : k.aileron;
    const de = (el >= 0 ? el * c.elevatorUpDeg : el * c.elevatorDownDeg) * DEG + k.trim * c.trimRangeRad;
    const rud = clamp(k.rudder + (surf?.rudderAdd ?? 0), -1, 1);
    return { de, da: ai * c.aileronDeg * DEG, dr: rud * c.rudderDeg * DEG, elevator: el, aileron: ai };
  }

  /** Pitch acceleration (rad/s²) per radian of elevator at the current dynamic pressure. */
  pitchEffectiveness() {
    const a = this.cfg.aero, g = this.cfg.geometry, I = this.inertia;
    return (a.CmDe * (this.qbar || 0) * g.wingArea * g.chord / I[1]) * Math.max(0.3, this.damage.aeroFactors.hStab);
  }
  /** Roll acceleration (rad/s²) per radian of aileron. */
  rollEffectiveness() {
    const a = this.cfg.aero, g = this.cfg.geometry, I = this.inertia, f = this.damage.aeroFactors;
    return a.ClDa * (this.qbar || 0) * g.wingArea * g.span / I[0] * Math.max(0.3, (f.wingL + f.wingR) / 2);
  }

  /** Convert a body-frame offset to geodetic point (approximate local tangent plane; valid for metre offsets). */
  offsetPoint(dNed) {
    const r = radii(this.lat);
    return {
      lat: this.lat + (dNed[0] / (r.M + this.alt)) * RAD,
      lon: this.lon + (dNed[1] / ((r.N + this.alt) * Math.cos(this.lat * DEG))) * RAD,
      alt: this.alt - dNed[2],
    };
  }

  /**
   * Advance the simulation by dt.
   * @param {number} dt
   * @param {{ground?: object, weather?: object, obstacles?: object, settle?: boolean}} env
   */
  step(dt, env = {}) {
    const ground = env.ground || FLAT_GROUND;
    const c = this.cfg, k = this.controls, dmg = this.damage;
    this.time += dt;
    const m = this.mass, I = this.inertia;
    const atm = atmosphere(this.alt, env.weather?.atmosphereConditions);
    this.atm = atm;

    // Ground under CG (for AGL, ground effect, wind profile).
    const g0 = ground.sample(this.lat, this.lon, this._gs || (this._gs = {}));
    const groundH = g0.surface === 'water' ? Math.max(g0.h, 0) : g0.h;
    this.groundElev = groundH;
    this.agl = this.alt - groundH;

    // Air-relative velocity.
    const Vg = Math.hypot(this.v[0], this.v[1], this.v[2]);
    let pGust = 0;
    if (env.weather) {
      const s = env.weather.sample(dt, Math.max(this.agl, 0), Vg);
      this.windNed = s.wind; pGust = s.pGust;
    } else this.windNed = [0, 0, 0];
    const vAirNed = [this.v[0] - this.windNed[0], this.v[1] - this.windNed[1], this.v[2] - this.windNed[2]];
    const vb = nedToBody(this.q, vAirNed);
    const V = Math.hypot(vb[0], vb[1], vb[2]);
    const alpha = V > 0.5 ? Math.atan2(vb[2], vb[0]) : 0;
    const beta = V > 0.5 ? Math.asin(clamp(vb[1] / V, -1, 1)) : 0;
    this.alphaDot = clamp((alpha - this.alphaPrev) / dt, -2, 2);
    this.alphaPrev = alpha;
    this.alpha = alpha; this.beta = beta; this.tas = V;
    const qbar = 0.5 * atm.rho * V * V;
    this.qbar = qbar;
    this.mach = V / atm.a;
    const mainsOnGround = this.wheelState[1]?.contact || this.wheelState[2]?.contact;
    const hydAvail = this.hyd.available;

    // Flaps (electric drive needs bus power, hydraulic drive needs pressure). Fighter: automatic with gear.
    if (c.aero.autoFlaps) k.flapsLever = k.gearDown ? 1 : 0;
    const flapTarget = c.aero.flaps[clamp(k.flapsLever, 0, c.aero.flaps.length - 1)].deg;
    const flapPower = c.aero.flapDrive === 'hydraulic' ? hydAvail : this.elec.busVolts > 18 ? 1 : 0;
    const flapMoving = flapPower > 0.3 && Math.abs(flapTarget - this.flapDeg) > 0.01;
    if (flapPower > 0.3) this.flapDeg = moveToward(this.flapDeg, flapTarget, c.aero.flapRateDegPerSec * flapPower * dt);

    // Landing gear (retractable): squat switch blocks retraction on the ground; gravity extension without power.
    if (c.gear.retractable) {
      const wantDown = k.gearDown || mainsOnGround;
      const power = c.gear.hydraulic ? hydAvail : this.elec.busVolts > 18 ? 1 : 0;
      const rate = 1 / (c.gear.transitSec || 8);
      if (wantDown && this.gearPos < 1) this.gearPos = Math.min(1, this.gearPos + rate * (power > 0.3 ? 1 : 0.4) * dt);
      else if (!wantDown && this.gearPos > 0 && power > 0.3) this.gearPos = Math.max(0, this.gearPos - rate * dt);
    } else this.gearPos = 1;

    // Spoilers / speedbrakes: manual lever plus ground spoilers (armed, on ground, idle or reverse).
    const sp = c.aero.spoilers;
    const idle = (k.throttles ? Math.max(...k.throttles) : k.throttle) < 0.08;
    // Ground spoilers: armed + idle with the wheels spun up (> ~60 kt), or reverse selected.
    const groundSpoilers = sp && mainsOnGround && ((k.spoilersArmed && idle && Math.hypot(this.v[0], this.v[1]) > 30) || k.reverse > 0.05);
    const spTarget = sp ? (groundSpoilers ? 1 : clamp(k.speedbrake, 0, 1)) : 0;
    this.spoilerPos = moveToward(this.spoilerPos, spTarget * (sp ? Math.min(1, hydAvail + 0.2) : 0), dt / 1.0);
    const gnd = !!groundSpoilers && this.spoilerPos > 0.1;
    const liftDump = sp ? this.spoilerPos * (gnd ? sp.groundDCL : sp.dCL) : 0;
    const spoilerCD = sp ? this.spoilerPos * (gnd ? sp.groundDCD : sp.dCD) : 0;
    const gearCD = c.gear.retractable ? this.gearPos * c.gear.dragCD : 0;

    // Control laws: autopilot (when engaged) or fly-by-wire turn pilot inputs into surface commands.
    const stick = { x: k.aileron, y: k.elevator };
    let surf = null;
    if (!env.settle) {
      const apOut = this.autopilot.update(dt, this, this.nav, stick);
      if (apOut) { surf = { ...apOut, rudderAdd: 0 }; this.fbw?.loops.reset(); }
      else if (this.fbw) surf = this.fbw.update(dt, this, stick);
    }
    const defl = this.deflections(surf);
    this.totalDe = defl.de; this.surf = { elevator: defl.elevator, aileron: defl.aileron };
    const phi = this.euler.phi;
    // Yaw damper: washout (high-passed) yaw-rate feedback damps dutch roll without opposing steady turns,
    // plus a little sideslip feedback for coordination.
    this.ydR = (this.ydR ?? 0) + (this.w[2] - (this.ydR ?? 0)) * Math.min(1, dt / 2.5);
    if (c.systems?.yawDamper && !this.onGround && V > 30 && this.elec.busVolts > 18) {
      defl.dr = clamp(defl.dr + clamp(-2.0 * (this.w[2] - this.ydR) + 1.2 * beta, -0.25, 0.25), -c.controls.rudderDeg * DEG, c.controls.rudderDeg * DEG);
    }
    // Assistance: auto-rudder coordinates turns (sideslip -> rudder).
    if (this.assist.autoRudder && !this.onGround) defl.dr = clamp(defl.dr + 3.0 * beta, -c.controls.rudderDeg * DEG, c.controls.rudderDeg * DEG);

    // Aerodynamics.
    const af = dmg.aeroFactors;
    const a = this.aero.compute({
      alpha, beta, V, qbar, p: this.w[0] - pGust, q: this.w[1], r: this.w[2], alphaDot: this.alphaDot, flapDeg: this.flapDeg,
      de: defl.de, da: defl.da, dr: defl.dr, agl: this.agl, damage: af, randomGust: valueNoise(this.time * 1.7, 3.3) * 2 - 1,
      mach: this.mach, liftDump, dragExtra: spoilerCD + gearCD,
    }, this.out);
    this.CL = a.CL; this.CD = a.CD; this.stall = a.stall;
    const F = [a.F[0], a.F[1], a.F[2]], M = [a.M[0], a.M[1], a.M[2]];

    // Propulsion: every engine at its position along its thrust axis (asymmetric thrust yaws the aircraft).
    const anyTurbine = this.engines.some((e) => e.kind !== 'piston' && e.running && (e.n2 ?? e.ng) > 50);
    const sys = { fuelAvailable: this.fuel.available, busVolts: this.elec.busVolts, bleed: this.apu.available || anyTurbine, onGround: !!mainsOnGround };
    let fuelFlow = 0, starterAmps = 0;
    const Vx = Math.max(vb[0], 0);
    for (let i = 0; i < this.engines.length; i++) {
      const e = this.engines[i], ec = c.engines[i];
      e.throttle = k.throttles?.[i] ?? k.throttle; e.mixture = k.mixture; e.propLever = k.prop;
      e.reverse = mainsOnGround && e.throttle < 0.08 ? k.reverse : 0;
      e.update(dt, atm, Vx, this.mach, sys);
      const ax = ec.thrustAxis || [1, 0, 0], pos = ec.position || [0, 0, 0];
      const Ft = [ax[0] * e.thrust, ax[1] * e.thrust, ax[2] * e.thrust];
      F[0] += Ft[0]; F[1] += Ft[1]; F[2] += Ft[2];
      const mo = cross(pos, Ft);
      M[0] += mo[0]; M[1] += mo[1]; M[2] += mo[2];
      if (e.kind === 'piston') {
        const rotSign = ec.propeller?.rotation === 'ccw' ? -1 : 1;
        // Torque reaction rolls the airframe opposite to prop rotation; wing rigging cancels most of it near cruise power.
        M[0] -= rotSign * e.propTorque * (1 - (ec.torqueRigging ?? 0));
        // P-factor + spiralling slipstream: left yaw at high power, low speed, high alpha.
        if (this.engines.length === 1) M[2] -= rotSign * e.thrust * (c.aero.pFactor * alpha * RAD + c.aero.slipstreamYaw / (V + 15)) * (0.5 + 0.5 * af.vStab);
      } else if (e.kind === 'turboprop') M[0] -= e.propTorque * 0.2;
      fuelFlow += e.fuelFlow; starterAmps += e.starterAmps || 0;
    }
    this.apu.update(dt, this.elec.busVolts, this.fuel.available);
    this.fuel.consume(fuelFlow + this.apu.fuelFlow, dt);
    this.totalFuelFlow = fuelFlow;

    // Load factor from aero + thrust (what the wings feel).
    this.nz = -F[2] / (m * G0);

    // Contacts: landing gear + airframe points + water + obstacles.
    const contact = this.contacts(dt, ground, env.obstacles, F, M, m);

    // Rigid-body integration (semi-implicit Euler).
    const Fn = bodyToNed(this.q, F);
    const acc = [Fn[0] / m, Fn[1] / m, Fn[2] / m + G0];
    this.accelBody = nedToBody(this.q, [acc[0], acc[1], acc[2] - G0]);
    this.ay = this.accelBody[1];
    for (let i = 0; i < 3; i++) this.v[i] += acc[i] * dt;
    const w = this.w;
    const Iw = [I[0] * w[0], I[1] * w[1], I[2] * w[2]];
    const gyro = cross(w, Iw);
    for (let i = 0; i < 3; i++) w[i] += ((M[i] - gyro[i]) / I[i]) * dt;
    for (let i = 0; i < 3; i++) w[i] = clamp(w[i], -12, 12);
    quatIntegrate(this.q, w, dt);
    const r = radii(this.lat);
    this.lat += (this.v[0] * dt) / (r.M + this.alt) * RAD;
    this.lon += (this.v[1] * dt) / ((r.N + this.alt) * Math.cos(this.lat * DEG)) * RAD;
    if (this.lon > 180) this.lon -= 360; else if (this.lon < -180) this.lon += 360;
    this.alt -= this.v[2] * dt;

    if (env.settle) { // damp motion while settling onto gear
      this.v[0] *= 0.9; this.v[1] *= 0.9; for (let i = 0; i < 3; i++) this.w[i] *= 0.9;
      return;
    }

    // Systems.
    const e = this.engine;
    if (e.running) this.hobbs += dt / 3600;
    const genAvail = this.isPiston ? e.rpm > 900 : this.engines.some((x) => x.running && (x.n2 ?? x.ng ?? 0) > 50) || this.apu.available;
    this.elec.update(dt, genAvail, starterAmps, flapMoving);
    this.hyd.update(dt, this.engines, this.elec.busVolts);
    this.press.update(dt, this.alt, this.apu.available || anyTurbine);
    this.nav.update(dt, this);
    const e2 = this.euler;
    const yawRateNed = (this.w[1] * Math.sin(e2.phi) + this.w[2] * Math.cos(e2.phi)) / Math.max(Math.cos(e2.theta), 0.1);
    this.inst.update(dt, { q: this.q, atm, magvar: this.magvar, rpm: this.vacuumRpm(), tasFwd: Math.max(vb[0], 0), yawRateNed, p: this.w[0], ay: this.ay }, { busVolts: this.elec.busVolts });
    const mainZ = c.gear.wheels[1]?.pos[2] ?? 1;
    this.radioAlt = Math.max(0, this.agl - mainZ + (this.wheelState[1]?.compression ?? 0));
    this.gpws.update(dt, this);

    // Damage: flight loads, overspeed, damage feedback into engine.
    const ias = casFromTas(Math.max(vb[0], 0), atm.p, atm.a);
    this.iasTrue = ias;
    const mmoIas = c.limits.Mmo && this.mach > 0.3 ? ias * (c.limits.Mmo + 0.06) / this.mach : Infinity;
    dmg.flight(dt, this.nz, ias, Math.min(c.limits.Vne * KT, mmoIas), this.rand);
    this.engines.forEach((en, i) => {
      const ec = c.engines[i];
      const prop = ec.propComponent ? (dmg.detached[ec.propComponent] ? 0 : dmg.health[ec.propComponent] ?? 1) : 1;
      en.damage(dmg.health[ec.component] ?? 1, prop);
    });
    if (dmg.fire) this.fuel.leak = 0.05;
    // Gear / flap overspeed damage (doors and actuators).
    const iasKt = ias / KT;
    if (c.gear.retractable && this.gearPos > 0.05 && (iasKt > (c.limits.Vle ?? 999) * 1.15 || (this.gearPos < 0.99 && iasKt > (c.limits.Vlo ?? 999) * 1.15))) for (const g of ['noseGear', 'leftMainGear', 'rightMainGear']) dmg.apply(g, 0.02 * dt, 'gear overspeed');
    this.warnings = this.computeWarnings(ias);
    this.updateAlerts();
    return contact;
  }

  contacts(dt, ground, obstacles, F, M, m) {
    const c = this.cfg, dmg = this.damage, k = this.controls;
    const wheels = c.gear.wheels;
    let anyWheel = false, anyAirframe = false, waterPts = 0;
    const gs = this._cs || (this._cs = {});
    const tmp = [0, 0, 0];

    const applyForce = (rb, Fned) => {
      const Fb = nedToBody(this.q, Fned);
      F[0] += Fb[0]; F[1] += Fb[1]; F[2] += Fb[2];
      const mo = cross(rb, Fb, tmp);
      M[0] += mo[0]; M[1] += mo[1]; M[2] += mo[2];
    };
    const pointVel = (rb) => bodyToNed(this.q, cross(this.w, rb), [0, 0, 0]).map((x, i) => x + this.v[i]);

    const gsp = Math.hypot(this.v[0], this.v[1]);
    const steerMax = c.controls.tillerDeg ? c.controls.nosewheelSteerDeg + (c.controls.tillerDeg - c.controls.nosewheelSteerDeg) * (1 - smoothstep(4, 15, gsp)) : c.controls.nosewheelSteerDeg;
    const steer = k.rudder * steerMax * DEG;
    const brakeL = k.parkingBrake ? 1 : k.brakeL, brakeR = k.parkingBrake ? 1 : k.brakeR;

    // ---- Wheels (spring-damper struts with tyre friction) ----
    for (let i = 0; i < wheels.length; i++) {
      const wcfg = wheels[i], st = this.wheelState[i];
      st.contact = false; st.force = 0;
      if (dmg.detached[wcfg.component] || this.gearPos < 0.98) { st.compression = 0; st.wasContact = false; continue; }
      const rb = wcfg.pos;
      const dN = bodyToNed(this.q, rb);
      const p = this.offsetPoint(dN);
      const g = ground.sample(p.lat, p.lon, gs);
      const surf = surfaceOf(g.surface);
      if (surf.water) { // wheels in water: handled as drag points below
        if (p.alt < 0) waterPts++;
        st.compression = 0; st.wasContact = false;
        continue;
      }
      // surface roughness bumps (deterministic in space)
      const bump = surf.rough ? (valueNoise(p.lat * 1e4, p.lon * 1e4) - 0.5) * surf.rough * 2 : 0;
      const pen = g.h + bump - p.alt;
      if (pen <= 0) { st.compression = Math.max(0, st.compression - dt * 2); st.wasContact = false; continue; }
      const n = [g.normal[1], g.normal[0], -g.normal[2]]; // ENU -> NED
      const vp = pointVel(rb);
      const closing = -dot(vp, n);
      st.compression = Math.min(pen, wcfg.travel);
      let N = wcfg.k * pen + wcfg.c * closing;
      if (pen > wcfg.travel) N += wcfg.k * 40 * (pen - wcfg.travel); // bottoming out
      N = Math.max(0, N);
      if (!st.wasContact) {
        // touchdown impact
        dmg.impact(wcfg.component, closing, 0, m, g.surface);
        if (i > 0 || !this.touchdown || this.time - this.touchdown.time > 2) this.touchdown = { time: this.time, wheel: wcfg.name, sinkRate: closing, surface: g.surface, lat: p.lat, lon: p.lon };
      }
      st.wasContact = true; st.contact = true; anyWheel = true;
      // Tyre frame on the ground plane.
      const fb = [Math.cos(wcfg.steer ? steer : 0), Math.sin(wcfg.steer ? steer : 0), 0];
      let f = bodyToNed(this.q, fb);
      const fn = dot(f, n); f = normalize([f[0] - fn * n[0], f[1] - fn * n[1], f[2] - fn * n[2]]);
      const l = cross(n, f); // points right of travel direction in NED (n is up)... sign irrelevant (we use projections)
      const vf = dot(vp, f), vl = dot(vp, l);
      st.rot += (vf / (wcfg.radius || 0.2)) * dt;
      const muScale = surf.mu / 0.8;
      const brake = wcfg.brake ? (wcfg.pos[1] < 0 ? brakeL : brakeR) : 0;
      const muLong = c.gear.rollingMu * surf.roll + brake * c.gear.brakeMu * muScale;
      let Ff = -clamp(vf / (brake > 0.05 ? 0.08 : 0.3), -1, 1) * muLong * N;
      let Fl = -clamp(vl / 0.12, -1, 1) * c.gear.lateralMu * muScale * N;
      const lim = surf.mu * N * 1.05, tot = Math.hypot(Ff, Fl);
      if (tot > lim) { Ff *= lim / tot; Fl *= lim / tot; }
      st.force = N; st.side = Fl; st.slip = vl;
      dmg.gearLoad(wcfg.component, N, Fl);
      applyForce(rb, [N * n[0] + Ff * f[0] + Fl * l[0], N * n[1] + Ff * f[1] + Fl * l[1], N * n[2] + Ff * f[2] + Fl * l[2]]);
      this.lastSurface = g.surface;
    }

    // ---- Airframe hard points (belly, wingtips, tail, propeller ...) ----
    const kAir = m * 500, cAir = m * 45;
    for (let i = 0; i < c.contacts.length; i++) {
      const pc = c.contacts[i], st = this.contactState[i];
      if (dmg.detached[pc.component]) { st.contact = false; continue; }
      const rb = pc.pos;
      const dN = bodyToNed(this.q, rb);
      const p = this.offsetPoint(dN);
      const g = ground.sample(p.lat, p.lon, gs);
      const surf = surfaceOf(g.surface);
      const vp = pointVel(rb);
      let hit = null;
      if (surf.water) {
        if (p.alt < 0) { waterPts++; this.waterContact(pc, st, p, vp, rb, m, applyForce, dt); continue; }
      } else if (g.h - p.alt > 0) {
        hit = { depth: g.h - p.alt, n: [g.normal[1], g.normal[0], -g.normal[2]], surface: g.surface, mu: surf.mu };
      }
      if (!hit && obstacles) {
        const o = obstacles.queryGeodetic(p.lat, p.lon, p.alt);
        if (o) {
          if (o.type === 'tree' && !o.trunk) { this.treeContact(pc, o, vp, rb, applyForce); st.contact = false; continue; }
          hit = { depth: Math.min(o.depth, 1.5), n: [o.normal[1], o.normal[0], -o.normal[2]], surface: o.type === 'tree' ? 'tree' : 'building', mu: 0.6 };
        }
      }
      if (!hit) { st.contact = false; continue; }
      anyAirframe = true;
      const closing = -dot(vp, hit.n);
      const vt = Math.sqrt(Math.max(0, dot(vp, vp) - closing * closing));
      if (!st.contact) {
        dmg.impact(pc.component, Math.max(closing, 0), vt, m, hit.surface);
        const pe = this.propToEngine.get(pc.component);
        if (pe !== undefined && this.engines[pe].rpm > 200) dmg.apply(pc.component, 0.5 + this.engines[pe].rpm / (c.engines[pe].propRPM || c.engines[pe].maxRPM || 2700), 'propeller strike');
        this.events.push({ t: this.time, type: 'contact', point: pc.name, surface: hit.surface, vn: closing });
      }
      st.contact = true;
      const N = Math.max(0, kAir * hit.depth + cAir * closing);
      const vtx = [vp[0] + closing * hit.n[0], vp[1] + closing * hit.n[1], vp[2] + closing * hit.n[2]];
      const vtl = Math.hypot(vtx[0], vtx[1], vtx[2]);
      const Ft = vtl > 1e-3 ? -hit.mu * N * clamp(vtl / 0.5, 0, 1) / vtl : 0;
      dmg.scrape(pc.component, hit.mu * N * vtl * dt);
      applyForce(rb, [N * hit.n[0] + Ft * vtx[0], N * hit.n[1] + Ft * vtx[1], N * hit.n[2] + Ft * vtx[2]]);
    }

    this.onGround = anyWheel || anyAirframe;
    this.inWater = waterPts > 0;
    if (this.inWater) this.waterTime += dt; else this.waterTime = 0;
    if (this.inWater && this.waterTime > 3 && Math.hypot(this.v[0], this.v[1]) < 3 && !dmg.ditched) {
      dmg.ditched = true; dmg.log('ditched', 'airframe', 0.5, 'aircraft came to rest on water');
    }
    return { anyWheel, anyAirframe };
  }

  waterContact(pc, st, p, vp, rb, m, applyForce, dt) {
    const dmg = this.damage;
    const depth = -p.alt;
    const vn = Math.max(0, vp[2]);
    const vt = Math.hypot(vp[0], vp[1]);
    if (!st.contact) {
      dmg.impact(pc.component, vn, vt, m, 'water');
      const pe = this.propToEngine.get(pc.component);
      if (pe !== undefined && this.engines[pe].rpm > 200) dmg.apply(pc.component, 0.6, 'propeller struck water');
      this.events.push({ t: this.time, type: 'water', point: pc.name, vn });
    }
    st.contact = true;
    this.lastSurface = 'water';
    // Buoyancy (volume share per point; slowly floods), plus hydrodynamic drag limited to not reverse velocity.
    const scale = this.cfg.mass.maxTakeoff / 1157;
    const vol = (pc.component === 'fuselage' ? 0.9 : pc.component.endsWith('Wing') ? 0.35 : 0.08) * scale * Math.max(0.15, 1 - this.waterTime / 240);
    const buoy = RHO_WATER * G0 * vol * clamp(depth, 0, 1);
    const sp = Math.hypot(vp[0], vp[1], vp[2]);
    let drag = 0.5 * RHO_WATER * 0.9 * 0.06 * Math.cbrt(this.cfg.mass.maxTakeoff / 1157) ** 2 * sp * sp;
    drag = Math.min(drag, (m * 0.25 * sp) / dt / 4);
    const f = sp > 1e-3 ? -drag / sp : 0;
    applyForce(rb, [f * vp[0], f * vp[1], -buoy + f * vp[2]]);
  }

  treeContact(pc, o, vp, rb, applyForce) {
    const sp = Math.hypot(vp[0], vp[1], vp[2]);
    const key = o.obj;
    if (!this.treeHits.has(key)) {
      this.treeHits.add(key);
      this.damage.impact(pc.component, sp * 0.3, sp, this.mass, 'tree');
      this.events.push({ t: this.time, type: 'tree', point: pc.name, v: sp });
    }
    const drag = 0.5 * 1.2 * 1.1 * 3.0 * sp * sp; // branches: ~3 m^2 effective area
    const f = sp > 1e-3 ? -Math.min(drag, this.mass * 20) / sp : 0;
    applyForce(rb, [f * vp[0], f * vp[1], f * vp[2]]);
  }

  computeWarnings(ias) {
    const c = this.cfg, e = this.engine, el = this.elec, k = this.controls;
    const powered = el.busVolts > 18;
    const stallAlpha = ((c.aero.alphaStallDeg ?? c.aero.generic.alphaStallDeg) - this.aero.flapValue(this.flapDeg, 'alphaShift') - (this.isPiston ? 3.5 : 2.5)) * DEG;
    const iasKt = ias / KT;
    const vfe = (c.limits.Vfe || []).find(([deg]) => this.flapDeg <= deg + 0.5)?.[1] ?? c.limits.Vfe?.at(-1)?.[1];
    const mainsGround = this.wheelState.some((w) => w.contact && w.force > 500);
    const thrMax = k.throttles ? Math.max(...k.throttles) : k.throttle;
    const fam = c.family;
    return {
      stall: powered && this.alpha > stallAlpha && this.tas > 12 && !mainsGround && fam !== 'fighter',
      overspeed: iasKt > (c.limits.Vmo ?? c.limits.Vne) || (c.limits.Mmo && this.mach > c.limits.Mmo + 0.005),
      flapOverspeed: this.flapDeg > 0.5 && vfe != null && iasKt > vfe,
      lowVolts: el.lowVolts,
      oilPress: powered && this.engines.some((x) => x.oilPress < (x.kind === 'piston' ? 20 : 13) && (x.running || x.kind === 'piston')),
      lowFuelL: powered && this.fuel.lowFuel(0),
      lowFuelR: powered && this.fuel.lowFuel(1),
      vacuum: powered && this.isPiston && this.inst.vacuum < 3.5,
      fire: this.damage.fire,
      overG: this.nz > c.damage.gLimitPos || this.nz < c.damage.gLimitNeg,
      gear: c.gear.retractable && !this.onGround && this.gearPos < 0.99 && this.radioAlt < 800 * 0.3048 && (thrMax < 0.15 || this.flapDeg >= (c.aero.flaps.at(-2)?.deg ?? 99)),
      config: c.family !== 'ga' && mainsGround && thrMax > 0.6 && (this.flapDeg < 0.5 && c.family !== 'fighter' && c.family !== 'twin-turboprop' || k.parkingBrake || this.spoilerPos > 0.2 || Math.abs(k.trim) > 0.85),
      cabinAlt: this.press.warning,
      hydLow: this.hyd.present && this.engines.some((x) => x.running) ? this.hyd.lowSystems() : [],
      genOff: powered && !this.isPiston && !this.engines.some((x) => x.running) && !this.apu.available,
      reverser: this.engines.some((x) => x.reverser > 0.1),
      apDisc: !!this.autopilot.disc,
    };
  }

  /** Master warning / caution lists with latching master lights (reset by cmd.resetMaster). */
  updateAlerts() {
    const w = this.warnings, warnings = [], cautions = [];
    if (w.fire) warnings.push('FIRE');
    if (w.stall) warnings.push('STALL');
    if (w.overspeed) warnings.push('OVERSPEED');
    if (w.config) warnings.push('CONFIG');
    if (w.cabinAlt) warnings.push('CABIN ALT');
    if (w.gear) warnings.push('GEAR');
    if (w.apDisc) warnings.push('AP DISC');
    if (w.overG) warnings.push('OVER G');
    if (w.flapOverspeed) cautions.push('FLAP SPEED');
    for (const h of w.hydLow) cautions.push(`HYD ${h} LO`);
    if (w.genOff) cautions.push('GEN OFF');
    if (w.lowVolts) cautions.push('LOW VOLTS');
    if (w.oilPress) cautions.push('OIL PRESS');
    if (w.lowFuelL || w.lowFuelR) cautions.push('FUEL LOW');
    if (this.engines.some((x) => x.failed)) cautions.push('ENG FAIL');
    if (this.spoilerPos > 0.2 && !this.onGround && this.flapDeg > 10) cautions.push('SPD BRK');
    this.alerts = { warnings, cautions };
    for (const a of warnings) if (!this._alertKeys.has(a)) { this.masterWarning = true; this._alertKeys.add(a); }
    for (const a of cautions) if (!this._alertKeys.has(a)) { this.masterCaution = true; this._alertKeys.add(a); }
    for (const a of [...this._alertKeys]) if (!warnings.includes(a) && !cautions.includes(a)) this._alertKeys.delete(a);
  }

  /** Flat snapshot of the state for UI, instruments, recording and debug. */
  snapshot() {
    const e = this.euler, gs = Math.hypot(this.v[0], this.v[1]);
    return {
      t: this.time, lat: this.lat, lon: this.lon, alt: this.alt, agl: this.agl ?? 0,
      pitch: e.theta * RAD, roll: e.phi * RAD, heading: wrap360(e.psi * RAD), headingMag: wrap360(e.psi * RAD - this.magvar),
      track: gs > 0.5 ? wrap360(Math.atan2(this.v[1], this.v[0]) * RAD) : wrap360(e.psi * RAD),
      ias: this.iasTrue ?? 0, tas: this.tas ?? 0, gs, vs: -this.v[2], alpha: (this.alpha ?? 0) * RAD, beta: (this.beta ?? 0) * RAD,
      nz: this.nz, p: this.w[0] * RAD, q: this.w[1] * RAD, r: this.w[2] * RAD,
      rpm: this.engine.rpm, thrust: this.engines.reduce((t, x) => t + x.thrust, 0), power: this.engine.power, fuelFlow: this.totalFuelFlow ?? this.engine.fuelFlow, running: this.engine.running,
      mach: this.mach, gearPos: this.gearPos, spoilers: this.spoilerPos, radioAlt: this.radioAlt,
      fuelL: this.fuel.tanks[0].qty, fuelR: this.fuel.tanks[1].qty, mass: this.mass,
      flaps: this.flapDeg, flapsLever: this.controls.flapsLever, trim: this.controls.trim, onGround: this.onGround, inWater: this.inWater,
      surface: this.lastSurface, stall: this.stall ?? 0, CL: this.CL ?? 0, CD: this.CD ?? 0, wind: this.windNed, groundElev: this.groundElev ?? 0,
    };
  }
}

export { MAGS };
