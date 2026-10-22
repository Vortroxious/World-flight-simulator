// Web Mercator (XYZ / "slippy map") tile math, matching Terrarium elevation tiles.
import { DEG, RAD } from './wgs84.js';

export const MAX_LAT = 85.0511287798066;

/** Lon/lat -> fractional tile coordinates at zoom z. */
export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z;
  const la = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * DEG;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n;
  return { x, y };
}

/** Fractional tile coordinates -> lon/lat (deg). */
export function tileToLonLat(x, y, z) {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * RAD;
  return { lon, lat };
}

export function tileBounds(x, y, z) {
  const nw = tileToLonLat(x, y, z), se = tileToLonLat(x + 1, y + 1, z);
  return { west: nw.lon, north: nw.lat, east: se.lon, south: se.lat };
}

export const tileKey = (z, x, y) => `${z}/${x}/${y}`;

/** Approximate ground width (m) of a tile at zoom z and latitude. */
export function tileSizeMeters(z, lat) {
  return (40075016.686 * Math.cos(lat * DEG)) / 2 ** z;
}

/** Decode a Terrarium RGB sample to metres. */
export const terrariumHeight = (r, g, b) => r * 256 + g + b / 256 - 32768;

/** Wrap tile x to valid range. */
export const wrapX = (x, z) => ((x % 2 ** z) + 2 ** z) % 2 ** z;
