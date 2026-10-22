// Spatial hash of static obstacles (buildings as extruded footprints, trees as cylinders) for collision queries.
import { LocalFrame, geodeticToEcef } from '../../geo/wgs84.js';

function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Outward horizontal normal and distance to the closest edge of a polygon. */
function nearestEdge(x, y, pts) {
  let best = Infinity, nx = 0, ny = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const ax = pts[j][0], ay = pts[j][1], bx = pts[i][0], by = pts[i][1];
    const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / l2));
    const px = ax + ex * t, py = ay + ey * t;
    const d = Math.hypot(x - px, y - py);
    if (d < best) { best = d; const l = Math.sqrt(l2); nx = ey / l; ny = -ex / l; } // CCW polygon -> right normal is outward
  }
  return { d: best, nx, ny };
}

/** A group of obstacles authored in one local ENU frame. */
export class ObstacleGroup {
  constructor(lat, lon, cell = 40) {
    this.frame = new LocalFrame(lat, lon, 0);
    this.cell = cell;
    this.grid = new Map();
    this.radius = 0; // bounding radius (m) of the group
    this.count = 0;
  }
  _key(ix, iy) { return ix * 73856093 ^ iy * 19349663; }
  _insert(obj, minX, minY, maxX, maxY) {
    const c = this.cell;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++)
      for (let iy = Math.floor(minY / c); iy <= Math.floor(maxY / c); iy++) {
        const k = this._key(ix, iy);
        let a = this.grid.get(k);
        if (!a) this.grid.set(k, (a = []));
        a.push(obj);
      }
    this.radius = Math.max(this.radius, Math.hypot(minX, minY), Math.hypot(maxX, maxY));
    this.count++;
  }
  /** Footprint polygon [[e,n],...] (CCW), base elevation (m MSL) and height (m). */
  addBuilding(pts, base, height, info = {}) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    this._insert({ type: 'building', pts, base, top: base + height, minX, minY, maxX, maxY, ...info }, minX, minY, maxX, maxY);
  }
  addTree(e, n, base, height, crownR) {
    this._insert({ type: 'tree', e, n, base, top: base + height, r: crownR, trunk: 0.35 }, e - crownR, n - crownR, e + crownR, n + crownR);
  }
  addBox(e, n, hw, hl, headingRad, base, height, info = {}) {
    const c = Math.cos(headingRad), s = Math.sin(headingRad);
    const corners = [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]].map(([x, y]) => [e + x * c + y * s, n - x * s + y * c]);
    this.addBuilding(corners, base, height, info);
  }

  /**
   * Query a point given in ECEF. Returns null or {type, depth, normal:[e,n,u] (in this frame), obj}.
   */
  query(ecef) {
    const p = this.frame.ecefToEnu(ecef[0], ecef[1], ecef[2]);
    if (Math.hypot(p[0], p[1]) > this.radius + 50) return null;
    const list = this.grid.get(this._key(Math.floor(p[0] / this.cell), Math.floor(p[1] / this.cell)));
    if (!list) return null;
    const alt = p[2] + this.frame.h; // approx MSL within a few km of origin (curvature drop handled by caller tolerance)
    const drop = (p[0] * p[0] + p[1] * p[1]) / (2 * 6371000);
    const h = alt + drop;
    for (const o of list) {
      if (h > o.top || h < o.base - 2) continue;
      if (o.type === 'tree') {
        const d = Math.hypot(p[0] - o.e, p[1] - o.n);
        if (d < o.r) {
          const trunkHit = d < o.trunk + 0.3;
          return { type: 'tree', trunk: trunkHit, depth: trunkHit ? o.trunk + 0.3 - d : o.r - d, normal: [(p[0] - o.e) / (d || 1), (p[1] - o.n) / (d || 1), 0], obj: o, frame: this.frame };
        }
      } else if (p[0] >= o.minX && p[0] <= o.maxX && p[1] >= o.minY && p[1] <= o.maxY && pointInPoly(p[0], p[1], o.pts)) {
        const edge = nearestEdge(p[0], p[1], o.pts);
        const fromTop = o.top - h;
        if (fromTop < edge.d) return { type: 'building', depth: fromTop, normal: [0, 0, 1], obj: o, frame: this.frame };
        return { type: 'building', depth: edge.d, normal: [edge.nx, edge.ny, 0], obj: o, frame: this.frame };
      }
    }
    return null;
  }
}

/** Collection of obstacle groups; queried with geodetic points. */
export class CollisionWorld {
  constructor() { this.groups = new Set(); }
  add(g) { this.groups.add(g); return g; }
  remove(g) { this.groups.delete(g); }
  clear() { this.groups.clear(); }
  queryGeodetic(lat, lon, h) {
    if (!this.groups.size) return null;
    const e = geodeticToEcef(lat, lon, h);
    for (const g of this.groups) { const r = g.query(e); if (r) return r; }
    return null;
  }
}
