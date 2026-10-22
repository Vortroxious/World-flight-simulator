// Procedural Web Audio sound design driven by simulation state (no sample files):
// piston engine + propeller, starter, wind, stall horn, flap motor, tyres, impacts, switch clicks, rain.
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
  impact(sev) { this.burst('lowpass', 300, clamp(sev, 0.2, 1.5), 0.9); this.burst('bandpass', 1200, clamp(sev * 0.6, 0.1, 1), 0.5); }
  tyre(sink) { this.burst('bandpass', 1400, clamp(0.15 + sink * 0.15, 0, 0.8), 0.25, 3); }

  update(ac, view, weather) {
    if (!this.ctx) return;
    const on = this.enabled ? 1 : 0;
    this.set(this.master.gain, this.volume * on, 0.1);
    const e = ac.engine, rpm = e.rpm;
    const fire = (rpm / 60) * 2; // 4-cylinder four-stroke: 2 firing events per revolution
    const power = e.power / ac.cfg.engine.maxPower;
    this.set(this.osc1.frequency, Math.max(fire, 1)); this.set(this.osc2.frequency, Math.max(fire / 2, 1)); this.set(this.osc3.frequency, Math.max(fire * 2, 1));
    this.set(this.engGain.gain, e.running ? 0.12 + 0.22 * power : rpm > 30 ? 0.05 * clamp(rpm / 300, 0, 1) : 0);
    this.set(this.engLP.frequency, 250 + 1400 * power + rpm * 0.15);
    this.set(this.exhaust.filter.frequency, 150 + fire * 3);
    this.set(this.propOsc.frequency, Math.max((rpm / 60) * 2, 1));
    this.set(this.propGain.gain, clamp(rpm / 2700, 0, 1) * 0.05);
    this.set(this.starterGain.gain, e.starterEngaged ? 0.08 : 0, 0.03);
    this.set(this.starterOsc.frequency, 120 + rpm * 0.3);
    const tas = ac.tas || 0;
    this.set(this.wind.gain.gain, clamp((tas / 60) ** 2, 0, 1) * (view === 'cockpit' ? 0.25 : 0.5));
    this.set(this.wind.filter.frequency, 300 + tas * 12);
    this.set(this.hornGain.gain, ac.warnings?.stall ? 0.12 : 0, 0.02);
    const flapTarget = ac.cfg.aero.flaps[ac.controls.flapsLever].deg;
    this.set(this.flapGain.gain, Math.abs(flapTarget - ac.flapDeg) > 0.2 && ac.elec.busVolts > 18 ? 0.05 : 0, 0.03);
    const gs = Math.hypot(ac.v[0], ac.v[1]);
    const rolling = ac.wheelState.some((w) => w.contact);
    this.set(this.rumble.gain.gain, rolling ? clamp(gs / 30, 0, 1) * 0.5 : 0, 0.05);
    this.set(this.cabin.frequency, view === 'cockpit' ? 1800 : 6000, 0.2);
    this.set(this.rain.gain.gain, weather?.precip === 'rain' ? 0.12 : 0, 0.5);
    if (ac.touchdown && ac.touchdown !== this.lastTd) { this.lastTd = ac.touchdown; this.tyre(ac.touchdown.sinkRate); }
  }

  stopAll() { if (this.ctx) this.set(this.master.gain, 0, 0.05); }
}
