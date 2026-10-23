// Hydraulic systems: engine-driven and electric pumps per system; pressure lags pump output.
// Consumers (gear, hydraulic flaps, spoilers, reversers) check `available` before moving.
import { clamp, smoothstep } from '../../core/math.js';

export class Hydraulics {
  constructor(defs) {
    this.systems = (defs || []).map((d) => ({ name: d.name, pumps: d.pumps, pressure: 0, engPump: true, elecPump: false }));
  }
  get present() { return this.systems.length > 0; }
  update(dt, engines, busVolts) {
    for (const s of this.systems) {
      let target = 0;
      for (const p of s.pumps) {
        if (p.engine !== undefined && s.engPump) {
          const e = engines[p.engine];
          const spool = e ? (e.n2 ?? e.ng ?? (e.rpm > 300 ? 60 : 0)) : 0;
          target = Math.max(target, 3000 * smoothstep(15, 50, spool));
        }
        if (p.electric && s.elecPump && busVolts > 20) target = Math.max(target, 3000);
      }
      s.pressure += (target - s.pressure) * clamp(dt / 1.2, 0, 1);
    }
  }
  /** Fraction 0..1 of nominal pressure available from the best system. */
  get available() { return this.present ? clamp(Math.max(...this.systems.map((s) => s.pressure)) / 2800, 0, 1) : 1; }
  lowSystems() { return this.systems.filter((s) => s.pressure < 1500).map((s) => s.name); }
  setAll(on) { for (const s of this.systems) { s.engPump = on; s.elecPump = on; } }
}
