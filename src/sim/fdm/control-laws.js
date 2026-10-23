// Model-based inner loops shared by fly-by-wire laws and the autopilot. Commands are expressed as desired
// pitch/roll rates; surface deflections are computed from the aircraft's actual control effectiveness
// (derivative × dynamic pressure × geometry / inertia), so the same gains work for a C172 and an A350.
import { clamp } from '../../core/math.js';
import { DEG } from '../../geo/wgs84.js';

export class AttitudeLoops {
  constructor() { this.reset(); }
  reset() { this.iPitch = null; this.iRoll = 0; }

  /** Returns elevator control position (-1..1) to achieve pitch rate qDes (rad/s). */
  pitch(dt, ac, qDes, Kq = 2.5) {
    const c = ac.cfg.controls, eff = Math.max(ac.pitchEffectiveness(), 0.05);
    const q = ac.w[1];
    if (this.iPitch === null) this.iPitch = ac.totalDe ?? 0;
    const upMax = c.elevatorUpDeg * DEG, dnMax = c.elevatorDownDeg * DEG;
    this.iPitch = clamp(this.iPitch + (0.7 * Kq * (qDes - q) / eff) * dt, -dnMax - c.trimRangeRad, upMax + c.trimRangeRad);
    const de = this.iPitch + this.pitchFeedForward(ac, qDes) + (Kq * (qDes - q)) / eff;
    const surf = de - ac.controls.trim * c.trimRangeRad;
    return clamp(surf >= 0 ? surf / upMax : surf / dnMax, -1, 1);
  }

  /**
   * Elevator increment that sustains a steady pitch rate (pull-up): the extra angle of attack for the extra
   * load factor (q·V/g) times the static stability, plus pitch damping, divided by elevator power.
   */
  pitchFeedForward(ac, qDes) {
    const a = ac.cfg.aero, g = ac.cfg.geometry, V = Math.max(ac.tas || 0, 30), qbar = Math.max(ac.qbar || 0, 50);
    const CLa = a.generic?.CLalpha ?? a.CLalpha ?? 5;
    const dAlpha = (qDes * V / 9.80665) * ac.mass * 9.80665 / (qbar * g.wingArea * CLa);
    const dCm = (a.CmAlphaWingBody + a.CmAlphaTail) * dAlpha + a.CmQ * qDes * g.chord / (2 * V);
    return clamp(-dCm / a.CmDe, -0.15, 0.15);
  }

  /** Returns aileron control position (-1..1) to achieve roll rate pDes (rad/s). */
  roll(dt, ac, pDes, Kp = 3) {
    const c = ac.cfg.controls, eff = Math.max(ac.rollEffectiveness(), 0.05);
    const p = ac.w[0];
    this.iRoll = clamp(this.iRoll + (0.5 * Kp * (pDes - p) / eff) * dt, -c.aileronDeg * DEG * 0.5, c.aileronDeg * DEG * 0.5);
    const da = this.iRoll + (Kp * (pDes - p)) / eff;
    return clamp(da / (c.aileronDeg * DEG), -1, 1);
  }

  /** Move the trim so the elevator unloads towards neutral (auto-trim / stabiliser trim). */
  autoTrim(dt, ac, elevator) {
    const c = ac.cfg.controls;
    const rate = c.trimRatePerSec ?? 0.1;
    ac.controls.trim = clamp(ac.controls.trim + clamp(elevator, -1, 1) * rate * dt * 1.5, -1, 1);
  }
}
