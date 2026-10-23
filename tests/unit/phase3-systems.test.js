// Phase 3 systems: turbofan / turboprop engines, hydraulics, pressurisation, APU, GPWS, nav receivers,
// autopilot interlocks and transport command interlocks.
import { describe, it, expect } from 'vitest';
import { Aircraft, SIM_DT } from '../../src/sim/aircraft.js';
import { AIRCRAFT } from '../../src/aircraft/index.js';
import { TurbofanEngine } from '../../src/sim/fdm/propulsion/turbofan.js';
import { TurbopropEngine } from '../../src/sim/fdm/propulsion/turboprop.js';
import { Hydraulics } from '../../src/sim/systems/hydraulics.js';
import { Pressurization, Apu } from '../../src/sim/systems/pressurization.js';
import { makeIls, NavSystem } from '../../src/sim/nav/nav.js';
import { createCommands } from '../../src/sim/commands.js';
import { atmosphere } from '../../src/sim/atmosphere.js';
import { destination } from '../../src/geo/wgs84.js';
import { ground } from '../helpers.js';

const FT = 0.3048, KT = 0.514444;
const sys = (o = {}) => ({ fuelAvailable: true, busVolts: 28, bleed: true, onGround: false, ...o });
const make = (id) => new Aircraft(AIRCRAFT[id], { seed: 3 });

describe('Turbofan engine', () => {
  const cfg = AIRCRAFT.a320.engines[0];
  it('spools up with lag and loses thrust with altitude and Mach', () => {
    const e = new TurbofanEngine(cfg); e.setRunning(0); e.throttle = 1;
    const sl = atmosphere(0);
    e.update(1, sl, 0, 0, sys()); expect(e.n1).toBeLessThan(80); // not instantaneous
    for (let i = 0; i < 600; i++) e.update(0.05, sl, 0, 0, sys());
    const Tsl = e.thrust; expect(Tsl / cfg.maxThrust).toBeGreaterThan(0.95);
    const hi = atmosphere(35000 * FT);
    for (let i = 0; i < 600; i++) e.update(0.05, hi, 230, 0.78, sys());
    expect(e.thrust / Tsl).toBeGreaterThan(0.18); expect(e.thrust / Tsl).toBeLessThan(0.35);
    expect(e.fuelFlow).toBeGreaterThan(0);
  });
  it('starts from cold with bleed air, lights off and stabilises at idle', () => {
    const e = new TurbofanEngine(cfg); e.fuelOn = true; e.starter = true;
    const sl = atmosphere(0);
    for (let i = 0; i < 1200 && !e.running; i++) e.update(0.05, sl, 0, 0, sys());
    expect(e.running).toBe(true);
    e.starter = false; for (let i = 0; i < 1200; i++) e.update(0.05, sl, 0, 0, sys());
    expect(e.n2).toBeGreaterThan(cfg.idleN2 - 3); expect(e.n1).toBeGreaterThan(cfg.idleN1 - 3);
    e.fuelOn = false; e.update(0.05, sl, 0, 0, sys()); expect(e.running).toBe(false);
  });
  it('deploys reversers only on the ground and produces reverse thrust', () => {
    const e = new TurbofanEngine(cfg); e.setRunning(0); e.throttle = 0; e.reverse = 1;
    const sl = atmosphere(0);
    for (let i = 0; i < 200; i++) e.update(0.05, sl, 60, 0.18, sys({ onGround: false }));
    expect(e.reverser).toBe(0);
    for (let i = 0; i < 400; i++) e.update(0.05, sl, 60, 0.18, sys({ onGround: true }));
    expect(e.reverser).toBeGreaterThan(0.95); expect(e.thrust).toBeLessThan(0);
  });
  it('afterburner multiplies thrust and fuel flow on the fighter', () => {
    const f = AIRCRAFT.fighter.engines[0], e = new TurbofanEngine(f), sl = atmosphere(0);
    e.setRunning(0.95); e.throttle = 0.95; for (let i = 0; i < 400; i++) e.update(0.05, sl, 0, 0, sys());
    const dry = e.thrust, ffDry = e.fuelFlow;
    e.throttle = 1; for (let i = 0; i < 400; i++) e.update(0.05, sl, 0, 0, sys());
    expect(e.afterburner).toBe(true); expect(e.thrust / dry).toBeGreaterThan(1.5); expect(e.fuelFlow / ffDry).toBeGreaterThan(3);
  });
});

