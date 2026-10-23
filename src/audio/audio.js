// Procedural Web Audio sound design driven by simulation state (no sample files):
// piston engine + propeller, turbofan (fan buzz, turbine whine, jet roar, afterburner), turboprop (blade
// passage + whine), starter, wind, stall horn, flap/gear motors, warning chimes, AP disconnect, overspeed
// clacker, tyres, impacts, switch clicks, rain; GPWS/altitude callouts through speech synthesis.
import { clamp } from '../core/math.js';

export class AudioEngine {
  constructor() { this.ctx = null; this.enabled = true; this.volume = 0.8; }

  async start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(ctx.destination);
    this.cabin = ctx.createBiquadFilter(); this.cabin.type = 'lowpass'; this.cabin.frequency.value = 2500; this.cabin.connect(this.master);
    this.noiseBuf = this.makeNoise();
    // Engine: firing-frequency sawtooth + sub-harmonic + exhaust noise; through a power-dependent lowpass.
    this.engLP = ctx.createBiquadFilter(); this.engLP.type = 'lowpass'; this.engLP.Q.value = 2; this.engLP.connect(this.cabin);
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0; this.engGain.connect(this.engLP);
    this.osc1 = this.osc('sawtooth', 50, 0.5, this.engGain);
    this.osc2 = this.osc('square', 25, 0.25, this.engGain);
    this.osc3 = this.osc('triangle', 100, 0.2, this.engGain);
    this.exhaust = this.noise(this.engGain, 'bandpass', 300, 0.8, 0.6);
    // Propeller blade-passage buzz
    this.propGain = ctx.createGain(); this.propGain.gain.value = 0; this.propGain.connect(this.cabin);
    this.propOsc = this.osc('sawtooth', 80, 1, this.propGain);
    // Starter whine
    this.starterGain = ctx.createGain(); this.starterGain.gain.value = 0; this.starterGain.connect(this.cabin);
    this.starterOsc = this.osc('sawtooth', 140, 0.4, this.starterGain);
    // Wind
    this.wind = this.noise(this.master, 'bandpass', 500, 0.6, 0);
    // Stall horn (reed ~1.6 kHz)
    this.hornGain = ctx.createGain(); this.hornGain.gain.value = 0; this.hornGain.connect(this.master);
    this.osc('square', 1650, 0.08, this.hornGain); this.osc('sine', 1650, 0.3, this.hornGain);
    // Flap motor
    this.flapGain = ctx.createGain(); this.flapGain.gain.value = 0; this.flapGain.connect(this.cabin);
    this.osc('sawtooth', 310, 0.15, this.flapGain);
    // Ground roll rumble
    this.rumble = this.noise(this.cabin, 'lowpass', 120, 0.7, 0);
    // Rain
    this.rain = this.noise(this.master, 'highpass', 2500, 0.5, 0);
    // Turbine voices: whine (N2), jet roar (thrust), afterburner rumble
    this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0; this.whineGain.connect(this.cabin);
    this.whineOsc = this.osc('sine', 2000, 0.6, this.whineGain); this.whine2 = this.osc('triangle', 3100, 0.25, this.whineGain);
    this.roar = this.noise(this.master, 'lowpass', 500, 0.5, 0);
    this.abRoar = this.noise(this.master, 'lowpass', 180, 0.9, 0);
    // Alert tones: warning chime (repetitive), caution chime, overspeed clacker
    this.chimeGain = ctx.createGain(); this.chimeGain.gain.value = 0; this.chimeGain.connect(this.master);
    this.osc('sine', 1046, 0.5, this.chimeGain); this.osc('sine', 1318, 0.3, this.chimeGain);
    this.clackGain = ctx.createGain(); this.clackGain.gain.value = 0; this.clackGain.connect(this.master);
    this.osc('square', 18, 0.6, this.clackGain);
    this.prevContacts = 0;
  }

  osc(type, f, g, dest) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f;
    const gn = this.ctx.createGain(); gn.gain.value = g; o.connect(gn); gn.connect(dest); o.start();
    return o;
  }
  makeNoise() {
    const n = this.ctx.sampleRate * 2, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; last = 0.97 * last + 0.03 * w; d[i] = w * 0.5 + last * 3; }
    return b;
  }
  noise(dest, type, f, q, g) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const fl = this.ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const gn = this.ctx.createGain(); gn.gain.value = g;
    s.connect(fl); fl.connect(gn); gn.connect(dest); s.start();
    return { src: s, filter: fl, gain: gn };
  }

  set(param, v, tc = 0.05) { param.setTargetAtTime(v, this.ctx.currentTime, tc); }

  /** One-shot noise burst (impacts, tyre chirp, clicks). */
  burst(type, f, gain, dur, q = 1) {
    if (!this.ctx || !this.enabled) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const fl = this.ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const gn = this.ctx.createGain(); const t = this.ctx.currentTime;
    gn.gain.setValueAtTime(gain, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(gn); gn.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  click() { this.burst('highpass', 3000, 0.25, 0.03); }
  /** Short tone (chimes, AP disconnect). */
  tone(f, dur, gain = 0.2, type = 'sine', delay = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  /** GPWS / callout voice (speech synthesis; silent where unavailable). */
  say(text) {
    if (!this.enabled || typeof speechSynthesis === 'undefined') return;
    try {
      const u = new SpeechSynthesisUtterance(String(text).toLowerCase());
      u.rate = 1.15; u.pitch = 0.7; u.volume = Math.min(1, this.volume + 0.1);
      if (/PULL UP|TERRAIN|SINK RATE|GLIDESLOPE|BANK|DON'T SINK|TOO LOW/.test(text)) speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { /* speech unavailable */ }
  }
  impact(sev) { this.burst('lowpass', 300, clamp(sev, 0.2, 1.5), 0.9); this.burst('bandpass', 1200, clamp(sev * 0.6, 0.1, 1), 0.5); }
  tyre(sink) { this.burst('bandpass', 1400, clamp(0.15 + sink * 0.15, 0, 0.8), 0.25, 3); }

  update(ac, view, weather) {
    if (!this.ctx) return;
    const on = this.enabled ? 1 : 0;
    this.set(this.master.gain, this.volume * on, 0.1);
    const outside = view !== 'cockpit';
    if (ac.isPiston) this.updatePiston(ac); else this.updateTurbine(ac, outside);
    const tas = ac.tas || 0;
    this.set(this.wind.gain.gain, clamp((tas / 60) ** 2, 0, 1) * (outside ? 0.5 : ac.isPiston ? 0.25 : 0.15) * (ac.isPiston ? 1 : clamp(tas / 150, 0.3, 1)));
    this.set(this.wind.filter.frequency, 300 + Math.min(tas, 300) * 12);
    this.set(this.hornGain.gain, ac.isPiston && ac.warnings?.stall ? 0.12 : 0, 0.02);
    const flapTarget = ac.cfg.aero.flaps[ac.controls.flapsLever].deg;
    const gearMoving = ac.cfg.gear.retractable && ac.gearPos > 0.01 && ac.gearPos < 0.99;
    this.set(this.flapGain.gain, (Math.abs(flapTarget - ac.flapDeg) > 0.2 && ac.elec.busVolts > 18 ? 0.05 : 0) + (gearMoving ? 0.07 : 0), 0.03);
    const gs = Math.hypot(ac.v[0], ac.v[1]);
    const rolling = ac.wheelState.some((w) => w.contact);
    this.set(this.rumble.gain.gain, rolling ? clamp(gs / 30, 0, 1) * 0.5 : 0, 0.05);
    this.set(this.cabin.frequency, outside ? 6000 : 1800, 0.2);
    this.set(this.rain.gain.gain, weather?.precip === 'rain' ? 0.12 : 0, 0.5);
    if (ac.touchdown && ac.touchdown !== this.lastTd) { this.lastTd = ac.touchdown; this.tyre(ac.touchdown.sinkRate); }
    // Alerts: continuous repetitive chime with master warning (stall uses the shaker/voice on transports),
    // single chime on new cautions, AP-disconnect tone, overspeed clacker.
    const now = this.ctx.currentTime;
    const warn = !ac.isPiston && ac.masterWarning;
    this.set(this.chimeGain.gain, warn && now % 0.9 < 0.32 ? 0.08 : 0, 0.01);
    if (!ac.isPiston && ac.masterCaution && !this._caution) this.tone(880, 0.5, 0.15);
    this._caution = ac.masterCaution;
    const disc = !!ac.autopilot?.disc;
    if (disc && !this._disc) { for (let i = 0; i < 3; i++) { this.tone(1200, 0.18, 0.15, 'triangle', i * 0.3); this.tone(1600, 0.18, 0.1, 'triangle', i * 0.3 + 0.15); } }
    this._disc = disc;
    this.set(this.clackGain.gain, ac.warnings?.overspeed ? 0.05 : 0, 0.02);
    if (!ac.isPiston && ac.warnings?.stall && now - (this._stallT ?? 0) > 2.5) { this._stallT = now; this.say('STALL'); }
  }

  updatePiston(ac) {
    const e = ac.engine, rpm = e.rpm;
    const fire = (rpm / 60) * 2; // 4-cylinder four-stroke: 2 firing events per revolution
    const power = e.power / (ac.cfg.engines[0].maxPower ?? 134000);
    this.set(this.osc1.frequency, Math.max(fire, 1)); this.set(this.osc2.frequency, Math.max(fire / 2, 1)); this.set(this.osc3.frequency, Math.max(fire * 2, 1));
    this.set(this.engGain.gain, e.running ? 0.12 + 0.22 * power : rpm > 30 ? 0.05 * clamp(rpm / 300, 0, 1) : 0);
    this.set(this.engLP.frequency, 250 + 1400 * power + rpm * 0.15);
    this.set(this.exhaust.filter.frequency, 150 + fire * 3);
    this.set(this.propOsc.frequency, Math.max((rpm / 60) * 2, 1));
    this.set(this.propGain.gain, clamp(rpm / 2700, 0, 1) * 0.05);
    this.set(this.starterGain.gain, e.starterEngaged ? 0.08 : 0, 0.03);
    this.set(this.starterOsc.frequency, 120 + rpm * 0.3);
    this.set(this.whineGain.gain, 0); this.set(this.roar.gain.gain, 0); this.set(this.abRoar.gain.gain, 0);
  }

  updateTurbine(ac, outside) {
    const es = ac.engines, n = es.length, jet = ac.isJet;
    const avg = (f) => es.reduce((t, e) => t + f(e), 0) / n;
    const spool = avg((e) => (jet ? e.n2 : e.ng) / 100), fan = avg((e) => (jet ? e.n1 : e.ng) / 100);
    const thrustFrac = clamp(avg((e) => Math.max(0, e.thrust)) / ((es[0].cfg.maxThrust ?? (es[0].cfg.maxPower ?? 1e6) / 60) || 1), 0, 1.8);
    const ab = es.some((e) => e.afterburner);
    // Turbine whine rises with the core spool; fan "buzz" through the engine voice at shaft frequency.
    this.set(this.whineGain.gain, spool > 0.05 ? (0.015 + 0.03 * spool) * (outside ? 1 : 0.6) : 0);
    this.set(this.whineOsc.frequency, 600 + 2600 * spool); this.set(this.whine2.frequency, 900 + 4200 * spool);
    const shaft = 20 + 75 * fan;
    this.set(this.osc1.frequency, shaft); this.set(this.osc2.frequency, shaft / 2); this.set(this.osc3.frequency, shaft * 2);
    this.set(this.engGain.gain, fan > 0.15 ? 0.03 + 0.08 * fan : 0); this.set(this.engLP.frequency, 300 + 900 * fan);
    this.set(this.exhaust.filter.frequency, 200 + 600 * fan);
    // Jet roar (exhaust noise) dominates outside and behind; turboprops get a blade-passage buzz instead.
    this.set(this.roar.gain.gain, (jet ? 0.05 + 0.35 * thrustFrac : 0.04 + 0.12 * fan) * (outside ? 1 : 0.35) * (spool > 0.3 ? 1 : spool / 0.3));
    this.set(this.roar.filter.frequency, 250 + 1200 * clamp(thrustFrac, 0, 1));
    this.set(this.abRoar.gain.gain, ab ? (outside ? 0.7 : 0.3) : 0, 0.15);
    if (!jet) {
      const np = avg((e) => e.np), blades = ac.cfg.sound?.blades ?? 4;
      this.set(this.propOsc.frequency, Math.max((np / 60) * blades, 1)); this.set(this.propGain.gain, clamp(np / (es[0].cfg.propRPM ?? 2000), 0, 1) * 0.07);
    } else this.set(this.propGain.gain, 0);
    const starting = es.some((e) => e.starting);
    this.set(this.starterGain.gain, starting ? 0.04 : 0, 0.1); this.set(this.starterOsc.frequency, 200 + 900 * spool);
  }

  stopAll() { if (this.ctx) this.set(this.master.gain, 0, 0.05); }
}
