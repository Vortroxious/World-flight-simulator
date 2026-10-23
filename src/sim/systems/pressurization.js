// Cabin pressurisation: scheduled cabin altitude limited by maximum differential pressure, rate-limited;
// with packs off (no bleed air) the cabin climbs towards ambient. CABIN ALTITUDE warning above 10,000 ft.
import { clamp } from '../../core/math.js';
import { atmosphere, pressureToAltitude } from '../atmosphere.js';

const PSI = 6894.76;

export class Pressurization {
  constructor(cfg) { this.cfg = cfg; this.cabinAltFt = 0; this.rateFpm = 0; this.packs = true; this.present = !!cfg; }
  reset(altFt) { this.cabinAltFt = this.present ? Math.min(altFt, 8000 * Math.min(1, Math.max(0, altFt) / 40000)) : altFt; }
  update(dt, altM, bleedAvailable) {
    const altFt = altM / 0.3048;
    if (!this.present) { this.cabinAltFt = altFt; this.rateFpm = 0; return; }
    let target;
    if (this.packs && bleedAvailable) {
      const sched = altFt <= 0 ? altFt : 8000 * Math.min(1, altFt / 40000);
      const pAmb = atmosphere(altM).p;
      const limitFt = pressureToAltitude(pAmb + this.cfg.maxDiffPsi * PSI * 0.98) / 0.3048;
      target = Math.min(altFt, Math.max(sched, limitFt));
      const rate = clamp((target - this.cabinAltFt) * 0.2, -350, 500); // fpm
      this.rateFpm = rate;
    } else {
      target = altFt;
      this.rateFpm = clamp((target - this.cabinAltFt) * 0.5, -2000, 2500);
    }
    this.cabinAltFt += (this.rateFpm / 60) * dt;
  }
  get diffPsi() { return this.present ? (atmosphere(this.cabinAltFt * 0.3048).p - atmosphere(0).p) / PSI : 0; }
  get warning() { return this.present && this.cabinAltFt > 10000; }
}

/** Auxiliary power unit: start sequence, bleed air and electrical generation. */
export class Apu {
  constructor(present) { this.present = present; this.switch = false; this.n = 0; this.state = 'OFF'; }
  update(dt, busVolts, fuelAvailable) {
    if (!this.present) return;
    const want = this.switch && fuelAvailable && (busVolts > 20 || this.n > 50);
    this.n = clamp(this.n + (want ? 100 / 35 : -100 / 20) * dt, 0, 100);
    this.state = this.n >= 95 ? 'AVAIL' : want ? 'START' : this.n > 0 ? 'SPOOL DN' : 'OFF';
  }
  get available() { return this.present && this.n >= 95; }
  get fuelFlow() { return this.n > 20 ? 0.035 : 0; } // kg/s (~125 kg/h)
}
