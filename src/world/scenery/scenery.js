// Procedural and data-driven scenery around the aircraft: instanced trees and generic urban buildings on
// near (z13) terrain tiles, OSM tall buildings for hero cities, and landmark structures. Everything placed
// here is also registered as collision obstacles.
import * as THREE from 'three';
import { LocalFrame } from '../../geo/wgs84.js';
import { tileToLonLat } from '../../geo/tilemath.js';
import { hash2 } from '../../core/math.js';
import { urbanWeight, forestWeight, sampleGrid, WATER_LEVEL_EPS } from '../terrain/terrain-core.js';
import { ObstacleGroup } from '../../sim/collision/obstacles.js';
import { MeshBuilder, addBuilding, buildingMaterials, curv } from '../airports/geometry.js';

const DENSITY = { low: { trees: 250, bld: 150, range: 5000 }, medium: { trees: 700, bld: 450, range: 8000 }, high: { trees: 1500, bld: 900, range: 11000 }, ultra: { trees: 2600, bld: 1500, range: 15000 } };

function treeGeometry() {
  const crown = new THREE.ConeGeometry(1, 1, 7); crown.translate(0, 0.62, 0);
  const crown2 = new THREE.IcosahedronGeometry(0.62, 0); crown2.translate(0, 0.45, 0);
  const trunk = new THREE.CylinderGeometry(0.06, 0.09, 0.3, 5); trunk.translate(0, 0.15, 0);
  const col = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  return {
    conifer: mergeGeoms([col(crown, [0.13, 0.22, 0.12]), col(trunk.clone(), [0.3, 0.22, 0.15])]),
    broad: mergeGeoms([col(crown2, [0.2, 0.28, 0.13]), col(trunk, [0.3, 0.22, 0.15])]),
  };
}

function mergeGeoms(list) {
  const pos = [], nor = [], col = [], idx = [];
  let off = 0;
  for (let g of list) {
    g = g.index ? g.toNonIndexed() : g;
    g.computeVertexNormals();
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); col.push(...g.attributes.color.array);
    for (let i = 0; i < g.attributes.position.count; i++) idx.push(off + i);
    off += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  m.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  m.setIndex(idx);
  return m;
}

