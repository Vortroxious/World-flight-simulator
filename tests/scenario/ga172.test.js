// End-to-end flight-model scenarios for the GA-172 against POH-derived targets (tolerances documented).
import { describe, it, expect } from 'vitest';
import { makeAc, run, speedPilot, ground, cfg, KT, SIM_DT } from '../helpers.js';
import { ObstacleGroup, CollisionWorld } from '../../src/sim/collision/obstacles.js';

const FT = 0.3048;

describe('GA-172 ground handling & takeoff', () => {
  it('rests on its gear in static equilibrium (weight shared ~25/75 nose/mains)', () => {
    const ac = makeAc(); ac.placeOnGround(37.6, -122.4, 0, ground());
    const s = run(ac, 5, { ground: ground() });
    const f = ac.wheelState.map((w) => w.force), tot = f.reduce((a, b) => a + b, 0);
    expect(tot / (ac.mass * 9.81)).toBeCloseTo(1, 1);
    expect(f[0] / tot).toBeGreaterThan(0.18); expect(f[0] / tot).toBeLessThan(0.35);
    expect(Math.abs(s.vs)).toBeLessThan(0.01); expect(s.gs).toBeLessThan(0.05);
  });
  it('parking brake holds at idle; brakes stop a rolling aircraft', () => {
    const ac = makeAc(); ac.placeOnGround(37.6, -122.4, 0, ground()); ac.setReadyState(); ac.controls.parkingBrake = true;
    expect(run(ac, 10, { ground: ground() }).gs).toBeLessThan(0.1);
    ac.controls.parkingBrake = false; ac.controls.throttle = 0.6; run(ac, 8, { ground: ground() });
    ac.controls.throttle = 0; ac.controls.brakeL = ac.controls.brakeR = 1;
    expect(run(ac, 8, { ground: ground() }).gs).toBeLessThan(0.5);
  });
  it('rudder steers the nosewheel', () => {
    const ac = makeAc(); ac.placeOnGround(37.6, -122.4, 0, ground()); ac.setReadyState(); ac.controls.parkingBrake = false;
    ac.controls.throttle = 0.35; ac.controls.rudder = 1;
    const s = run(ac, 12, { ground: ground() });
    expect(s.heading).toBeGreaterThan(20); expect(s.heading).toBeLessThan(359);
  });
  it('full-power takeoff: ground roll 230-420 m (POH ~290 m) and liftoff ~55-70 KIAS', () => {
    const ac = makeAc(); ac.placeOnGround(37.6, -122.4, 0, ground()); ac.setReadyState();
    ac.controls.parkingBrake = false; ac.controls.throttle = 1;
    const lat0 = ac.lat; let lift = null;
    for (let i = 0; i < 240 * 40 && !lift; i++) {
      const s = ac.snapshot();
      ac.controls.elevator = s.ias / KT > 55 ? Math.max(-1, Math.min(1, 0.08 * (9 - s.pitch) - 0.03 * s.q)) : 0;
      ac.controls.rudder = Math.max(-1, Math.min(1, -0.2 * ((s.heading + 180) % 360 - 180)));
      ac.controls.aileron = -0.05 * s.roll;
      ac.step(SIM_DT, { ground: ground() });
      if (!ac.wheelState.some((w) => w.contact) && s.agl > 1.5) lift = { d: (ac.lat - lat0) * 111000, kt: s.ias / KT };
    }
    expect(lift).not.toBeNull();
    expect(lift.d).toBeGreaterThan(230); expect(lift.d).toBeLessThan(420);
    expect(lift.kt).toBeGreaterThan(53); expect(lift.kt).toBeLessThan(72);
  });
});

