// Flight recorder: ring buffer of state snapshots for crash replay and post-crash telemetry.
export class Recorder {
  constructor(seconds = 30, hz = 30) { this.max = seconds * hz; this.dt = 1 / hz; this.buf = []; this.acc = 0; }
  reset() { this.buf = []; this.acc = 0; }
  record(dt, ac) {
    this.acc += dt;
    if (this.acc < this.dt) return;
    this.acc = 0;
    const s = ac.snapshot();
    this.buf.push({
      t: ac.time, lat: ac.lat, lon: ac.lon, alt: ac.alt, q: ac.q.slice(), ias: s.ias, vs: s.vs, agl: s.agl, nz: ac.nz, pitch: s.pitch, roll: s.roll,
      controls: { ...ac.controls }, flapDeg: ac.flapDeg, rpm: ac.engine.rpm, comp: ac.wheelState.map((w) => w.compression), detached: { ...ac.damage.detached },
    });
    if (this.buf.length > this.max) this.buf.shift();
  }
  get duration() { return this.buf.length ? this.buf[this.buf.length - 1].t - this.buf[0].t : 0; }
  /** Frame at time offset from start (seconds). */
  frameAt(t) {
    if (!this.buf.length) return null;
    const t0 = this.buf[0].t + t;
    let i = this.buf.findIndex((f) => f.t >= t0);
    if (i < 0) i = this.buf.length - 1;
    return this.buf[i];
  }
  /** Peak values over the last `sec` seconds (impact telemetry). */
  peaks(sec = 5) {
    const end = this.buf.length ? this.buf[this.buf.length - 1].t : 0;
    const w = this.buf.filter((f) => f.t >= end - sec);
    return {
      maxIas: Math.max(0, ...w.map((f) => f.ias)), minVs: Math.min(0, ...w.map((f) => f.vs)), maxNz: Math.max(1, ...w.map((f) => f.nz)), minNz: Math.min(1, ...w.map((f) => f.nz)),
    };
  }
}
