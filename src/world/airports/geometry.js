// Geometry helpers for airport/scenery construction in a local ENU frame (three.js axes x=E, y=U, z=-N),
// including Earth-curvature correction so long runways and city blocks sit on the ellipsoid.
import * as THREE from 'three';

const R2 = 2 * 6371000;
export const curv = (e, n) => (e * e + n * n) / R2;

/** Accumulate triangles with per-vertex colour and uv into one BufferGeometry. */
export class MeshBuilder {
  constructor() { this.pos = []; this.col = []; this.uv = []; this.nor = []; }
  vert(e, n, h, color, u = 0, v = 0, normal = null) {
    this.pos.push(e, h - curv(e, n), -n);
    this.col.push(color[0] ** 2.2, color[1] ** 2.2, color[2] ** 2.2); // sRGB palette -> linear
    this.uv.push(u, v);
    if (normal) this.nor.push(normal[0], normal[1], normal[2]);
  }
  get count() { return this.pos.length / 3; }
  build(computeNormals = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.nor.length === this.pos.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    else if (computeNormals) g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Triangulate and return index triples wound counter-clockwise in (e, n) - i.e. facing up in three.js. */
export function ccwTris(contour) {
  return THREE.ShapeUtils.triangulateShape(contour, []).map(([a, b, c]) => {
    const A = contour[a], B = contour[b], C = contour[c];
    return (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) >= 0 ? [a, b, c] : [a, c, b];
  });
}

/** Flat polygon (CCW [[e,n],...]) at heights from hFn(e,n), offset dz. */
export function addPolygon(mb, pts, hFn, color, dz = 0) {
  const contour = pts.map(([e, n]) => new THREE.Vector2(e, n));
  if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  for (const t of ccwTris(contour)) for (const i of t) {
    const p = contour[i];
    mb.vert(p.x, p.y, hFn(p.x, p.y) + dz, color, p.x / 20, p.y / 20, [0, 1, 0]);
  }
}

/** Ribbon along a polyline of width w. */
export function addRibbon(mb, pts, w, hFn, color, dz = 0) {
  if (pts.length < 2) return;
  const half = w / 2;
  const L = [], Rr = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    let s = half;
    if (i > 0 && i < pts.length - 1) { // miter, limited
      const d1x = p[0] - a[0], d1y = p[1] - a[1], l1 = Math.hypot(d1x, d1y) || 1;
      const cos = (d1x / l1) * dx + (d1y / l1) * dy;
      s = half / Math.max(0.5, Math.sqrt((1 + cos) / 2));
    }
    L.push([p[0] - dy * s, p[1] + dx * s]); Rr.push([p[0] + dy * s, p[1] - dx * s]);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = L[i], b = Rr[i], c = L[i + 1], d = Rr[i + 1];
    for (const q of [a, b, c, c, b, d]) mb.vert(q[0], q[1], hFn(q[0], q[1]) + dz, color, 0, 0, [0, 1, 0]);
  }
}

/** Extruded building footprint with walls (uv in metres/3.5 for window textures) and flat roof. */
export function addBuilding(walls, roofs, pts, base, height, wallColor, roofColor, windowed = true) {
  const top = base + height, bottom = base - 8;
  let per = 0;
  const contour = pts.map(([e, n]) => new THREE.Vector2(e, n));
  if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i], b = contour[(i + 1) % contour.length];
    const len = a.distanceTo(b);
    const nx = (b.y - a.y) / (len || 1), nz = (b.x - a.x) / (len || 1); // outward normal (e,n) = (dy, -dx)
    const nrm = [nx, 0, nz];
    const u0 = windowed ? per / 3.6 : 0.02, u1 = windowed ? (per + len) / 3.6 : 0.02;
    const v0 = windowed ? -8 / 3.4 : 0.02, v1 = windowed ? height / 3.4 : 0.02;
    walls.vert(a.x, a.y, bottom, wallColor, u0, v0, nrm); walls.vert(b.x, b.y, bottom, wallColor, u1, v0, nrm); walls.vert(a.x, a.y, top, wallColor, u0, v1, nrm);
    walls.vert(a.x, a.y, top, wallColor, u0, v1, nrm); walls.vert(b.x, b.y, bottom, wallColor, u1, v0, nrm); walls.vert(b.x, b.y, top, wallColor, u1, v1, nrm);
    per += len;
  }
  for (const t of ccwTris(contour)) for (const i of t) roofs.vert(contour[i].x, contour[i].y, top, roofColor, 0, 0, [0, 1, 0]);
}

let windowTex = null;
/** Facade texture: map (white walls, dark glass) + emissive (lit windows at night). */
export function windowTextures() {
  if (windowTex) return windowTex;
  const mk = (lit) => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = lit ? '#000' : '#fff'; g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      const on = ((x * 7 + y * 13) % 3) !== 0;
      g.fillStyle = lit ? (on ? '#ffd890' : '#000') : '#5d6873';
      g.fillRect(x * 64 + 10, y * 64 + 16, 44, 34);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  windowTex = { map: mk(false), emissive: mk(true) };
  return windowTex;
}

export function buildingMaterials() {
  const w = windowTextures();
  const walls = new THREE.MeshStandardMaterial({ vertexColors: true, map: w.map, emissiveMap: w.emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0, roughness: 0.75, metalness: 0.05 });
  const roofs = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  return { walls, roofs };
}
