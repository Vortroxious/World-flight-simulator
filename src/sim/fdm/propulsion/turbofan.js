// Two-spool turbofan (optionally with afterburner). Models the start sequence (starter -> N2 -> light-off ->
// idle), N1/N2 spool lag, thrust lapse with density and Mach, TSFC, EGT, thrust reversers, windmilling and
// failures. Thrust is along the engine axis; reverse thrust is negative.
import { clamp, smoothstep } from '../../../core/math.js';

export class TurbofanEngine {
  constructor(cfg) {
    this.cfg = cfg;
    this.kind = cfg.afterburner ? 'turbofan-ab' : 'turbofan';
    this.n1 = 0; this.n2 = 0; this.egt = 15; this.oilPress = 0; this.thrust = 0; this.fuelFlow = 0;
    this.running = false; this.fuelOn = false; this.starter = false; this.starting = false;
    this.throttle = 0; this.reverse = 0; this.reverser = 0; this.afterburner = false;
    this.health = 1; this.fire = false; this.failed = false; this.failReason = '';
    this.propTorque = 0; this.starterAmps = 0; this.power = 0; this.rpm = 0;
  }
  get idleN1() { return this.cfg.idleN1 ?? 21; }
  get idleN2() { return this.cfg.idleN2 ?? 60; }

  setRunning(throttle = 0) {
    this.running = true; this.fuelOn = true; this.n2 = this.idleN2 + (95 - this.idleN2) * throttle; this.n1 = this.idleN1 + (100 - this.idleN1) * throttle;
    this.egt = 450; this.oilPress = 45;
  }
  shutdown() { this.fuelOn = false; }

  /**
   * @param {number} dt @param {{rho:number,sigma:number,T:number}} atm @param {number} V TAS (m/s) @param {number} mach
   * @param {{fuelAvailable:boolean, bleed:boolean, busVolts:number, onGround:boolean}} sys
   */
  update(dt, atm, V, mach, sys) {
    const c = this.cfg;
    const fuel = this.fuelOn && sys.fuelAvailable && !this.failed && this.health > 0.05;
    const startAir = this.starter && (sys.bleed || (c.electricStart && sys.busVolts > 20));
    // Spool targets
    let n2t, n1t, tau;
    if (this.running) {
      if (!fuel) this.running = false;
    } else if (fuel && this.n2 >= (c.lightOffN2 ?? 22)) {
      this.running = true; // light-off
    }
    const thr = clamp(this.throttle, 0, 1);
    if (this.running) {
      const rev = this.reverser > 0.9 ? clamp(this.reverse, 0, 1) * 0.8 : 0;
      const lever = Math.max(thr, rev);
      n1t = this.idleN1 + (100 - this.idleN1) * lever * (0.6 + 0.4 * this.health);
      n2t = this.idleN2 + (100 - this.idleN2) * Math.sqrt(lever);
      // Below idle (start) N2 accelerates slowly; at power spools respond faster.
      tau = this.n2 < this.idleN2 - 2 ? 6 : n1t > this.n1 ? (this.n1 < 50 ? 3.5 : 2.2) : 1.6;
      if (this.n2 < this.idleN2 - 2) n1t = Math.min(n1t, this.n2 * 0.33);
    } else {
      const wind = clamp(V / 8, 0, 28); // windmilling N1 with airspeed
      n1t = startAir ? Math.max(wind, 8) : wind; n2t = startAir ? 26 : wind * 0.9;
      tau = startAir ? 7 : 9;
    }
    this.n1 += (n1t - this.n1) * clamp(dt / tau, 0, 1);
    this.n2 += (n2t - this.n2) * clamp(dt / (tau * 0.9), 0, 1);
    this.starterAmps = startAir && c.electricStart ? 300 : 0;
    this.starting = this.starter && this.n2 < this.idleN2 - 2;

    // Thrust (SLS fraction from N1, lapse with density and Mach).
    const frac = this.running ? 0.04 + 0.96 * Math.pow(clamp((this.n1 - this.idleN1) / (100 - this.idleN1), 0, 1), 1.6) : 0;
    const lapse = Math.pow(atm.sigma, c.densityLapse ?? 0.8) * Math.max(0.2, 1 - (c.machLapse ?? 0.5) * mach + 0.25 * mach * mach);
    let T = c.maxThrust * frac * lapse;
    this.afterburner = !!c.afterburner && this.running && thr > 0.97 && this.n1 > 90 && this.reverser < 0.1;
    if (this.afterburner) T *= c.afterburner.thrustMult * (1 + 0.25 * mach);
    // Thrust reversers: hydraulically driven, ground only.
    const wantRev = this.reverse > 0.05 && sys.onGround && c.reverser;
    this.reverser = clamp(this.reverser + (wantRev ? 1 : -1) * dt / 1.8, 0, 1);
    if (this.reverser > 0.1) T *= 1 - this.reverser * (1 + (c.reverser?.efficiency ?? 0.4));
    // Windmilling / failed engine ram drag
    if (!this.running) T = -0.5 * atm.rho * V * V * (c.inletArea ?? 2) * 0.06;
    this.thrust = T;
    const tsfc = (c.tsfc ?? 1.0e-5) * (1 + 0.55 * mach) * (this.afterburner ? c.afterburner.tsfcMult : 1);
    this.fuelFlow = this.running ? tsfc * Math.max(Math.abs(T), 0.035 * c.maxThrust * atm.sigma) : 0;
    this.power = Math.max(0, T * V); this.rpm = this.n2; // generic indications
    const egtT = this.running ? 380 + 520 * (this.n1 / 100) ** 2 * (1.15 - 0.15 * this.health) + (this.afterburner ? 150 : 0) : atm.T - 273.15 + (this.starting ? 150 : 0);
    this.egt += (egtT - this.egt) * clamp(dt * 0.6, 0, 1);
    const opT = this.n2 > 20 ? 18 + 50 * smoothstep(20, 90, this.n2) * (this.health > 0.3 ? 1 : this.health * 3) : 0;
    this.oilPress += (opT - this.oilPress) * clamp(dt * 2, 0, 1);
    return this;
  }

  damage(health) {
    this.health = health;
    if (health <= 0.05 && !this.failed) { this.failed = true; this.failReason = 'Engine failure'; }
  }

  /** Values for EICAS/HUD. */
  indications() { return { n1: this.n1, n2: this.n2, egt: this.egt, ff: this.fuelFlow, oil: this.oilPress, rev: this.reverser, ab: this.afterburner, running: this.running, starting: this.starting }; }
}
