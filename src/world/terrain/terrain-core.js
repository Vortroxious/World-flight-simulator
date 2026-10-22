// Pure terrain functions shared by the terrain worker, main-thread physics sampling and Node tests:
// elevation sources (Terrarium tiles + baked fallback packs), tile meshing, grid sampling and ground colouring.
import { LocalFrame, DEG, RAD } from '../../geo/wgs84.js';
import { tileToLonLat, lonLatToTile, tileSizeMeters, terrariumHeight } from '../../geo/tilemath.js';
import { applyZones } from './flatten.js';
import { clamp, fbm, smoothstep, valueNoise } from '../../core/math.js';

export const WATER_LEVEL_EPS = -0.5;

/** A baked fallback pack: {z, n, scale, tiles: Map("x/y" -> index), data: Int16Array}. */
export function makePack(meta, buffer) {
  const tiles = new Map(meta.tiles.map((k, i) => [k, i]));
  return { z: meta.z, n: meta.n, scale: meta.scale, tiles, data: new Int16Array(buffer) };
}

/** Bilinear sample of a pack at lon/lat; returns null if not covered. */
export function samplePack(pack, lon, lat) {
  const t = lonLatToTile(lon, lat, pack.z);
  const tx = Math.floor(t.x), ty = Math.floor(t.y);
  const idx = pack.tiles.get(`${tx}/${ty}`);
  if (idx === undefined) return null;
  const n = pack.n, base = idx * n * n;
  const fx = (t.x - tx) * (n - 1), fy = (t.y - ty) * (n - 1);
  const x0 = Math.min(n - 2, Math.floor(fx)), y0 = Math.min(n - 2, Math.floor(fy));
  const u = fx - x0, v = fy - y0, d = pack.data;
  const h00 = d[base + y0 * n + x0], h10 = d[base + y0 * n + x0 + 1], h01 = d[base + (y0 + 1) * n + x0], h11 = d[base + (y0 + 1) * n + x0 + 1];
  return ((h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v) / pack.scale;
}

/** Height from a decoded 256x256 RGBA Terrarium image (Uint8ClampedArray) at fractional pixel coords. */
export function sampleTerrarium(rgba, px, py) {
  const fx = clamp(px - 0.5, 0, 255), fy = clamp(py - 0.5, 0, 255);
  const x0 = Math.min(254, Math.floor(fx)), y0 = Math.min(254, Math.floor(fy)), u = fx - x0, v = fy - y0;
  const h = (x, y) => { const i = (y * 256 + x) * 4; return terrariumHeight(rgba[i], rgba[i + 1], rgba[i + 2]); };
  return (h(x0, y0) * (1 - u) + h(x0 + 1, y0) * u) * (1 - v) + (h(x0, y0 + 1) * (1 - u) + h(x0 + 1, y0 + 1) * u) * v;
}

/** Urban density weight 0..1 from populated places [{lat, lon, r (m)}]. */
export function urbanWeight(places, lat, lon, h, slope) {
  if (!places || !places.length || h < -0.5) return 0;
  let w = 0;
  const cl = Math.cos(lat * DEG);
  for (const p of places) {
    const dn = (lat - p.lat) * 111320, de = (lon - p.lon) * 111320 * cl;
    const d = Math.hypot(dn, de);
    if (d > p.r * 1.3) continue;
    w = Math.max(w, 1 - smoothstep(p.r * 0.35, p.r * 1.3, d));
  }
  if (w <= 0) return 0;
  const n = fbm(lat * 900, lon * 900, 3, 7);
  w *= smoothstep(0.25, 0.55, n + w * 0.35);
  w *= 1 - smoothstep(120, 260, h); // cities thin out up hills
  w *= 1 - smoothstep(0.12, 0.3, slope); // ...and on steep slopes (slope = 1 - normal.up; DEM is noisy over cities)
  return clamp(w, 0, 1);
}

/** Forest density 0..1 (procedural; no land-cover dataset in Phase 2). */
export function forestWeight(lat, lon, h, slope, urban) {
  if (h < 3 || urban > 0.2) return 0;
  const n = fbm(lat * 400, lon * 400, 4, 11);
  const climate = 1 - smoothstep(1800, 2800, h) * 1;
  return clamp(smoothstep(0.52, 0.7, n) * climate * (1 - smoothstep(0.3, 0.5, slope)), 0, 1);
}

/** Ground colour (linear-ish sRGB 0..1). */
export function groundColor(h, slope, lat, lon, urban, zoneW, out) {
  const n = valueNoise(lat * 3000, lon * 3000, 3) * 0.5 + fbm(lat * 300, lon * 300, 3, 5) * 0.5;
  let r, g, b;
  if (h < WATER_LEVEL_EPS && zoneW < 0.5) { r = 0.16; g = 0.2; b = 0.18; } // seabed (under water surface)
  else {
    // lowland grass / dry grass mix by noise, darker forests, rock on slopes, snow at altitude/latitude.
    const dry = smoothstep(0.35, 0.75, fbm(lat * 120, lon * 120, 3, 9));
    r = 0.32 + 0.22 * dry; g = 0.36 + 0.12 * dry; b = 0.18 + 0.04 * dry;
    const forest = forestWeight(lat, lon, h, slope, urban);
    r += (0.17 - r) * forest; g += (0.24 - g) * forest; b += (0.13 - b) * forest;
    const rock = smoothstep(0.25, 0.5, slope);
    r += (0.42 - r) * rock; g += (0.39 - g) * rock; b += (0.35 - b) * rock;
    const snowLine = 4200 - 2600 * smoothstep(30, 65, Math.abs(lat));
    const snow = smoothstep(snowLine, snowLine + 500, h + n * 300) * (1 - rock * 0.6);
    r += (0.93 - r) * snow; g += (0.94 - g) * snow; b += (0.97 - b) * snow;
    const beach = (1 - smoothstep(0.5, 3, h)) * (1 - zoneW);
    r += (0.62 - r) * beach * 0.6; g += (0.58 - g) * beach * 0.6; b += (0.45 - b) * beach * 0.6;
    if (urban > 0) { const u = urban * 0.85; r += (0.44 - r) * u; g += (0.43 - g) * u; b += (0.42 - b) * u; }
    if (zoneW > 0) { r += (0.36 - r) * zoneW; g += (0.42 - g) * zoneW; b += (0.22 - b) * zoneW; } // mown airport grass
  }
  const k = 0.85 + 0.3 * n;
  // palette is authored in sRGB; vertex colours are linear
  out[0] = (r * k) ** 2.2; out[1] = (g * k) ** 2.2; out[2] = (b * k) ** 2.2;
  return out;
}

/**
 * Build a terrain tile. heightAt(lon, lat) supplies DEM metres. Returns transferable arrays.
 * @param {{z:number,x:number,y:number,n:number,zones?:object[],places?:object[], skirt?:number, procedural?:boolean}} t
 */
export function buildTile(t, heightAt) {
  const { z, x, y, n } = t;
  const N1 = n + 1;
  const c = tileToLonLat(x + 0.5, y + 0.5, z);
  const frame = new LocalFrame(c.lat, c.lon, 0);
  const grid = new Float32Array(N1 * N1);
  const zw = new Float32Array(N1 * N1);
  const zo = { h: 0, w: 0 };
  let minH = Infinity, maxH = -Infinity, water = false;
  const lats = new Float64Array(N1), lons = new Float64Array(N1);
  for (let i = 0; i < N1; i++) lons[i] = tileToLonLat(x + i / n, y, z).lon;
  for (let j = 0; j < N1; j++) lats[j] = tileToLonLat(x, y + j / n, z).lat;
  const sizeM = tileSizeMeters(z, c.lat);
  for (let j = 0; j < N1; j++) for (let i = 0; i < N1; i++) {
    const lat = lats[j], lon = lons[i];
    let h = heightAt(lon, lat);
    if (t.procedural && h > 0) h += (fbm(lat * 60, lon * 60, 4, 3) - 0.5) * Math.min(400, 40 + h * 0.3);
    applyZones(t.zones, lat, lon, h, zo);
    grid[j * N1 + i] = zo.h; zw[j * N1 + i] = zo.w;
    if (zo.h < WATER_LEVEL_EPS && zo.w < 0.5) water = true;
    minH = Math.min(minH, zo.h); maxH = Math.max(maxH, zo.h);
  }
  // Vertices (+ skirt ring), in tile-local three.js axes (x=E, y=U, z=-N).
  const ring = 4 * n;
  const vCount = N1 * N1 + ring;
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), col = new Float32Array(vCount * 3);
  const enu = [0, 0, 0];
  const rh = (h) => (h < WATER_LEVEL_EPS ? Math.min(h * 2, -3) : h); // push seabed down to avoid shoreline z-fight
  for (let j = 0; j < N1; j++) for (let i = 0; i < N1; i++) {
    const k = j * N1 + i;
    const h = grid[k];
    const hh = zw[k] < 0.5 ? rh(h) : h;
    frame.toEnu(lats[j], lons[i], hh, enu);
    pos[k * 3] = enu[0]; pos[k * 3 + 1] = enu[2]; pos[k * 3 + 2] = -enu[1];
  }
  // Normals from central differences in local ENU (approximate; adequate for shading).
  const cell = sizeM / n;
  const col3 = [0, 0, 0];
  for (let j = 0; j < N1; j++) for (let i = 0; i < N1; i++) {
    const k = j * N1 + i;
    const hl = grid[j * N1 + Math.max(0, i - 1)], hr = grid[j * N1 + Math.min(n, i + 1)];
    const hu = grid[Math.max(0, j - 1) * N1 + i], hd = grid[Math.min(n, j + 1) * N1 + i];
    const dx = (hr - hl) / (cell * (Math.min(n, i + 1) - Math.max(0, i - 1)));
    const dy = (hu - hd) / (cell * (Math.min(n, j + 1) - Math.max(0, j - 1))); // north-up gradient
    const l = Math.hypot(dx, dy, 1);
    const ne = -dx / l, nn = -dy / l, nu = 1 / l;
    nor[k * 3] = ne; nor[k * 3 + 1] = nu; nor[k * 3 + 2] = -nn;
    const slope = 1 - nu;
    const urban = urbanWeight(t.places, lats[j], lons[i], grid[k], slope) * (1 - zw[k]);
    groundColor(grid[k], slope, lats[j], lons[i], urban, zw[k], col3);
    col[k * 3] = col3[0]; col[k * 3 + 1] = col3[1]; col[k * 3 + 2] = col3[2];
  }
  // Skirt: duplicate border vertices dropped downward to hide LOD cracks.
  const skirt = t.skirt ?? Math.max(20, sizeM * 0.015);
  const border = [];
  for (let i = 0; i < n; i++) border.push(i); // top edge (j=0) left->right
  for (let j = 0; j < n; j++) border.push(j * N1 + n); // right edge
  for (let i = n; i > 0; i--) border.push(n * N1 + i); // bottom edge right->left
  for (let j = n; j > 0; j--) border.push(j * N1); // left edge bottom->top
  for (let b = 0; b < ring; b++) {
    const src = border[b], dst = N1 * N1 + b;
    pos[dst * 3] = pos[src * 3]; pos[dst * 3 + 1] = pos[src * 3 + 1] - skirt; pos[dst * 3 + 2] = pos[src * 3 + 2];
    for (let q = 0; q < 3; q++) { nor[dst * 3 + q] = nor[src * 3 + q]; col[dst * 3 + q] = col[src * 3 + q] * 0.9; }
  }
  return { z, x, y, n, grid, zoneW: zw, pos, nor, col, minH, maxH, water, center: [c.lat, c.lon], sizeM, border };
}

