// Autopilot / flight director / autothrottle. Outer loops turn the selected modes into bank and pitch
// targets; model-based inner loops (AttitudeLoops) move the real control surfaces and auto-trim — the
// aircraft is never repositioned. Per-aircraft limits come from config.autopilot.
//   Lateral : ROL (wings level / bank hold), HDG, NAV (GPS direct-to), LOC (synthetic ILS), armed NAV/LOC
//   Vertical: PIT (attitude hold), VS, ALT, ALT* (capture), FLC (speed on pitch), GS, FLARE (autoland)
//   A/T     : SPD, THR CLB, IDLE, RETARD
import { clamp } from '../../core/math.js';
import { DEG, RAD, wrap180 } from '../../geo/wgs84.js';
import { KT, FT, G0 } from '../../core/units.js';
import { AttitudeLoops } from '../fdm/control-laws.js';

const theta0 = (ac) => ac.euler.theta;

export class Autopilot {
  constructor(cfg = {}) {
    this.cfg = { maxBank: 25, maxVs: 2000, at: false, flc: false, app: true, nav: true, autoland: false, pitchRate: 3, rollRate: 5, maxPitch: 20, minPitch: -12, ...cfg };
    this.loops = new AttitudeLoops();
    this.reset();
  }
  reset() {
    this.engaged = false; this.fd = false; this.atEngaged = false;
    this.lat = 'ROL'; this.vert = 'PIT'; this.latArm = null; this.vertArm = null; this.atMode = 'SPD';
    this.sel = { hdg: 0, alt: 3000, vs: 0, spd: 250 };
    this.bankHold = 0; this.pitchHold = 0; this.vsI = 0; this.flcPitch = 0; this.pitchT = 0; this.bankT = 0;
    this.disc = null; this.loops.reset(); this.lastIas = null; this.accelF = 0; this.gammaPrev = null; this.gammaDot = 0; this.touchdownT = null;
    this.out = null;
  }

  get available() { return true; }
  /** Engage the autopilot; keeps current attitude modes (roll hold / VS) if none selected. */
  engage(ac) {
    if (ac.onGround) return false;
    const s = ac.snapshot();
    this.engaged = true; this.disc = null; this.loops.reset();
    if (this.lat === 'ROL') this.bankHold = Math.abs(s.roll) < 6 ? 0 : clamp(s.roll, -this.cfg.maxBank, this.cfg.maxBank);
    if (this.vert === 'PIT') { this.vert = 'VS'; this.sel.vs = Math.round((s.vs / FT * 60) / 100) * 100; }
    this.vsI = 0; this.flcPitch = s.pitch;
    return true;
  }
  disengage(reason = 'manual') { if (this.engaged) this.disc = { reason, t: 0 }; this.engaged = false; this.loops.reset(); }
  toggle(ac) { if (this.engaged) this.disengage(); else this.engage(ac); }
  toggleAt(ac) { if (!this.cfg.at) return; this.atEngaged = !this.atEngaged; if (this.atEngaged) { this.atMode = 'SPD'; if (!this.sel.spd) this.sel.spd = Math.round(ac.snapshot().ias / KT); } }

