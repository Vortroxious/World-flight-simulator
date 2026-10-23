// Navigation receivers: GPS direct-to (desired track, cross-track, distance, ETE) and a synthetic ILS
// (localizer + glideslope generated from runway data; labelled synthetic because OurAirports has no ILS data).
import { bearing, distance, destination, wrap180, DEG, RAD } from '../../geo/wgs84.js';
import { clamp } from '../../core/math.js';

export const LOC_FULL_SCALE_DEG = 2.5; // ±2 dots
export const GS_FULL_SCALE_DEG = 0.7;

/** Build a synthetic ILS from a runway spawn/threshold description. */
export function makeIls({ ident, runway, threshold, heading, length }) {
  const loc = destination(threshold.lat, threshold.lon, heading, length + 300); // localizer beyond far end
  const gs = destination(threshold.lat, threshold.lon, heading, 300); // GS antenna abeam touchdown zone
  return { ident: `${ident} ${runway}`, airport: ident, runway, course: heading, locLat: loc.lat, locLon: loc.lon, gsLat: gs.lat, gsLon: gs.lon, gsElev: threshold.elev, angle: 3, thrLat: threshold.lat, thrLon: threshold.lon, thrElev: threshold.elev, synthetic: true };
}

export class NavSystem {
  constructor() { this.dto = null; this.ils = null; this.dtoInfo = null; this.ilsInfo = null; this.timer = 0; }

  directTo(target, ac) {
    this.dto = { ...target, fromLat: ac.lat, fromLon: ac.lon };
    this.dto.course = bearing(ac.lat, ac.lon, target.lat, target.lon);
    this.timer = 0; this.update(0, ac, true);
  }
  setIls(ils) { if (!ils) { this.ils = null; this.ilsInfo = null; return; } if (this.ils?.ident !== ils.ident) { this.ils = ils; this.ilsInfo = null; } }

  update(dt, ac, force = false) {
    this.timer -= dt;
    if (this.timer > 0 && !force) return;
    this.timer = 0.05;
    const gs = Math.hypot(ac.v[0], ac.v[1]);
    if (this.dto) {
      const d = this.dto;
      const brg = bearing(ac.lat, ac.lon, d.lat, d.lon), dist = distance(ac.lat, ac.lon, d.lat, d.lon);
      const d13 = distance(d.fromLat, d.fromLon, ac.lat, ac.lon) / 6371008.8;
      const t13 = bearing(d.fromLat, d.fromLon, ac.lat, ac.lon) * DEG;
      const xtk = Math.asin(Math.sin(d13) * Math.sin(t13 - d.course * DEG)) * 6371008.8; // + right of course
      this.dtoInfo = { ident: d.ident, brg, dist, dtk: d.course, xtk, eteSec: gs > 10 ? dist / gs : null };
    }
    if (this.ils) {
      const i = this.ils;
      const toLoc = bearing(ac.lat, ac.lon, i.locLat, i.locLon);
      const locDev = wrap180(toLoc - i.course); // + : localizer course lies to the right -> fly right
      const dLoc = distance(ac.lat, ac.lon, i.locLat, i.locLon);
      const dGs = distance(ac.lat, ac.lon, i.gsLat, i.gsLon);
      const dThr = distance(ac.lat, ac.lon, i.thrLat, i.thrLon);
      const elev = Math.atan2(ac.alt - i.gsElev, Math.max(dGs, 1)) * RAD;
      const inFront = Math.abs(wrap180(bearing(i.thrLat, i.thrLon, ac.lat, ac.lon) - (i.course + 180))) < 90;
      const locValid = Math.abs(locDev) < 35 && dLoc < 25 * 1852 && Math.abs(wrap180(this.trackOf(ac) - i.course)) < 100;
      const gsValid = locValid && inFront && dGs < 12 * 1852 && Math.abs(locDev) < 10;
      this.ilsInfo = {
        ident: i.ident, course: i.course, locDev, gsDev: elev - i.angle, locValid, gsValid, dist: dThr, distLoc: dLoc,
        locDevM: Math.sin(locDev * DEG) * dLoc, gsDevM: Math.tan((elev - i.angle) * DEG) * dGs,
        locDots: clamp(locDev / (LOC_FULL_SCALE_DEG / 2), -2.5, 2.5), gsDots: clamp(-(elev - i.angle) / (GS_FULL_SCALE_DEG / 2), -2.5, 2.5),
      };
    }
  }
  trackOf(ac) { return Math.hypot(ac.v[0], ac.v[1]) > 5 ? (Math.atan2(ac.v[1], ac.v[0]) * RAD + 360) % 360 : (ac.euler.psi * RAD + 360) % 360; }
}
