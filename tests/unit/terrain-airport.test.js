import { describe, it, expect } from 'vitest';
import { buildTile, sampleGrid, tileIndices, makePack, samplePack } from '../../src/world/terrain/terrain-core.js';
import { makeZone, applyZones, convexHull, PAVED_DROP } from '../../src/world/terrain/flatten.js';
import { lonLatToTile, tileToLonLat } from '../../src/geo/tilemath.js';
import { Airport } from '../../src/world/airports/airport.js';
import { distance } from '../../src/geo/wgs84.js';

const slope = (lon, lat) => 100 + (lat - 37) * 10000 + (lon + 122) * 3000; // tilted plane (metres)

describe('Terrain tiles', () => {
  const t0 = lonLatToTile(-122.4, 37.6, 13);
  const tile = buildTile({ z: 13, x: Math.floor(t0.x), y: Math.floor(t0.y), n: 16 }, slope);
  it('builds grid, skirt and index buffers of the right size', () => {
    expect(tile.grid.length).toBe(17 * 17);
    expect(tile.pos.length).toBe((17 * 17 + 64) * 3);
    expect(tileIndices(16).length).toBe(16 * 16 * 6 + 64 * 6);
  });
  it('physics sampling reproduces the source surface (planar terrain is exact)', () => {
    for (const [fx, fy] of [[0.13, 0.77], [0.5, 0.5], [0.91, 0.04]]) {
      const ll = tileToLonLat(tile.x + fx, tile.y + fy, 13);
      const s = sampleGrid(tile, ll.lon, ll.lat, {});
      expect(s.h).toBeCloseTo(slope(ll.lon, ll.lat), 0);
      expect(s.normal[2]).toBeLessThan(1); expect(s.normal[1]).toBeLessThan(0); // rises to the north -> normal tilts south
    }
  });
  it('flags water below sea level', () => {
    const w = buildTile({ z: 13, x: tile.x, y: tile.y, n: 8 }, () => -5);
    expect(w.water).toBe(true); expect(tile.water).toBe(false);
  });
  it('baked packs: bilinear sample inside coverage, null outside', () => {
    const n = 3, data = new Int16Array([0, 10, 20, 0, 10, 20, 0, 10, 20]);
    const p = makePack({ z: 4, n, scale: 1, tiles: ['2/6'] }, data.buffer);
    const ll = tileToLonLat(2.25, 6.5, 4);
    expect(samplePack(p, ll.lon, ll.lat)).toBeCloseTo(5, 1);
    expect(samplePack(p, 100, 10)).toBeNull();
  });
});

describe('Airport flattening zones', () => {
  const hull = convexHull([[-500, -100], [500, -100], [500, 100], [-500, 100], [0, 0]]);
  const z = makeZone('TEST', 37.6, -122.4, hull, [{ a: [-450, 0, 10], b: [450, 0, 14] }], 12, 200);
  it('hull is convex with 4 corners', () => expect(hull.length).toBe(4));
  it('flattens to the runway profile inside, blends outside, untouched far away', () => {
    const inside = applyZones([z], 37.6, -122.4 + 400 / z.mLon, 80);
    expect(inside.w).toBe(1); expect(inside.h).toBeCloseTo(10 + 4 * (850 / 900) - PAVED_DROP, 1);
    const edge = applyZones([z], 37.6 + 200 / z.mLat, -122.4, 80);
    expect(edge.w).toBeGreaterThan(0); expect(edge.w).toBeLessThan(1);
    expect(applyZones([z], 37.7, -122.4, 80).h).toBe(80);
  });
});

describe('Airport surfaces and spawn points', () => {
  const data = {
    ident: 'TEST', name: 'Test Field', lat: 37.6, lon: -122.4, elev: 5, type: 'M',
    runways: [{ le: '09', he: '27', len: 1500, wid: 30, surf: 'ASP', lit: 1, hdg: 90, a: [37.6, -122.4085, 5, 0], b: [37.6, -122.3915, 5, 0] }],
  };
  const ap = new Airport(data, null);
  it('runway surface query inside the runway rectangle only', () => {
    expect(ap.surfaceAt(37.6, -122.4).surface).toBe('runway');
    expect(ap.surfaceAt(37.6 + 30 / 111000, -122.4)).toBeNull();
  });
  it('procedural layout has paved apron/taxiways and stands', () => {
    expect(ap.layout.taxiways.length).toBeGreaterThan(2);
    const st = ap.spawnPoints().filter((s) => s.type === 'parking');
    expect(st.length).toBeGreaterThan(0);
    expect(['paved', 'runway']).toContain(ap.surfaceAt(st[0].lat, st[0].lon).surface);
  });
  it('runway spawn points face down the runway; approach point on a 3° glidepath', () => {
    const rw = ap.spawnPoints().filter((s) => s.type === 'runway');
    expect(rw.map((r) => Math.round(r.heading))).toEqual([90, 270]);
    const app = ap.approachPoint(rw[0], 5556);
    expect(distance(app.lat, app.lon, rw[0].threshold.lat, rw[0].threshold.lon)).toBeCloseTo(5556, -1);
    expect(app.alt - 5).toBeCloseTo(15 + Math.tan(3 * Math.PI / 180) * 5556, 0);
  });
});