  setLateral(mode, ac) {
    if (mode === 'HDG') { this.lat = this.lat === 'HDG' ? 'ROL' : 'HDG'; this.latArm = null; }
    else if (mode === 'NAV') { if (!this.cfg.nav) return; this.latArm = this.latArm === 'NAV' ? null : 'NAV'; if (this.lat === 'NAV') { this.lat = 'ROL'; this.latArm = null; } }
    else if (mode === 'APP') { if (!this.cfg.app) return; const on = this.latArm === 'LOC' || this.lat === 'LOC'; if (on) { this.latArm = null; if (this.lat === 'LOC') this.lat = 'HDG'; this.vertArm = null; if (this.vert === 'GS') this.vert = 'VS'; } else { this.latArm = 'LOC'; this.vertArm = 'GS'; } }
    if (this.lat === 'ROL' && ac) this.bankHold = 0;
  }
  setVertical(mode, ac) {
    const s = ac.snapshot();
    if (mode === 'ALT') { this.vert = this.vert === 'ALT' ? 'VS' : 'ALT'; if (this.vert === 'ALT') this.sel.alt = Math.round(s.alt / FT / 10) * 10; else this.sel.vs = 0; }
    else if (mode === 'VS') { this.vert = 'VS'; this.sel.vs = Math.round((s.vs / FT * 60) / 100) * 100; }
    else if (mode === 'FLC') { if (!this.cfg.flc) return; this.vert = 'FLC'; this.flcPitch = s.pitch; if (!this.sel.spd) this.sel.spd = Math.round(s.ias / KT); else if (!this.atEngaged) this.sel.spd = Math.round(s.ias / KT); }
    this.vsI = 0;
  }
  bump(field, d) {
    const s = this.sel;
    if (field === 'hdg') s.hdg = ((Math.round(s.hdg) + d) % 360 + 360) % 360;
    else if (field === 'alt') s.alt = clamp(Math.round((s.alt + d) / 100) * 100, 0, 50000);
    else if (field === 'vs') s.vs = clamp(s.vs + d, -this.cfg.maxVs, this.cfg.maxVs);
    else if (field === 'spd') s.spd = clamp(s.spd + d, 60, 400);
  }