describe('GA-172 in flight', () => {
  it('climbs 550-800 fpm at Vy (74 KIAS) full throttle near sea level', () => {
    const ac = makeAc(); ac.placeAirborne(37.6, -122.4, 600, 0, 74);
    ac.controls.throttle = 1;
    const s = run(ac, 60, {}, speedPilot(74));
    expect(s.vs / FT * 60).toBeGreaterThan(550); expect(s.vs / FT * 60).toBeLessThan(800);
  });
  it('level cruise at 8,000 ft full throttle 108-128 KTAS', () => {
    const ac = makeAc(); ac.placeAirborne(37.6, -122.4, 2440, 0, 105); ac.controls.throttle = 1;
    const s = run(ac, 120, {}, (st, a) => { a.controls.elevator = Math.max(-1, Math.min(1, 0.002 * (2440 - st.alt) - 0.1 * st.vs - 0.02 * st.q)); a.controls.aileron = -0.05 * st.roll; });
    expect(Math.abs(s.alt - 2440)).toBeLessThan(30);
    expect(s.tas / KT).toBeGreaterThan(108); expect(s.tas / KT).toBeLessThan(128);
  });
  it('trimmed hands-off flight is stable for 30 s', () => {
    const ac = makeAc(); ac.placeAirborne(37.6, -122.4, 1500, 90, 100);
    const s = run(ac, 30);
    expect(Math.abs(s.ias / KT - 100)).toBeLessThan(5); expect(Math.abs(s.vs)).toBeLessThan(1.5); expect(Math.abs(s.roll)).toBeLessThan(15);
  });
  for (const [flaps, vs, label] of [[0, cfg.limits.Vs1, 'clean'], [3, cfg.limits.Vs0, 'full flap']]) {
    it(`power-off stall at MTOW within ±10% of POH (${label} ${vs} KCAS)`, () => {
      const ac = makeAc(); ac.payload = cfg.mass.maxTakeoff - cfg.mass.empty - ac.fuel.massKg;
      ac.placeAirborne(37.6, -122.4, 1500, 90, vs + 22, { flapsLever: flaps }); ac.controls.throttle = 0;
      // Stall speed = minimum airspeed reached while slowing ~1 kt/s to full aft stick (break or full-aft 'mush').
      let stallKt = null, minKt = 1e9;
      for (let i = 0; i < 240 * 90 && stallKt == null; i++) {
        const s = ac.snapshot();
        ac.controls.elevator = Math.min(1, ac.controls.elevator + SIM_DT * (0.004 * (1500 - s.alt) - 0.01 * s.vs));
        ac.controls.aileron = -0.05 * s.roll;
        ac.step(SIM_DT);
        if (i > 240) minKt = Math.min(minKt, s.ias / KT);
        if (i > 240 && (s.stall > 0.5 || s.vs < -6 || (ac.controls.elevator >= 1 && s.ias / KT > minKt + 1))) stallKt = minKt;
      }
      expect(stallKt).not.toBeNull();
      expect(stallKt).toBeGreaterThan(vs * 0.9); expect(stallKt).toBeLessThan(vs * 1.1);
    });
  }
  it('turns: 30° bank produces a heading change and requires back pressure (load factor > 1.1)', () => {
    const ac = makeAc(); ac.placeAirborne(37.6, -122.4, 1500, 0, 95);
    let maxNz = 0;
    const s = run(ac, 20, {}, (st, a) => { speedPilot(95, 30)(st, a); a.controls.elevator = Math.max(-1, Math.min(1, a.controls.elevator)); maxNz = Math.max(maxNz, a.nz); });
    expect(s.heading).toBeGreaterThan(40); expect(s.heading).toBeLessThan(200);
    expect(maxNz).toBeGreaterThan(1.1);
  });
});