describe('Turboprop engine', () => {
  const cfg = AIRCRAFT.kingair.engines[0];
  it('governs propeller rpm, reports torque, and feathers when shut down in flight', () => {
    const e = new TurbopropEngine(cfg), sl = atmosphere(0);
    e.setRunning(0.8); e.throttle = 0.8; e.propLever = 1;
    for (let i = 0; i < 600; i++) e.update(0.05, sl, 60, 0.18, sys());
    expect(Math.abs(e.np - cfg.propRPM) / cfg.propRPM).toBeLessThan(0.05);
    expect(e.indications().tq).toBeGreaterThan(40); expect(e.thrust).toBeGreaterThan(5000);
    e.fuelOn = false; for (let i = 0; i < 400; i++) e.update(0.05, sl, 60, 0.18, sys());
    expect(e.running).toBe(false); expect(e.feathered).toBe(true); expect(e.np).toBeLessThan(cfg.propRPM * 0.2);
  });
});

describe('Hydraulics, pressurisation and APU', () => {
  it('engine-driven pumps pressurise their systems; electric pumps back them up', () => {
    const h = new Hydraulics(AIRCRAFT.a320.systems.hydraulics);
    const engines = [{ running: true, n2: 60 }, { running: false, n2: 0 }];
    for (let i = 0; i < 100; i++) h.update(0.1, engines, 28);
    const p = Object.fromEntries(h.systems.map((s) => [s.name, s.pressure]));
    expect(p.G).toBeGreaterThan(2500); expect(p.Y).toBeLessThan(500); expect(h.lowSystems()).toContain('Y');
    h.setAll(true); for (let i = 0; i < 100; i++) h.update(0.1, engines, 28);
    expect(h.systems.find((s) => s.name === 'Y').pressure).toBeGreaterThan(2500);
  });
  it('cabin follows the schedule within max differential; climbs to ambient without packs', () => {
    const pr = new Pressurization({ maxDiffPsi: 8.6 }); pr.reset(0);
    for (let i = 0; i < 3000; i++) pr.update(1, 37000 * FT, true);
    expect(pr.cabinAltFt).toBeGreaterThan(6000); expect(pr.cabinAltFt).toBeLessThan(8100);
    expect(pr.diffPsi).toBeGreaterThan(7); expect(pr.diffPsi).toBeLessThan(8.7); expect(pr.warning).toBe(false);
    pr.packs = false; for (let i = 0; i < 600; i++) pr.update(1, 37000 * FT, true);
    expect(pr.warning).toBe(true);
  });
  it('APU needs battery power to start and becomes available', () => {
    const a = new Apu(true); a.switch = true;
    for (let i = 0; i < 100; i++) a.update(0.5, 0, true); expect(a.available).toBe(false);
    for (let i = 0; i < 100; i++) a.update(0.5, 28, true); expect(a.available).toBe(true); expect(a.fuelFlow).toBeGreaterThan(0);
  });
});

describe('Navigation receivers', () => {
  const thr = { lat: 37.6, lon: -122.4, elev: 0 };
  const ils = makeIls({ ident: 'TEST', runway: '36', threshold: thr, heading: 0, length: 3000 });
  const at = (distNm, offsetM, altFt) => {
    const p = destination(thr.lat, thr.lon, 180, distNm * 1852), q = destination(p.lat, p.lon, 90, offsetM);
    const ac = { lat: q.lat, lon: q.lon, alt: altFt * FT, v: [70, 0, 0], euler: { psi: 0 } };
    const n = new NavSystem(); n.setIls(ils); n.update(0, ac, true); return n.ilsInfo;
  };
  it('localizer deviation points towards the course (fly left when right of it)', () => {
    const r = at(8, 300, 2500), l = at(8, -300, 2500), c = at(8, 0, 2500);
    expect(r.locValid).toBe(true); expect(r.locDots).toBeLessThan(-0.2); expect(l.locDots).toBeGreaterThan(0.2); expect(Math.abs(c.locDots)).toBeLessThan(0.05);
  });
  it('glideslope deviation: above the 3° path reads fly-down', () => {
    const d = 6 * 1852 + 300, onPath = Math.tan(3 * Math.PI / 180) * d / FT;
    expect(Math.abs(at(6, 0, onPath).gsDots)).toBeLessThan(0.1);
    expect(at(6, 0, onPath + 300).gsDots).toBeLessThan(-0.5); expect(at(6, 0, onPath - 300).gsDots).toBeGreaterThan(0.5);
  });
  it('direct-to reports distance, desired track and cross-track error', () => {
    const ac = make('a320'); ac.placeAirborne(37.0, -122.4, 3000, 0, 250);
    ac.nav.directTo({ ident: 'X', lat: 37.5, lon: -122.4 }, ac);
    expect(ac.nav.dtoInfo.dist / 1852).toBeCloseTo(30, 0); expect(Math.min(ac.nav.dtoInfo.dtk, 360 - ac.nav.dtoInfo.dtk)).toBeLessThan(0.5); expect(Math.abs(ac.nav.dtoInfo.xtk)).toBeLessThan(5);
  });
});

