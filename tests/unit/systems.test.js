import { describe, it, expect } from 'vitest';
import { makeAc, run, cfg, ground, SIM_DT } from '../helpers.js';
import { Electrical } from '../../src/sim/systems/electrical.js';
import { FuelSystem } from '../../src/sim/systems/fuel.js';
import { createCommands } from '../../src/sim/commands.js';
import { pressureToAltitude } from '../../src/sim/atmosphere.js';

describe('Electrical system', () => {
  it('battery discharges with loads and alternator off; alternator recharges', () => {
    const e = new Electrical(cfg.electrical);
    e.switches.battery = true; e.switches.landingLight = true; e.switches.avionics = true;
    for (let i = 0; i < 600; i++) e.update(1, 0);
    expect(e.soc).toBeLessThan(0.97); expect(e.busVolts).toBeLessThan(25.2);
    e.switches.alternator = true;
    const soc = e.soc;
    for (let i = 0; i < 600; i++) e.update(1, 2300);
    expect(e.soc).toBeGreaterThan(soc); expect(e.busVolts).toBeCloseTo(28.5, 1);
  });
  it('master off removes all power; avionics bus needs its switch', () => {
    const e = new Electrical(cfg.electrical);
    e.update(1, 0); expect(e.busVolts).toBe(0);
    e.switches.battery = true; e.update(1, 0);
    expect(e.busVolts).toBeGreaterThan(23); expect(e.avionicsPowered).toBe(false);
    e.switches.avionics = true; expect(e.avionicsPowered).toBe(true);
  });
  it('disabling the bus stops electric flaps', () => {
    const ac = makeAc(); ac.placeOnGround(37.6, -122.4, 0, ground()); ac.setColdAndDark();
    ac.controls.flapsLever = 3; run(ac, 5, { ground: ground() });
    expect(ac.flapDeg).toBe(0);
    ac.elec.switches.battery = true; run(ac, 10, { ground: ground() });
    expect(ac.flapDeg).toBeGreaterThan(25);
  });
});

describe('Fuel system', () => {
  it('consumes from selected tanks; OFF starves the engine', () => {
    const f = new FuelSystem(cfg.fuel);
    const q0 = f.totalLitres;
    f.selector = 'LEFT'; f.consume(0.01, 600);
    expect(f.tanks[0].qty).toBeLessThan(f.tanks[1].qty); expect(f.totalLitres).toBeCloseTo(q0 - 6 / 0.72, 1);
    f.selector = 'OFF'; expect(f.available).toBe(false);
  });
  it('fuel burn reduces aircraft mass in flight', () => {
    const ac = makeAc(); ac.placeAirborne(37.6, -122.4, 1500, 0, 100);
    const m0 = ac.mass; run(ac, 120);
    expect(ac.mass).toBeLessThan(m0 - 0.5); expect(ac.mass).toBeGreaterThan(m0 - 2);
  });
  it('engine quits when the selector is turned OFF and the lines run dry', () => {
    const ac = makeAc(); ac.placeAirborne(37.6, -122.4, 1500, 0, 100);
    createCommands(ac).fuelSelector(-2); // BOTH -> OFF? cycle: BOTH(1) -2 => OFF(3)
    expect(ac.fuel.selector).toBe('OFF');
    run(ac, 15);
    expect(ac.engine.running).toBe(false);
  });
});

describe('Flight instruments derive from simulated state', () => {
  it('altimeter shows field elevation with QNH set; VSI ~0 at rest', () => {
    const ac = makeAc(); ac.placeOnGround(37.6, -122.4, 90, ground(120)); ac.setReadyState();
    run(ac, 15, { ground: ground(120) });
    expect(ac.inst.altitude).toBeGreaterThan(120); expect(ac.inst.altitude).toBeLessThan(123);
    expect(Math.abs(ac.inst.vsi)).toBeLessThan(0.2);
    expect(pressureToAltitude(ac.atm.p, ac.inst.kollsman)).toBeCloseTo(ac.alt, 0);
  });
  it('airspeed indicator tracks CAS; heading indicator tracks heading', () => {
    const ac = makeAc(); ac.placeAirborne(37.6, -122.4, 300, 45, 100);
    run(ac, 5);
    expect(ac.inst.ias / 0.514444).toBeGreaterThan(95); expect(ac.inst.ias / 0.514444).toBeLessThan(105);
    expect(Math.abs(((ac.inst.dgHeading - ac.snapshot().headingMag + 540) % 360) - 180)).toBeLessThan(1);
  });
  it('windmilling engine keeps vacuum; vacuum pump failure topples the attitude indicator', () => {
    const ac = makeAc(); ac.placeAirborne(37.6, -122.4, 1500, 0, 90);
    ac.controls.mixture = 0; run(ac, 20, {}, (s, a) => { a.controls.aileron = -0.05 * s.roll; });
    expect(ac.engine.running).toBe(false); expect(ac.inst.vacuum).toBeGreaterThan(3.5);
    ac.inst.vacuumFailed = true; run(ac, 240, {}, (s, a) => { a.controls.aileron = -0.05 * s.roll; });
    expect(ac.inst.aiSpin).toBeLessThan(0.5);
    expect(Math.abs(ac.inst.aiRoll - ac.snapshot().roll)).toBeGreaterThan(3);
  });
  it('stall warning triggers before the stall', () => {
    const ac = makeAc(); ac.placeAirborne(37.6, -122.4, 1500, 0, 70);
    ac.controls.throttle = 0;
    let warnT = null, stallT = null, warnKt = null;
    for (let i = 0; i < 240 * 60 && stallT == null; i++) {
      const s = ac.snapshot();
      ac.controls.elevator = Math.min(1, ac.controls.elevator + SIM_DT * (0.004 * (1500 - s.alt) - 0.01 * s.vs));
      ac.controls.aileron = -0.05 * s.roll;
      ac.step(SIM_DT);
      if (warnT == null && ac.warnings.stall) { warnT = s.t; warnKt = s.ias / 0.514444; }
      if (s.stall > 0.5) stallT = s.t;
    }
    expect(warnT).not.toBeNull(); expect(stallT).not.toBeNull();
    expect(stallT - warnT).toBeGreaterThan(1.5); // horn sounds well before the break
    expect(warnKt).toBeGreaterThan(cfg.limits.Vs1 * 0.9);
  });
});