export class Scenery {
  constructor(scene, origin, terrain, collision, quality = 'medium') {
    this.scene = scene; this.origin = origin; this.terrain = terrain; this.collision = collision;
    this.group = new THREE.Group(); this.group.name = 'scenery'; scene.add(this.group);
    this.tiles = new Map();
    this.setQuality(quality);
    this.treeGeo = treeGeometry();
    this.treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1); this.boxGeo.translate(0, 0.5, 0);
    this.bMats = buildingMaterials();
    this.bldMat = this.bMats.walls.clone();
    this.bldMat.vertexColors = false; this.bldMat.map = null; this.bldMat.emissiveMap = null; this.bldMat.color = new THREE.Color(0xffffff);
    this.excluded = []; // [{lat, lon, r}] e.g. airports and hero cities (no procedural buildings)
    this.hero = [];
  }

  setQuality(q) { this.q = DENSITY[q] || DENSITY.medium; }

  exclude(lat, lon, r) { this.excluded.push({ lat, lon, r }); }
  isExcluded(lat, lon) {
    for (const x of this.excluded) { const dn = (lat - x.lat) * 111320, de = (lon - x.lon) * 111320 * Math.cos(lat * Math.PI / 180); if (dn * dn + de * de < x.r * x.r) return true; }
    return false;
  }

  /** Called every frame: build scenery for visible z13 tiles within range, drop it for far ones. */
  update(cam) {
    let built = 0;
    for (const t of this.terrain.tiles.values()) {
      if (t.z !== 13) continue;
      const c = tileToLonLat(t.x + 0.5, t.y + 0.5, t.z);
      const d = Math.hypot((c.lat - cam.lat) * 111320, (c.lon - cam.lon) * 111320 * Math.cos(cam.lat * Math.PI / 180));
      const want = d < this.q.range + t.sizeM && cam.alt - (t.maxH || 0) < 6000;
      const have = this.tiles.get(t.key);
      if (want && (!have || have.version !== t)) {
        if (built++ > 1) continue; // spread work across frames
        if (have) this.dropTile(t.key);
        this.buildTile(t);
      } else if (!want && have) this.dropTile(t.key);
    }
    for (const [k, s] of this.tiles) if (!this.terrain.tiles.has(k)) this.dropTile(k);
  }

  buildTile(t) {
    const c = tileToLonLat(t.x + 0.5, t.y + 0.5, t.z);
    const frame = new LocalFrame(c.lat, c.lon, 0);
    const obstacles = new ObstacleGroup(c.lat, c.lon, 30);
    const trees = { conifer: [], broad: [] }, blds = [];
    const places = this.terrain.placesFor(t.z, t.x, t.y);
    const s = { h: 0 };
    const enu = [0, 0, 0];
    const step = t.sizeM / 64; // ~60 m grid cell
    const maxT = this.q.trees, maxB = this.q.bld;
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
      for (let k = 0; k < 3; k++) {
        const r1 = hash2(t.x * 64 + i, t.y * 64 + j, k * 7 + 1), r2 = hash2(t.x * 64 + i, t.y * 64 + j, k * 7 + 2), r3 = hash2(t.x * 64 + i, t.y * 64 + j, k * 7 + 3);
        const ll = tileToLonLat(t.x + (i + r1) / 64, t.y + (j + r2) / 64, t.z);
        sampleGrid(t, ll.lon, ll.lat, s);
        if (s.h < WATER_LEVEL_EPS + 1.5 || s.zoneW > 0.01) continue;
        const slope = 1 - s.normal[2];
        if (this.isExcluded(ll.lat, ll.lon)) continue;
        const urban = urbanWeight(places, ll.lat, ll.lon, s.h, slope);
        frame.toEnu(ll.lat, ll.lon, s.h, enu);
        if (urban > 0.2 && k < 2 && blds.length < maxB && r3 < urban * 0.85 && slope < 0.3) {
          const w = 10 + 18 * hash2(i, j, 91 + k), l = 10 + 22 * hash2(j, i, 37 + k);
          const h = 5 + (urban > 0.7 ? 18 : 8) * hash2(i + 3, j, 5 + k) ** 2;
          blds.push([enu[0], enu[1], enu[2], w, l, h, s.h]);
          continue;
        }
        const f = forestWeight(ll.lat, ll.lon, s.h, slope, urban);
        const p = f * 0.9 + (urban > 0 ? 0.03 : 0.05);
        if (r3 < p && trees.conifer.length + trees.broad.length < maxT) {
          const h = 7 + 16 * hash2(i, j, 300 + k);
          const kind = s.h > 400 || hash2(i, j, 13) < 0.45 ? 'conifer' : 'broad';
          trees[kind].push([enu[0], enu[1], enu[2], h, s.h]);
        }
      }
    }
    const group = new THREE.Group();
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const kind of ['conifer', 'broad']) {
      const list = trees[kind];
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(this.treeGeo[kind], this.treeMat, list.length);
      list.forEach(([e, n, u, h, msl], idx) => {
        const r = h * (kind === 'conifer' ? 0.28 : 0.4);
        q.setFromAxisAngle(up, hash2(idx, 5, 9) * 6.28);
        m4.compose(pv.set(e, u - 0.3, -n), q, sc.set(r, h, r));
        im.setMatrixAt(idx, m4);
        obstacles.addTree(e, n, msl - 1, h, r);
      });
      im.castShadow = true; im.receiveShadow = true;
      group.add(im);
    }
    if (blds.length) {
      const im = new THREE.InstancedMesh(this.boxGeo, this.bldMat, blds.length);
      const col = new THREE.Color();
      blds.forEach(([e, n, u, w, l, h, msl], idx) => {
        const yaw = 0;
        m4.compose(pv.set(e, u - 4, -n), q.setFromAxisAngle(up, yaw), sc.set(w, h + 4, l));
        im.setMatrixAt(idx, m4);
        const v = 0.62 + 0.3 * hash2(idx, 1, 2);
        im.setColorAt(idx, col.setRGB(v, v * (0.92 + 0.08 * hash2(idx, 3, 4)), v * 0.88));
        obstacles.addBox(e, n, w / 2, l / 2, yaw, msl - 4, h + 4);
      });
      im.castShadow = true; im.receiveShadow = true;
      group.add(im);
    }
    this.origin.attach(group, frame);
    this.group.add(group);
    this.collision.add(obstacles);
    this.tiles.set(t.key, { group, obstacles, version: t, trees: trees.conifer.length + trees.broad.length, buildings: blds.length });
  }

  dropTile(k) {
    const s = this.tiles.get(k);
    if (!s) return;
    this.origin.detach(s.group); this.group.remove(s.group);
    s.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    this.collision.remove(s.obstacles);
    this.tiles.delete(k);
  }

  /** OSM tall buildings for a hero city (cities array from hero json). */
  addHeroCity(city, heightAt) {
    const frame = new LocalFrame(city.ref[0], city.ref[1], 0);
    const walls = new MeshBuilder(), roofs = new MeshBuilder();
    const obstacles = new ObstacleGroup(city.ref[0], city.ref[1], 50);
    for (const b of city.buildings) {
      const cx = b.pts.reduce((s, p) => s + p[0], 0) / b.pts.length, cy = b.pts.reduce((s, p) => s + p[1], 0) / b.pts.length;
      const g = frame.enuToGeodetic(cx, cy, 0);
      const base = heightAt(g.lat, g.lon);
      const tint = 0.7 + 0.25 * hash2(Math.round(cx), Math.round(cy), 3);
      addBuilding(walls, roofs, b.pts, base, b.h, [tint, tint, tint * 1.02], [0.35, 0.36, 0.38], true);
      obstacles.addBuilding(b.pts, base - 8, b.h + 8, { name: b.name });
    }
    const g = new THREE.Group(); g.name = 'city ' + city.name;
    const wm = new THREE.Mesh(walls.build(false), this.bMats.walls); wm.castShadow = wm.receiveShadow = true;
    const rm = new THREE.Mesh(roofs.build(false), this.bMats.roofs);
    g.add(wm, rm);
    this.origin.attach(g, frame);
    this.group.add(g);
    this.collision.add(obstacles);
    this.hero.push({ g, obstacles });
    const r = Math.max(...city.buildings.map((b) => Math.hypot(b.pts[0][0], b.pts[0][1]))) + 300;
    this.exclude(city.ref[0], city.ref[1], r);
  }

  setNight(n) { this.bMats.walls.emissiveIntensity = n * 0.9; this.bldMat.emissiveIntensity = 0; }

  dispose() {
    for (const k of [...this.tiles.keys()]) this.dropTile(k);
    for (const h of this.hero) { this.origin.detach(h.g); this.group.remove(h.g); this.collision.remove(h.obstacles); }
    this.scene.remove(this.group);
  }
}

export { curv };
