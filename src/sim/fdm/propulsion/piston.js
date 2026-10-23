// Normally aspirated piston engine driving a fixed-pitch propeller.
// Models manifold pressure, mixture (equivalence ratio), magnetos, starter, RPM dynamics from torque balance,
// propeller thrust/power from advance ratio, fuel flow, oil/EGT/CHT temperature lags and failures.
import { clamp, smoothstep } from '../../../core/math.js';
import { P0, RHO0 } from '../../atmosphere.js';

export const MAGS = { OFF: 0, RIGHT: 1, LEFT: 2, BOTH: 3, START: 4 };

export class PistonEngine {
  constructor(cfg) {
    this.cfg = cfg;
    this.kind = 'piston';
    const p = cfg.propeller;
    this.D = p.diameter;
    this.rpm = 0;
    this.running = false;
    this.throttle = 0; this.mixture = 1; this.magnetos = MAGS.OFF;
    this.map = P0; this.fuelFlow = 0; this.power = 0; this.thrust = 0; this.propTorque = 0;
    this.egt = 288; this.cht = 288; this.oilTemp = 288; this.oilPress = 0; this.phi = 0;
    this.starterEngaged = false; this.starterAmps = 0;
    this.health = 1; this.propHealth = 1; this.seized = false; this.fire = false;
    this.failReason = '';
  }

  /** Steady thrust coefficient / power coefficient vs advance ratio J (fixed pitch). */
  ct(J) { const p = this.cfg.propeller; return p.ct0 * (1 - (J / p.jct) ** 2); }
  cp(J) { const p = this.cfg.propeller; return p.cp0 * (1 - (J / p.jcp) ** 2); }

  setRunning(rpm = 1000) { this.running = true; this.rpm = rpm; this.magnetos = MAGS.BOTH; this.oilTemp = 340; this.cht = 400; this.egt = 800; }

  /**
   * @param {number} dt
   * @param {{rho:number, p:number, T:number}} atm
   * @param {number} V  true airspeed along thrust axis (m/s)
   * @param {{fuelAvailable:boolean, busVolts:number}} sys
   */
  update(dt, atm, V, mach, sys) {
    const c = this.cfg;
    const n = this.rpm / 60;
    const sigma = atm.rho / RHO0;

    // Manifold pressure: throttle plate restriction (idle ~ 35% ambient), small intake loss.
    const thr = clamp(this.throttle, 0, 1);
    this.map = atm.p * (0.33 + 0.64 * Math.pow(thr, 0.85));
    if (this.rpm < 50) this.map = atm.p;

    // Equivalence ratio: carburettor runs richer as density falls (∝ 1/sqrt(sigma)).
    this.phi = (1.15 * this.mixture) / Math.sqrt(Math.max(sigma, 0.2));
    const phi = this.phi;
    const mag = this.magnetos === MAGS.BOTH ? 1 : this.magnetos === MAGS.START ? 1 : this.magnetos === MAGS.OFF ? 0 : 0.965;
    const fuelOk = sys.fuelAvailable && this.mixture > 0.02;
    const combustible = !this.seized && mag > 0 && fuelOk && phi > 0.6 && phi < 1.95 && this.rpm > 120 && this.health > 0.05 && this.propHealth > 0.15;

    let mixEff;
    if (phi >= 1.15) mixEff = 1 - 0.5 * (phi - 1.15);
    else mixEff = 1 - 1.6 * (1.15 - phi) ** 2;
    mixEff = clamp(mixEff, 0, 1);

    const x = this.rpm / c.maxRPM;
    const f = c.frictionFrac;
    let pInd = 0;
    if (combustible) pInd = c.maxPower * (1 + f) / 0.97 * (this.map / P0) * x * mixEff * mag * (0.3 + 0.7 * this.health);
    const pFric = c.maxPower * f * x * x;
    const qStatic = (this.rpm > 1 ? 14 : 0) + (this.seized ? 5000 : 0); // breakaway/compression friction torque (N·m)
    const omega = Math.max((2 * Math.PI * this.rpm) / 60, 1);

    // Starter motor (needs bus voltage).
    this.starterEngaged = this.magnetos === MAGS.START && sys.busVolts > 18;
    this.starterAmps = this.starterEngaged ? c.starterAmps * clamp(1 - this.rpm / 400, 0.3, 1) : 0;
    const qStarter = this.starterEngaged ? c.starterTorque * (sys.busVolts / 24) * clamp(1 - this.rpm / 450, 0, 1) : 0;

    // Propeller.
    const J = n > 0.5 ? V / (n * this.D) : 0;
    const rhoN2D4 = atm.rho * n * n * this.D ** 4;
    const propEff = this.propHealth;
    this.thrust = this.ct(J) * rhoN2D4 * propEff;
    const pProp = this.cp(J) * rhoN2D4 * n * this.D * (0.4 + 0.6 * propEff);
    this.propTorque = pProp / omega; // torque absorbed by propeller (negative when windmilling)

    const qEngine = (pInd - pFric) / omega + qStarter - qStatic;
    // Low-rpm static friction so a stopped engine stays stopped.
    let qNet = qEngine - this.propTorque;
    if (this.rpm < 30 && !combustible && qStarter === 0 && Math.abs(qNet) < 25) qNet = -this.rpm * 2;
    const alpha = qNet / c.inertia;
    this.rpm = Math.max(0, this.rpm + (alpha * dt * 60) / (2 * Math.PI));
    if (this.seized) this.rpm = Math.max(0, this.rpm - 4000 * dt);

    this.running = combustible && this.rpm > 300;
    this.power = Math.max(0, pInd - pFric);
    this.fuelFlow = combustible ? c.fuelFlowFull * (this.map / P0) * x * Math.min(phi / 1.15, 1.7) * 1.0 : 0;
    if (!this.running && !combustible) this.fuelFlow = 0;

    // Temperatures (K) and oil pressure with first-order lags.
    const pFrac = this.power / c.maxPower;
    const egtTarget = this.running ? 700 + 330 * clamp(1 - 2.5 * (phi - 1.0) ** 2, 0.4, 1) * (0.5 + 0.5 * pFrac) : atm.T;
    const cooling = 1 + V / 40;
    const chtTarget = this.running ? atm.T + (130 + 170 * pFrac) / cooling * 1.6 : atm.T;
    const oilTarget = this.running ? atm.T + 60 + 50 * pFrac : atm.T;
    this.egt += (egtTarget - this.egt) * clamp(dt * 0.8, 0, 1);
    this.cht += (chtTarget - this.cht) * clamp(dt * 0.03, 0, 1);
    this.oilTemp += (oilTarget - this.oilTemp) * clamp(dt * 0.01, 0, 1);
    const opTarget = this.rpm > 100 ? clamp(25 + 50 * smoothstep(400, 2000, this.rpm), 0, 90) * (this.health > 0.3 ? 1 : this.health * 3) : 0;
    this.oilPress += (opTarget - this.oilPress) * clamp(dt * 3, 0, 1);
    return this;
  }

  get fuelOn() { return this.mixture > 0.02; }
  indications() { return { rpm: this.rpm, map: this.map, egt: this.egt, ff: this.fuelFlow, oil: this.oilPress, running: this.running }; }

  /** Apply sudden-stoppage / damage effects. */
  damage(engineHealth, propHealth) {
    this.health = engineHealth; this.propHealth = propHealth;
    if (propHealth < 0.3 && this.rpm > 500) { this.seized = true; this.failReason = 'Propeller strike — sudden stoppage'; }
    if (engineHealth <= 0.05) { this.seized = true; this.failReason ||= 'Engine destroyed'; }
  }
}
