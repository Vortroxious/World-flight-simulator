// Component-based structural damage model. Damage depends on impact normal speed (i.e. speed and angle),
// aircraft mass relative to design mass, impacted surface, scraping energy and component strength.
import { clamp } from '../../core/math.js';

export const DAMAGE_MODES = { REALISTIC: 'realistic', SIMPLIFIED: 'simplified', OFF: 'off' };

const SURFACE_FACTOR = { runway: 1, paved: 1, grass: 1.15, terrain: 0.9, water: 1.25, building: 0.55, tree: 2.5 };

export class DamageModel {
  constructor(cfg, mode = DAMAGE_MODES.REALISTIC) {
    this.cfg = cfg.damage;
    this.mtow = cfg.mass.maxTakeoff;
    this.mode = mode;
    this.reset();
  }
  reset() {
    this.health = {};
    this.detached = {};
    for (const k of Object.keys(this.cfg.components)) { this.health[k] = 1; this.detached[k] = false; }
    this.events = [];
    this.destroyed = false;
    this.destroyedReason = '';
    this.maxG = 1; this.minG = 1; this.overstress = false;
    this.fire = false; this.ditched = false;
    this.time = 0;
  }

  log(type, component, severity, detail) {
    const ev = { t: +this.time.toFixed(2), type, component, severity: +severity.toFixed(3), detail };
    this.events.push(ev);
    if (this.events.length > 200) this.events.shift();
    this.onEvent?.(ev);
    return ev;
  }

  /** Apply damage fraction to a component; handles detachment and catastrophic outcomes. */
  apply(component, amount, cause) {
    if (this.mode === DAMAGE_MODES.OFF || amount <= 0 || !(component in this.health)) return;
    const prev = this.health[component];
    if (this.detached[component]) return;
    this.health[component] = clamp(prev - amount, 0, 1);
    const c = this.cfg.components[component];
    if (this.health[component] <= 0 && c.detachable) {
      this.detached[component] = true;
      this.log('detached', component, 1, cause);
    } else if (prev - this.health[component] > 0.02) {
      this.log('damage', component, amount, cause);
    }
    this.evaluate(cause);
  }

  evaluate(cause) {
    const h = this.health;
    let reason = '';
    if (h.fuselage <= 0) reason = 'Fuselage structural failure';
    else if (this.detached.leftWing && this.detached.rightWing) reason = 'Both wings separated';
    if (this.mode === DAMAGE_MODES.SIMPLIFIED && !reason) {
      const worst = Math.min(...Object.values(h));
      if (worst < 0.5) reason = `Simplified mode: critical damage (${cause})`;
    }
    if (reason && !this.destroyed) {
      this.destroyed = true;
      this.destroyedReason = reason;
      this.log('destroyed', 'airframe', 1, reason);
    }
  }

  /**
   * Impact at a contact point (on first contact or when normal speed increases).
   * @param {string} component  @param {number} vn normal closing speed (m/s) @param {number} vt tangential speed
   * @param {number} mass current aircraft mass @param {string} surface
   */
  impact(component, vn, vt, mass, surface) {
    const c = this.cfg.components[component];
    if (!c || this.detached[component]) return 0;
    const sf = SURFACE_FACTOR[surface] ?? 1;
    // Effective closing speed scales with sqrt(mass ratio): heavier aircraft carry more energy into the structure.
    const vEff = vn * Math.sqrt(mass / this.mtow) / sf + (surface === 'building' ? vt * 0.15 : 0) + (surface === 'water' ? vt * 0.02 : 0);
    if (vEff <= c.vSafe) return 0;
    const sev = (vEff * vEff - c.vSafe * c.vSafe) / Math.max(c.vFail * c.vFail - c.vSafe * c.vSafe, 0.01);
    this.apply(component, sev, `impact ${vn.toFixed(1)} m/s on ${surface}`);
    if (sev > 0.6 && (component === 'engine' || component === 'leftWing' || component === 'rightWing') && surface !== 'water' && this.mode === DAMAGE_MODES.REALISTIC) {
      if (!this.fire) { this.fire = true; this.log('fire', component, sev, 'fuel system ruptured'); }
    }
    return sev;
  }

  /** Continuous scraping/abrasion: friction work (J) dissipated by a non-wheel component. */
  scrape(component, work) {
    const c = this.cfg.components[component];
    if (!c || !c.scrapeEnergy) { if (component === 'propeller' || component === 'engine') this.apply(component, work / 20000, 'ground contact'); return; }
    this.apply(component, work / c.scrapeEnergy, 'scraping');
  }

  /** Landing gear structural load check. */
  gearLoad(component, normalForce, sideForce) {
    const c = this.cfg.components[component];
    if (!c || this.detached[component]) return;
    if (normalForce > c.loadLimit) this.apply(component, (normalForce / c.loadLimit - 1) * 0.6, `overload ${(normalForce / 1000).toFixed(1)} kN`);
    if (Math.abs(sideForce) > c.sideLimit) this.apply(component, (Math.abs(sideForce) / c.sideLimit - 1) * 0.4, `side load ${(Math.abs(sideForce) / 1000).toFixed(1)} kN`);
  }

  /** In-flight load factor / overspeed checks. */
  flight(dt, nz, ias, vne, rnd) {
    this.time += dt;
    this.maxG = Math.max(this.maxG, nz); this.minG = Math.min(this.minG, nz);
    const lim = nz >= 0 ? this.cfg.gLimitPos : this.cfg.gLimitNeg;
    const ratio = nz / lim;
    if (ratio > 1) {
      if (!this.overstress) { this.overstress = true; this.log('overstress', 'wings', ratio - 1, `load factor ${nz.toFixed(1)} g`); }
      if (ratio > this.cfg.ultimateFactor) {
        const side = rnd() < 0.5 ? 'leftWing' : 'rightWing';
        this.apply(side, 1, `structural failure at ${nz.toFixed(1)} g`);
      } else {
        this.apply('leftWing', (ratio - 1) * 0.02 * dt * 60, 'overstress');
        this.apply('rightWing', (ratio - 1) * 0.02 * dt * 60, 'overstress');
      }
    }
    if (ias > vne * this.cfg.flutterMargin) {
      const sev = (ias / (vne * this.cfg.flutterMargin) - 1) * 2 * dt;
      this.apply(rnd() < 0.5 ? 'hStab' : 'vStab', sev, `flutter at ${(ias / 0.5144).toFixed(0)} kt`);
    }
  }

  /** Aerodynamic effectiveness factors consumed by the flight model. */
  get aeroFactors() {
    const h = this.health, d = this.detached;
    const eff = (k, floor) => (d[k] ? 0 : floor + (1 - floor) * h[k]);
    return { wingL: eff('leftWing', 0.55), wingR: eff('rightWing', 0.55), hStab: eff('hStab', 0.3), vStab: eff('vStab', 0.3) };
  }

  summary() {
    const worst = Object.entries(this.health).sort((a, b) => a[1] - b[1]);
    return { destroyed: this.destroyed, reason: this.destroyedReason, worst: worst.slice(0, 3), health: { ...this.health }, detached: Object.keys(this.detached).filter((k) => this.detached[k]) };
  }
}
