import cfg from '../src/aircraft/ga172/config.json';
import { Aircraft, SIM_DT } from '../src/sim/aircraft.js';
export { cfg, SIM_DT };
export const KT = 0.514444;
export function makeAc(opts) { return new Aircraft(cfg, { seed: 7, ...opts }); }
export function run(ac, seconds, env = {}, pilot) {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) { if (pilot) pilot(ac.snapshot(), ac); ac.step(SIM_DT, env); }
  return ac.snapshot();
}
/** Simple pitch-for-airspeed + wings-level pilot. */
export const speedPilot = (iasKt, bank = 0) => {
  let i = 0;
  return (s, ac) => {
    const e = s.ias / KT - iasKt; i += e * SIM_DT;
    const pitchCmd = Math.max(-15, Math.min(20, 2 + 0.6 * e + 0.05 * i));
    ac.controls.elevator = Math.max(-1, Math.min(1, 0.08 * (pitchCmd - s.pitch) - 0.05 * s.q));
    ac.controls.aileron = Math.max(-1, Math.min(1, 0.05 * (bank - s.roll) - 0.02 * s.p));
  };
};
/** Flat ground with a configurable surface and height. */
export const ground = (h = 0, surface = 'runway') => ({ sample: (lat, lon, out = {}) => { out.h = h; out.surface = surface; out.normal = [0, 0, 1]; out.zoneW = 0; return out; } });
