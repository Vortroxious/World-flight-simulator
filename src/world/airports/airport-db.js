// Airport database: search index (all ~29k airports with runways) + lazily loaded geographic shards.
import { distance } from '../../geo/wgs84.js';

export const TYPE_LABEL = { L: 'Large airport', M: 'Medium airport', S: 'Small airport' };

export class AirportDB {
  constructor(base = './data/') { this.base = base; this.rows = []; this.shards = new Map(); this.magvar = []; }

  async init() {
    const [idx, mv] = await Promise.all([
      fetch(this.base + 'airports/index.json').then((r) => r.json()),
      fetch(this.base + 'navaids/magvar.json').then((r) => r.json()).catch(() => []),
    ]);
    this.rows = idx.rows.map((r) => ({ ident: r[0], iata: r[1], name: r[2], city: r[3], country: r[4], lat: r[5], lon: r[6], elev: r[7], type: r[8] }));
    this.byIdent = new Map(this.rows.map((r) => [r.ident, r]));
    this.magvar = mv;
    return this;
  }

  /** Search by ICAO/IATA/ident (exact first), then name/city substring. */
  search(q, limit = 30) {
    q = (q || '').trim().toUpperCase();
    if (!q) return this.rows.filter((r) => r.type === 'L').slice(0, limit);
    const exact = [], starts = [], contains = [];
    for (const r of this.rows) {
      if (r.ident === q || r.iata === q) exact.push(r);
      else if (r.ident.startsWith(q)) starts.push(r);
      else {
        const hay = (r.name + ' ' + r.city).toUpperCase();
        if (hay.includes(q)) contains.push(r);
      }
      if (exact.length + starts.length > limit * 3) break;
    }
    const rank = { L: 0, M: 1, S: 2 };
    contains.sort((a, b) => rank[a.type] - rank[b.type]);
    starts.sort((a, b) => rank[a.type] - rank[b.type]);
    return [...exact, ...starts, ...contains].slice(0, limit);
  }

  nearest(lat, lon, n = 5, filter = () => true) {
    const cand = [];
    for (const r of this.rows) {
      if (Math.abs(r.lat - lat) > 2 || !filter(r)) continue;
      cand.push([distance(lat, lon, r.lat, r.lon), r]);
    }
    return cand.sort((a, b) => a[0] - b[0]).slice(0, n).map(([d, r]) => ({ ...r, dist: d }));
  }

  shardKey(lat, lon) { return `${Math.floor(lat / 10) * 10}_${Math.floor(lon / 10) * 10}`; }

  async shard(lat, lon) {
    const k = this.shardKey(lat, lon);
    if (!this.shards.has(k)) this.shards.set(k, fetch(`${this.base}airports/shards/${k}.json`).then((r) => r.json()).catch(() => ({ airports: {}, navaids: [] })));
    return this.shards.get(k);
  }

  /** Full airport record including runways and frequencies. */
  async get(ident) {
    const r = this.byIdent.get(ident);
    if (!r) return null;
    const s = await this.shard(r.lat, r.lon);
    const a = s.airports[ident];
    return a ? { ident, ...a } : null;
  }

  /** Magnetic variation (deg, east +) by inverse-distance weighting of nearby navaid declinations. */
  magneticVariation(lat, lon) {
    let wsum = 0, vsum = 0;
    const best = [];
    for (const [la, lo, v] of this.magvar) {
      if (Math.abs(la - lat) > 8) continue;
      const d = Math.hypot(la - lat, (lo - lon) * Math.cos((lat * Math.PI) / 180)) + 0.05;
      if (best.length < 6) best.push([d, v]); else { let wi = 0; for (let i = 1; i < 6; i++) if (best[i][0] > best[wi][0]) wi = i; if (d < best[wi][0]) best[wi] = [d, v]; }
    }
    for (const [d, v] of best) { const w = 1 / (d * d); wsum += w; vsum += v * w; }
    return wsum ? vsum / wsum : 0;
  }
}
