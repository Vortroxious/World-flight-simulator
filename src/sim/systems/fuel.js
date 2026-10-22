// Fuel tanks, selector valve and consumption. Mass changes feed back into the flight model.
export class FuelSystem {
  constructor(cfg) {
    this.density = cfg.densityKgL;
    this.tanks = cfg.tanks.map((t) => ({ name: t.name, capacity: t.capacityL, unusable: t.unusableL, qty: t.capacityL * t.defaultFrac, pos: t.pos }));
    this.selector = 'BOTH'; // OFF | LEFT | RIGHT | BOTH
    this.leak = 0; // L/s leak rate from damage
  }
  setFraction(f) { for (const t of this.tanks) t.qty = t.capacity * f; }
  feeding() {
    const s = this.selector;
    return this.tanks.filter((t, i) => (s === 'BOTH' || (s === 'LEFT' && i === 0) || (s === 'RIGHT' && i === 1)) && t.qty > t.unusable);
  }
  get available() { return this.selector !== 'OFF' && this.feeding().length > 0; }
  /** Burn fuel mass (kg) over this step from selected tanks. */
  consume(kgPerSec, dt) {
    const tanks = this.feeding();
    if (tanks.length) {
      const litres = (kgPerSec * dt) / this.density / tanks.length;
      for (const t of tanks) t.qty = Math.max(0, t.qty - litres);
    }
    if (this.leak > 0) for (const t of this.tanks) t.qty = Math.max(0, t.qty - this.leak * dt);
  }
  get totalLitres() { return this.tanks.reduce((a, t) => a + t.qty, 0); }
  get massKg() { return this.totalLitres * this.density; }
  lowFuel(i) { return this.tanks[i].qty - this.tanks[i].unusable < 19; } // ~5 gal usable
}
