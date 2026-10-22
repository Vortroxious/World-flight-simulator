// Main-thread terrain streaming: quadtree LOD selection around the camera, prioritised worker requests,
// LRU tile cache, fallback-ancestor rendering (no holes while streaming), water surfaces and the physics
// ground sampler (identical triangulation to the rendered mesh).
import * as THREE from 'three';
import { tileToLonLat, lonLatToTile, tileSizeMeters, tileBounds, wrapX } from '../../geo/tilemath.js';
import { LocalFrame, DEG, distance } from '../../geo/wgs84.js';
import { makePack, samplePack, sampleGrid, tileIndices, WATER_LEVEL_EPS } from './terrain-core.js';
import { applyZones } from './flatten.js';
import { createTerrainMaterial, createWaterMaterial } from './terrain-material.js';

const MAX_Z = 13, ROOT_Z = 5;

export const TERRAIN_QUALITY = {
  low: { maxDist: 90000, splitK: 1.6, maxTiles: 220, inFlight: 4 },
  medium: { maxDist: 160000, splitK: 2.2, maxTiles: 360, inFlight: 6 },
  high: { maxDist: 260000, splitK: 2.9, maxTiles: 520, inFlight: 8 },
  ultra: { maxDist: 380000, splitK: 3.6, maxTiles: 760, inFlight: 10 },
};

const key = (z, x, y) => `${z}/${x}/${y}`;

export class TerrainManager {
  constructor(scene, origin, opts = {}) {
    this.scene = scene; this.origin = origin;
    this.group = new THREE.Group(); this.group.name = 'terrain';
    scene.add(this.group);
    this.tiles = new Map();
    this.pending = new Map();
    this.zones = [];
    this.places = [];
    this.packs = [];
    this.online = opts.online ?? true;
    this.setQuality(opts.quality || 'medium');
    this.material = createTerrainMaterial();
    this.waterMaterial = createWaterMaterial();
    this.indexCache = new Map();
    this.waterGeoCache = new Map();
    this.workers = [];
    this.nextId = 1;
    this.stats = { requested: 0, loaded: 0, failed: 0, online: 0, fallback: 0, visible: 0, inFlight: 0 };
    this.surfaceProvider = null; // (lat, lon) => {surface, h} | null for runways/aprons
    this.onTileReady = null; this.onTileEvicted = null;
    this.frame = 0;
  }

  setQuality(q) { this.quality = TERRAIN_QUALITY[q] || TERRAIN_QUALITY.medium; }

