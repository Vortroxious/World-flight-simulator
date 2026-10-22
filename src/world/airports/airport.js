// Runtime airport: builds runways (with baked markings), taxiways, aprons, buildings, lighting and PAPI from
// OurAirports runway data plus an OSM "hero" layout when available, otherwise a procedural layout.
// Also provides the terrain flattening zone, paved-surface queries for physics, obstacles and spawn points.
import * as THREE from 'three';
import { LocalFrame, bearing, destination, DEG, wrap360 } from '../../geo/wgs84.js';
import { makeZone, convexHull, zoneSurfaceHeight } from '../terrain/flatten.js';
import { MeshBuilder, addPolygon, addRibbon, addBuilding, buildingMaterials, curv } from './geometry.js';
import { runwayTexture, isPaved } from './runway-texture.js';
import { LightSet, Papi } from './lighting.js';
import { ObstacleGroup } from '../../sim/collision/obstacles.js';

const C = {
  asphalt: [0.27, 0.27, 0.28], taxi: [0.31, 0.31, 0.31], apron: [0.46, 0.46, 0.44], yellow: [0.85, 0.66, 0.12],
  terminal: [0.78, 0.8, 0.84], hangar: [0.72, 0.74, 0.74], building: [0.8, 0.75, 0.66], tower: [0.85, 0.85, 0.82], roof: [0.42, 0.42, 0.43],
};

export class Airport {
  constructor(data, hero = null) {
    this.data = data; this.hero = hero;
    this.ident = data.ident;
    const ref = hero ? hero.ref : [data.lat, data.lon];
    this.frame = new LocalFrame(ref[0], ref[1], 0);
    this.elev = data.elev;
    this.runways = data.runways.map((r) => this.prepRunway(r));
    this.layout = hero ? { taxiways: hero.taxiways, aprons: hero.aprons, buildings: hero.buildings, stands: hero.stands } : this.proceduralLayout();
    this.zone = this.makeZone();
    this.buildIndex();
  }

  en(lat, lon) { const p = this.frame.toEnu(lat, lon, 0); return [p[0], p[1]]; }
  ll(e, n) { const g = this.frame.enuToGeodetic(e, n, 0); return { lat: g.lat, lon: g.lon }; }

  prepRunway(r) {
    const A = this.en(r.a[0], r.a[1]), B = this.en(r.b[0], r.b[1]);
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const d = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
    return { ...r, A, B, L, d, right: [d[1], -d[0]], paved: isPaved(r.surf), hA: r.a[2], hB: r.b[2], dispA: r.a[3] || 0, dispB: r.b[3] || 0 };
  }

  heightAt(e, n) { return zoneSurfaceHeight(this.zone, e, n); }

  /** Generic layout: apron, parallel taxiway with connectors, terminal, hangars, tower, stands. */
  proceduralLayout() {
    const big = this.data.type === 'L', med = this.data.type === 'M';
    const main = this.runways.slice().sort((a, b) => b.L - a.L)[0];
    const side = 1; // right of A->B
    const off = main.wid / 2 + (big ? 170 : med ? 110 : 45);
    const twOff = main.wid / 2 + (big ? 90 : med ? 55 : 25);
    const twW = big ? 23 : med ? 18 : 10;
    const mid = [(main.A[0] + main.B[0]) / 2, (main.A[1] + main.B[1]) / 2];
    const P = (along, across) => [mid[0] + main.d[0] * along + main.right[0] * across * side, mid[1] + main.d[1] * along + main.right[1] * across * side];
    const half = main.L / 2;
    const apL = Math.min(main.L * 0.45, big ? 900 : med ? 420 : 140), apD = big ? 170 : med ? 100 : 45;
    const taxiways = [
      { w: twW, pts: [P(-half + 40, twOff), P(half - 40, twOff)] },
      { w: twW, pts: [P(-half + 40, main.wid / 2), P(-half + 40, twOff)] },
      { w: twW, pts: [P(half - 40, main.wid / 2), P(half - 40, twOff)] },
      { w: twW, pts: [P(0, main.wid / 2), P(0, off)] },
    ];
    if (main.L > 1500) taxiways.push({ w: twW, pts: [P(-half / 2, main.wid / 2), P(-half / 2, twOff)] }, { w: twW, pts: [P(half / 2, main.wid / 2), P(half / 2, twOff)] });
    const aprons = [{ pts: [P(-apL / 2, off), P(apL / 2, off), P(apL / 2, off + apD), P(-apL / 2, off + apD)] }];
    const buildings = [];
    const tD = big ? 45 : med ? 28 : 12, tH = big ? 20 : med ? 12 : 5;
    const tl = apL * (big ? 0.75 : 0.5);
    buildings.push({ kind: 'terminal', h: tH, pts: [P(-tl / 2, off + apD + 5), P(tl / 2, off + apD + 5), P(tl / 2, off + apD + 5 + tD), P(-tl / 2, off + apD + 5 + tD)] });
    const hw = big ? 70 : med ? 40 : 18;
    for (let i = 0; i < (big ? 3 : 2); i++) {
      const a0 = apL / 2 + 30 + i * (hw + 15);
      buildings.push({ kind: 'hangar', h: big ? 22 : med ? 12 : 6, pts: [P(a0, off + 10), P(a0 + hw, off + 10), P(a0 + hw, off + 10 + hw * 0.8), P(a0, off + 10 + hw * 0.8)] });
    }
    if (big || med) { const t = P(-apL / 2 - 40, off + 30); buildings.push({ kind: 'tower', h: big ? 55 : 25, pts: circlePts(t, big ? 7 : 5, 8) }); }
    const stands = [];
    const nS = Math.max(2, Math.floor(apL / (big ? 70 : med ? 45 : 25)));
    for (let i = 0; i < nS; i++) {
      const a = -apL / 2 + (i + 0.5) * (apL / nS);
      stands.push({ ref: `${i + 1}`, pts: [P(a, off + apD - 10), P(a, off + 15)] });
    }
    // Ensure runway direction orientation of the main taxiway is used for spawn heading.
    return { taxiways, aprons, buildings, stands, procedural: true };
  }

