// International Standard Atmosphere with non-standard sea-level pressure (QNH) and temperature deviation.
import { G0 } from '../core/units.js';

export const P0 = 101325; // Pa
export const T0 = 288.15; // K
export const RHO0 = 1.225; // kg/m3
export const L = 0.0065; // K/m
export const R = 287.053; // J/(kg K)
export const GAMMA = 1.4;
export const A0 = Math.sqrt(GAMMA * R * T0); // 340.29 m/s
const EXP = G0 / (R * L);

/**
 * Atmospheric state at geometric altitude h (m MSL; geopotential difference neglected).
 * @param {number} h
 * @param {{qnh?: number, isaDev?: number}} [cond] qnh in Pa, isaDev in K
 */
export function atmosphere(h, cond = {}) {
  const qnh = cond.qnh ?? P0, dev = cond.isaDev ?? 0;
  const tsl = T0 + dev;
  const hTrop = 11000;
  let T, p;
  if (h <= hTrop) {
    T = tsl - L * h;
    p = qnh * Math.pow(T / tsl, EXP);
  } else {
    const Tt = tsl - L * hTrop;
    const pt = qnh * Math.pow(Tt / tsl, EXP);
    T = Tt;
    p = pt * Math.exp((-G0 * (h - hTrop)) / (R * Tt));
  }
  const rho = p / (R * T);
  return { T, p, rho, a: Math.sqrt(GAMMA * R * T), sigma: rho / RHO0 };
}

/** Altimeter: indicated altitude for static pressure p and Kollsman setting (Pa). */
export function pressureToAltitude(p, setting = P0) {
  return (T0 / L) * (1 - Math.pow(p / setting, 1 / EXP));
}

/** Calibrated airspeed (m/s) from true airspeed, static pressure and speed of sound (compressible). */
export function casFromTas(tas, p, a) {
  const M = tas / a;
  const qc = p * (Math.pow(1 + 0.2 * M * M, 3.5) - 1);
  return A0 * Math.sqrt(5 * (Math.pow(qc / P0 + 1, 2 / 7) - 1));
}