  async init(baseUrl = './data/terrain/', workerCount = 2) {
    const names = ['ksfo-z12', 'global-z4'];
    const loaded = await Promise.all(names.map(async (n) => {
      try {
        const [meta, buf] = await Promise.all([fetch(baseUrl + n + '.json').then((r) => r.json()), fetch(baseUrl + n + '.bin').then((r) => r.arrayBuffer())]);
        return { meta, buffer: buf };
      } catch (e) { console.warn('terrain pack failed', n, e); return null; }
    }));
    const ok = loaded.filter(Boolean);
    this.packs = ok.map((p) => makePack(p.meta, p.buffer.slice(0))).sort((a, b) => b.z - a.z);
    await Promise.all(Array.from({ length: workerCount }, () => new Promise((resolve) => {
      const w = new Worker(new URL('./terrain-worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (ev) => (ev.data.type === 'ready' ? resolve() : this.onWorkerMessage(ev.data));
      w.onerror = (e) => { console.error('terrain worker error', e); resolve(); };
      w.postMessage({ type: 'init', packs: ok.map((p) => ({ meta: p.meta, buffer: p.buffer.slice(0) })) });
      w.busy = 0;
      this.workers.push(w);
    })));
  }

  setPlaces(rows) {
    this.places = rows.map((r) => ({ name: r[0], lat: r[2], lon: r[3], r: Math.min(35000, 2500 * Math.sqrt(r[4] / 1e5)) }));
  }

  /** Register an airport flattening zone; rebuilds loaded tiles it overlaps. */
  addZone(zone) {
    if (this.zones.some((z) => z.id === zone.id)) return;
    zone.llbox = [zone.lat + zone.bbox[1] / zone.mLat, zone.lon + zone.bbox[0] / zone.mLon, zone.lat + zone.bbox[3] / zone.mLat, zone.lon + zone.bbox[2] / zone.mLon];
    this.zones.push(zone);
    for (const t of this.tiles.values()) if (this.zonesFor(t.z, t.x, t.y).includes(zone)) { t.stale = true; }
  }

  removeZone(id) {
    const zone = this.zones.find((z) => z.id === id);
    if (!zone) return;
    for (const t of this.tiles.values()) if (this.zonesFor(t.z, t.x, t.y).includes(zone)) t.stale = true;
    this.zones = this.zones.filter((z) => z !== zone);
  }

  zonesFor(z, x, y) {
    const b = tileBounds(x, y, z);
    return this.zones.filter((zn) => zn.llbox[0] <= b.north && zn.llbox[2] >= b.south && zn.llbox[1] <= b.east && zn.llbox[3] >= b.west);
  }

  placesFor(z, x, y) {
    if (z < 9) return [];
    const b = tileBounds(x, y, z);
    return this.places.filter((p) => {
      const dl = p.r / 111000, dlo = dl / Math.cos(p.lat * DEG);
      return p.lat + dl >= b.south && p.lat - dl <= b.north && p.lon + dlo >= b.west && p.lon - dlo <= b.east;
    });
  }

  request(z, x, y, priority) {
    const k = key(z, x, y);
    const t = this.tiles.get(k);
    if (t && !t.stale) return;
    if (this.pending.has(k)) { const p = this.pending.get(k); p.priority = Math.min(p.priority, priority); p.frame = this.frame; return; }
    this.pending.set(k, { z, x, y, priority, frame: this.frame, sent: false });
  }

  dispatch() {
    const queue = [...this.pending.values()].filter((p) => !p.sent);
    // drop requests not refreshed recently (camera moved on)
    for (const p of queue) if (this.frame - p.frame > 90) this.pending.delete(key(p.z, p.x, p.y));
    queue.sort((a, b) => a.priority - b.priority);
    let inFlight = [...this.pending.values()].filter((p) => p.sent).length;
    for (const p of queue) {
      if (inFlight >= this.quality.inFlight || this.frame - p.frame > 90) continue;
      const w = this.workers.reduce((a, b) => (a.busy <= b.busy ? a : b));
      if (!w) break;
      p.sent = true; p.id = this.nextId++; w.busy++; p.worker = w; inFlight++;
      this.stats.requested++;
      w.postMessage({ type: 'build', id: p.id, z: p.z, x: p.x, y: p.y, n: p.z >= 11 ? 64 : p.z >= 8 ? 32 : 24, zones: this.zonesFor(p.z, p.x, p.y), places: this.placesFor(p.z, p.x, p.y), online: this.online });
    }
    this.stats.inFlight = inFlight;
  }

  onWorkerMessage(m) {
    if (m.type !== 'tile') return;
    const k = key(m.z, m.x, m.y);
    const p = this.pending.get(k);
    if (p) { p.worker.busy--; this.pending.delete(k); }
    if (m.source === 'online') this.stats.online++; else this.stats.fallback++;
    this.stats.loaded++;
    const old = this.tiles.get(k);
    if (old) this.disposeTile(old, false);
    const frame = new LocalFrame(m.center[0], m.center[1], 0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(m.nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(m.col, 3));
    geo.setIndex(new THREE.BufferAttribute(this.indices(m.n), 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    mesh.name = 'tile ' + k;
    this.origin.attach(mesh, frame);
    mesh.visible = false;
    this.group.add(mesh);
    let water = null;
    if (m.water) {
      water = new THREE.Mesh(this.waterGeometry(m.z, m.x, m.y, frame), this.waterMaterial);
      water.receiveShadow = true;
      water.visible = false;
      this.origin.attach(water, frame);
      this.group.add(water);
    }
    const tile = { key: k, z: m.z, x: m.x, y: m.y, n: m.n, grid: m.grid, zoneW: m.zoneW, sizeM: m.sizeM, mesh, water, frame, source: m.source, used: this.frame, minH: m.minH, maxH: m.maxH, stale: false };
    this.tiles.set(k, tile);
    this.onTileReady?.(tile);
  }

  indices(n) {
    if (!this.indexCache.has(n)) this.indexCache.set(n, tileIndices(n));
    return this.indexCache.get(n);
  }

  /** Flat (sea-level) water patch covering a tile, in the tile's local frame. */
  waterGeometry(z, x, y, frame) {
    const n = 12, pos = [], idx = [], uv = [];
    const enu = [0, 0, 0];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const ll = tileToLonLat(x + i / n, y + j / n, z);
      frame.toEnu(ll.lat, ll.lon, 0, enu);
      pos.push(enu[0], enu[2], -enu[1]);
      uv.push(i / n, j / n);
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  disposeTile(t, notify = true) {
    this.group.remove(t.mesh); this.origin.detach(t.mesh); t.mesh.geometry.dispose();
    if (t.water) { this.group.remove(t.water); this.origin.detach(t.water); t.water.geometry.dispose(); }
    this.tiles.delete(t.key);
    if (notify) this.onTileEvicted?.(t);
  }

  /** Distance (m) from camera to nearest point of a tile. */
  tileDistance(cam, z, x, y) {
    const b = tileBounds(x, y, z);
    const lat = Math.max(b.south, Math.min(b.north, cam.lat));
    let lon = cam.lon;
    if (lon < b.west || lon > b.east) lon = Math.abs(lon - b.west) < Math.abs(lon - b.east) ? b.west : b.east;
    const d = distance(cam.lat, cam.lon, lat, lon);
    return Math.hypot(d, Math.max(0, cam.alt - 200));
  }

  /** Select LOD leaves and update visibility; call once per frame. */
  update(cam, aircraft) {
    this.frame++;
    const q = this.quality;
    const R = 6371000;
    const horizon = Math.sqrt(2 * R * Math.max(cam.alt, 10)) + Math.sqrt(2 * R * 3000);
    const maxDist = Math.min(q.maxDist * (1 + Math.min(cam.alt / 8000, 1.5)), horizon);
    const leaves = [];
    const recurse = (z, x, y) => {
      const d = this.tileDistance(cam, z, x, y);
      if (d > maxDist) return;
      const c = tileToLonLat(x + 0.5, y + 0.5, z);
      const size = tileSizeMeters(z, c.lat);
      if (z < MAX_Z && d < size * q.splitK) {
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) recurse(z + 1, x * 2 + dx, y * 2 + dy);
      } else leaves.push({ z, x, y, d, size });
    };
    const rt = lonLatToTile(cam.lon, cam.lat, ROOT_Z);
    const n = 2 ** ROOT_Z;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const y = Math.floor(rt.y) + dy;
      if (y < 0 || y >= n) continue;
      recurse(ROOT_Z, wrapX(Math.floor(rt.x) + dx, ROOT_Z), y);
    }
    // Physics tiles under/around the aircraft always requested first.
    if (aircraft) for (const t of this.physicsTiles(aircraft.lat, aircraft.lon)) this.request(MAX_Z, t.x, t.y, -1e9);

    const draw = new Set(), fallback = new Set();
    for (const l of leaves) {
      const t = this.tiles.get(key(l.z, l.x, l.y));
      if (t && !t.stale) { draw.add(t); continue; }
      if (t && t.stale) draw.add(t); // keep stale mesh visible while rebuilding
      this.request(l.z, l.x, l.y, l.d / l.size);
      if (!t) {
        let z = l.z, x = l.x, y = l.y, anc = null;
        while (z > 0 && !anc) { z--; x >>= 1; y >>= 1; anc = this.tiles.get(key(z, x, y)) || null; }
        if (anc) fallback.add(anc); else { // request a coarse ancestor so something shows soon
          const az = Math.max(ROOT_Z, l.z - 3); this.request(az, l.x >> (l.z - az), l.y >> (l.z - az), -1e6 + l.d);
        }
      }
    }
    // Suppress leaves covered by a fallback ancestor (prevents overlap).
    const isDesc = (t, a) => t.z > a.z && (t.x >> (t.z - a.z)) === a.x && (t.y >> (t.z - a.z)) === a.y;
    for (const a of fallback) for (const t of draw) if (isDesc(t, a)) draw.delete(t);
    for (const a of fallback) for (const b of fallback) if (a !== b && isDesc(a, b)) fallback.delete(a);
    let vis = 0;
    for (const t of this.tiles.values()) {
      const v = draw.has(t) || fallback.has(t);
      t.mesh.visible = v; if (t.water) t.water.visible = v;
      if (v) { t.used = this.frame; vis++; }
    }
    this.stats.visible = vis;
    this.visibleTiles = draw;
    this.dispatch();
    this.evict(aircraft);
  }

  physicsTiles(lat, lon) {
    const t = lonLatToTile(lon, lat, MAX_Z);
    const out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.push({ x: wrapX(Math.floor(t.x) + dx, MAX_Z), y: Math.floor(t.y) + dy });
    return out;
  }

  /** True when the z13 tile under the point and its neighbours are loaded. */
  physicsReady(lat, lon) {
    return this.physicsTiles(lat, lon).every((t) => this.tiles.has(key(MAX_Z, t.x, t.y)));
  }

  evict(aircraft) {
    if (this.tiles.size <= this.quality.maxTiles) return;
    const keep = new Set(aircraft ? this.physicsTiles(aircraft.lat, aircraft.lon).map((t) => key(MAX_Z, t.x, t.y)) : []);
    const list = [...this.tiles.values()].filter((t) => !t.mesh.visible && !keep.has(t.key)).sort((a, b) => a.used - b.used);
    let excess = this.tiles.size - this.quality.maxTiles;
    for (const t of list) { if (excess-- <= 0) break; this.disposeTile(t); }
  }

  /**
   * Physics ground query. Returns {h, surface, normal:[e,n,u], zoneW}.
   */
  sample(lat, lon, out = {}) {
    if (this.surfaceProvider) {
      const s = this.surfaceProvider(lat, lon);
      if (s) { out.h = s.h; out.surface = s.surface; out.normal = [0, 0, 1]; out.zoneW = 1; return out; }
    }
    let found = false;
    for (let z = MAX_Z; z >= 6 && !found; z--) {
      const t = lonLatToTile(lon, lat, z);
      const tile = this.tiles.get(key(z, Math.floor(t.x), Math.floor(t.y)));
      if (tile) { sampleGrid(tile, lon, lat, out); found = true; }
    }
    if (!found) {
      let h = 0;
      for (const p of this.packs) { const v = samplePack(p, lon, lat); if (v !== null) { h = v; break; } }
      const zo = applyZones(this.zones, lat, lon, h);
      out.h = zo.h; out.zoneW = zo.w; out.normal = [0, 0, 1];
    }
    if (out.h < WATER_LEVEL_EPS && out.zoneW < 0.5) { out.surface = 'water'; out.h = Math.min(out.h, 0); }
    else out.surface = out.zoneW > 0.5 ? 'grass' : 'terrain';
    return out;
  }

  /** Terrain height for scenery placement (no surface overrides). */
  heightAt(lat, lon) {
    const sp = this.surfaceProvider; this.surfaceProvider = null;
    const s = this.sample(lat, lon, {});
    this.surfaceProvider = sp;
    return s;
  }

  setTime(t) { if (this.waterMaterial.userData.shader) this.waterMaterial.userData.shader.uniforms.uTime.value = t; }

  dispose() {
    for (const t of [...this.tiles.values()]) this.disposeTile(t, true);
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.scene.remove(this.group);
  }
}