  makeZone() {
    const pts = [];
    for (const r of this.runways) {
      const ext = 120, lat = r.wid / 2 + (this.data.type === 'L' ? 150 : 80);
      for (const [s, t] of [[-ext, -lat], [-ext, lat], [r.L + ext, -lat], [r.L + ext, lat]]) pts.push([r.A[0] + r.d[0] * s + r.right[0] * t, r.A[1] + r.d[1] * s + r.right[1] * t]);
    }
    for (const a of this.layout.aprons) for (const p of a.pts) pts.push(p);
    for (const t of this.layout.taxiways) for (const p of t.pts) pts.push(p);
    for (const b of this.layout.buildings) if (b.kind !== 'building') for (const p of b.pts) pts.push(p);
    const hull = convexHull(pts);
    // expand hull slightly
    const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length, cy = hull.reduce((s, p) => s + p[1], 0) / hull.length;
    const grown = hull.map(([x, y]) => { const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1; return [x + (dx / l) * 40, y + (dy / l) * 40]; });
    const rw = this.runways.map((r) => ({ a: [r.A[0], r.A[1], r.hA], b: [r.B[0], r.B[1], r.hB] }));
    return makeZone(this.ident, this.frame.lat, this.frame.lon, grown, rw, this.elev, this.data.type === 'L' ? 400 : 250);
  }

