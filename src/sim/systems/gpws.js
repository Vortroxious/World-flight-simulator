// Ground proximity warning (simplified modes 1-6) and radio-altitude callouts. Produces one active alert
// (highest priority) plus spoken callouts; evaluated at 10 Hz.
import { FT, KT } from '../../core/units.js';

const CALLOUTS = [2500, 1000, 500, 400, 300, 200, 100, 50, 40, 30, 20, 10];

export class Gpws {
  constructor(enabled, family) { this.enabled = enabled; this.family = family; this.reset(); }
  reset() { this.alert = ''; this.timer = 0; this.prevRa = null; this.closure = 0; this.lastCall = Infinity; this.queue = []; this.minimums = 200; this.inhibitUntil = 0; this.takeoff = true; this.maxRaSinceTo = 0; this.spokenAt = -10; }
  say(text) { this.queue.push(text); }

  update(dt, ac) {
    if (!this.enabled) return;
    this.timer += dt;
    if (this.timer < 0.1) return;
    const step = this.timer; this.timer = 0;
    const ra = ac.radioAlt / FT; // ft
    const s = ac.snapshot();
    const sink = -s.vs / FT * 60; // fpm (+ down)
    if (this.prevRa !== null) this.closure = this.closure * 0.7 + 0.3 * ((this.prevRa - ra) / step) * 60;
    this.prevRa = ra;
    const gearDown = ac.gearPos > 0.95, landingFlaps = ac.flapDeg >= (ac.cfg.aero.flaps.at(-2)?.deg ?? 0) - 0.5;
    if (ac.onGround) { this.takeoff = true; this.maxRaSinceTo = 0; }
    else this.maxRaSinceTo = Math.max(this.maxRaSinceTo, ra);
    if (this.takeoff && ra > 1500) this.takeoff = false;
    let alert = '';
    if (!ac.onGround && ra < 2450 && ac.elec.busVolts > 18) {
      if (sink > 1.6 * ra + 1250) alert = 'PULL UP';
      else if (sink > 1.25 * ra + 950) alert = 'SINK RATE';
      if (!alert && ra < 1500 && this.closure > 2600 + ra * 0.8 && !(gearDown && landingFlaps)) alert = this.closure > 4000 + ra ? 'PULL UP' : 'TERRAIN';
      if (!alert && this.takeoff && ra > 30 && ra < 1500 && sink > 200 && this.maxRaSinceTo - ra > 0.1 * this.maxRaSinceTo + 20) alert = "DON'T SINK";
      if (!alert && !this.takeoff && ra < 500 && !gearDown && s.ias / KT < 190 && ac.cfg.gear.retractable) alert = 'TOO LOW GEAR';
      if (!alert && !this.takeoff && ra < 245 && gearDown && !landingFlaps && s.ias / KT < 159) alert = 'TOO LOW FLAPS';
      const ils = ac.nav?.ilsInfo;
      if (!alert && ils?.gsValid && ra < 1000 && ra > 30 && ils.gsDots > 1.3 && gearDown) alert = 'GLIDESLOPE';
      if (!alert && Math.abs(s.roll) > 35 && ra > 30) alert = 'BANK ANGLE';
    }
    if (alert && (alert !== this.alert || ac.time - this.spokenAt > 2.5)) { this.say(alert === 'TERRAIN' ? 'TERRAIN TERRAIN' : alert); this.spokenAt = ac.time; }
    this.alert = alert;
    // Radio-altitude callouts on descent.
    if (!ac.onGround && sink > 100 && !this.takeoff) {
      for (const h of CALLOUTS) {
        if (ra <= h && this.lastCall > h) { this.say(h === 2500 ? 'TWENTY FIVE HUNDRED' : h === this.minimums ? 'MINIMUMS' : String(h)); this.lastCall = h; break; }
      }
      if (this.family !== 'fighter' && ac.cfg.fbw?.law === 'airbus' && ra < 20 && ra > 5 && ac.controls.throttle > 0.05 && this.lastCall >= 10 && !this.retardSaid) { this.say('RETARD'); this.retardSaid = true; }
    }
    if (ra > 2600 || ac.onGround) { this.lastCall = Infinity; this.retardSaid = false; }
  }
  drain() { const q = this.queue; this.queue = []; return q; }
}
