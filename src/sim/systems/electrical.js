// Single-bus 24 V electrical system: battery, engine-driven alternator, master/avionics switches, loads and breakers.
import { clamp } from '../../core/math.js';

/** Steady current draw (A) of each switchable load. */
export const LOADS = {
  avionics: 7.5, navLights: 3, beacon: 2, strobe: 2.5, landingLight: 7.5, taxiLight: 6,
  pitotHeat: 6, fuelPump: 2.5, panelLights: 1.2, turnCoordinator: 0.6, flapMotor: 9, stallHorn: 0.1,
};

export class Electrical {
  constructor(cfg) {
    this.cfg = cfg;
    this.switches = { battery: false, alternator: false, avionics: false, navLights: false, beacon: false, strobe: false, landingLight: false, taxiLight: false, pitotHeat: false, fuelPump: false, panelLights: false };
    this.breakers = {}; // name -> tripped
    this.soc = 1; // battery state of charge 0..1
    this.busVolts = 0; this.batteryAmps = 0; this.altAmps = 0; this.loadAmps = 0;
    this.altFailed = false;
  }

  powered(name) { return this.busVolts > 18 && !this.breakers[name]; }
  get avionicsPowered() { return this.switches.avionics && this.powered('avionics'); }

  update(dt, rpm, extraAmps = 0, flapMotorRunning = false) {
    const c = this.cfg, s = this.switches;
    const batOpen = 23.4 + 1.6 * this.soc; // resting voltage
    const altOnline = s.battery && s.alternator && !this.altFailed && rpm > 900;
    let load = 0;
    if (s.battery) {
      for (const k of ['navLights', 'beacon', 'strobe', 'landingLight', 'taxiLight', 'pitotHeat', 'fuelPump', 'panelLights']) if (s[k] && !this.breakers[k]) load += LOADS[k];
      if (s.avionics && !this.breakers.avionics) load += LOADS.avionics;
      load += LOADS.turnCoordinator + LOADS.stallHorn;
      if (flapMotorRunning) load += LOADS.flapMotor;
      load += extraAmps;
    }
    this.loadAmps = load;
    if (!s.battery) { this.busVolts = 0; this.batteryAmps = 0; this.altAmps = 0; return; }
    if (altOnline) {
      this.altAmps = Math.min(c.alternatorAmps, load + clamp((1 - this.soc) * 40, 0, 20));
      this.busVolts = load > c.alternatorAmps ? c.alternatorVolts - (load - c.alternatorAmps) * 0.05 : c.alternatorVolts;
      this.batteryAmps = this.altAmps - load; // + charging
    } else {
      this.altAmps = 0;
      const rInt = 0.012 + (1 - this.soc) * 0.03;
      this.busVolts = this.soc > 0.01 ? Math.max(0, batOpen - load * rInt) : 0;
      this.batteryAmps = -load;
    }
    this.soc = clamp(this.soc + (this.batteryAmps * dt) / 3600 / c.batteryAh, 0, 1);
  }

  get lowVolts() { return this.switches.battery && this.busVolts < this.cfg.lowVolts; }
}
