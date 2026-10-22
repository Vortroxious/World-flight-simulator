// Pitot-static and gyroscopic instrument models. Indications are derived from simulated air data and
// instrument power sources (vacuum pump / electrical bus) — they lag, drift and fail realistically.
import { clamp, quatToEuler } from '../../core/math.js';
import { pressureToAltitude, casFromTas, P0 } from '../atmosphere.js';
import { RAD, wrap360 } from '../../geo/wgs84.js';

export class Instruments {
  constructor() {
    this.kollsman = P0; // altimeter setting (Pa)
    this.ias = 0; this.altitude = 0; this.vsi = 0;
    this.aiPitch = 0; this.aiRoll = 0; this.aiSpin = 0; // gyro rotor speed 0..1
    this.dgHeading = 0; this.dgSpin = 0; this.dgBug = 0; this.dgDrift = 0.0125;
    this.turnRate = 0; this.slip = 0; this.tcSpin = 0;
    this.compass = 0; this.vacuum = 0;
    this.pitotBlocked = false; this.staticBlocked = false; this.vacuumFailed = false; // failure injection
    this._altPrev = null;
    this.stallWarning = false;
  }

  /** Initialise gyros spun-up and aligned (used for 'ready for takeoff' starts). */
  align(st, spun = true) {
    const e = quatToEuler(st.q);
    this.aiPitch = e.theta * RAD; this.aiRoll = e.phi * RAD;
    this.dgHeading = wrap360(e.psi * RAD - st.magvar);
    this.compass = this.dgHeading;
    this.aiSpin = this.dgSpin = this.tcSpin = spun ? 1 : 0;
    this.altitude = pressureToAltitude(st.atm.p, this.kollsman);
    this._altPrev = this.altitude;
  }

  update(dt, st, sys) {
    // Vacuum pump driven by engine rpm (suction ~ 4.5-5.5 inHg above ~1200 rpm).
    this.vacuum = this.vacuumFailed ? 0 : clamp((st.rpm - 300) / 900, 0, 1) * 5.0;
    const vacOk = this.vacuum > 3.5 ? 1 : this.vacuum / 3.5;
    this.aiSpin += ((vacOk) - this.aiSpin) * clamp(dt / (vacOk > this.aiSpin ? 40 : 240), 0, 1);
    this.dgSpin += ((vacOk) - this.dgSpin) * clamp(dt / (vacOk > this.dgSpin ? 40 : 240), 0, 1);
    const tcPower = sys.busVolts > 18 ? 1 : 0;
    this.tcSpin += (tcPower - this.tcSpin) * clamp(dt / (tcPower ? 8 : 60), 0, 1);

    const e = quatToEuler(st.q);
    const pitch = e.theta * RAD, roll = e.phi * RAD, hdgMag = wrap360(e.psi * RAD - st.magvar);

    // Airspeed (pitot-static; blocked pitot freezes impact pressure).
    if (!this.pitotBlocked) this.ias += (casFromTas(Math.max(st.tasFwd, 0), st.atm.p, st.atm.a) - this.ias) * clamp(dt * 8, 0, 1);
    // Altimeter / VSI.
    const altTrue = pressureToAltitude(st.atm.p, this.kollsman);
    if (!this.staticBlocked) this.altitude += (altTrue - this.altitude) * clamp(dt * 6, 0, 1);
    if (this._altPrev == null) this._altPrev = this.altitude;
    const rate = (this.altitude - this._altPrev) / dt;
    this._altPrev = this.altitude;
    this.vsi += (rate - this.vsi) * clamp(dt / 1.6, 0, 1); // ~6-9 s lag typical of non-IVSI

    // Attitude indicator: follows truth when spun; topples/droops when rotor slows.
    const ok = this.aiSpin;
    const k = clamp(dt * 12 * Math.max(0, (ok - 0.4) / 0.6) ** 2, 0, 1); // erection weakens as the rotor slows
    this.aiPitch += (pitch - this.aiPitch) * k;
    this.aiRoll += (roll - this.aiRoll) * k;
    if (ok < 0.7) { this.aiRoll += (25 - this.aiRoll) * dt * 0.15 * (0.7 - ok); this.aiPitch += (-10 - this.aiPitch) * dt * 0.15 * (0.7 - ok); }

    // Directional gyro: tracks heading with precession drift; must be aligned to compass with the knob.
    this._lastHdg ??= hdgMag;
    const dh = ((hdgMag - this._lastHdg + 540) % 360) - 180;
    this._lastHdg = hdgMag;
    // Gyro precession drift (~0.75 deg/min) - pilot re-aligns DG to the compass with the knob.
    if (this.dgSpin > 0.7) this.dgHeading = wrap360(this.dgHeading + dh * this.dgSpin + this.dgDrift * dt);
    else this.dgHeading = wrap360(this.dgHeading + dh * this.dgSpin * 0.3);

    // Turn coordinator (electric) — rate of turn plus roll-rate component; inclinometer ball from lateral accel.
    const tc = (st.yawRateNed * RAD) / 3 + st.p * RAD * 0.05; // 1.0 = standard rate
    this.turnRate += (tc * this.tcSpin - this.turnRate) * clamp(dt * 4, 0, 1);
    this.slip += (clamp(st.ay / 9.81, -1, 1) - this.slip) * clamp(dt * 5, 0, 1);

    // Magnetic compass: damped, with northerly turning error approximation.
    const target = wrap360(hdgMag - 0.3 * roll * Math.cos(hdgMag / RAD));
    const dc = ((target - this.compass + 540) % 360) - 180;
    this.compass = wrap360(this.compass + dc * clamp(dt * 1.5, 0, 1));
  }

  syncDG() { this.dgHeading = this.compass; }
}