  /** Spatial index of paved surfaces for physics queries. */
  buildIndex() {
    const cell = 60;
    this.cell = cell; this.grid = new Map();
    const add = (item, pts, pad) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      for (let i = Math.floor((x0 - pad) / cell); i <= Math.floor((x1 + pad) / cell); i++)
        for (let j = Math.floor((y0 - pad) / cell); j <= Math.floor((y1 + pad) / cell); j++) {
          const k = i * 100003 + j; let a = this.grid.get(k); if (!a) this.grid.set(k, (a = [])); a.push(item);
        }
    };
    for (const r of this.runways) add({ type: 'runway', r }, [r.A, r.B], r.wid / 2 + 2);
    for (const t of this.layout.taxiways) for (let i = 0; i < t.pts.length - 1; i++) add({ type: 'taxi', a: t.pts[i], b: t.pts[i + 1], w: t.w }, [t.pts[i], t.pts[i + 1]], t.w / 2 + 1);
    for (const a of this.layout.aprons) add({ type: 'apron', pts: a.pts }, a.pts, 0);
    this.bbox = this.zone.bbox;
  }

  /** Physics surface query: returns {surface, h} for paved/runway areas, otherwise null. */
  surfaceAt(lat, lon) {
    const e = (lon - this.zone.lon) * this.zone.mLon, n = (lat - this.zone.lat) * this.zone.mLat;
    if (e < this.bbox[0] || e > this.bbox[2] || n < this.bbox[1] || n > this.bbox[3]) return null;
    const list = this.grid.get(Math.floor(e / this.cell) * 100003 + Math.floor(n / this.cell));
    if (!list) return null;
    for (const it of list) {
      if (it.type === 'runway') {
        const r = it.r, dx = e - r.A[0], dy = n - r.A[1];
        const along = dx * r.d[0] + dy * r.d[1], across = dx * r.right[0] + dy * r.right[1];
        if (along >= -2 && along <= r.L + 2 && Math.abs(across) <= r.wid / 2) return { surface: r.paved ? 'runway' : 'grass', h: r.hA + ((r.hB - r.hA) * Math.max(0, Math.min(r.L, along))) / r.L };
      } else if (it.type === 'taxi') {
        const ex = it.b[0] - it.a[0], ey = it.b[1] - it.a[1];
        const t = Math.max(0, Math.min(1, ((e - it.a[0]) * ex + (n - it.a[1]) * ey) / (ex * ex + ey * ey || 1)));
        if (Math.hypot(e - it.a[0] - ex * t, n - it.a[1] - ey * t) <= it.w / 2) return { surface: 'paved', h: this.heightAt(e, n) };
      } else if (pip(e, n, it.pts)) return { surface: 'paved', h: this.heightAt(e, n) };
    }
    return null;
  }

  /** Build all render objects. terrainHeight(lat, lon) gives ground height for buildings outside the zone. */
  build(origin, terrainHeight, opts = {}) {
    const g = new THREE.Group(); g.name = 'airport ' + this.ident;
    const hFn = (e, n) => this.heightAt(e, n);
    // Aprons and taxiways (vertex-coloured, one mesh).
    const ground = new MeshBuilder();
    for (const a of this.layout.aprons) addPolygon(ground, a.pts, hFn, C.apron, 0);
    for (const t of this.layout.taxiways) addRibbon(ground, t.pts, t.w, hFn, C.taxi, 0.03);
    for (const t of this.layout.taxiways) addRibbon(ground, t.pts, 0.35, hFn, C.yellow, 0.06);
    const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
    const gm = new THREE.Mesh(ground.build(false), groundMat); gm.receiveShadow = true; g.add(gm);

    // Runways with baked markings.
    for (const r of this.runways) {
      const tex = runwayTexture({ len: r.L, wid: r.wid, le: r.le, he: r.he, surf: r.surf, dispA: r.dispA, dispB: r.dispB, precision: this.data.type === 'L' && r.wid >= 40 });
      const mb = new MeshBuilder();
      const segs = Math.max(2, Math.ceil(r.L / 80));
      const half = r.wid / 2;
      for (let i = 0; i < segs; i++) {
        const m0 = (r.L * i) / segs, m1 = (r.L * (i + 1)) / segs;
        const P = (m, s) => [r.A[0] + r.d[0] * m + r.right[0] * s, r.A[1] + r.d[1] * m + r.right[1] * s];
        const h = (m) => r.hA + ((r.hB - r.hA) * m) / r.L + 0.09;
        const a = P(m0, -half), b = P(m0, half), c = P(m1, -half), d = P(m1, half);
        const v0 = m0 / r.L, v1 = m1 / r.L;
        const w = [1, 1, 1];
        for (const [p, m, u, v] of [[a, m0, 0, v0], [b, m0, 1, v0], [c, m1, 0, v1], [c, m1, 0, v1], [b, m0, 1, v0], [d, m1, 1, v1]]) mb.vert(p[0], p[1], h(m), w, u, v, [0, 1, 0]);
      }
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 });
      const mesh = new THREE.Mesh(mb.build(false), mat); mesh.receiveShadow = true; mesh.name = `runway ${r.le}/${r.he}`;
      // Winding: the strip is built with (left, right, next-left) which is CCW from above when right = clockwise of d.
      g.add(mesh);
    }

    // Buildings.
    const mats = buildingMaterials();
    this.buildingMats = mats;
    const walls = new MeshBuilder(), roofs = new MeshBuilder();
    this.obstacles = new ObstacleGroup(this.frame.lat, this.frame.lon);
    for (const b of this.layout.buildings) {
      const cx = b.pts.reduce((s, p) => s + p[0], 0) / b.pts.length, cy = b.pts.reduce((s, p) => s + p[1], 0) / b.pts.length;
      const inZone = this.zoneWeight(cx, cy) > 0.5;
      let base = inZone ? this.heightAt(cx, cy) : terrainHeight(this.ll(cx, cy));
      if (!Number.isFinite(base)) base = this.elev;
      const col = C[b.kind] || C.building;
      addBuilding(walls, roofs, b.pts, base, b.h, col, b.kind === 'hangar' ? [0.6, 0.62, 0.64] : C.roof, b.kind !== 'hangar' && b.kind !== 'tower');
      this.obstacles.addBuilding(b.pts, base - 8, b.h + 8, { name: b.name || b.kind });
    }
    if (walls.count) {
      const wm = new THREE.Mesh(walls.build(false), mats.walls); wm.castShadow = wm.receiveShadow = true; g.add(wm);
      const rm = new THREE.Mesh(roofs.build(false), mats.roofs); rm.castShadow = rm.receiveShadow = true; g.add(rm);
    }

    // Lighting.
    this.lights = this.buildLights();
    g.add(this.lights.points);
    for (const p of this.lights.papis) g.add(p.points);

    this.group = g;
    origin.attach(g, this.frame);
    return g;
  }

  zoneWeight(e, n) { return pip(e, n, this.zone.pts) ? 1 : 0; }

  buildLights() {
    const set = new LightSet(), papis = [];
    const big = this.data.type === 'L';
    const lit3 = (e, n, h) => [e, h + 0.4 - curv(e, n), -n];
    for (const r of this.runways) {
      if (!r.lit && this.data.type === 'S') continue;
      const half = r.wid / 2 + 1.5;
      const at = (m, s) => [r.A[0] + r.d[0] * m + r.right[0] * s, r.A[1] + r.d[1] * m + r.right[1] * s];
      const h = (m) => r.hA + ((r.hB - r.hA) * Math.max(0, Math.min(r.L, m))) / r.L;
      for (let m = 0; m <= r.L + 0.1; m += 60) for (const s of [-half, half]) { const p = at(m, s); set.add(...lit3(p[0], p[1], h(m)), 'white'); }
      for (const [m0, dir] of [[r.dispA, 1], [r.L - r.dispB, -1]]) {
        for (let s = -half; s <= half + 0.01; s += 3) {
          const p = at(m0 - dir * 1, s); set.add(...lit3(p[0], p[1], h(m0)), 'green');
          const q = at(m0 + dir * 1, s); set.add(...lit3(q[0], q[1], h(m0)), 'red');
        }
      }
      if (big && r.wid >= 40) for (let m = 30; m < r.L - 30; m += 15) { const p = at(m, 0); set.add(p[0], h(m) + 0.12 - curv(p[0], p[1]), -p[1], m > r.L - 300 || m < 300 ? 'red' : 'white'); }
      // Approach lights (simplified ALSF) and PAPI per landing direction.
      for (const end of [0, 1]) {
        const thrM = end === 0 ? r.dispA : r.L - r.dispB;
        const dir = end === 0 ? 1 : -1; // landing direction along +d for end 0
        const ap = (dist, s) => at(thrM - dir * dist, s * dir);
        if (big && r.paved && r.wid >= 40) {
          for (let dist = 30; dist <= 720; dist += 30) {
            for (const s of [-2, -1, 0, 1, 2]) { const p = ap(dist, s); set.add(...lit3(p[0], p[1], h(thrM) + 1), 'white'); }
            if (dist >= 300) { const p = ap(dist, 0); set.add(...lit3(p[0], p[1], h(thrM) + 1.4), 'strobe', (720 - dist) / 720); }
          }
          for (let s = -15; s <= 15; s += 1.5) { const p = ap(300, s); set.add(...lit3(p[0], p[1], h(thrM) + 1), 'white'); }
        }
        if (r.paved && (big || this.data.type === 'M' || r.lit)) {
          const aim = thrM + dir * Math.min(305, r.L * 0.2);
          const units = [];
          const side = -dir; // left of landing direction
          const thr = [3.5, 3.17, 2.83, 2.5];
          for (let i = 0; i < 4; i++) {
            const p = at(aim, side * (r.wid / 2 + 15 + i * 9));
            const v = lit3(p[0], p[1], h(aim) + 0.6);
            units.push({ pos: new THREE.Vector3(v[0], v[1], v[2]), threshold: thr[i] });
          }
          const ld = new THREE.Vector3(r.d[0] * dir, 0, -r.d[1] * dir);
          papis.push(new Papi(units, ld));
        }
      }
    }
    for (const t of this.layout.taxiways) {
      for (let i = 0; i < t.pts.length - 1; i++) {
        const a = t.pts[i], b = t.pts[i + 1];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const nx = -(b[1] - a[1]) / (L || 1), ny = (b[0] - a[0]) / (L || 1);
        for (let m = 0; m < L; m += 45) {
          const e = a[0] + ((b[0] - a[0]) * m) / L, n = a[1] + ((b[1] - a[1]) * m) / L;
          if (this.surfaceAtLocalRunway(e, n)) continue;
          for (const s of [-1, 1]) { const pe = e + nx * s * (t.w / 2 + 1), pn = n + ny * s * (t.w / 2 + 1); set.add(...lit3(pe, pn, this.heightAt(pe, pn)), 'blue'); }
        }
      }
    }
    return { points: set.build(4.5), papis };
  }

  surfaceAtLocalRunway(e, n) {
    for (const r of this.runways) {
      const dx = e - r.A[0], dy = n - r.A[1];
      const along = dx * r.d[0] + dy * r.d[1], across = dx * r.right[0] + dy * r.right[1];
      if (along >= 0 && along <= r.L && Math.abs(across) <= r.wid / 2 + 3) return true;
    }
    return false;
  }

  /** Runway-end and parking spawn points (geodetic, true heading). */
  spawnPoints() {
    const out = [];
    for (const r of this.runways) {
      for (const end of [0, 1]) {
        const id = end === 0 ? r.le : r.he;
        const thrM = end === 0 ? r.dispA : r.L - r.dispB;
        const dir = end === 0 ? 1 : -1;
        const m = Math.max(0, Math.min(r.L, thrM + dir * 25));
        const e = r.A[0] + r.d[0] * m, n = r.A[1] + r.d[1] * m;
        const ll = this.ll(e, n);
        const hdg = wrap360(Math.atan2(r.d[0] * dir, r.d[1] * dir) / DEG);
        const thrLL = this.ll(r.A[0] + r.d[0] * thrM, r.A[1] + r.d[1] * thrM);
        out.push({ type: 'runway', id: `RWY ${id}`, runway: id, lat: ll.lat, lon: ll.lon, heading: hdg, elev: r.hA + ((r.hB - r.hA) * m) / r.L, length: r.L, width: r.wid, surface: r.surf, threshold: { ...thrLL, elev: end === 0 ? r.hA : r.hB } });
      }
    }
    const stands = (this.layout.stands || []).filter((s) => s.pts && s.pts.length >= 2);
    const pick = this.layout.procedural ? stands : stands.filter((_, i) => i % Math.max(1, Math.floor(stands.length / 12)) === 0).slice(0, 12);
    for (const s of pick) {
      const [a, b] = [s.pts[0], s.pts[s.pts.length - 1]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1) continue;
      const ll = this.ll(a[0], a[1]);
      const hdg = wrap360(Math.atan2(b[0] - a[0], b[1] - a[1]) / DEG);
      if (!this.surfaceAt(ll.lat, ll.lon)) continue;
      out.push({ type: 'parking', id: `Stand ${s.ref || out.length}`, lat: ll.lat, lon: ll.lon, heading: hdg, elev: this.heightAt(a[0], a[1]) });
    }
    return out;
  }

  /** Point on extended centreline `distM` before the threshold, on a 3° glidepath (+ threshold crossing 15 m). */
  approachPoint(spawn, distM) {
    const p = destination(spawn.threshold.lat, spawn.threshold.lon, spawn.heading + 180, distM);
    return { lat: p.lat, lon: p.lon, alt: spawn.threshold.elev + 15 + Math.tan(3 * DEG) * distM, heading: spawn.heading };
  }

  /** Per-frame: PAPI colours, light intensity and flasher timing. */
  update(cameraWorld, night, time, pixelRatio = 1) {
    if (!this.group) return;
    const inv = this._inv || (this._inv = new THREE.Matrix4());
    inv.copy(this.group.matrixWorld).invert();
    const local = cameraWorld.clone().applyMatrix4(inv);
    for (const p of this.lights.papis) { p.update(local); p.points.material.uniforms.uNight.value = night; p.points.material.uniforms.uPixelRatio.value = pixelRatio; }
    const u = this.lights.points.material.uniforms;
    u.uNight.value = night; u.uTime.value = time; u.uPixelRatio.value = pixelRatio;
    if (this.buildingMats) this.buildingMats.walls.emissiveIntensity = night * 0.9;
  }

  dispose(origin) {
    if (!this.group) return;
    origin.detach(this.group);
    this.group.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
    this.group.parent?.remove(this.group);
    this.group = null;
  }
}

function pip(x, y, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function circlePts(c, r, n) { const out = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); } return out; }

export { bearing };
