// Small float64 vector / quaternion helpers used by the simulation (arrays, no allocation-heavy classes).
// Conventions: NED world frame, body frame x-forward, y-right, z-down. Quaternion [w,x,y,z] rotates body -> NED.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const moveToward = (v, target, maxDelta) => (Math.abs(target - v) <= maxDelta ? target : v + Math.sign(target - v) * maxDelta);

export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add = (a, b, o = [0, 0, 0]) => { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; };
export const sub = (a, b, o = [0, 0, 0]) => { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; };
export const scale = (a, s, o = [0, 0, 0]) => { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; };
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b, o = [0, 0, 0]) => {
  const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
  o[0] = x; o[1] = y; o[2] = z; return o;
};
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a, o = [0, 0, 0]) => { const l = len(a) || 1; return scale(a, 1 / l, o); };

/** Quaternion from Euler roll (phi), pitch (theta), yaw (psi) radians, aerospace ZYX sequence. */
export function quatFromEuler(phi, theta, psi) {
  const cr = Math.cos(phi / 2), sr = Math.sin(phi / 2);
  const cp = Math.cos(theta / 2), sp = Math.sin(theta / 2);
  const cy = Math.cos(psi / 2), sy = Math.sin(psi / 2);
  return [cr * cp * cy + sr * sp * sy, sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy];
}

/** Euler {phi, theta, psi} (rad) from body->NED quaternion. */
export function quatToEuler(q) {
  const [w, x, y, z] = q;
  const phi = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const theta = Math.asin(clamp(2 * (w * y - z * x), -1, 1));
  const psi = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return { phi, theta, psi };
}

export const quatNormalize = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l; return q; };

export function quatMul(a, b, o = [0, 0, 0, 0]) {
  const w = a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3];
  const x = a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2];
  const y = a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1];
  const z = a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0];
  o[0] = w; o[1] = x; o[2] = y; o[3] = z; return o;
}

/** Rotate body vector into NED. */
export function bodyToNed(q, v, o = [0, 0, 0]) {
  const [w, x, y, z] = q;
  const vx = v[0], vy = v[1], vz = v[2];
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  o[0] = vx + w * tx + (y * tz - z * ty);
  o[1] = vy + w * ty + (z * tx - x * tz);
  o[2] = vz + w * tz + (x * ty - y * tx);
  return o;
}

/** Rotate NED vector into body. */
export function nedToBody(q, v, o = [0, 0, 0]) {
  return bodyToNed([q[0], -q[1], -q[2], -q[3]], v, o);
}

/** Integrate attitude with body rates w (rad/s) over dt using the exact axis-angle increment. */
export function quatIntegrate(q, w, dt) {
  const ang = Math.hypot(w[0], w[1], w[2]) * dt;
  if (ang < 1e-12) return q;
  const s = Math.sin(ang / 2) / (ang / dt);
  const dq = [Math.cos(ang / 2), w[0] * s, w[1] * s, w[2] * s];
  quatMul(q, dq, q);
  return quatNormalize(q);
}

/** Linear table interpolation; table is [[x, y], ...] sorted by x. */
export function interp1(table, x) {
  if (x <= table[0][0]) return table[0][1];
  const n = table.length - 1;
  if (x >= table[n][0]) return table[n][1];
  let i = 1;
  while (table[i][0] < x) i++;
  const [x0, y0] = table[i - 1], [x1, y1] = table[i];
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

/** Deterministic PRNG (mulberry32) so scenario tests and procedural scenery are reproducible. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash -> [0,1). */
export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 2D value noise in [0,1). */
export function valueNoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, y, octaves = 4, seed = 0) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) { s += amp * valueNoise(x * f, y * f, seed + i * 31); f *= 2; amp *= 0.5; }
  return s / (1 - 0.5 ** octaves);
}
