import { describe, it, expect } from 'vitest';
import { atmosphere, pressureToAltitude, casFromTas, P0 } from '../../src/sim/atmosphere.js';

describe('ISA atmosphere', () => {
  it('sea level standard', () => { const a = atmosphere(0); expect(a.p).toBeCloseTo(101325, 0); expect(a.rho).toBeCloseTo(1.225, 3); expect(a.a).toBeCloseTo(340.3, 1); });
  it('tropopause 11 km: 216.65 K, 22632 Pa', () => { const a = atmosphere(11000); expect(a.T).toBeCloseTo(216.65, 2); expect(a.p / 22632).toBeCloseTo(1, 2); });
  it('10,000 ft density ratio ~0.738', () => expect(atmosphere(3048).sigma).toBeCloseTo(0.738, 2));
  it('altimeter reads true altitude when set to QNH', () => {
    const qnh = 99500;
    const a = atmosphere(1500, { qnh });
    expect(pressureToAltitude(a.p, qnh)).toBeCloseTo(1500, 0);
    expect(pressureToAltitude(a.p, P0)).toBeGreaterThan(1500); // low QNH: pressure altitude is above true altitude
  });
  it('CAS equals TAS at sea level, lower at altitude', () => {
    const sl = atmosphere(0), hi = atmosphere(3000);
    expect(casFromTas(50, sl.p, sl.a)).toBeCloseTo(50, 2);
    expect(casFromTas(50, hi.p, hi.a)).toBeLessThan(45);
  });
});