/** Index buffer for a tile of n segments with skirt (cached per n by callers). */
export function tileIndices(n) {
  const N1 = n + 1, ring = 4 * n;
  const idx = new Uint32Array(n * n * 6 + ring * 6);
  let k = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * N1 + i, b = a + 1, c = a + N1, d = c + 1;
    // Triangles (a, c, b) and (b, c, d): diagonal b-c, matching sampleGrid().
    idx[k++] = a; idx[k++] = c; idx[k++] = b;
    idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  // skirt quads: border ring order is clockwise when viewed from above in three.js space
  const border = [];
  for (let i = 0; i < n; i++) border.push(i);
  for (let j = 0; j < n; j++) border.push(j * N1 + n);
  for (let i = n; i > 0; i--) border.push(n * N1 + i);
  for (let j = n; j > 0; j--) border.push(j * N1);
  for (let b = 0; b < ring; b++) {
    const t0 = border[b], t1 = border[(b + 1) % ring], s0 = N1 * N1 + b, s1 = N1 * N1 + ((b + 1) % ring);
    idx[k++] = t0; idx[k++] = t1; idx[k++] = s0;
    idx[k++] = t1; idx[k++] = s1; idx[k++] = s0;
  }
  return idx;
}

/**
 * Sample a tile height grid at lon/lat with the same triangulation as the rendered mesh.
 * Returns {h, normal:[e,n,u], zoneW}.
 */
