// Keeps airports near the aircraft built (departure airport + nearby airports), aggregates their paved
// surfaces for physics, terrain flattening zones and obstacles.
import { Airport } from './airport.js';
import { distance } from '../../geo/wgs84.js';

export const HEROES = { KSFO: './data/hero/KSFO.json' };

export class AirportManager {
  constructor({ db, scene, origin, terrain, collision }) {
    Object.assign(this, { db, scene, origin, terrain, collision });
    this.built = new Map();
    this.loading = new Map();
    this.heroCache = new Map();
    this.pinned = new Set();
    this.timer = 0;
  }

  hasHero(ident) { return ident in HEROES; }

  async hero(ident) {
    if (!HEROES[ident]) return null;
    if (!this.heroCache.has(ident)) this.heroCache.set(ident, fetch(HEROES[ident]).then((r) => r.json()).catch(() => null));
    return this.heroCache.get(ident);
  }

  /** Construct (not build) an Airport for menus/spawn lookup. */
  async describe(ident) {
    const data = await this.db.get(ident);
    if (!data) return null;
    const hero = await this.hero(ident);
    return new Airport(data, hero);
  }

  async ensure(ident, pin = false) {
    if (pin) this.pinned.add(ident);
    if (this.built.has(ident)) return this.built.get(ident);
    if (this.loading.has(ident)) return this.loading.get(ident);
    const p = (async () => {
      const ap = await this.describe(ident);
      if (!ap) return null;
      this.terrain.addZone(ap.zone);
      ap.build(this.origin, (ll) => this.terrain.heightAt(ll.lat, ll.lon).h);
      this.scene.add(ap.group);
      this.collision.add(ap.obstacles);
      this.built.set(ident, ap);
      this.loading.delete(ident);
      return ap;
    })();
    this.loading.set(ident, p);
    return p;
  }

  release(ident) {
    const ap = this.built.get(ident);
    if (!ap) return;
    this.terrain.removeZone(ap.zone.id);
    this.collision.remove(ap.obstacles);
    ap.dispose(this.origin);
    this.built.delete(ident);
  }

  /** Physics surface query across built airports. */
  surfaceAt(lat, lon) {
    for (const ap of this.built.values()) { const s = ap.surfaceAt(lat, lon); if (s) return s; }
    return null;
  }

  /** Periodically build airports within ~25 km and release far ones. */
  update(dt, lat, lon, cameraWorld, night, time, pixelRatio) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 4;
      for (const a of this.db.nearest(lat, lon, 6)) if (a.dist < 25000 && !this.built.has(a.ident)) { this.ensure(a.ident); break; }
      for (const [id, ap] of this.built) if (!this.pinned.has(id) && distance(lat, lon, ap.frame.lat, ap.frame.lon) > 60000) this.release(id);
    }
    for (const ap of this.built.values()) ap.update(cameraWorld, night, time, pixelRatio);
  }
}