  /** Per-sim-step update. Returns {elevator, aileron} when the AP flies the aircraft, else null. */
  update(dt, ac, nav, stick) {
    if (this.disc) { this.disc.t += dt; if (this.disc.t > 3) this.disc = null; }
    const c = this.cfg, s = ac.snapshot();
    const ias = s.ias / KT, altFt = s.alt / FT, vsFpm = s.vs / FT * 60;
    const V = Math.max(s.tas, 20);
    const ra = ac.radioAlt / FT;
    // Pilot override disconnects (any sharp stick input).
    if (this.engaged && (Math.abs(stick.x) > 0.35 || Math.abs(stick.y) > 0.35)) this.disengage('override');
    // Stall warning disconnects the autopilot (the pilot must recover); FLC never targets below 1.3 Vs.
    if (this.engaged && !ac.onGround && (s.stall > 0.4 || (ac.cfg.limits.Vs1 && ias < ac.cfg.limits.Vs0 * 0.95))) this.disengage('stall');
    const minSpd = Math.round((ac.cfg.limits.Vs1 ?? 50) * 1.3);
    const ils = nav?.ilsInfo, dto = nav?.dtoInfo;
    // Filtered airspeed trend (kt/s) damps both speed loops (FLC pitch and autothrottle).
    const accel = this.lastIas == null ? 0 : (ias - this.lastIas) / dt;
    this.accelF += (accel - this.accelF) * clamp(dt / 1.0, 0, 1);

    // ---- Mode transitions ----
    if (this.latArm === 'NAV' && dto) { this.lat = 'NAV'; this.latArm = null; }
    if (this.latArm === 'LOC' && ils?.locValid && Math.abs(ils.locDev) < 2.2) { this.lat = 'LOC'; this.latArm = null; }
    if (this.vertArm === 'GS' && this.lat === 'LOC' && ils?.gsValid && Math.abs(ils.gsDev) < 0.15) { this.vert = 'GS'; this.vertArm = null; this.vsI = 0; }
    if (['VS', 'FLC'].includes(this.vert)) {
      const err = this.sel.alt - altFt, band = Math.max(150, Math.abs(vsFpm) / 6);
      if (Math.abs(err) < band && Math.sign(err) === Math.sign(vsFpm || err)) this.vert = 'ALT*';
    }
    if (this.vert === 'ALT*' && Math.abs(this.sel.alt - altFt) < 25 && Math.abs(vsFpm) < 300) this.vert = 'ALT';
    if (this.vert === 'GS' && c.autoland && this.engaged && ra < 50 && ra > 0) this.vert = 'FLARE';
    // Without autoland the autopilot may not be used below its minimum use height on an approach.
    if (this.engaged && !c.autoland && this.vert === 'GS' && ra > 0 && ra < (c.minUseFt ?? 160)) this.disengage('minimums');

    // ---- Lateral: bank target (deg) ----
    let bankT = this.bankHold;
    const trk = s.track, hdgM = s.headingMag;
    const trackToBank = (tTrue) => clamp(wrap180(tTrue - trk) * 2.5, -c.maxBank, c.maxBank);
    if (this.lat === 'HDG') bankT = clamp(wrap180(this.sel.hdg - hdgM) * 2.5, -c.maxBank, c.maxBank);
    else if (this.lat === 'NAV' && dto) bankT = trackToBank(dto.dtk - clamp(dto.xtk * 0.012, -30, 30));
    else if (this.lat === 'LOC' && ils) bankT = trackToBank(ils.course + clamp(ils.locDevM * 0.035, -30, 30));
    if (this.vert === 'FLARE' || ac.onGround) bankT = clamp(bankT, -3, 3);
    this.bankT = bankT;

    // ---- Vertical: vertical-speed or pitch target ----
    let vsT = null, pitchT = null;
    const vmax = Math.min(c.maxVs, this.vert === 'ALT*' ? 2500 : c.maxVs) * FT / 60;
    if (this.vert === 'ALT' || this.vert === 'ALT*') vsT = clamp((this.sel.alt - altFt) * FT * (this.vert === 'ALT' ? 0.05 : 0.07), -vmax, vmax);
    else if (this.vert === 'VS') vsT = this.sel.vs * FT / 60;
    else if (this.vert === 'GS' && ils) vsT = -Math.hypot(ac.v[0], ac.v[1]) * Math.tan(3 * DEG) - clamp(ils.gsDevM * 0.25, -4, 4);
    else if (this.vert === 'FLARE') vsT = -(0.15 * Math.max(ra * FT, 0) + 0.3);
    else if (this.vert === 'FLC') {
      this.flcPitch = clamp(this.flcPitch + clamp((ias - Math.max(this.sel.spd, minSpd)) * 0.08 + this.accelF * 0.6, -1.5, 1.5) * dt, c.minPitch, c.maxPitch);
      // never climb when descending to a lower altitude and vice versa
      const dir = Math.sign(this.sel.alt - altFt);
      const gammaNow = Math.asin(clamp(s.vs / V, -1, 1)) * RAD;
      if (dir > 0 && gammaNow < 0) this.flcPitch = Math.max(this.flcPitch, s.pitch - gammaNow + 0.5);
      if (dir < 0 && gammaNow > 0) this.flcPitch = Math.min(this.flcPitch, s.pitch - gammaNow - 0.5);
      pitchT = this.flcPitch;
    } else pitchT = this.pitchHold || s.pitch;
    // Flight-path angle and its filtered rate: the path lags pitch by the airframe's path time constant
    // (several seconds at approach speed), so path-rate damping is needed for a well-damped VS/ALT/GS loop.
    const gammaNow = Math.asin(clamp(s.vs / V, -1, 1));
    const gRate = this.gammaPrev == null ? 0 : (gammaNow - this.gammaPrev) / dt;
    this.gammaPrev = gammaNow;
    this.gammaDot += (gRate - this.gammaDot) * clamp(dt / 0.3, 0, 1);
    let qPath = null;
    if (vsT !== null) {
      const gammaT = Math.asin(clamp(vsT / V, -1, 1));
      // Slow integrator trims out steady errors only (frozen during large transients so it cannot wind up).
      if (Math.abs(vsT - s.vs) < 4) this.vsI = clamp(this.vsI + (vsT - s.vs) * 0.0006 * dt, -0.03, 0.03);
      pitchT = (s.pitch * DEG - gammaNow + gammaT + this.vsI) * RAD;
      qPath = 1.0 * (gammaT + this.vsI - gammaNow) - 1.5 * this.gammaDot;
    }
    pitchT = clamp(pitchT, c.minPitch, c.maxPitch);
    this.pitchT = pitchT;

    // ---- Autothrottle ----
    if (this.atEngaged) {
      let mode = 'SPD', thr = ac.controls.throttle;
      if (this.vert === 'FLC') mode = this.sel.alt > altFt ? 'THR CLB' : 'IDLE';
      if (this.vert === 'FLARE' && ra < 25) mode = 'RETARD';
      if (mode === 'SPD') {
        // Speed error with filtered acceleration damping; gentle enough for turbofan spool-up lag.
        thr += clamp(0.012 * (this.sel.spd - ias) - 0.08 * this.accelF, -0.12, 0.12) * dt;
      } else if (mode === 'THR CLB') thr += (0.92 - thr) * clamp(dt * 0.6, 0, 1);
      else thr += (0 - thr) * clamp(dt * (mode === 'RETARD' ? 0.8 : 0.5), 0, 1);
      ac.controls.throttle = clamp(thr, 0, 1); ac.controls.throttles = null;
      this.atMode = mode;
      if (ac.onGround && this.vert === 'FLARE') { this.atEngaged = false; ac.controls.throttle = 0; }
    }
    this.lastIas = ias;

    // ---- Inner loops (only when the AP flies) ----
    if (!this.engaged) return null;
    // Autoland rollout: after main-gear touchdown fly the nose down at a controlled rate, then disconnect.
    if (ac.onGround && this.vert === 'FLARE') { this.vert = 'ROLLOUT'; this.touchdownT = 0; }
    if (this.vert === 'ROLLOUT') {
      this.touchdownT += dt;
      const noseDown = ac.wheelState[0]?.contact;
      if ((noseDown && this.touchdownT > 0.5) || this.touchdownT > 8) { this.disengage('touchdown'); return null; }
      const qDes = clamp(-1.2 * DEG + 0.5 * (-1 * DEG - theta0(ac)), -2 * DEG, 0.5 * DEG);
      const elevator = this.loops.pitch(dt, ac, qDes);
      return { elevator, aileron: this.loops.roll(dt, ac, clamp(-0.8 * ac.euler.phi, -0.1, 0.1)) };
    }
    if (ac.onGround) this.disengage('on ground');
    const phi = ac.euler.phi, theta = ac.euler.theta;
    const turnComp = (G0 / V) * Math.sin(phi) * Math.tan(clamp(phi, -1.2, 1.2));
    // Path modes use the damped path law, kept inside the pitch-attitude limits; attitude modes track pitchT.
    let qCmd = 1.0 * (pitchT * DEG - theta);
    if (qPath !== null) qCmd = clamp(qPath, (c.minPitch * DEG - theta) * 1.0, (c.maxPitch * DEG - theta) * 1.0);
    const qDes = clamp(qCmd, -c.pitchRate * DEG, c.pitchRate * DEG) + turnComp;
    const pDes = clamp(0.8 * (bankT * DEG - phi), -c.rollRate * DEG, c.rollRate * DEG);
    const elevator = this.loops.pitch(dt, ac, qDes);
    this.loops.autoTrim(dt, ac, elevator);
    const aileron = this.loops.roll(dt, ac, pDes);
    return { elevator, aileron };
  }

  /** Flight-mode annunciation for displays. */
  fma() {
    return {
      at: this.atEngaged ? this.atMode : '', lat: this.lat, latArm: this.latArm || '', vert: this.vert, vertArm: this.vertArm || '',
      ap: this.engaged ? 'AP' : '', fd: this.fd ? 'FD' : '', disc: this.disc?.reason || '',
    };
  }
}
