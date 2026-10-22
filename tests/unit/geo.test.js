import { describe, it, expect } from 'vitest';
import { geodeticToEcef, ecefToGeodetic, LocalFrame, distance, bearing, destination, crossTrack, wrap180 } from '../../src/geo/wgs84.js';
import { lonLatToTile, tileToLonLat, tileSizeMeters, terrariumHeight } from '../../src/geo/tilemath.js';

describe('WGS84 geodesy', () => {
  it('round-trips geodetic <-> ECEF to sub-millimetre', () => {
    for (const [lat, lon, h] of [[37.6189, -122.375, 4], [-33.9, 151.2, 8848], [0, 0, 0], [78.2, 15.5, -100]]) {
      const e = geodeticToEcef(lat, lon, h);
      const g = ecefToGeodetic(...e);
      expect(g.lat).toBeCloseTo(lat, 9); expect(g.lon).toBeCloseTo(lon, 9); expect(g.h).toBeCloseTo(h, 3);
    }
  });
  it('equatorial radius is the WGS84 semi-major axis', () => { expect(geodeticToEcef(0, 0, 0)[0]).toBeCloseTo(6378137, 3); });
  it('local ENU frame: north/east offsets and up axis', () => {
    const f = new LocalFrame(37.6, -122.4, 0);
    const p = f.toEnu(37.6 + 0.01, -122.4, 0);
    expect(p[0]).toBeCloseTo(0, 3); expect(p[1]).toBeGreaterThan(1100); expect(p[1]).toBeLessThan(1112);
    expect(p[2]).toBeLessThan(0); // Earth curves away
    const g = f.enuToGeodetic(500, -300, 120);
    const back = f.toEnu(g.lat, g.lon, g.h);
    expect(back[0]).toBeCloseTo(500, 4); expect(back[1]).toBeCloseTo(-300, 4); expect(back[2]).toBeCloseTo(120, 4);
  });
  it('great-circle distance and bearing (KSFO -> KLAX ~ 543 km, ~137°)', () => {
    const d = distance(37.619, -122.375, 33.9425, -118.408);
    expect(d / 1000).toBeGreaterThan(535); expect(d / 1000).toBeLessThan(550);
    const b = bearing(37.619, -122.375, 33.9425, -118.408);
    expect(b).toBeGreaterThan(130); expect(b).toBeLessThan(142);
  });
  it('destination inverts distance/bearing; cross-track sign', () => {
    const p = destination(37.6, -122.4, 75, 25000);
    expect(distance(37.6, -122.4, p.lat, p.lon)).toBeCloseTo(25000, 0);
    expect(wrap180(bearing(37.6, -122.4, p.lat, p.lon) - 75)).toBeCloseTo(0, 3);
    const right = destination(37.6, -122.4, 90, 1000); // course north, point east -> right of track
    expect(crossTrack(37.6, -122.4, 38.6, -122.4, right.lat, right.lon)).toBeGreaterThan(990);
  });
  it('flight-plan leg maths: ETE from distance and ground speed', () => {
    const legs = [[37.619, -122.375, 37.721, -122.221], [37.721, -122.221, 38.512, -121.493]];
    const total = legs.reduce((s, l) => s + distance(...l), 0);
    const eteMin = total / (110 * 0.514444) / 60;
    expect(total / 1852).toBeGreaterThan(60); expect(total / 1852).toBeLessThan(75);
    expect(eteMin).toBeGreaterThan(30); expect(eteMin).toBeLessThan(42);
  });
});

describe('Web Mercator tile maths', () => {
  it('tile <-> lon/lat inverse', () => {
    const t = lonLatToTile(-122.375, 37.619, 13);
    const ll = tileToLonLat(t.x, t.y, 13);
    expect(ll.lon).toBeCloseTo(-122.375, 8); expect(ll.lat).toBeCloseTo(37.619, 8);
    expect(Math.floor(t.x)).toBe(1311); expect(Math.floor(t.y)).toBe(3170);
  });
  it('tile size shrinks with latitude', () => { expect(tileSizeMeters(13, 60)).toBeCloseTo(tileSizeMeters(13, 0) / 2, 0); });
  it('decodes Terrarium RGB', () => { expect(terrariumHeight(128, 0, 0)).toBe(0); expect(terrariumHeight(128, 100, 128)).toBeCloseTo(100.5, 6); });
});
