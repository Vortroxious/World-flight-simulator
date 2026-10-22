// Build-time OSM bake for "hero" areas (ODbL © OpenStreetMap contributors).
// Produces public/data/hero/<ICAO>.json with taxiways, aprons, buildings in local ENU metres.
// Usage: NODE_USE_ENV_PROXY=1 node scripts/bake-osm-airport.mjs [ICAO]
import { cachedFetch, writeJSON, round } from './lib.mjs';
import { LocalFrame } from '../src/geo/wgs84.js';

const MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

// Hero definitions: airport bbox (S,W,N,E) plus optional city "landmark" bboxes (tall buildings only).
const HEROES = {
  KSFO: {
    ref: [37.61899948, -122.375],
    bbox: [37.592, -122.405, 37.642, -122.350],
    cities: [{ name: 'San Francisco downtown', bbox: [37.770, -122.425, 37.812, -122.385], minHeight: 30 }],
  },
};

async function overpass(query, cacheName) {
  let err;
  for (const url of MIRRORS) {
    try {
      const text = await cachedFetch(url, cacheName, {
        init: { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'world-flight-simulator-databake/0.2' } },
      });
      return JSON.parse(text);
    } catch (e) { err = e; console.warn(`mirror failed: ${url}: ${e.message}`); }
  }
  throw err;
}

function heightOf(tags, fallback) {
  const h = parseFloat(tags.height);
  if (Number.isFinite(h)) return h;
  const lv = parseFloat(tags['building:levels']);
  if (Number.isFinite(lv)) return lv * 3.4 + 1;
  return fallback;
}

function polygonArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return a / 2;
}

function wayCoords(way, nodes, frame) {
  const out = [];
  for (const id of way.nodes) {
    const n = nodes.get(id);
    if (!n) return null;
    const p = frame.toEnu(n.lat, n.lon, 0);
    out.push([round(p[0], 1), round(p[1], 1)]);
  }
  return out;
}

async function bake(icao) {
  const hero = HEROES[icao];
  const frame = new LocalFrame(hero.ref[0], hero.ref[1], 0);
  const [s, w, n, e] = hero.bbox;
  const q = `[out:json][timeout:120];(way["aeroway"](${s},${w},${n},${e});way["building"](${s},${w},${n},${e}););(._;>;);out body;`;
  const data = await overpass(q, `osm-${icao}.json`);
  const nodes = new Map();
  for (const el of data.elements) if (el.type === 'node') nodes.set(el.id, el);

  const out = { icao, ref: hero.ref, attribution: '© OpenStreetMap contributors (ODbL)', taxiways: [], aprons: [], buildings: [], stands: [], holdShort: [], cities: [] };
  for (const el of data.elements) {
    if (el.type !== 'way') continue;
    const t = el.tags || {};
    const pts = wayCoords(el, nodes, frame);
    if (!pts || pts.length < 2) continue;
    const closed = el.nodes[0] === el.nodes[el.nodes.length - 1];
    if (closed) pts.pop();
    switch (t.aeroway) {
      case 'taxiway': case 'taxilane':
        out.taxiways.push({ ref: t.ref || '', w: round(parseFloat(t.width) || (t.aeroway === 'taxilane' ? 15 : 23), 1), pts });
        continue;
      case 'apron':
        if (closed && pts.length >= 3) out.aprons.push({ pts: polygonArea(pts) < 0 ? pts.reverse() : pts });
        continue;
      case 'parking_position': case 'gate':
        out.stands.push({ ref: t.ref || '', pts: [pts[0], pts[pts.length - 1]] });
        continue;
      case 'holding_position':
        out.holdShort.push({ pts });
        continue;
    }
    if ((t.building || t.aeroway === 'terminal' || t.aeroway === 'hangar') && closed && pts.length >= 3) {
      const kind = t.aeroway === 'terminal' || t.building === 'terminal' ? 'terminal' : t.aeroway === 'hangar' || t.building === 'hangar' ? 'hangar' : t['man_made'] === 'tower' || t.aeroway === 'tower' ? 'tower' : 'building';
      const fallback = { terminal: 18, hangar: 16, tower: 60, building: 8 }[kind];
      out.buildings.push({ kind, h: round(heightOf(t, fallback), 1), name: t.name || '', pts: polygonArea(pts) < 0 ? pts.reverse() : pts });
    }
  }

  for (const c of hero.cities || []) {
    const [cs, cw, cn, ce] = c.bbox;
    const cq = `[out:json][timeout:120];(way["building"]["height"](${cs},${cw},${cn},${ce});way["building"]["building:levels"](${cs},${cw},${cn},${ce}););(._;>;);out body;`;
    const cd = await overpass(cq, `osm-${icao}-${c.name.replace(/\W+/g, '_')}.json`);
    const cn2 = new Map();
    for (const el of cd.elements) if (el.type === 'node') cn2.set(el.id, el);
    const cref = [(cs + cn) / 2, (cw + ce) / 2];
    const cframe = new LocalFrame(cref[0], cref[1], 0);
    const blds = [];
    for (const el of cd.elements) {
      if (el.type !== 'way' || el.nodes[0] !== el.nodes[el.nodes.length - 1]) continue;
      const h = heightOf(el.tags || {}, 0);
      if (h < c.minHeight) continue;
      const pts = wayCoords(el, cn2, cframe);
      if (!pts || pts.length < 4) continue;
      pts.pop();
      blds.push({ h: round(h, 1), name: el.tags.name || '', pts: polygonArea(pts) < 0 ? pts.reverse() : pts });
    }
    out.cities.push({ name: c.name, ref: cref, buildings: blds });
  }
  const size = writeJSON(`public/data/hero/${icao}.json`, out);
  console.log(`${icao}: ${out.taxiways.length} taxiways, ${out.aprons.length} aprons, ${out.buildings.length} buildings, ${out.stands.length} stands, ` +
    out.cities.map((c) => `${c.name}: ${c.buildings.length} tall buildings`).join(', ') + ` (${(size / 1024).toFixed(0)} KB)`);
}

for (const icao of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(HEROES)) await bake(icao);
