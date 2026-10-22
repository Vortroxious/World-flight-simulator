import { describe, it, expect } from 'vitest';
import { cfg } from '../helpers.js';
import { Aero } from '../../src/sim/fdm/aero.js';
import { PistonEngine, MAGS } from '../../src/sim/fdm/propulsion/piston.js';
import { atmosphere } from '../../src/sim/atmosphere.js';

const D = Math.PI / 180;
const aero = new Aero(cfg);
const base = { beta: 0, V: 50, qbar: 0.5 * 1.225 * 2500, p: 0, q: 0, r: 0, alphaDot: 0, flapDeg: 0, de: 0, da: 0, dr: 0, agl: 1000, damage: { wingL: 1, wingR: 1, hStab: 1, vStab: 1 }, randomGust: 0 };
const run = (o) => aero.compute({ ...base, alpha: 2 * D, ...o }, { F: [0, 0, 0], M: [0, 0, 0] });

describe('Lift and drag', () => {
  it('lift curve: CL0, slope, CLmax at stall angle, post-stall drop', () => {
    expect(aero.liftCoefficient(0)).toBeCloseTo(0.36, 2);
    const slope = (aero.liftCoefficient(5 * D) - aero.liftCoefficient(0)) / (5 * D);
    expect(slope).toBeGreaterThan(4.5); expect(slope).toBeLessThan(5.5);
    expect(aero.liftCoefficient(17.5 * D)).toBeCloseTo(1.8, 2);
    expect(aero.liftCoefficient(22 * D)).toBeLessThan(1.4);
  });
  it('flaps raise CLmax and drag and lower the stall angle', () => {
    expect(aero.liftCoefficient(16 * D, 30)).toBeGreaterThan(aero.liftCoefficient(16 * D, 0) + 0.7);
    expect(run({ flapDeg: 30 }).CD).toBeGreaterThan(run({}).CD + 0.04);
    expect(aero.stallFactor(16.5 * D, 30)).toBeGreaterThan(aero.stallFactor(16.5 * D, 0));
  });
  it('drag polar: induced drag grows with CL^2; ground effect reduces it', () => {
    const lo = run({ alpha: 0 }), hi = run({ alpha: 10 * D });
    expect(hi.CD - lo.CD).toBeGreaterThan(0.05);
    expect(run({ alpha: 10 * D, agl: 1 }).CD).toBeLessThan(hi.CD);
  });
  it('forces in body axes: positive alpha gives upward (negative z) force', () => {
    const r = run({ alpha: 5 * D });
    expect(r.F[2]).toBeLessThan(0); expect(-r.F[2]).toBeCloseTo(r.L * Math.cos(5 * D) + r.D * Math.sin(5 * D), 3);
  });
});

describe('Control surface response (sign conventions)', () => {
  it('elevator nose-up -> positive pitching moment; static stability nose-down with alpha', () => {
    expect(run({ de: 10 * D }).M[1]).toBeGreaterThan(run({}).M[1]);
    expect(run({ alpha: 8 * D }).M[1]).toBeLessThan(run({ alpha: 2 * D }).M[1]);
  });
  it('aileron right -> right roll moment; rudder right -> right yaw moment; adverse yaw', () => {
    expect(run({ da: 10 * D }).M[0]).toBeGreaterThan(0);
    expect(run({ dr: 10 * D }).M[2]).toBeGreaterThan(0);
    expect(run({ da: 10 * D }).M[2]).toBeLessThan(0);
  });
  it('damping opposes rates; weathercock and dihedral stability', () => {
    expect(run({ p: 0.5 }).M[0]).toBeLessThan(0);
    expect(run({ q: 0.5 }).M[1]).toBeLessThan(run({}).M[1]);
    expect(run({ r: 0.5 }).M[2]).toBeLessThan(0);
    expect(run({ beta: 5 * D }).M[2]).toBeGreaterThan(0);
    expect(run({ beta: 5 * D }).M[0]).toBeLessThan(0);
  });
  it('damaged left wing produces lift loss and left roll', () => {
    const r = run({ damage: { wingL: 0.5, wingR: 1, hStab: 1, vStab: 1 } });
    expect(r.CL).toBeLessThan(run({}).CL); expect(r.M[0]).toBeLessThan(0);
  });
});

