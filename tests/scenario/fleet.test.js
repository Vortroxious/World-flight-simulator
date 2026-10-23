// Flight-model scenarios for the Phase 3 fleet: ground equilibrium, takeoff, cruise, stall, autopilot,
// engine-out, fly-by-wire protections and ILS autoland. Targets are class-typical public figures with
// generous tolerances (the configs are plausible, not certified data) — see docs/PHASE_REPORTS/phase-3.md.
import { describe, it, expect } from 'vitest';
import { Aircraft, SIM_DT } from '../../src/sim/aircraft.js';
import { atmosphere } from '../../src/sim/atmosphere.js';
import { makeIls } from '../../src/sim/nav/nav.js';
import { AIRCRAFT } from '../../src/aircraft/index.js';
import { ground, KT } from '../helpers.js';

const FT = 0.3048;
const T = 120000; // per-test timeout (ms)
const FLEET = ['kingair', 'a320', 'b737', 'b787', 'a350', 'fighter', 'cargo'];
const MULTI = FLEET.filter((id) => AIRCRAFT[id].engines.length > 1);
const AUTOLAND = FLEET.filter((id) => AIRCRAFT[id].autopilot.autoland);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const make = (id) => new Aircraft(AIRCRAFT[id], { seed: 7 });
const env = { ground: ground() };
function run(ac, sec, pilot) {
  for (let i = 0; i < Math.round(sec / SIM_DT); i++) {
    if (pilot) pilot(ac.snapshot(), ac);
    ac.step(SIM_DT, env);
    if (ac.damage.destroyed) break;
  }
  return ac.snapshot();
}
const damageEvents = (ac) => { const ev = []; ac.damage.onEvent = (e) => ev.push(e); return ev; };
const cruiseAltFt = (cfg) => ({ kingair: 25000, cargo: 20000, fighter: 30000 })[cfg.id] ?? 35000;

