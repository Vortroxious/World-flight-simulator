// Fly-by-wire control laws.
//  airbus : sidestick = pitch-rate demand with flight-path hold at neutral, load-factor, AoA, pitch-attitude
//           and high-speed protections; roll-rate demand with bank hold (33°) and bank limit (67°); auto-trim.
//  boeing : yoke = same pitch law (C*-like) with protections; roll is conventional (direct aileron) with
//           bank-angle protection beyond 35°.
//  fighter: stick = pitch-rate demand limited by load factor (+9/-3 g) and AoA (25°); roll-rate demand up
//           to 240°/s; automatic turn coordination.
// On the ground and below ~20 ft the laws blend to direct control so rotation and flare feel natural.
import { clamp, smoothstep } from '../../core/math.js';
import { DEG, RAD } from '../../geo/wgs84.js';
import { G0, KT } from '../../core/units.js';
import { AttitudeLoops } from './control-laws.js';

export class FlyByWire {
  constructor(cfg) { this.cfg = cfg; this.loops = new AttitudeLoops(); this.reset(); }
  reset() { this.loops.reset(); this.nzPrev = null; this.nzDot = 0; this.gammaHold = null; this.bankHold = null; this.law = 'NORMAL'; this.protections = []; }

  /**
   * @param {object} ac Aircraft @param {{x:number,y:number}} stick pilot inputs (-1..1, y + = pull)
   * @returns {{elevator:number, aileron:number, rudderAdd:number}}
   */
  update(dt, ac, stick) {
    const f = this.cfg;
    const V = Math.max(ac.tas || 0, 30);
    const e = ac.euler, phi = e.phi, theta = e.theta;
    const ra = ac.radioAlt ?? 1e4;
    const direct = ac.onGround || ra < 6 ? 1 : 1 - smoothstep(6, 40, ra);
    this.protections = [];
    if (direct >= 0.999) { this.loops.reset(); this.gammaHold = null; this.bankHold = null; this.law = 'GROUND'; return { elevator: stick.y, aileron: stick.x, rudderAdd: 0 }; }
    this.law = direct > 0.01 ? 'FLARE' : 'NORMAL';

    // ---- Pitch ----
    const gamma = Math.asin(clamp((ac.v ? -ac.v[2] : 0) / V, -1, 1));
    const turnComp = ((G0 / V) * Math.sin(phi) * Math.tan(clamp(phi, -1.2, 1.2)));
    let qCmd;
    if (Math.abs(stick.y) < 0.04) {
      if (this.gammaHold === null) this.gammaHold = gamma;
      qCmd = turnComp + 1.2 * (this.gammaHold - gamma);
    } else {
      this.gammaHold = null;
      qCmd = turnComp + stick.y * f.qMax * DEG * (stick.y > 0 ? 1 : 0.8);
    }
    // Load factor limits: feed-forward pitch-rate cap from q ≈ (nz − cosθ·cosφ)·g/V, tightened by the
    // predicted load factor (nz + 0.3 s of its filtered rate) so short-period overshoot stays small.
    const nzRate = this.nzPrev == null ? 0 : (ac.nz - this.nzPrev) / dt;
    this.nzPrev = ac.nz; this.nzDot += (nzRate - this.nzDot) * clamp(dt / 0.08, 0, 1);
    const nzPred = ac.nz + 0.3 * this.nzDot, c1 = Math.cos(theta) * Math.cos(phi);
    const qHi = ((f.nzMax - c1) * G0) / V - Math.max(0, nzPred - f.nzMax) * 2 * G0 / V;
    const qLo = ((f.nzMin - c1) * G0) / V + Math.max(0, f.nzMin - nzPred) * 2 * G0 / V;
    if (qCmd > qHi) { qCmd = qHi; if (ac.nz > f.nzMax - 0.3) this.protections.push('G'); }
    if (qCmd < qLo) { qCmd = qLo; if (ac.nz < f.nzMin + 0.3) this.protections.push('G'); }
    // AoA protection: commanded alpha limited between alphaProt (neutral) and alphaMax (full back stick).
    const shift = ac.aero.flapValue(ac.flapDeg, 'alphaShift');
    const aProt = (f.alphaProtDeg - shift) * DEG, aMax = (f.alphaMaxDeg - shift) * DEG;
    const aLim = aProt + Math.max(0, stick.y) * (aMax - aProt);
    const aPred = ac.alpha + 0.3 * clamp(ac.alphaDot ?? 0, -1, 1);
    if (aPred > aProt - 1 * DEG) { qCmd = Math.min(qCmd, 2.0 * (aLim - aPred)); if (ac.alpha > aProt) this.protections.push('ALPHA'); }
    // Pitch attitude limits.
    if (theta > f.pitchMax * DEG) qCmd = Math.min(qCmd, 1.5 * (f.pitchMax * DEG - theta));
    if (theta < f.pitchMin * DEG) qCmd = Math.max(qCmd, 1.5 * (f.pitchMin * DEG - theta));
    // High-speed protection (transport laws).
    const vmo = ac.cfg.limits.Vmo * KT;
    if (f.law !== 'fighter' && (ac.iasTrue ?? 0) > vmo + 6 * KT) { qCmd = Math.max(qCmd, 0.03 * ((ac.iasTrue - vmo) / KT - 6) * DEG * 10); this.protections.push('HI SPD'); }
    let elevator = this.loops.pitch(dt, ac, qCmd, f.law === 'fighter' ? 4 : 2.5);
    this.loops.autoTrim(dt, ac, elevator);
    elevator = elevator * (1 - direct) + stick.y * direct;

    // ---- Roll ----
    let aileron;
    const bankLim = f.maxBank * DEG;
    if (f.directRoll) {
      aileron = stick.x;
      if (Math.abs(phi) > f.bankHold * DEG && Math.sign(stick.x) !== -Math.sign(phi)) { aileron -= Math.sign(phi) * clamp((Math.abs(phi) - f.bankHold * DEG) * 3, 0, 0.8); this.protections.push('BANK'); }
    } else {
      let pCmd;
      if (Math.abs(stick.x) < 0.04) {
        if (this.bankHold === null) this.bankHold = Math.abs(phi) > f.bankHold * DEG && f.law !== 'fighter' ? Math.sign(phi) * f.bankHold * DEG : phi;
        pCmd = 1.0 * (this.bankHold - phi);
      } else {
        this.bankHold = null;
        pCmd = stick.x * f.pMax * DEG;
        if (f.law !== 'fighter' && Math.abs(phi) > bankLim - 2 * DEG && Math.sign(pCmd) === Math.sign(phi)) { pCmd = 0.5 * (Math.sign(phi) * bankLim - phi); this.protections.push('BANK'); }
      }
      aileron = this.loops.roll(dt, ac, pCmd, f.law === 'fighter' ? 4 : 3);
    }
    aileron = aileron * (1 - direct) + stick.x * direct;
    // Turn coordination for the fighter (rudder from sideslip).
    const rudderAdd = f.law === 'fighter' ? clamp(4 * ac.beta, -0.5, 0.5) * (1 - direct) : 0;
    return { elevator, aileron, rudderAdd };
  }
}

export { RAD };
