// Natural Earth populated places (public domain) -> compact list used to seed procedural urban areas.
// Usage: NODE_USE_ENV_PROXY=1 node scripts/build-places.mjs
import { cachedFetch, writeJSON, round } from './lib.mjs';

const URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson';
const gj = JSON.parse(await cachedFetch(URL, 'ne_10m_populated_places_simple.geojson'));
const rows = [];
for (const f of gj.features) {
  const p = f.properties;
  const pop = Math.max(p.pop_max || 0, p.pop_min || 0);
  if (pop < 20000) continue;
  const [lon, lat] = f.geometry.coordinates;
  rows.push([p.name, p.adm0_a3 || '', round(lat, 4), round(lon, 4), pop]);
}
rows.sort((a, b) => b[4] - a[4]);
const size = writeJSON('public/data/places.json', { fields: ['name', 'country', 'lat', 'lon', 'pop'], rows, attribution: 'Natural Earth (public domain)' });
console.log(`places: ${rows.length} (${(size / 1024).toFixed(0)} KB)`);