describe.each(FLEET)('%s', (id) => {
  const cfg = AIRCRAFT[id], L = cfg.limits;

  it('rests on its gear in equilibrium', () => {
    const ac = make(id); ac.placeOnGround(37.6, -122.4, 0, env.ground); ac.setReadyState();
    const s = run(ac, 4);
    const f = ac.wheelState.map((w) => w.force), tot = f.reduce((a, b) => a + b, 0);
    expect(tot / (ac.mass * 9.81)).toBeCloseTo(1, 1);
    expect(Math.abs(s.vs)).toBeLessThan(0.01); expect(s.gs).toBeLessThan(0.1); expect(Math.abs(s.pitch)).toBeLessThan(1.5);
    expect(ac.damage.destroyed).toBe(false);
  }, T);

  it('takes off near Vr with takeoff flaps, no tail strike, and climbs gear-up', () => {
    const ac = make(id); ac.placeOnGround(37.6, -122.4, 0, env.ground); ac.setReadyState();
    ac.controls.parkingBrake = false; ac.controls.flapsLever = L.takeoffFlap; run(ac, 12);
    const ev = damageEvents(ac);
    ac.controls.throttle = 1;
    const lat0 = ac.lat; let lift = null;
    for (let i = 0; i < 240 * 80 && !lift; i++) {
      const s = ac.snapshot();
      ac.controls.elevator = s.ias / KT > L.Vr ? clamp(0.15 * (10 - s.pitch) - 0.05 * s.q, -1, 1) : 0;
      ac.controls.rudder = clamp(-0.2 * (((s.heading + 180) % 360) - 180), -1, 1); ac.controls.aileron = -0.05 * s.roll;
      ac.step(SIM_DT, env);
      if (!ac.wheelState.some((w) => w.contact)) lift = { d: (ac.lat - lat0) * 111000, kt: s.ias / KT };
    }
    expect(lift).not.toBeNull();
    expect(lift.d).toBeLessThan(id === 'fighter' || id === 'kingair' ? 900 : 2300);
    expect(lift.kt).toBeGreaterThan(L.Vr - 3); expect(lift.kt).toBeLessThan(L.Vr + 35);
    ac.controls.gearDown = false;
    const s = run(ac, 25, (st, a) => { a.controls.elevator = clamp(0.1 * (10 - st.pitch) - 0.05 * st.q, -1, 1); a.controls.aileron = -0.05 * st.roll; });
    expect(s.vs / FT * 60).toBeGreaterThan(800);
    expect(ac.gearPos).toBeLessThan(0.05);
    expect(ev.filter((e) => e.component === 'fuselage')).toHaveLength(0);
  }, T);

  it('cruises at its typical altitude and speed within the thrust available', () => {
    const alt = cruiseAltFt(cfg) * FT;
    const ac = make(id); ac.placeAirborne(37.6, -122.4, alt, 0, L.cruiseKtas * Math.sqrt(atmosphere(alt).sigma));
    expect(ac.controls.throttle).toBeLessThan(0.99);
    const s = run(ac, 30);
    expect(s.fuelFlow).toBeGreaterThan(0);
    expect(Math.abs(s.alt - alt) / FT).toBeLessThan(ac.fbw ? 100 : 400);
    expect(Math.abs(s.tas / KT - L.cruiseKtas)).toBeLessThan(25);
  }, T);

  it.skipIf(id === 'fighter')('stalls within 15% of the speed implied by its lift curve', () => {
    for (const fl of [0, cfg.aero.flaps.length - 1]) {
      const ac = make(id), fd = cfg.aero.flaps[fl].deg;
      let clmax = 0; for (let a = 0; a < 30; a += 0.1) clmax = Math.max(clmax, ac.aero.liftCoefficient(a * Math.PI / 180, fd));
      const vs = Math.sqrt((2 * ac.mass * 9.81) / (1.225 * cfg.geometry.wingArea * clmax)) / KT;
      ac.placeAirborne(37.6, -122.4, 1500, 0, vs * 1.3, { flapsLever: fl, gearDown: fl > 0 });
      ac.fbw = null; ac.controls.throttle = 0; // direct law: measure the airframe, not the protections
      let stallIas = null;
      run(ac, 60, (s, a) => {
        if (stallIas) return;
        a.controls.elevator = Math.min(1, 0.04 * a.time); a.controls.aileron = -0.05 * s.roll - 0.02 * s.p;
        if (s.stall > 0.5) stallIas = (s.ias / KT) / Math.sqrt(Math.max(s.nz, 0.3)); // 1-g equivalent stall speed
      });
      expect(stallIas).not.toBeNull();
      expect(Math.abs(stallIas / vs - 1)).toBeLessThan(0.15);
    }
  }, T);

  it('autopilot: HDG turn and altitude change, then holds altitude', () => {
    const ac = make(id); ac.placeAirborne(37.6, -122.4, 3000, 0, Math.min(250, L.Vy));
    const ap = ac.autopilot; ap.engage(ac);
    ap.sel.hdg = 90; ap.setLateral('HDG', ac);
    ap.sel.alt = 11800;
    if (cfg.autopilot.flc) {
      if (cfg.autopilot.at) { ap.toggleAt(ac); ap.sel.spd = Math.min(250, L.Vy); } else ac.controls.throttle = Math.min(1, ac.controls.throttle + 0.3);
      ap.setVertical('FLC', ac);
    } else { ap.setVertical('VS', ac); ap.sel.vs = 1500; ac.controls.throttle = Math.min(1, ac.controls.throttle + 0.2); }
    let s = run(ac, 200);
    expect(ap.engaged).toBe(true);
    expect(Math.abs(((s.headingMag - 90 + 540) % 360) - 180)).toBeLessThan(3);
    expect(Math.abs(s.alt / FT - 11800)).toBeLessThan(150);
    s = run(ac, 30);
    expect(Math.abs(s.alt / FT - 11800)).toBeLessThan(100); expect(Math.abs(s.roll)).toBeLessThan(3);
  }, T);

  it.skipIf(!MULTI.includes(id))('climbs with one engine failed after takeoff', () => {
    const ac = make(id);
    ac.placeAirborne(37.6, -122.4, 600, 0, L.V2 + 10, { flapsLever: L.takeoffFlap, gearDown: false });
    ac.controls.throttle = 1; ac.engines[0].failed = true;
    const s = run(ac, 45, (st, a) => {
      a.controls.elevator = clamp(0.08 * (clamp(st.ias / KT - (L.V2 + 10) + 6, 0, 12) - st.pitch) - 0.05 * st.q, -1, 1);
      a.controls.aileron = clamp(-0.05 * st.roll - 0.02 * st.p, -1, 1);
      a.controls.rudder = clamp(0.15 * st.beta - 0.06 * (((st.heading + 180) % 360) - 180), -1, 1);
    });
    expect(ac.engines[0].thrust).toBeLessThanOrEqual(0);
    expect(s.vs / FT * 60).toBeGreaterThan(300);
    expect(Math.abs(((s.heading + 180) % 360) - 180)).toBeLessThan(20);
  }, T);
});

