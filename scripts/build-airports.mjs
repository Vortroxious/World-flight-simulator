// Build-time airport pipeline: OurAirports (public domain) -> compact search index + 10° geographic shards.
// Usage: NODE_USE_ENV_PROXY=1 node scripts/build-airports.mjs
import { cachedFetch, parseCSV, writeJSON, round } from './lib.mjs';
import { destination, bearing, distance } from '../src/geo/wgs84.js';

const BASE = 'https://davidmegginson.github.io/ourairports-data/';
const TYPES = { large_airport: 'L', medium_airport: 'M', small_airport: 'S' };
const shardKey = (lat, lon) => `${Math.floor(lat / 10) * 10}_${Math.floor(lon / 10) * 10}`;
const num = (s) => (s === '' || s == null ? null : Number(s));

const [aText, rText, nText, fText] = await Promise.all([
  cachedFetch(BASE + 'airports.csv', 'airports.csv'),
  cachedFetch(BASE + 'runways.csv', 'runways.csv'),
  cachedFetch(BASE + 'navaids.csv', 'navaids.csv'),
  cachedFetch(BASE + 'airport-frequencies.csv', 'airport-frequencies.csv'),
]);
const airports = parseCSV(aText), runways = parseCSV(rText), navaids = parseCSV(nText), freqs = parseCSV(fText);
console.log(`parsed ${airports.length} airports, ${runways.length} runways, ${navaids.length} navaids, ${freqs.length} frequencies`);

// Magnetic variation samples from navaids (degrees, east positive) for IDW interpolation at runtime.
const magvar = [];
for (const n of navaids) {
  const mv = num(n.magnetic_variation_deg);
  if (mv == null || Number.isNaN(mv)) continue;
  magvar.push([round(+n.latitude_deg, 2), round(+n.longitude_deg, 2), round(mv, 1)]);
}
writeJSON('public/data/navaids/magvar.json', magvar);

const rwByAirport = new Map();
for (const r of runways) {
  if (r.closed === '1') continue;
  if (!rwByAirport.has(r.airport_ident)) rwByAirport.set(r.airport_ident, []);
  rwByAirport.get(r.airport_ident).push(r);
}
const freqByAirport = new Map();
for (const f of freqs) {
  if (!freqByAirport.has(f.airport_ident)) freqByAirport.set(f.airport_ident, []);
  freqByAirport.get(f.airport_ident).push([f.type, f.description, +f.frequency_mhz]);
}

/** Heading implied by a runway ident like "28L" (magnetic, approximate) or compass letters. */
function identHeading(id) {
  const m = /^(\d{1,2})/.exec(id || '');
  if (m) return (+m[1] % 36) * 10;
  const c = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 }[(id || '').replace(/[^A-Z]/g, '')];
  return c ?? null;
}

const index = [];
const shards = new Map();
let rwOut = 0, synth = 0;
for (const a of airports) {
  const t = TYPES[a.type];
  if (!t) continue;
  const lat = +a.latitude_deg, lon = +a.longitude_deg, elevFt = num(a.elevation_ft) ?? 0;
  const rws = [];
  for (const r of rwByAirport.get(a.ident) || []) {
    const lenFt = num(r.length_ft), widFt = num(r.width_ft) || (t === 'L' ? 150 : t === 'M' ? 100 : 60);
    if (!lenFt || lenFt < 300) continue;
    let leLat = num(r.le_latitude_deg), leLon = num(r.le_longitude_deg);
    let heLat = num(r.he_latitude_deg), heLon = num(r.he_longitude_deg);
    let hdg = num(r.le_heading_degT);
    const lenM = lenFt * 0.3048;
    if (leLat == null || heLat == null) {
      // Synthesize ends from the airport reference point (documented approximation).
      if (hdg == null) hdg = identHeading(r.le_ident);
      if (hdg == null) continue;
      const a1 = destination(lat, lon, hdg + 180, lenM / 2), a2 = destination(lat, lon, hdg, lenM / 2);
      leLat = a1.lat; leLon = a1.lon; heLat = a2.lat; heLon = a2.lon; synth++;
    } else {
      hdg = bearing(leLat, leLon, heLat, heLon);
    }
    const leE = num(r.le_elevation_ft) ?? elevFt, heE = num(r.he_elevation_ft) ?? elevFt;
    rws.push({
      le: r.le_ident, he: r.he_ident,
      len: Math.round(distance(leLat, leLon, heLat, heLon) || lenM), wid: round(widFt * 0.3048, 1),
      surf: (r.surface || '').toUpperCase().slice(0, 12), lit: r.lighted === '1' ? 1 : 0,
      hdg: round(hdg, 2),
      a: [round(leLat, 6), round(leLon, 6), round(leE * 0.3048, 1), round((num(r.le_displaced_threshold_ft) || 0) * 0.3048, 1)],
      b: [round(heLat, 6), round(heLon, 6), round(heE * 0.3048, 1), round((num(r.he_displaced_threshold_ft) || 0) * 0.3048, 1)],
    });
  }
  if (!rws.length) continue;
  rwOut += rws.length;
  const key = shardKey(lat, lon);
  index.push([a.ident, a.iata_code || '', a.name, a.municipality || '', a.iso_country, round(lat, 5), round(lon, 5), Math.round(elevFt * 0.3048), t]);
  if (!shards.has(key)) shards.set(key, { airports: {}, navaids: [] });
  shards.get(key).airports[a.ident] = {
    name: a.name, lat: round(lat, 6), lon: round(lon, 6), elev: round(elevFt * 0.3048, 1), type: t,
    iata: a.iata_code || '', city: a.municipality || '', country: a.iso_country,
    runways: rws, freqs: (freqByAirport.get(a.ident) || []).slice(0, 12),
  };
}
for (const n of navaids) {
  const lat = +n.latitude_deg, lon = +n.longitude_deg;
  if (!Number.isFinite(lat)) continue;
  const key = shardKey(lat, lon);
  if (!shards.has(key)) shards.set(key, { airports: {}, navaids: [] });
  shards.get(key).navaids.push([n.ident, n.type, +n.frequency_khz || 0, round(lat, 5), round(lon, 5), Math.round((num(n.elevation_ft) || 0) * 0.3048), num(n.magnetic_variation_deg) ?? 0, n.name]);
}

const idxSize = writeJSON('public/data/airports/index.json', {
  fields: ['ident', 'iata', 'name', 'city', 'country', 'lat', 'lon', 'elev', 'type'], rows: index,
});
let total = 0;
for (const [k, v] of shards) total += writeJSON(`public/data/airports/shards/${k}.json`, v);
console.log(`index: ${index.length} airports (${(idxSize / 1e6).toFixed(1)} MB); ${rwOut} runways (${synth} with synthesized ends); ${shards.size} shards (${(total / 1e6).toFixed(1)} MB); ${magvar.length} magvar samples`);
