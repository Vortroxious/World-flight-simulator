// WGS84 geodesy: geodetic <-> ECEF <-> local ENU, great-circle helpers.
// All math is float64 and DOM-free so it can run in workers and Node tests.

export const A = 6378137.0; // semi-major axis (m)
export const F = 1 / 298.257223563;
export const E2 = F * (2 - F);
export const R_MEAN = 6371008.8;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/** Geodetic (deg, deg, m) -> ECEF [x,y,z] (m). */
export function geodeticToEcef(latDeg, lonDeg, h, out = [0, 0, 0]) {
  const lat = latDeg * DEG, lon = lonDeg * DEG;
  const sl = Math.sin(lat), cl = Math.cos(lat);
  const N = A / Math.sqrt(1 - E2 * sl * sl);
  out[0] = (N + h) * cl * Math.cos(lon);
  out[1] = (N + h) * cl * Math.sin(lon);
  out[2] = (N * (1 - E2) + h) * sl;
  return out;
}

/** ECEF -> geodetic {lat, lon, h} using Bowring's method (sub-mm accuracy near the surface). */
export function ecefToGeodetic(x, y, z) {
  const b = A * (1 - F);
  const ep2 = (A * A - b * b) / (b * b);
  const p = Math.hypot(x, y);
  const th = Math.atan2(z * A, p * b);
  const st = Math.sin(th), ct = Math.cos(th);
  const lat = Math.atan2(z + ep2 * b * st * st * st, p - E2 * A * ct * ct * ct);
  const lon = Math.atan2(y, x);
  const sl = Math.sin(lat);
  const N = A / Math.sqrt(1 - E2 * sl * sl);
  const h = p / Math.cos(lat) - N;
  return { lat: lat * RAD, lon: lon * RAD, h };
}

/**
 * Rotation matrix rows (east, north, up) at a geodetic point; ECEF delta -> ENU = M * d.
 * Returned as flat array [ex,ey,ez, nx,ny,nz, ux,uy,uz].
 */
export function enuBasis(latDeg, lonDeg) {
  const lat = latDeg * DEG, lon = lonDeg * DEG;
  const sl = Math.sin(lat), cl = Math.cos(lat), so = Math.sin(lon), co = Math.cos(lon);
  return [-so, co, 0, -sl * co, -sl * so, cl, cl * co, cl * so, sl];
}

/** Radii of curvature (meridian M, prime vertical N) at latitude. */
export function radii(latDeg) {
  const s = Math.sin(latDeg * DEG);
  const w = 1 - E2 * s * s;
  return { M: (A * (1 - E2)) / Math.pow(w, 1.5), N: A / Math.sqrt(w) };
}

/** Local tangent plane ENU frame anchored at a geodetic origin. */
export class LocalFrame {
  constructor(lat, lon, h = 0) { this.set(lat, lon, h); }
  set(lat, lon, h = 0) {
    this.lat = lat; this.lon = lon; this.h = h;
    this.origin = geodeticToEcef(lat, lon, h);
    this.m = enuBasis(lat, lon);
    return this;
  }
  /** Geodetic -> ENU [e, n, u] relative to this frame. */
  toEnu(lat, lon, h, out = [0, 0, 0]) {
    const p = geodeticToEcef(lat, lon, h);
    return this.ecefToEnu(p[0], p[1], p[2], out);
  }
  ecefToEnu(x, y, z, out = [0, 0, 0]) {
    const dx = x - this.origin[0], dy = y - this.origin[1], dz = z - this.origin[2];
    const m = this.m;
    out[0] = m[0] * dx + m[1] * dy + m[2] * dz;
    out[1] = m[3] * dx + m[4] * dy + m[5] * dz;
    out[2] = m[6] * dx + m[7] * dy + m[8] * dz;
    return out;
  }
  /** Rotate an ECEF direction into this ENU frame. */
  dirToEnu(dx, dy, dz, out = [0, 0, 0]) {
    const m = this.m;
    out[0] = m[0] * dx + m[1] * dy + m[2] * dz;
    out[1] = m[3] * dx + m[4] * dy + m[5] * dz;
    out[2] = m[6] * dx + m[7] * dy + m[8] * dz;
    return out;
  }
  enuToEcef(e, n, u, out = [0, 0, 0]) {
    const m = this.m;
    out[0] = this.origin[0] + m[0] * e + m[3] * n + m[6] * u;
    out[1] = this.origin[1] + m[1] * e + m[4] * n + m[7] * u;
    out[2] = this.origin[2] + m[2] * e + m[5] * n + m[8] * u;
    return out;
  }
  enuToGeodetic(e, n, u) {
    const p = this.enuToEcef(e, n, u);
    return ecefToGeodetic(p[0], p[1], p[2]);
  }
}

/** Great-circle distance (m) on the mean sphere. */
export function distance(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG, p2 = lat2 * DEG, dp = p2 - p1, dl = (lon2 - lon1) * DEG;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_MEAN * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial true bearing (deg 0..360) from point 1 to point 2. */
export function bearing(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG, p2 = lat2 * DEG, dl = (lon2 - lon1) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * RAD + 360) % 360;
}

/** Destination point given start, true bearing (deg) and distance (m). */
export function destination(lat, lon, brgDeg, dist) {
  const d = dist / R_MEAN, b = brgDeg * DEG, p1 = lat * DEG, l1 = lon * DEG;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * RAD, lon: ((l2 * RAD + 540) % 360) - 180 };
}

/** Cross-track distance (m, + right of course) of point 3 from great circle 1->2. */
export function crossTrack(lat1, lon1, lat2, lon2, lat3, lon3) {
  const d13 = distance(lat1, lon1, lat3, lon3) / R_MEAN;
  const t13 = bearing(lat1, lon1, lat3, lon3) * DEG;
  const t12 = bearing(lat1, lon1, lat2, lon2) * DEG;
  return Math.asin(Math.sin(d13) * Math.sin(t13 - t12)) * R_MEAN;
}

export const wrap360 = (a) => ((a % 360) + 360) % 360;
export const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
