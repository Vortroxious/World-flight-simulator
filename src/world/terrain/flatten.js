// Airport flattening zones: blends the DEM to runway/airport elevation inside an airport hull.
// Shared by the terrain worker (mesh + physics grids) and main-thread fallback sampling.
import { radii, DEG } from '../../geo/wgs84.js';
import { smoothstep } from '../../core/math.js';

export const PAVED_DROP = 0.15; // terrain inside zones sits slightly below pavement meshes

/** Build a serialisable flatten zone. pts: hull [[e,n],..] in metres around (lat, lon); runways: [{a:[e,n,h], b:[e,n,h]}]. */
export function makeZone(id, lat, lon, pts, runways, elev, blend = 220) {
  const r = radii(lat);
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (const [e, n] of pts) { minE = Math.min(minE, e); maxE = Math.max(maxE, e); minN = Math.min(minN, n); maxN = Math.max(maxN, n); }
  return { id, lat, lon, pts, runways, elev, blend, mLat: r.M * DEG, mLon: r.N * Math.cos(lat * DEG) * DEG, bbox: [minE - blend, minN - blend, maxE + blend, maxN + blend] };
}

function inPoly(x, y, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function distPoly(x, y, pts) {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const ax = pts[j][0], ay = pts[j][1], ex = pts[i][0] - ax, ey = pts[i][1] - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1)));
    best = Math.min(best, Math.hypot(x - ax - ex * t, y - ay - ey * t));
  }
  return best;
}

/** Elevation of the airport surface at local (e, n): along the nearest runway's profile. */
export function zoneSurfaceHeight(z, e, n) {
  if (!z.runways.length) return z.elev;
  let best = Infinity, h = z.elev;
  for (const r of z.runways) {
    const ex = r.b[0] - r.a[0], ey = r.b[1] - r.a[1];
    const t = Math.max(0, Math.min(1, ((e - r.a[0]) * ex + (n - r.a[1]) * ey) / (ex * ex + ey * ey || 1)));
    const d = Math.hypot(e - r.a[0] - ex * t, n - r.a[1] - ey * t);
    if (d < best) { best = d; h = r.a[2] + (r.b[2] - r.a[2]) * t; }
  }
  return h;
}

/** Apply zones to a DEM height. Returns {h, w} where w is the zone weight (1 = fully inside). */
export function applyZones(zones, lat, lon, demH, out = { h: 0, w: 0 }) {
  out.h = demH; out.w = 0;
  if (!zones) return out;
  for (const z of zones) {
    const e = (lon - z.lon) * z.mLon, n = (lat - z.lat) * z.mLat;
    if (e < z.bbox[0] || e > z.bbox[2] || n < z.bbox[1] || n > z.bbox[3]) continue;
    const inside = inPoly(e, n, z.pts);
    const w = inside ? 1 : 1 - smoothstep(0, z.blend, distPoly(e, n, z.pts));
    if (w <= 0) continue;
    const zh = zoneSurfaceHeight(z, e, n) - PAVED_DROP;
    out.h = out.h + (zh - out.h) * w;
    out.w = Math.max(out.w, w);
  }
  return out;
}

/** Convex hull (monotone chain) of 2D points, CCW. */
export function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop();
  return lo.concat(up);
}
