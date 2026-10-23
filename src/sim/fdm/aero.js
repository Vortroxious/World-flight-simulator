// Aerodynamic coefficient build-up (lift, drag, side force, roll/pitch/yaw moments) in body axes.
import { DEG, RAD } from '../../geo/wgs84.js';
import { clamp, interp1, smoothstep } from '../../core/math.js';

export class Aero {
  constructor(cfg) {
    this.cfg = cfg;
    const a = cfg.aero, g = cfg.geometry;
    this.S = g.wingArea; this.b = g.span; this.c = g.chord;
    this.k = 1 / (Math.PI * (g.span * g.span) / g.wingArea * a.oswald);
    this.flaps = a.flaps;
    this.CLtable = a.CLtable || buildCLTable(a.generic);
    this.mach = a.mach || null;
    this.stallNoise = 0;
  }

  /** Compressibility drag rise (and supersonic decline for aircraft that can go supersonic). */
  waveDrag(M) {
    const m = this.mach;
    if (!m || M <= m.mcrit) return 0;
    if (!m.supersonic || M < 1.0) return m.rise * (M - m.mcrit) ** 2 * (M < 1 ? 1 : 1);
    const peak = m.rise * (1.0 - m.mcrit) ** 2 + (m.peak ?? 0.02);
    return M < 1.1 ? peak : peak / Math.pow(M * M - 1, 0.25) * 0.68;
  }

  /** Interpolate a flap-table field for a (continuous) flap deflection in degrees. */
  flapValue(deg, field) {
    const f = this.flaps;
    if (deg <= f[0].deg) return f[0][field];
    for (let i = 1; i < f.length; i++) {
      if (deg <= f[i].deg) {
        const t = (deg - f[i - 1].deg) / (f[i].deg - f[i - 1].deg);
        return f[i - 1][field] + (f[i][field] - f[i - 1][field]) * t;
      }
    }
    return f[f.length - 1][field];
  }

  /** Lift coefficient (no rate/control terms) for alpha (rad) and flap deflection (deg). */
  liftCoefficient(alpha, flapDeg = 0) {
    const shift = this.flapValue(flapDeg, 'alphaShift');
    let aDeg = alpha * RAD;
    // flap shift moves the curve left (stall occurs earlier) - only applied on positive side
    const shifted = aDeg > -10 ? aDeg + shift : aDeg;
    const cl = interp1(this.CLtable, clamp(shifted, -90, 90));
    // flap increment fades out post-stall / at extreme alpha
    const fade = 1 - smoothstep(25, 45, Math.abs(aDeg));
    return cl + this.flapValue(flapDeg, 'dCL') * fade;
  }

  stallFactor(alpha, flapDeg = 0) {
    const as = (this.cfg.aero.alphaStallDeg ?? this.cfg.aero.generic.alphaStallDeg) - this.flapValue(flapDeg, 'alphaShift');
    const a = alpha * RAD;
    return a >= 0 ? smoothstep(as - 1.0, as + 3.5, a) : smoothstep(13, 17, -a);
  }

