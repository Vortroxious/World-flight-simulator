// Bakes offline terrain fallback packs from AWS Terrain Tiles (Terrarium encoding).
//  - global-z4: every z4 tile, 65x65 samples, Int16 metres (coarse whole-Earth fallback)
//  - <region>-z12: hero region at z12, 129x129 samples, Int16 quarter-metres
// Usage: NODE_USE_ENV_PROXY=1 node scripts/bake-terrain-fallback.mjs
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { cachedFetch, ROOT } from './lib.mjs';
import { lonLatToTile, terrariumHeight } from '../src/geo/tilemath.js';

const URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

function resample(png, n) {
  const out = new Float32Array(n * n);
  const px = (ix, iy) => {
    const i = (Math.min(255, Math.max(0, iy)) * 256 + Math.min(255, Math.max(0, ix))) * 4;
    return terrariumHeight(png.data[i], png.data[i + 1], png.data[i + 2]);
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const fx = Math.min(255, Math.max(0, (i / (n - 1)) * 256 - 0.5));
    const fy = Math.min(255, Math.max(0, (j / (n - 1)) * 256 - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const h = px(x0, y0) * (1 - tx) * (1 - ty) + px(x0 + 1, y0) * tx * (1 - ty) + px(x0, y0 + 1) * (1 - tx) * ty + px(x0 + 1, y0 + 1) * tx * ty;
    out[j * n + i] = h;
  }
  return out;
}

async function pack(name, z, tiles, n, scale) {
  const data = new Int16Array(tiles.length * n * n);
  let k = 0;
  for (const [x, y] of tiles) {
    const buf = await cachedFetch(URL(z, x, y), `terrarium-${z}-${x}-${y}.png`, { binary: true });
    const h = resample(PNG.sync.read(buf), n);
    for (let i = 0; i < h.length; i++) data[k++] = Math.max(-32768, Math.min(32767, Math.round(h[i] * scale)));
  }
  const dir = path.join(ROOT, 'public/data/terrain');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.bin`), Buffer.from(data.buffer));
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ z, n, scale, tiles: tiles.map(([x, y]) => `${x}/${y}`), source: 'AWS Terrain Tiles (Terrarium)' }));
  console.log(`${name}: ${tiles.length} tiles, ${(data.byteLength / 1e6).toFixed(2)} MB`);
}

const global = [];
for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) global.push([x, y]);
await pack('global-z4', 4, global, 65, 1);

const REGIONS = { ksfo: { s: 37.30, w: -122.80, n: 38.00, e: -121.90 } };
for (const [name, r] of Object.entries(REGIONS)) {
  const a = lonLatToTile(r.w, r.n, 12), b = lonLatToTile(r.e, r.s, 12);
  const tiles = [];
  for (let y = Math.floor(a.y); y <= Math.floor(b.y); y++) for (let x = Math.floor(a.x); x <= Math.floor(b.x); x++) tiles.push([x, y]);
  await pack(`${name}-z12`, 12, tiles, 129, 4);
}