describe('fly-by-wire protections', () => {
  it('Airbus-type normal law limits load factor and angle of attack under full back stick', () => {
    for (const id of ['a320', 'a350']) {
      const ac = make(id); ac.placeAirborne(37.6, -122.4, 3000, 0, 250);
      let maxNz = 0; run(ac, 6, (s, a) => { a.controls.elevator = 1; maxNz = Math.max(maxNz, s.nz); });
      expect(maxNz).toBeLessThan(AIRCRAFT[id].fbw.nzMax + 0.25);
      ac.placeAirborne(37.6, -122.4, 3000, 0, 160); ac.controls.throttle = 0;
      let maxAlpha = 0; run(ac, 30, (s, a) => { a.controls.elevator = 1; maxAlpha = Math.max(maxAlpha, s.alpha); });
      expect(maxAlpha).toBeLessThan(AIRCRAFT[id].fbw.alphaMaxDeg + 1.5);
    }
  }, T);
  it('neutral sidestick holds attitude after a bank input (FBW aircraft)', () => {
    const ac = make('a320'); ac.placeAirborne(37.6, -122.4, 3000, 0, 250);
    run(ac, 3, (s, a) => { a.controls.aileron = 0.5; });
    const s0 = ac.snapshot(), s = run(ac, 20, (st, a) => { a.controls.aileron = 0; });
    expect(Math.abs(s.roll - s0.roll)).toBeLessThan(3); expect(Math.abs(s.alt - s0.alt) / FT).toBeLessThan(60);
  }, T);
  it('fighter g-limiter holds 9 g and the AoA limiter prevents departure', () => {
    const ac = make('fighter'); ac.placeAirborne(37.6, -122.4, 3000, 0, 450); ac.controls.throttle = 1;
    let maxNz = 0; run(ac, 4, (s, a) => { a.controls.elevator = 1; maxNz = Math.max(maxNz, s.nz); });
    expect(maxNz).toBeGreaterThan(7.5); expect(maxNz).toBeLessThan(9.4);
    expect(ac.damage.destroyed).toBe(false);
    ac.placeAirborne(37.6, -122.4, 3000, 0, 200); ac.controls.throttle = 0.3;
    let maxAlpha = 0; run(ac, 8, (s, a) => { a.controls.elevator = 1; maxAlpha = Math.max(maxAlpha, s.alpha); });
    expect(maxAlpha).toBeLessThan(AIRCRAFT.fighter.fbw.alphaMaxDeg + 2);
  }, T);
});

describe.each(AUTOLAND)('%s ILS autoland', (id) => {
  it('captures LOC/GS, flares, touches down in the zone on the centreline and stops', () => {
    const cfg = AIRCRAFT[id], L = cfg.limits, nf = cfg.aero.flaps.length;
    const thr = { lat: 37.6, lon: -122.4, elev: 0 };
    const ac = make(id), ev = damageEvents(ac);
    ac.placeAirborne(thr.lat - 10 / 60, thr.lon + 400 / (111000 * Math.cos(37.6 * Math.PI / 180)), 2500 * FT, 10, L.Vref + 25, { flapsLever: Math.max(1, nf - 3), gearDown: true });
    ac.nav.setIls(makeIls({ ident: 'TEST', runway: '36', threshold: thr, heading: 0, length: 3000 }));
    const ap = ac.autopilot; ap.engage(ac); ap.sel.hdg = 10; ap.setLateral('HDG', ac); ap.setVertical('ALT', ac); ap.sel.alt = 2500; ap.setLateral('APP', ac);
    ap.toggleAt(ac); ap.sel.spd = L.Vref + 5;
    ac.controls.spoilersArmed = true;
    let td = null, stopped = null, flare = false;
    for (let i = 0; i < 240 * 400 && !stopped; i++) {
      const s = ac.snapshot();
      if (ac.nav.ilsInfo?.dist < 6 * 1852) ac.controls.flapsLever = nf - 1;
      if (ap.vert === 'FLARE') flare = true;
      if (!td && ac.wheelState.some((w, k) => k > 0 && w.contact)) {
        td = { d: (s.lat - thr.lat) * 111000, xte: (s.lon - thr.lon) * 111000 * Math.cos(37.6 * Math.PI / 180), sink: (-s.vs / FT) * 60 };
      }
      if (td && !ap.engaged) { ac.controls.reverse = s.ias / KT > 60 ? 1 : 0; ac.controls.brakeL = ac.controls.brakeR = 0.5; }
      if (td && s.gs < 1) stopped = (s.lat - thr.lat) * 111000;
      ac.step(SIM_DT, env);
      if (ac.damage.destroyed) break;
    }
    expect(flare).toBe(true);
    expect(td).not.toBeNull();
    expect(td.sink).toBeLessThan(500); expect(td.sink).toBeGreaterThan(30);
    expect(td.d).toBeGreaterThan(150); expect(td.d).toBeLessThan(900);
    expect(Math.abs(td.xte)).toBeLessThan(5);
    expect(stopped).not.toBeNull(); expect(stopped).toBeLessThan(3000);
    expect(ev.filter((e) => e.type !== 'touchdown')).toHaveLength(0);
  }, T);
});