  /**
   * @param {object} s  inputs: alpha, beta, V, qbar, p, q, r, alphaDot, flapDeg, de, da, dr (rad, my sign conventions),
   *   agl (m), gearDown (0..1), damage {wingL, wingR, hStab, vStab}, randomGust (0..1 noise), dragExtra (CD), clMaxFactor
   */
  compute(s, out) {
    const a = this.cfg.aero;
    const V = Math.max(s.V, 1e-3);
    const Vn = Math.max(V, 12); // normalisation speed floor for rate derivatives
    const alpha = s.alpha, beta = s.beta;
    const ph = (s.p * this.b) / (2 * Vn), qh = (s.q * this.c) / (2 * Vn), rh = (s.r * this.b) / (2 * Vn);
    const adh = (s.alphaDot * this.c) / (2 * Vn);
    const stall = this.stallFactor(alpha, s.flapDeg);
    const dmg = s.damage;
    const wingEff = (dmg.wingL + dmg.wingR) / 2;

    // Ground effect (Wieselsberger / McCormick): reduces induced drag, slight lift gain.
    const hb = Math.max(s.agl, 0.1) / this.b;
    const ge = (16 * hb) ** 2 / (1 + (16 * hb) ** 2);

    let CL = this.liftCoefficient(alpha, s.flapDeg) * (s.clMaxFactor ?? 1);
    CL *= 1 + 0.06 * (1 - ge);
    CL += a.CLq * qh - a.CLde * s.de; // nose-up elevator (TE up) slightly reduces lift
    CL *= wingEff;
    CL -= s.liftDump || 0; // spoilers / speedbrakes

    // Drag: parasite + induced (ground-effect reduced) + flaps + sideslip; blends to flat plate post-stall.
    const cdInduced = this.k * CL * CL * ge;
    const cdFlat = 1.28 * Math.sin(alpha) ** 2;
    const cdStall = smoothstep(18, 40, Math.abs(alpha * RAD));
    let CD = a.CD0 + this.flapValue(s.flapDeg, 'dCD') + a.CDbeta2 * beta * beta + (s.dragExtra || 0) + this.waveDrag(s.mach || 0);
    CD += cdInduced * (1 - cdStall) + cdFlat * cdStall + 0.02 * stall;
    CD += (1 - wingEff) * 0.04;

    const vEff = dmg.vStab, hEff = dmg.hStab;
    const CY = a.CYbeta * beta * (0.4 + 0.6 * vEff) + a.CYdr * s.dr * vEff;

    // Roll: post-stall the roll damping reverses sign (autorotation), plus asymmetric stall break.
    const clpEff = a.ClP * (1 - 1.7 * stall);
    let Cl = a.ClBeta * beta + clpEff * ph + a.ClR * rh * clamp(CL / 0.4, 0, 2) + a.ClDa * s.da * wingEff + a.ClDr * s.dr * vEff;
    Cl += stall * (0.06 * (s.randomGust ?? 0) - 0.25 * beta);
    Cl += 0.1 * this.liftCoefficient(alpha, s.flapDeg) * (dmg.wingL - dmg.wingR);

    const CmAlpha = a.CmAlphaWingBody + a.CmAlphaTail * hEff;
    let Cm = a.Cm0 + this.flapValue(s.flapDeg, 'dCm') + CmAlpha * Math.sin(alpha) + (a.CmQ * qh + a.CmAlphaDot * adh) * hEff + a.CmDe * s.de * hEff;
    Cm -= 0.25 * stall * Math.sign(alpha) * hEff; // nose-down break at the stall (tail still flying)
    Cm -= 0.04 * (1 - ge) * hEff; // reduced downwash on tail in ground effect -> nose-down

    const Cn = a.CnBeta * beta * (0.2 + 0.8 * vEff) + a.CnP * ph + a.CnR * rh * (0.3 + 0.7 * vEff) + a.CnDa * s.da + a.CnDr * s.dr * vEff;

    // Wind axes -> body axes.
    const ca = Math.cos(alpha), sa = Math.sin(alpha), cb = Math.cos(beta);
    const qS = s.qbar * this.S;
    const L = CL * qS, D = CD * qS, Y = CY * qS;
    out.F[0] = -D * ca * cb + L * sa;
    out.F[1] = Y;
    out.F[2] = -D * sa * cb - L * ca;
    out.M[0] = Cl * qS * this.b;
    out.M[1] = Cm * qS * this.c;
    out.M[2] = Cn * qS * this.b;
    out.CL = CL; out.CD = CD; out.Cm = Cm; out.stall = stall; out.L = L; out.D = D;
    return out;
  }
}

export const toRad = (d) => d * DEG;

/**
 * Lift curve from a few parameters: linear to near the stall, rounded peak at CLmax, post-stall drop and
 * flat-plate behaviour beyond. kind: 'conventional' (sharp break), 'swept' (milder), 'fighter' (vortex lift, gentle).
 */
export function buildCLTable(g) {
  const { CL0, CLalpha, CLmax, alphaStallDeg: as, kind = 'conventional' } = g;
  const slope = CLalpha * DEG; // per degree
  const lin = (a) => CL0 + slope * a;
  const aRound = Math.min(as - 1.5, (CLmax - 0.12 - CL0) / slope); // end of linear region
  const t = [];
  for (const a of [-90, -60, -45, -30, -20]) t.push([a, Math.sin(2 * a * DEG) * 0.95]);
  const negStall = -Math.min(as - 2, 16);
  t.push([negStall, Math.max(lin(negStall), -CLmax * 0.75)]);
  t.push([negStall + 4, lin(negStall + 4)]);
  t.push([0, CL0]);
  t.push([aRound, lin(aRound)]);
  t.push([(aRound + as) / 2, CLmax - 0.035]);
  t.push([as, CLmax]);
  const drop = { conventional: [0.97, 0.84, 0.76, 0.66], swept: [0.98, 0.9, 0.82, 0.72], fighter: [0.995, 0.97, 0.93, 0.85] }[kind];
  t.push([as + 1, CLmax * drop[0]]);
  t.push([as + 3, CLmax * drop[1]]);
  t.push([as + 6, CLmax * drop[2]]);
  t.push([as + 10, CLmax * drop[3]]);
  for (const a of [Math.max(as + 14, 32), 45, 60, 90]) t.push([a, Math.min(CLmax * drop[3], Math.sin(2 * a * DEG) * 1.0)]);
  return t.sort((x, y) => x[0] - y[0]).filter((p, i, arr) => i === 0 || p[0] > arr[i - 1][0]);
}