describe('Piston engine and propeller', () => {
  const sl = atmosphere(0), sys = { fuelAvailable: true, busVolts: 28 };
  const settle = (e, V, atm = sl, s = 30) => { for (let i = 0; i < s * 60; i++) e.update(1 / 60, atm, V, sys); return e; };
  it('static full-throttle: ~2300 rpm and ~2.2 kN thrust', () => {
    const e = new PistonEngine(cfg.engine); e.setRunning(1000); e.throttle = 1; settle(e, 0);
    expect(e.rpm).toBeGreaterThan(2200); expect(e.rpm).toBeLessThan(2450);
    expect(e.thrust).toBeGreaterThan(1900); expect(e.thrust).toBeLessThan(2500);
  });
  it('thrust decreases with airspeed, rpm increases (fixed pitch)', () => {
    const e0 = new PistonEngine(cfg.engine); e0.setRunning(); e0.throttle = 1; settle(e0, 0);
    const e1 = new PistonEngine(cfg.engine); e1.setRunning(); e1.throttle = 1; settle(e1, 50);
    expect(e1.thrust).toBeLessThan(e0.thrust); expect(e1.rpm).toBeGreaterThan(e0.rpm);
  });
  it('power lapses with altitude', () => {
    const e0 = new PistonEngine(cfg.engine); e0.setRunning(); e0.throttle = 1; settle(e0, 50);
    const e1 = new PistonEngine(cfg.engine); e1.setRunning(); e1.throttle = 1; settle(e1, 50, atmosphere(3048));
    expect(e1.power / e0.power).toBeLessThan(0.85);
  });
  it('fuel flow at full power ~ 11-15 gph; zero when stopped', () => {
    const e = new PistonEngine(cfg.engine); e.setRunning(); e.throttle = 1; settle(e, 40);
    const gph = (e.fuelFlow / 0.72) * 3600 / 3.785;
    expect(gph).toBeGreaterThan(10); expect(gph).toBeLessThan(16);
  });
  it('mixture cutoff, magnetos off, or fuel starvation stop the engine', () => {
    for (const kill of [(e) => (e.mixture = 0), (e) => (e.magnetos = MAGS.OFF), () => (sys.fuelAvailable = false)]) {
      sys.fuelAvailable = true;
      const e = new PistonEngine(cfg.engine); e.setRunning(); e.throttle = 0.3; settle(e, 0, sl, 3);
      kill(e); settle(e, 0, sl, 10);
      expect(e.running).toBe(false); expect(e.rpm).toBeLessThan(50);
    }
    sys.fuelAvailable = true;
  });
  it('starter cranks and the engine fires with mixture rich and magnetos on', () => {
    const e = new PistonEngine(cfg.engine); e.throttle = 0.1; e.mixture = 1; e.magnetos = MAGS.START;
    for (let i = 0; i < 240 * 4 && !e.running; i++) e.update(1 / 240, sl, 0, sys);
    expect(e.running).toBe(true);
    e.magnetos = MAGS.BOTH; settle(e, 0, sl, 10);
    expect(e.rpm).toBeGreaterThan(900); expect(e.oilPress).toBeGreaterThan(40);
  });
  it('no start without electrical power', () => {
    const e = new PistonEngine(cfg.engine); e.throttle = 0.1; e.mixture = 1; e.magnetos = MAGS.START;
    for (let i = 0; i < 240 * 4; i++) e.update(1 / 240, sl, 0, { fuelAvailable: true, busVolts: 0 });
    expect(e.running).toBe(false);
  });
});
