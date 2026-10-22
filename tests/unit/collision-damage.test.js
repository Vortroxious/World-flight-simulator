import { describe, it, expect } from 'vitest';
import { cfg } from '../helpers.js';
import { DamageModel } from '../../src/sim/damage/damage.js';
import { ObstacleGroup, CollisionWorld } from '../../src/sim/collision/obstacles.js';

describe('Damage severity', () => {
  const m = cfg.mass.maxTakeoff;
  it('no damage below the safe impact speed; increases with speed', () => {
    const d = new DamageModel(cfg);
    expect(d.impact('leftMainGear', 2.0, 0, m, 'runway')).toBe(0);
    const s1 = new DamageModel(cfg).impact('leftMainGear', 3.6, 0, m, 'runway');
    const s2 = new DamageModel(cfg).impact('leftMainGear', 4.4, 0, m, 'runway');
    expect(s1).toBeGreaterThan(0); expect(s2).toBeGreaterThan(s1);
  });
  it('heavier aircraft take more damage at the same impact speed', () => {
    const light = new DamageModel(cfg).impact('noseGear', 3.5, 0, 850, 'runway');
    const heavy = new DamageModel(cfg).impact('noseGear', 3.5, 0, 1157, 'runway');
    expect(heavy).toBeGreaterThan(light);
  });
  it('surface matters: buildings are harsher than grass', () => {
    expect(new DamageModel(cfg).impact('leftWing', 3, 5, m, 'building')).toBeGreaterThan(new DamageModel(cfg).impact('leftWing', 3, 5, m, 'grass'));
  });
  it('components detach when health reaches zero; fuselage failure destroys the aircraft', () => {
    const d = new DamageModel(cfg);
    d.impact('rightWing', 9, 0, m, 'terrain');
    expect(d.detached.rightWing).toBe(true);
    expect(d.destroyed).toBe(false);
    d.impact('fuselage', 12, 0, m, 'terrain');
    expect(d.destroyed).toBe(true); expect(d.destroyedReason).toMatch(/Fuselage/);
  });
  it('over-G: overstress below ultimate, wing failure above ultimate', () => {
    const d = new DamageModel(cfg), r = () => 0.3;
    d.flight(0.1, 4.2, 40, 84, r); expect(d.overstress).toBe(true); expect(d.detached.leftWing).toBe(false);
    d.flight(0.01, 6.0, 40, 84, r); expect(d.detached.leftWing).toBe(true);
  });
  it('damage-off mode records nothing; simplified mode ends flight at critical damage', () => {
    const off = new DamageModel(cfg, 'off'); off.impact('fuselage', 20, 0, m, 'terrain'); expect(off.destroyed).toBe(false);
    const simp = new DamageModel(cfg, 'simplified'); simp.impact('noseGear', 4.0, 0, m, 'runway'); expect(simp.destroyed).toBe(true);
  });
  it('aerodynamic factors reflect wing/tail damage', () => {
    const d = new DamageModel(cfg); d.apply('hStab', 0.5, 'test');
    expect(d.aeroFactors.hStab).toBeLessThan(1); expect(d.aeroFactors.wingL).toBe(1);
  });
});

describe('Obstacle collision', () => {
  const g = new ObstacleGroup(37.6, -122.4);
  g.addBuilding([[0, 0], [20, 0], [20, 20], [0, 20]], 5, 30);
  g.addTree(100, 100, 2, 15, 3);
  const w = new CollisionWorld(); w.add(g);
  const at = (e, n, h) => { const p = g.frame.enuToGeodetic(e, n, 0); return w.queryGeodetic(p.lat, p.lon, h); };
  it('detects points inside a building footprint below the roof', () => {
    const hit = at(10, 2, 20);
    expect(hit.type).toBe('building'); expect(hit.normal[1]).toBeCloseTo(-1, 5); expect(hit.depth).toBeCloseTo(2, 1);
    expect(at(10, 10, 34.5).normal[2]).toBe(1); // near roof -> pushed up
    expect(at(10, 10, 40)).toBeNull(); expect(at(30, 10, 20)).toBeNull();
  });
  it('distinguishes tree crown from trunk', () => {
    expect(at(102, 100, 8).trunk).toBe(false);
    expect(at(100.2, 100, 8).trunk).toBe(true);
    expect(at(110, 100, 8)).toBeNull();
  });
});
