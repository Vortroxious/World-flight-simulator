// Weather state and atmospheric-disturbance model used by the flight model: wind profile with altitude,
// gusts, Dryden-like (first-order Markov) turbulence including rotational component, QNH and temperature.
import { DEG } from '../../geo/wgs84.js';
import { KT } from '../../core/units.js';
import { clamp, rng } from '../../core/math.js';
import { P0 } from '../atmosphere.js';

export const WEATHER_PRESETS = {
  clear:    { label: 'Clear & calm', windDir: 280, windKt: 0, gustKt: 0, turbulence: 0, visibilityKm: 60, cloudCover: 0, cloudBaseFt: 5000, precip: 'none' },
  breezy:   { label: 'Light westerly breeze', windDir: 290, windKt: 10, gustKt: 15, turbulence: 0.15, visibilityKm: 40, cloudCover: 0.25, cloudBaseFt: 4500, precip: 'none' },
  crosswind:{ label: 'Strong crosswind', windDir: 190, windKt: 18, gustKt: 26, turbulence: 0.35, visibilityKm: 25, cloudCover: 0.4, cloudBaseFt: 3500, precip: 'none' },
  haze:     { label: 'Marine haze / low visibility', windDir: 270, windKt: 6, gustKt: 0, turbulence: 0.05, visibilityKm: 3, cloudCover: 0.8, cloudBaseFt: 900, precip: 'none' },
  stormy:   { label: 'Gusty & turbulent', windDir: 230, windKt: 22, gustKt: 35, turbulence: 0.75, visibilityKm: 8, cloudCover: 0.9, cloudBaseFt: 2000, precip: 'rain' },
};

export class Weather {
  constructor(opts = {}) {
    this.set({ ...WEATHER_PRESETS.clear, qnhHpa: 1013.25, tempC: 15, ...opts });
    this.rand = rng(opts.seed ?? 1234);
    this.turb = [0, 0, 0]; this.turbP = 0; this.gust = 0; this.gustTarget = 0; this.gustTimer = 0;
  }
  set(o) {
    Object.assign(this, o);
    this.qnh = (this.qnhHpa ?? 1013.25) * 100;
    this.isaDev = (this.tempC ?? 15) - 15;
    return this;
  }
  get atmosphereConditions() { return { qnh: this.qnh, isaDev: this.isaDev }; }

  /** Gaussian sample via Box-Muller. */
  gauss() { const u = Math.max(this.rand(), 1e-9), v = this.rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  /** Mean wind (NED, m/s, blowing TOWARD) at height above ground. */
  meanWind(agl) {
    const factor = clamp(Math.pow(Math.max(agl, 1) / 10, 1 / 7), 0.35, 1.45);
    const spd = this.windKt * KT * factor;
    const veer = clamp(agl / 600, 0, 1) * 15; // veers with height (northern hemisphere)
    const to = (this.windDir + 180 + veer) * DEG;
    return [Math.cos(to) * spd, Math.sin(to) * spd, 0];
  }

  /**
   * Advance disturbance state and return total wind NED plus rotational turbulence (rad/s).
   * @param {number} dt @param {number} agl @param {number} V airspeed for turbulence length scale
   */
  sample(dt, agl, V) {
    const w = this.meanWind(agl);
    // Gusts: random events up to (gust - mean), aligned with mean wind direction.
    const gustDelta = Math.max(0, (this.gustKt || 0) - this.windKt) * KT;
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) { this.gustTimer = 2 + this.rand() * 6; this.gustTarget = this.rand() < 0.45 ? this.rand() * gustDelta : 0; }
    this.gust += (this.gustTarget - this.gust) * clamp(dt * 0.9, 0, 1);
    const spd = Math.hypot(w[0], w[1]) || 1;
    w[0] += (w[0] / spd) * this.gust; w[1] += (w[1] / spd) * this.gust;

    // Turbulence: first-order Markov per axis (Dryden approx). sigma grows near ground with wind (mechanical).
    const mech = clamp(this.windKt / 25, 0, 1) * clamp(1 - agl / 900, 0, 1) * 0.6;
    const sigma = (this.turbulence + mech) * 3.2; // m/s
    const L = clamp(agl < 300 ? Math.max(agl, 30) : 530, 30, 530);
    const tau = L / Math.max(V, 10);
    const k = Math.sqrt((2 * dt) / tau);
    for (let i = 0; i < 3; i++) {
      const s = i === 2 ? sigma * 0.7 * clamp(agl / 60, 0.1, 1) : sigma;
      this.turb[i] += -this.turb[i] * (dt / tau) + s * k * this.gauss();
    }
    this.turbP += -this.turbP * (dt / (tau * 0.5)) + sigma * 0.02 * Math.sqrt((4 * dt) / tau) * this.gauss();
    return { wind: [w[0] + this.turb[0], w[1] + this.turb[1], w[2] + this.turb[2]], pGust: this.turbP, sigma };
  }
}