describe('GPWS', () => {
  it('warns of excessive sink rate near the ground and calls radio altitudes on approach', () => {
    const ac = make('b737'); ac.placeAirborne(37.6, -122.4, 900 * FT, 0, 150, { flapsLever: 5, gearDown: true });
    ac.v[2] = 3000 * FT / 60; // 3000 fpm down
    for (let i = 0; i < 240; i++) ac.step(SIM_DT, { ground: ground() });
    expect(ac.gpws.drain().some((x) => /SINK RATE|PULL UP/.test(x))).toBe(true);
    // stabilised 3° approach: radio-altitude callouts, no alert
    const bc = make('b737'); bc.placeAirborne(37.6, -122.4, 600 * FT, 0, 145, { flapsLever: 5, gearDown: true, flightPathDeg: -3 }); bc.gpws.takeoff = false;
    const heard = [];
    for (let i = 0; i < 240 * 40 && bc.radioAlt / FT > 60; i++) { bc.step(SIM_DT, { ground: ground() }); heard.push(...bc.gpws.drain()); }
    expect(heard).toContain('500'); expect(heard).toContain('100'); expect(heard.some((x) => /PULL|SINK|TERRAIN/.test(x))).toBe(false);
  });
  it('TOO LOW GEAR with the gear up close to the ground', () => {
    const ac = make('a320'); ac.placeAirborne(37.6, -122.4, 450 * FT, 0, 150, { flapsLever: 4, gearDown: false, flightPathDeg: -3 }); // flaps 3: landing configuration
    ac.gpws.takeoff = false;
    const heard = [];
    for (let i = 0; i < 240 * 4; i++) { ac.step(SIM_DT, { ground: ground() }); heard.push(...ac.gpws.drain()); }
    expect(heard).toContain('TOO LOW GEAR'); expect(ac.alerts.warnings).toContain('GEAR');
  });
});

describe('Command interlocks', () => {
  it('gear cannot retract on the ground; reverse only on the ground at idle', () => {
    const ac = make('a320'); ac.placeOnGround(37.6, -122.4, 0, ground()); ac.setReadyState();
    const c = createCommands(ac);
    c.gear(false); expect(ac.controls.gearDown).toBe(true);
    ac.controls.throttle = 0.5; c.reverse(true); expect(ac.controls.reverse).toBe(0);
    ac.controls.throttle = 0; c.reverse(true); expect(ac.controls.reverse).toBe(1);
    ac.placeAirborne(37.6, -122.4, 1000, 0, 200); c.gear(false); expect(ac.controls.gearDown).toBe(false);
    for (let i = 0; i < 240 * 15; i++) ac.step(SIM_DT, {});
    expect(ac.gearPos).toBeLessThan(0.02);
  });
  it('autopilot will not engage on the ground and disconnects on a firm stick input', () => {
    const ac = make('b787'); ac.placeOnGround(37.6, -122.4, 0, ground()); ac.setReadyState();
    const c = createCommands(ac); c.apToggle(); expect(ac.autopilot.engaged).toBe(false);
    ac.placeAirborne(37.6, -122.4, 3000, 0, 250); c.apToggle(); expect(ac.autopilot.engaged).toBe(true);
    ac.controls.elevator = 0.8; ac.step(SIM_DT, {}); expect(ac.autopilot.engaged).toBe(false); expect(ac.autopilot.fma().disc).toBe('override');
  });
  it('master warning latches on a new warning and resets', () => {
    const ac = make('a320'); ac.placeAirborne(37.6, -122.4, 3000, 0, 250);
    ac.controls.gearDown = false; ac.gearPos = 0; ac.controls.flapsLever = 5; ac.flapDeg = 35; ac.controls.throttle = 0;
    ac.placeAirborne(37.6, -122.4, 200, 0, 140, { flapsLever: 5, gearDown: false }); ac.controls.throttle = 0;
    for (let i = 0; i < 240; i++) ac.step(SIM_DT, { ground: ground() });
    expect(ac.alerts.warnings).toContain('GEAR'); expect(ac.masterWarning).toBe(true);
    createCommands(ac).masterReset(); expect(ac.masterWarning).toBe(false);
  });
});