export function sampleGrid(tile, lon, lat, out) {
  const { z, x, y, n } = tile;
  const t = lonLatToTile(lon, lat, z);
  let fx = (t.x - x) * n, fy = (t.y - y) * n;
  fx = clamp(fx, 0, n - 1e-9); fy = clamp(fy, 0, n - 1e-9);
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
  const N1 = n + 1, g = tile.grid;
  const h00 = g[j * N1 + i], h10 = g[j * N1 + i + 1], h01 = g[(j + 1) * N1 + i], h11 = g[(j + 1) * N1 + i + 1];
  let h, dhdu, dhdv;
  if (u + v <= 1) { h = h00 + u * (h10 - h00) + v * (h01 - h00); dhdu = h10 - h00; dhdv = h01 - h00; }
  else { h = h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11); dhdu = h11 - h01; dhdv = h11 - h10; }
  const cell = tile.sizeM / n;
  const de = dhdu / cell, dn = -dhdv / cell; // v increases southward
  const l = Math.hypot(de, dn, 1);
  out.h = h; out.normal = out.normal || [0, 0, 1];
  out.normal[0] = -de / l; out.normal[1] = -dn / l; out.normal[2] = 1 / l;
  const zw = tile.zoneW;
  out.zoneW = zw ? Math.max(zw[j * N1 + i], zw[j * N1 + i + 1], zw[(j + 1) * N1 + i], zw[(j + 1) * N1 + i + 1]) : 0;
  return out;
}

export { RAD };