describe('GA-172 landings and crashes', () => {
  it('flies a 3° approach, flares and lands without damage (scripted pilot)', () => {
    const ac = makeAc(); ac.placeAirborne(37.6, -122.4, 120, 0, 65, { flapsLever: 3, flightPathDeg: -3 });
    let landed = null;
    for (let i = 0; i < 240 * 90 && !landed; i++) {
      const s = ac.snapshot();
      const agl = s.agl;
      // Before the flare: pitch for 65 KIAS, power for ~ -3.4 m/s (3° at 65 kt). Flare below 8 m: idle, raise the nose.
      if (agl > 8) {
        const pitchT = Math.max(-8, Math.min(6, -2 + 0.6 * (s.ias / KT - 65)));
        ac.controls.elevator = Math.max(-1, Math.min(1, 0.1 * (pitchT - s.pitch) - 0.05 * s.q));
        ac.controls.throttle = Math.max(0, Math.min(1, ac.controls.throttle + SIM_DT * 0.25 * (-3.4 - s.vs)));
      } else {
        ac.controls.throttle = 0;
        const pitchT = 7 - agl * 0.6; // progressively raise the nose so the mains touch first
        ac.controls.elevator = Math.max(-1, Math.min(1, 0.12 * (pitchT - s.pitch) - 0.05 * s.q));
      }
      ac.controls.aileron = -0.05 * s.roll;
      ac.step(SIM_DT, { ground: ground() });
      if (ac.touchdown) landed = ac.touchdown;
    }
    run(ac, 20, { ground: ground() }, (st, a) => { a.controls.brakeL = a.controls.brakeR = 1; a.controls.elevator = 0.3; });
    expect(landed).not.toBeNull();
    expect(landed.sinkRate).toBeLessThan(2.5);
    expect(ac.damage.summary().destroyed).toBe(false);
    expect(Object.values(ac.damage.health).every((h) => h === 1)).toBe(true);
    expect(ac.snapshot().gs).toBeLessThan(1);
  });

  const touchdown = (sink, surface = 'runway', pitchDeg = 5, h = 0) => {
    const ac = makeAc(); ac.placeAirborne(37.6, -122.4, h + 3, 0, 55);
    ac.alt = h + 1.7; ac.v[2] = sink; ac.controls.throttle = 0; ac.setAttitude(0, pitchDeg, 0);
    run(ac, 4, { ground: ground(h, surface) });
    return ac;
  };
  it('normal landing (~1 m/s, 200 fpm): no damage, aircraft rolls out', () => {
    const ac = touchdown(1.0);
    expect(ac.damage.summary().worst[0][1]).toBe(1);
    expect(ac.touchdown.sinkRate).toBeGreaterThan(0.6); expect(ac.touchdown.sinkRate).toBeLessThan(2.0);
  });
  it('hard landing (5.5 m/s) collapses the gear; aircraft slides on its belly', () => {
    const ac = touchdown(5.5);
    expect(ac.damage.detached.leftMainGear || ac.damage.detached.rightMainGear).toBe(true);
    expect(ac.contactState.some((c) => c.contact)).toBe(true);
  });
  it('nose-first impact strikes the propeller and stops the engine', () => {
    const ac = touchdown(4, 'runway', -6);
    expect(ac.damage.health.propeller).toBeLessThan(0.5);
    run(ac, 3, { ground: ground() });
    expect(ac.engine.rpm).toBeLessThan(200);
  });
  it('steep high-speed terrain impact destroys the aircraft', () => {
    const ac = makeAc(); ac.placeAirborne(37.6, -122.4, 400, 0, 120);
    ac.setAttitude(0, -35, 0); const V = 62; ac.v = [V * Math.cos(0.61), 0, V * Math.sin(0.61)];
    run(ac, 10, { ground: ground(200, 'terrain') }, (st, a) => { a.controls.elevator = -0.4; a.controls.throttle = 1; });
    expect(ac.damage.destroyed).toBe(true);
  });
  it('outcomes depend on the impact: different speeds give different damage states', () => {
    const a = touchdown(3.4).damage.summary(), b = touchdown(4.4).damage.summary();
    expect(JSON.stringify(a.health)).not.toEqual(JSON.stringify(b.health));
  });
  it('low-speed water landing results in ditching (floats, not destroyed)', () => {
    const ac = makeAc(); ac.placeAirborne(37.6, -122.4, 3, 0, 50, { flapsLever: 3 });
    ac.alt = 1.6; ac.v[2] = 1.0; ac.controls.throttle = 0; ac.setAttitude(0, 8, 0);
    run(ac, 40, { ground: ground(-10, 'water') });
    expect(ac.inWater).toBe(true); expect(ac.damage.ditched).toBe(true);
    expect(ac.alt).toBeGreaterThan(-2.5);
  });
  it('flying into a building damages/destroys the aircraft; trees cause damage', () => {
    const w = new CollisionWorld(), g = new ObstacleGroup(37.6, -122.4);
    const north = 300; // building 300 m north, 60 m tall
    g.addBuilding([[-40, north], [40, north], [40, north + 30], [-40, north + 30]], 0, 60);
    w.add(g);
    const ac = makeAc(); ac.placeAirborne(37.6, -122.4, 30, 0, 100);
    run(ac, 8, { obstacles: w, ground: ground(0, 'terrain') }, speedPilot(100));
    expect(ac.damage.destroyed || Object.values(ac.damage.health).some((h) => h < 0.5)).toBe(true);
    const w2 = new CollisionWorld(), g2 = new ObstacleGroup(37.6, -122.4);
    for (let i = 0; i < 40; i++) g2.addTree((i % 8) * 4 - 16, 200 + Math.floor(i / 8) * 6, 0, 20, 3);
    w2.add(g2);
    const ac2 = makeAc(); ac2.placeAirborne(37.6, -122.4, 12, 0, 80);
    run(ac2, 6, { obstacles: w2, ground: ground(0, 'terrain') }, speedPilot(80));
    expect(Object.values(ac2.damage.health).some((h) => h < 1)).toBe(true);
  });
});
