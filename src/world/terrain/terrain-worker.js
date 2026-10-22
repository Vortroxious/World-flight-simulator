// Terrain worker: fetches Terrarium elevation tiles, falls back to baked packs, applies airport flattening
// and builds mesh buffers off the main thread.
import { buildTile, makePack, samplePack, sampleTerrarium } from './terrain-core.js';
import { tileToLonLat, lonLatToTile } from '../../geo/tilemath.js';

let packs = [];
let urlTemplate = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
let offlineUntil = 0, failures = 0;

async function fetchTerrarium(z, x, y) {
  if (Date.now() < offlineUntil) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const url = urlTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const res = await fetch(url, { signal: ctrl.signal, mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const bmp = await createImageBitmap(await res.blob());
    const canvas = new OffscreenCanvas(256, 256);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    failures = 0;
    return ctx.getImageData(0, 0, 256, 256).data;
  } catch (e) {
    if (++failures >= 4) { offlineUntil = Date.now() + 60000; failures = 0; }
    return null;
  } finally { clearTimeout(timer); }
}

function fallbackHeight(lon, lat) {
  for (const p of packs) { const h = samplePack(p, lon, lat); if (h !== null) return h; }
  return 0;
}

self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.type === 'init') {
    packs = m.packs.map((p) => makePack(p.meta, p.buffer)).sort((a, b) => b.z - a.z);
    if (m.urlTemplate) urlTemplate = m.urlTemplate;
    self.postMessage({ type: 'ready' });
    return;
  }
  if (m.type !== 'build') return;
  const { z, x, y } = m;
  let source = 'fallback', heightAt;
  // Terrarium tiles exist to z15; we fetch at the tile's own zoom (max 13 in this sim).
  const rgba = m.online ? await fetchTerrarium(z, x, y) : null;
  if (rgba) {
    source = 'online';
    heightAt = (lon, lat) => { const t = lonLatToTile(lon, lat, z); return sampleTerrarium(rgba, (t.x - x) * 256, (t.y - y) * 256); };
  } else {
    // Packs cover the hero region at z12 and the globe at z4; mark low-detail tiles for procedural relief.
    const c = tileToLonLat(x + 0.5, y + 0.5, z);
    const best = packs.find((p) => samplePack(p, c.lon, c.lat) !== null);
    source = best ? `pack-z${best.z}` : 'none';
    heightAt = fallbackHeight;
    m.procedural = !best || best.z <= 6 ? z > 6 : false;
  }
  const t = buildTile({ z, x, y, n: m.n, zones: m.zones, places: m.places, procedural: m.procedural }, heightAt);
  const msg = { type: 'tile', id: m.id, z, x, y, n: m.n, source, grid: t.grid, zoneW: t.zoneW, pos: t.pos, nor: t.nor, col: t.col, minH: t.minH, maxH: t.maxH, water: t.water, center: t.center, sizeM: t.sizeM };
  self.postMessage(msg, [t.grid.buffer, t.zoneW.buffer, t.pos.buffer, t.nor.buffer, t.col.buffer]);
};
