// Free-turbine turboprop with constant-speed propeller (PT6/T56-class). Models gas-generator (Ng) start and
// spool lag, flat-rated shaft power with density lapse, governed propeller RPM, feathering, beta/reverse on
// the ground, momentum-theory static thrust blending to eta*P/V in flight, windmilling drag, ITT and fuel flow.
import { clamp, smoothstep } from '../../../core/math.js';

export class TurbopropEngine {
  constructor(cfg) {
    this.cfg = cfg;
    this.kind = 'turboprop';
    this.ng = 0; this.np = 0; this.power = 0; this.torque = 0; this.itt = 15; this.oilPress = 0;
    this.thrust = 0; this.fuelFlow = 0; this.running = false; this.fuelOn = false; this.starter = false; this.starting = false;
    this.throttle = 0; this.reverse = 0; this.propLever = 1; this.feathered = false;
    this.health = 1; this.propHealth = 1; this.failed = false; this.failReason = ''; this.propTorque = 0; this.starterAmps = 0;
    this.rpm = 0;
  }
  get idleNg() { return this.cfg.idleNg ?? 58; }

  setRunning(throttle = 0) { this.running = true; this.fuelOn = true; this.ng = this.idleNg + (100 - this.idleNg) * throttle; this.np = this.cfg.propRPM * 0.85; this.power = this.cfg.maxPower * throttle; this.itt = 600; this.oilPress = 90; }
  shutdown() { this.fuelOn = false; }

  update(dt, atm, V, mach, sys) {
    const c = this.cfg;
    const fuel = this.fuelOn && sys.fuelAvailable && !this.failed && this.health > 0.05;
    const startPower = this.starter && sys.busVolts > 20;
    if (this.running && !fuel) this.running = false;
    else if (!this.running && fuel && this.ng >= 12) this.running = true;
    const thr = clamp(this.throttle, 0, 1);
    // Available power: flat rated up to the thermodynamic limit, lapsing with density.
    const avail = Math.min(c.maxPower, c.thermoPower * Math.pow(atm.sigma, 0.75) * (1 + 0.15 * mach * mach)) * (0.5 + 0.5 * this.health);
    let pTarget = 0, ngT;
    if (this.running) {
      const rev = clamp(this.reverse, 0, 1);
      pTarget = Math.max(thr, rev * 0.6) * avail + 0.05 * c.maxPower;
      ngT = this.idleNg + (101 - this.idleNg) * Math.sqrt(clamp(pTarget / c.maxPower, 0, 1));
      if (this.ng < this.idleNg - 2) pTarget = 0;
    } else ngT = startPower ? 16 : 0;
    this.ng += (ngT - this.ng) * clamp(dt / (this.running ? (this.ng < this.idleNg ? 4 : 1.6) : startPower ? 5 : 8), 0, 1);
    this.power += (pTarget - this.power) * clamp(dt / 1.4, 0, 1);
    this.starting = this.starter && this.ng < this.idleNg - 2;
    this.starterAmps = startPower && this.ng < this.idleNg ? 250 : 0;

    // Propeller: governed RPM unless feathered; feathers automatically when the lever is pulled to feather.
    this.feathered = this.propLever < 0.05 || (!this.running && c.autoFeather && V > 20);
    const A = Math.PI * (c.propDiameter / 2) ** 2;
    const npGov = c.propRPM * (0.82 + 0.18 * clamp(this.propLever, 0, 1));
    const npT = this.feathered ? 0 : this.running && this.power > 0.03 * c.maxPower ? npGov : Math.min(npGov, V * 9 + (this.running ? 0.6 * c.propRPM : 0));
    this.np += (npT - this.np) * clamp(dt / 2.5, 0, 1);
    this.rpm = this.np;
    const omega = Math.max(1, (this.np * 2 * Math.PI) / 60);
    this.torque = this.power / omega;
    this.propTorque = this.torque * (c.torqueReaction ?? 0.1);
    const eta = (c.propEfficiency ?? 0.82) * this.propHealth;
    let T;
    if (this.feathered) T = -0.5 * atm.rho * V * V * A * 0.003;
    else if (this.running && this.power > 1000) {
      const Pshaft = this.power;
      const Tstatic = 0.85 * Math.cbrt(2 * atm.rho * A * Pshaft * Pshaft);
      const Vs = (eta * Pshaft) / Tstatic;
      T = (eta * Pshaft) / Math.sqrt(V * V + Vs * Vs);
      // Beta / reverse range on the ground
      if (this.reverse > 0.05 && sys.onGround) T = -this.reverse * 0.55 * Tstatic;
    } else T = -0.5 * atm.rho * V * V * A * 0.08 * (this.np > 50 ? 1 : 0.3); // windmilling prop drag
    this.thrust = T;
    this.fuelFlow = this.running ? (c.bsfc ?? 0.93e-7) * (0.08 * c.maxPower + this.power) : 0;
    const ittT = this.running ? 480 + 300 * (this.power / c.maxPower) / Math.max(0.4, atm.sigma ** 0.4) : atm.T - 273.15 + (this.starting ? 200 : 0);
    this.itt += (ittT - this.itt) * clamp(dt * 0.8, 0, 1);
    const opT = this.ng > 10 ? 40 + 60 * smoothstep(10, 60, this.ng) * (this.health > 0.3 ? 1 : this.health * 3) : 0;
    this.oilPress += (opT - this.oilPress) * clamp(dt * 2, 0, 1);
    return this;
  }

  damage(health, propHealth = 1) {
    this.health = health; this.propHealth = propHealth;
    if ((health <= 0.05 || propHealth < 0.2) && !this.failed) { this.failed = true; this.failReason = propHealth < 0.2 ? 'Propeller strike' : 'Engine failure'; }
  }
  indications() { return { ng: this.ng, np: this.np, torque: this.torque, tq: (this.torque / (this.cfg.maxPower / ((this.cfg.propRPM * 2 * Math.PI) / 60))) * 100, itt: this.itt, ff: this.fuelFlow, oil: this.oilPress, feathered: this.feathered, running: this.running, starting: this.starting }; }
}
