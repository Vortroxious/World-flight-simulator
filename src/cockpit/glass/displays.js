// Glass-cockpit displays drawn to canvases: PFD (with FMA), navigation display, engine/alert display (EICAS /
// E-WD style), turboprop engine page, standby instrument and the fighter HUD. Everything reads simulated state
// (air data from the instrument model, engines, systems, autopilot, nav receivers) — nothing is decorative.
import { KT } from '../../core/units.js';
import { clamp } from '../../core/math.js';
import { distance, bearing } from '../../geo/wgs84.js';

const TAU = Math.PI * 2, D2R = Math.PI / 180, FT = 0.3048;
const FONT = '"Helvetica Neue", Arial, sans-serif';
export const C = { white: '#f2f2f2', green: '#3cf26a', cyan: '#4fe3ff', magenta: '#ff5cf0', amber: '#ffb21a', red: '#ff3b30', grey: '#7a7f86', sky: '#2c79c8', ground: '#7b4f27', bg: '#05070a' };

export function text(g, s, x, y, size, color = C.white, align = 'center', weight = 'bold') {
  g.fillStyle = color; g.font = `${weight} ${size}px ${FONT}`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y);
}
function box(g, x, y, w, h, stroke = C.white, lw = 2, fill = null) { if (fill) { g.fillStyle = fill; g.fillRect(x, y, w, h); } g.strokeStyle = stroke; g.lineWidth = lw; g.strokeRect(x, y, w, h); }
function line(g, x0, y0, x1, y1, color = C.white, lw = 2) { g.strokeStyle = color; g.lineWidth = lw; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
const wrap360 = (a) => ((a % 360) + 360) % 360;
const wrap180 = (a) => ((a + 540) % 360) - 180;

/** Common air data for all glass displays. */
export function airData(ac) {
  const s = ac.snapshot(), i = ac.inst;
  const ias = (i.ias ?? s.ias) / KT;
  if (ac._prevIas == null) ac._prevIas = ias;
  ac._iasTrend = (ac._iasTrend ?? 0) * 0.97 + ((ias - ac._prevIas) / Math.max(1 / 60, 0.016)) * 0.03;
  ac._prevIas = ias;
  return {
    s, ias, altFt: (i.altitude ?? s.alt) / FT, vsFpm: s.vs / FT * 60, pitch: s.pitch, roll: s.roll, hdg: s.headingMag, trk: wrap360(s.track - ac.magvar),
    mach: s.mach, gs: s.gs / KT, tas: s.tas / KT, ra: ac.radioAlt / FT, trend: ac._iasTrend * 10, qnh: i.kollsman ?? 101325,
    powered: ac.elec.busVolts > 18,
  };
}

/** Speeds for the speed tape: VLS-like minimum (1.23 Vs for the current flap/mass) and the max speed. */
export function speedLimits(ac) {
  const c = ac.cfg, L = c.limits, flap = ac.flapDeg ?? 0;
  let clmax = 0; for (let a = 0; a < 25; a += 0.5) clmax = Math.max(clmax, ac.aero.liftCoefficient(a * D2R, flap));
  const vs = Math.sqrt((2 * ac.mass * 9.81) / (1.225 * c.geometry.wingArea * clmax)) / KT;
  let vmax = L.Vmo ?? L.Vne ?? 999;
  if (L.Mmo && ac.mach > 0.3) vmax = Math.min(vmax, (ac.iasTrue / KT) * (L.Mmo / ac.mach));
  for (const [deg, kt] of L.Vfe ?? []) if (flap > 0.5 && deg >= flap - 0.5) { vmax = Math.min(vmax, kt); break; }
  if (ac.gearPos > 0.02 && c.gear.retractable) vmax = Math.min(vmax, L.Vle ?? vmax);
  return { vs, vls: vs * 1.23, vmax, vsw: vs * 1.04 };
}

// ======================================================================= PFD
export function drawPFD(g, W, H, ac) {
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  const d = airData(ac);
  if (!d.powered) return;
  const ap = ac.autopilot, fma = ap.fma();
  const u = W / 100;
  // ---- FMA (top band) ----
  const fy = H * 0.055, cols = [10, 30, 50, 70, 90].map((p) => p * u);
  g.strokeStyle = C.grey; g.lineWidth = 1.5;
  for (let k = 1; k < 5; k++) line(g, k * 20 * u, 0, k * 20 * u, H * 0.1, C.grey, 1.5);
  const fsz = H * 0.033;
  text(g, fma.at, cols[0], fy, fsz, C.green);
  text(g, fma.vert, cols[1], fy, fsz, C.green); text(g, fma.vertArm, cols[1], fy + H * 0.04, fsz * 0.85, C.cyan);
  text(g, fma.lat, cols[2], fy, fsz, C.green); text(g, fma.latArm, cols[2], fy + H * 0.04, fsz * 0.85, C.cyan);
  text(g, ap.vert === 'FLARE' || ap.vert === 'ROLLOUT' ? 'LAND' : ap.lat === 'LOC' && ap.vert === 'GS' ? (ac.cfg.autopilot.autoland ? 'CAT 3' : 'CAT 1') : '', cols[3], fy, fsz, C.white);
  text(g, fma.ap ? 'AP1' : '', cols[4], fy - H * 0.012, fsz, C.white); text(g, ap.fd ? 'FD' : '', cols[4] - 8 * u, fy + H * 0.03, fsz * 0.8, C.white);
  text(g, ap.atEngaged ? 'A/THR' : '', cols[4], fy + H * 0.03, fsz * 0.85, C.white);
  if (fma.disc) { g.fillStyle = Math.floor(performance.now() / 400) % 2 ? C.red : '#000'; g.fillRect(cols[4] - 9 * u, fy - H * 0.03, 18 * u, H * 0.05); text(g, 'AP OFF', cols[4], fy - H * 0.005, fsz, C.white); }

  // ---- Attitude ----
  const ax = W * 0.5, ay = H * 0.47, aw = W * 0.46, ah = H * 0.5, ppd = ah / 50;
  g.save(); g.beginPath(); g.rect(ax - aw / 2, ay - ah / 2, aw, ah); g.clip();
  g.translate(ax, ay); g.rotate(-d.roll * D2R);
  g.fillStyle = C.sky; g.fillRect(-W, -W * 2 + d.pitch * ppd, W * 2, W * 2);
  g.fillStyle = C.ground; g.fillRect(-W, d.pitch * ppd, W * 2, W * 2);
  line(g, -W, d.pitch * ppd, W, d.pitch * ppd, C.white, 2);
  for (let p = -40; p <= 40; p += 2.5) {
    if (!p) continue;
    const y = (d.pitch - p) * ppd, w = p % 10 === 0 ? aw * 0.28 : p % 5 === 0 ? aw * 0.16 : aw * 0.07;
    if (Math.abs(y) > ah * 0.48) continue;
    line(g, -w / 2, y, w / 2, y, C.white, 1.8);
    if (p % 10 === 0) { text(g, String(Math.abs(p)), -w / 2 - W * 0.025, y, H * 0.026); text(g, String(Math.abs(p)), w / 2 + W * 0.025, y, H * 0.026); }
  }
  // bank scale pointer (rotates with the horizon)
  g.fillStyle = C.white; const rr0 = ah * 0.42;
  g.beginPath(); g.moveTo(0, -rr0); g.lineTo(-W * 0.015, -rr0 + H * 0.028); g.lineTo(W * 0.015, -rr0 + H * 0.028); g.fill();
  g.restore();
  // fixed bank scale
  const rr = ah * 0.42;
  for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const a = (b - 90) * D2R, l = Math.abs(b) % 30 === 0 ? H * 0.03 : H * 0.018;
    line(g, ax + Math.cos(a) * rr, ay + Math.sin(a) * rr, ax + Math.cos(a) * (rr + l), ay + Math.sin(a) * (rr + l), C.white, 2);
  }
  // slip indicator (beta)
  const sx = clamp(-(ac.inst.slip ?? 0), -1, 1) * W * 0.04;
  g.fillStyle = C.white; g.fillRect(ax - W * 0.02 + sx, ay - rr + H * 0.032, W * 0.04, H * 0.008);
  // aircraft symbol
  g.fillStyle = '#000'; g.strokeStyle = C.amber; g.lineWidth = 3;
  for (const s of [-1, 1]) { g.fillRect(ax + s * aw * 0.3 - (s < 0 ? 0 : aw * 0.14), ay - 3, aw * 0.14, 6); g.strokeRect(ax + s * aw * 0.3 - (s < 0 ? 0 : aw * 0.14), ay - 3, aw * 0.14, 6); }
  g.fillRect(ax - 4, ay - 4, 8, 8); g.strokeRect(ax - 4, ay - 4, 8, 8);
  // flight director
  if (ap.fd || ap.engaged) {
    const dp = clamp(ap.pitchT - d.pitch, -10, 10) * ppd, dr = clamp(ap.bankT - d.roll, -30, 30) / 30 * aw * 0.25;
    line(g, ax - aw * 0.22, ay - dp, ax + aw * 0.22, ay - dp, C.green, 3);
    line(g, ax + dr, ay - ah * 0.22, ax + dr, ay + ah * 0.22, C.green, 3);
  }
  // ILS deviation scales
  const ils = ac.nav?.ilsInfo;
  if (ils?.locValid) {
    const by = ay + ah / 2 + H * 0.025;
    for (let k = -2; k <= 2; k++) if (k) { g.strokeStyle = C.white; g.beginPath(); g.arc(ax + k * aw * 0.12, by, 4, 0, TAU); g.stroke(); }
    const lx = ax + clamp(ils.locDots, -2.3, 2.3) * aw * 0.12;
    g.fillStyle = C.magenta; g.beginPath(); g.moveTo(lx - 10, by); g.lineTo(lx, by - 8); g.lineTo(lx + 10, by); g.lineTo(lx, by + 8); g.fill();
  }
  if (ils?.gsValid) {
    const bx = ax + aw / 2 + W * 0.02;
    for (let k = -2; k <= 2; k++) if (k) { g.strokeStyle = C.white; g.beginPath(); g.arc(bx, ay + k * ah * 0.12, 4, 0, TAU); g.stroke(); }
    const gy = ay - clamp(ils.gsDots, -2.3, 2.3) * ah * 0.12;
    g.fillStyle = C.magenta; g.beginPath(); g.moveTo(bx, gy - 10); g.lineTo(bx + 8, gy); g.lineTo(bx, gy + 10); g.lineTo(bx - 8, gy); g.fill();
    text(g, ils.ident, ax - aw / 2 + 6, ay + ah / 2 - H * 0.03, H * 0.026, C.magenta, 'left');
    text(g, `${(ils.dist / 1852).toFixed(1)} NM`, ax - aw / 2 + 6, ay + ah / 2 - H * 0.065, H * 0.024, C.magenta, 'left');
  }
  // radio altitude
  if (d.ra < 2500 && d.ra > 0) text(g, String(Math.round(d.ra / (d.ra > 50 ? 10 : 1)) * (d.ra > 50 ? 10 : 1)), ax, ay + ah * 0.36, H * 0.045, d.ra < (ac.cfg.limits.minimumsFt ?? 200) ? C.amber : C.green);
  // GPWS / stall
  const alert = ac.gpws?.alert;
  if (alert) text(g, alert, ax, ay + ah * 0.2, H * 0.05, /PULL|STALL|TERRAIN|SINK/.test(alert) ? C.red : C.amber);
  if (ac.warnings?.stall) text(g, 'STALL', ax, ay - ah * 0.2, H * 0.06, C.red);

  // ---- Speed tape ----
  const lim = speedLimits(ac);
  const tx = W * 0.07, tw = W * 0.12, ty = ay - ah / 2, th = ah, kpp = th / 80;
  g.fillStyle = '#3a3e45'; g.fillRect(tx, ty, tw, th);
  g.save(); g.beginPath(); g.rect(tx, ty, tw, th); g.clip();
  for (let v = Math.floor((d.ias - 45) / 10) * 10; v <= d.ias + 45; v += 10) {
    if (v < 30) continue;
    const y = ay - (v - d.ias) * kpp;
    line(g, tx + tw * 0.75, y, tx + tw, y, C.white, 2);
    if (v % 20 === 0) text(g, String(v), tx + tw * 0.4, y, H * 0.03);
  }
  // barber poles: max speed and low-speed band
  const yMax = ay - (lim.vmax - d.ias) * kpp, yVls = ay - (lim.vls - d.ias) * kpp, yVs = ay - (lim.vsw - d.ias) * kpp;
  for (let y = ty - 20; y < yMax; y += 12) { g.fillStyle = (y / 12) % 2 < 1 ? C.red : C.white; g.fillRect(tx + tw * 0.86, y, tw * 0.14, 12); }
  g.fillStyle = C.amber; g.fillRect(tx + tw * 0.88, yVls, tw * 0.06, Math.max(0, yVs - yVls));
  for (let y = yVs; y < ty + th + 20; y += 12) { g.fillStyle = (y / 12) % 2 < 1 ? C.red : '#000'; g.fillRect(tx + tw * 0.86, y, tw * 0.14, 12); }
  // selected speed bug and trend
  const ySel = clamp(ay - (ap.sel.spd - d.ias) * kpp, ty, ty + th);
  g.fillStyle = C.magenta; g.beginPath(); g.moveTo(tx + tw, ySel); g.lineTo(tx + tw + 12, ySel - 9); g.lineTo(tx + tw + 12, ySel + 9); g.fill();
  if (Math.abs(d.trend) > 2) { line(g, tx + tw * 0.8, ay, tx + tw * 0.8, ay - d.trend * kpp, C.green, 3); }
  g.restore();
  box(g, tx - 4, ay - H * 0.03, tw * 0.8, H * 0.06, C.amber, 2, '#000');
  text(g, String(Math.round(d.ias)).padStart(3, ' '), tx + tw * 0.36, ay, H * 0.042, C.white);
  text(g, ap.sel.spd ? String(ap.sel.spd) : '', tx + tw / 2, ty - H * 0.03, H * 0.035, C.magenta);
  if (d.mach > 0.4) text(g, `.${Math.round(d.mach * 1000).toString().padStart(3, '0').slice(0, 3)}`, tx + tw / 2, ty + th + H * 0.035, H * 0.036, C.green);
  else text(g, `GS ${Math.round(d.gs)}`, tx + tw / 2, ty + th + H * 0.035, H * 0.03, C.white);

  // ---- Altitude tape ----
  const bx = W * 0.79, bw = W * 0.13, fpp = th / 1000;
  g.fillStyle = '#3a3e45'; g.fillRect(bx, ty, bw, th);
  g.save(); g.beginPath(); g.rect(bx, ty, bw, th); g.clip();
  for (let a = Math.floor((d.altFt - 600) / 100) * 100; a <= d.altFt + 600; a += 100) {
    const y = ay - (a - d.altFt) * fpp;
    line(g, bx, y, bx + bw * 0.18, y, C.white, 2);
    if (a % 200 === 0) text(g, String(a), bx + bw * 0.6, y, H * 0.028);
  }
  const yA = clamp(ay - (ap.sel.alt - d.altFt) * fpp, ty, ty + th);
  g.fillStyle = C.magenta; g.fillRect(bx, yA - 10, 8, 20);
  // ground reference
  if (d.ra < 1000) { const yg = ay + d.ra * fpp; g.fillStyle = C.amber; g.fillRect(bx, yg, bw, 6); }
  g.restore();
  box(g, bx - 4, ay - H * 0.032, bw + 8, H * 0.064, C.amber, 2, '#000');
  text(g, String(Math.round(d.altFt / 10) * 10), bx + bw / 2, ay, H * 0.04, C.green);
  text(g, String(ap.sel.alt), bx + bw / 2, ty - H * 0.03, H * 0.035, C.magenta);
  const hpa = d.qnh / 100, std = Math.abs(hpa - 1013.25) < 0.3;
  text(g, std ? 'STD' : `QNH ${Math.round(hpa)}`, bx + bw / 2, ty + th + H * 0.035, H * 0.03, C.cyan);
  // ---- VSI ----
  const vx = W * 0.94, vy = ay;
  g.fillStyle = '#2a2d33'; g.fillRect(vx - W * 0.015, ty + th * 0.1, W * 0.045, th * 0.8);
  const vsPix = (fpm) => Math.sign(fpm) * Math.min(1, Math.sqrt(Math.abs(fpm) / 6000)) * th * 0.38;
  for (const f of [-6000, -2000, -1000, 0, 1000, 2000, 6000]) line(g, vx - W * 0.015, vy - vsPix(f), vx - W * 0.002, vy - vsPix(f), C.white, 1.5);
  line(g, vx + W * 0.03, vy, vx - W * 0.01, vy - vsPix(d.vsFpm), Math.abs(d.vsFpm) > 6000 ? C.amber : C.green, 3);
  if (Math.abs(d.vsFpm) > 200) text(g, String(Math.round(Math.abs(d.vsFpm) / 100)), vx + W * 0.008, vy - vsPix(d.vsFpm) - Math.sign(d.vsFpm) * H * 0.03, H * 0.026, C.green);

  // ---- Heading tape ----
  const hy = H * 0.86, hw = aw, dpp = hw / 60;
  g.fillStyle = '#3a3e45'; g.fillRect(ax - hw / 2, hy - H * 0.035, hw, H * 0.07);
  g.save(); g.beginPath(); g.rect(ax - hw / 2, hy - H * 0.035, hw, H * 0.07); g.clip();
  for (let h = Math.floor(d.hdg - 32); h <= d.hdg + 32; h++) {
    if (h % 5) continue;
    const x = ax + (h - d.hdg) * dpp;
    line(g, x, hy - H * 0.035, x, hy - H * (h % 10 ? 0.02 : 0.008), C.white, 2);
    if (h % 10 === 0) text(g, String(wrap360(h) / 10 | 0).padStart(2, '0'), x, hy + H * 0.012, H * 0.026);
  }
  const hb = ax + wrap180(ap.sel.hdg - d.hdg) * dpp;
  g.fillStyle = C.magenta; g.fillRect(hb - 6, hy - H * 0.035, 12, H * 0.015);
  const tx2 = ax + wrap180(d.trk - d.hdg) * dpp; g.fillStyle = C.green; g.beginPath(); g.arc(tx2, hy - H * 0.028, 5, 0, TAU); g.fill();
  g.restore();
  line(g, ax, hy - H * 0.05, ax, hy - H * 0.03, C.amber, 4);
  text(g, `HDG ${String(ap.sel.hdg).padStart(3, '0')}`, ax - hw / 2 - W * 0.01, hy + H * 0.06, H * 0.028, C.magenta, 'left');
  text(g, `${Math.round(d.tas)} TAS  ${Math.round(d.gs)} GS`, ax + hw / 2, hy + H * 0.06, H * 0.026, C.white, 'right', 'normal');
}

// ======================================================================= ND (arc mode)
export function drawND(g, W, H, ac, st = {}) {
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  const d = airData(ac);
  if (!d.powered) return;
  const range = st.range ?? 20, cx = W / 2, cy = H * 0.86, R = H * 0.72, ppn = R / range;
  const hdg = d.hdg;
  // compass arc
  g.strokeStyle = C.white; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2 - 0.85, -Math.PI / 2 + 0.85); g.stroke();
  for (let h = 0; h < 360; h += 5) {
    const rel = wrap180(h - hdg); if (Math.abs(rel) > 50) continue;
    const a = (rel - 90) * D2R, l = h % 10 ? 8 : 16;
    line(g, cx + Math.cos(a) * R, cy + Math.sin(a) * R, cx + Math.cos(a) * (R - l), cy + Math.sin(a) * (R - l), C.white, 2);
    if (h % 30 === 0) text(g, String(h / 10), cx + Math.cos(a) * (R - 32), cy + Math.sin(a) * (R - 32), H * 0.04);
  }
  // half-range ring
  g.setLineDash([6, 8]); g.strokeStyle = C.grey; g.beginPath(); g.arc(cx, cy, R / 2, -Math.PI / 2 - 0.85, -Math.PI / 2 + 0.85); g.stroke(); g.setLineDash([]);
  text(g, String(range / 2), cx - R / 2 * Math.sin(0.85) - 14, cy - R / 2 * Math.cos(0.85), H * 0.03, C.cyan);
  // heading box + lubber
  box(g, cx - W * 0.06, H * 0.035, W * 0.12, H * 0.065, C.white, 2, '#000');
  text(g, String(Math.round(hdg) % 360).padStart(3, '0'), cx, H * 0.068, H * 0.045);
  line(g, cx, cy - R - 4, cx, cy - R + 18, C.amber, 4);
  // heading bug and track
  const ap = ac.autopilot, bugA = (wrap180(ap.sel.hdg - hdg) - 90) * D2R;
  if (Math.abs(wrap180(ap.sel.hdg - hdg)) < 50) { g.fillStyle = C.magenta; g.save(); g.translate(cx + Math.cos(bugA) * R, cy + Math.sin(bugA) * R); g.rotate(bugA + Math.PI / 2); g.fillRect(-8, -10, 16, 10); g.restore(); }
  const ta = (wrap180(d.trk - hdg) - 90) * D2R;
  g.setLineDash([10, 8]); line(g, cx, cy, cx + Math.cos(ta) * R, cy + Math.sin(ta) * R, C.green, 2); g.setLineDash([]);
  // plotting helper (lat/lon -> screen)
  const s = d.s, plot = (lat, lon) => {
    const dist = distance(s.lat, s.lon, lat, lon) / 1852, brg = bearing(s.lat, s.lon, lat, lon) - ac.magvar;
    const a = (wrap180(brg - hdg) - 90) * D2R;
    return { x: cx + Math.cos(a) * dist * ppn, y: cy + Math.sin(a) * dist * ppn, dist };
  };
  g.save(); g.beginPath(); g.rect(0, H * 0.1, W, cy - H * 0.1 + 20); g.clip();
  // nearby airports
  for (const apt of st.airports ?? []) {
    const p = plot(apt.lat, apt.lon); if (p.dist > range * 1.05) continue;
    g.strokeStyle = C.cyan; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, 7, 0, TAU); g.stroke();
    text(g, apt.ident, p.x + 10, p.y - 10, H * 0.028, C.cyan, 'left');
  }
  // ILS course (localizer) line
  const ils = ac.nav?.ils;
  if (ils) {
    const p0 = plot(ils.thrLat, ils.thrLon);
    const back = (ils.course + 180 - ac.magvar), a = (wrap180(back - hdg) - 90) * D2R, L = 15 * ppn;
    g.strokeStyle = C.magenta; g.lineWidth = 2; g.setLineDash([12, 6]);
    line(g, p0.x, p0.y, p0.x + Math.cos(a) * L, p0.y + Math.sin(a) * L, C.magenta, 2); g.setLineDash([]);
  }
  // direct-to course + waypoint
  const dto = ac.nav?.dto;
  if (dto) {
    const p0 = plot(dto.fromLat, dto.fromLon), p1 = plot(dto.lat, dto.lon);
    line(g, p0.x, p0.y, p1.x, p1.y, C.magenta, 3);
    g.fillStyle = C.magenta; g.beginPath(); g.moveTo(p1.x, p1.y - 10); g.lineTo(p1.x + 8, p1.y); g.lineTo(p1.x, p1.y + 10); g.lineTo(p1.x - 8, p1.y); g.fill();
  }
  // terrain/weather would go here (not simulated on the ND yet)
  g.restore();
  // own aircraft
  g.strokeStyle = C.amber; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy - 18); g.lineTo(cx, cy + 14); g.moveTo(cx - 14, cy - 4); g.lineTo(cx + 14, cy - 4); g.moveTo(cx - 6, cy + 12); g.lineTo(cx + 6, cy + 12); g.stroke();
  // data block
  text(g, `GS ${Math.round(d.gs)}  TAS ${Math.round(d.tas)}`, W * 0.03, H * 0.04, H * 0.032, C.white, 'left');
  const w = ac.windNed ?? [0, 0, 0], ws = Math.hypot(w[0], w[1]) / KT;
  if (ws > 1) {
    const from = wrap360(Math.atan2(-w[1], -w[0]) / D2R - ac.magvar);
    text(g, `${String(Math.round(from)).padStart(3, '0')}°/${Math.round(ws)}`, W * 0.03, H * 0.085, H * 0.032, C.white, 'left');
    const a = (wrap180(from - hdg) + 90) * D2R; const ox = W * 0.06, oy = H * 0.15;
    line(g, ox - Math.cos(a) * 18, oy - Math.sin(a) * 18, ox + Math.cos(a) * 18, oy + Math.sin(a) * 18, C.green, 3);
  }
  if (ac.nav?.dtoInfo) {
    const i = ac.nav.dtoInfo;
    text(g, i.ident, W * 0.97, H * 0.04, H * 0.036, C.magenta, 'right');
    text(g, `${(i.dist / 1852).toFixed(1)} NM`, W * 0.97, H * 0.085, H * 0.032, C.white, 'right');
    if (i.eteSec != null) text(g, `${Math.floor(i.eteSec / 60)}:${String(Math.round(i.eteSec % 60)).padStart(2, '0')}`, W * 0.97, H * 0.125, H * 0.03, C.green, 'right');
  }
  text(g, st.mode ?? 'ARC', W * 0.03, H * 0.95, H * 0.03, C.green, 'left'); text(g, `${range} NM`, W * 0.97, H * 0.95, H * 0.03, C.cyan, 'right');
  if (ac.gpws?.alert && /TERRAIN|PULL/.test(ac.gpws.alert)) text(g, 'TERRAIN', cx, H * 0.2, H * 0.06, C.red);
}

// ======================================================================= engine & alert display
function dial(g, x, y, r, v, lo, hi, red, label, digits, color = C.white) {
  const a0 = -Math.PI * 1.2, a1 = Math.PI * 0.2, f = clamp((v - lo) / (hi - lo), 0, 1), a = a0 + (a1 - a0) * f;
  g.strokeStyle = C.white; g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke();
  if (red != null) { const ar = a0 + (a1 - a0) * clamp((red - lo) / (hi - lo), 0, 1); g.strokeStyle = C.red; g.lineWidth = 4; g.beginPath(); g.arc(x, y, r, ar, a1); g.stroke(); }
  g.fillStyle = 'rgba(160,160,170,0.25)'; g.beginPath(); g.moveTo(x, y); g.arc(x, y, r, a0, a); g.closePath(); g.fill();
  line(g, x, y, x + Math.cos(a) * r, y + Math.sin(a) * r, color, 3);
  box(g, x - r * 0.05, y - r * 0.55, r * 1.05, r * 0.42, C.grey, 1.5, '#000');
  text(g, digits, x + r * 0.95, y - r * 0.34, r * 0.32, color, 'right');
  text(g, label, x, y + r * 0.5, r * 0.26, C.cyan, 'center', 'normal');
}

export function drawEICAS(g, W, H, ac) {
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  const powered = ac.elec.busVolts > 18;
  if (!powered) return;
  const es = ac.engines, n = es.length, kind = es[0].kind;
  const colW = W / Math.max(n, 2), r = Math.min(colW * 0.32, H * 0.085);
  es.forEach((e, i) => {
    const x = colW * (i + 0.5);
    if (kind === 'turbofan') {
      const red = e.cfg.afterburner ? 104 : 104;
      dial(g, x, H * 0.12, r, e.n1, 0, 110, red, 'N1 %', e.n1.toFixed(1), e.failed ? C.amber : C.white);
      dial(g, x, H * 0.32, r * 0.85, e.egt, 0, 1100, 950, 'EGT °C', Math.round(e.egt).toString());
      text(g, `N2 ${e.n2.toFixed(1)}`, x, H * 0.43, H * 0.028, C.green);
      text(g, `FF ${Math.round(e.fuelFlow * 3600)}`, x, H * 0.465, H * 0.026, C.green);
      if (e.reverser > 0.05) text(g, e.reverser > 0.9 ? 'REV' : 'REV', x, H * 0.04, H * 0.03, e.reverser > 0.9 ? C.green : C.amber);
      if (e.afterburner) text(g, 'AB', x, H * 0.04, H * 0.035, C.amber);
      if (e.starting) text(g, 'START', x, H * 0.2, H * 0.026, C.cyan);
    } else {
      const tq = e.indications?.().tq ?? (e.torque || 0);
      dial(g, x, H * 0.12, r, tq, 0, 120, 100, 'TRQ %', tq.toFixed(0), e.failed ? C.amber : C.white);
      dial(g, x, H * 0.32, r * 0.85, e.itt, 0, 1000, 820, 'ITT °C', Math.round(e.itt).toString());
      text(g, `NP ${Math.round(e.np)}`, x, H * 0.43, H * 0.026, C.green);
      text(g, `NG ${e.ng.toFixed(1)}`, x, H * 0.46, H * 0.026, C.green);
      if (e.feathered) text(g, 'FTHR', x, H * 0.04, H * 0.03, C.amber);
      if (e.starting) text(g, 'START', x, H * 0.2, H * 0.026, C.cyan);
    }
    if (!e.running) text(g, e.fuelOn ? 'RELIGHT' : 'OFF', x, H * 0.235, H * 0.026, C.amber);
  });
  line(g, 0, H * 0.5, W, H * 0.5, C.grey, 1.5);
  // fuel, configuration, gear
  const fq = ac.fuel.massKg;
  text(g, 'FOB', W * 0.06, H * 0.54, H * 0.028, C.white, 'left'); text(g, `${Math.round(fq)} KG`, W * 0.06, H * 0.58, H * 0.034, C.green, 'left');
  text(g, `FF ${Math.round((ac.totalFuelFlow ?? 0) * 3600)} KG/H`, W * 0.06, H * 0.62, H * 0.024, C.green, 'left');
  const fl = ac.cfg.aero.flaps, lv = fl[ac.controls.flapsLever]?.label ?? '', moving = Math.abs(ac.flapDeg - fl[ac.controls.flapsLever].deg) > 0.3;
  text(g, 'FLAPS', W * 0.5, H * 0.54, H * 0.028, C.white); text(g, lv, W * 0.5, H * 0.58, H * 0.036, moving ? C.cyan : C.green);
  const maxF = fl[fl.length - 1].deg || 1; box(g, W * 0.38, H * 0.6, W * 0.24, H * 0.018, C.white, 1.5); g.fillStyle = C.green; g.fillRect(W * 0.38, H * 0.6, W * 0.24 * (ac.flapDeg / maxF), H * 0.018);
  if (ac.cfg.gear.retractable) {
    const gp = ac.gearPos, cmdDown = ac.controls.gearDown;
    ['N', 'L', 'R'].forEach((lbl, k) => {
      const det = ac.damage.detached[['noseGear', 'leftMainGear', 'rightMainGear'][k]];
      const x = W * (0.8 + (k - 1) * 0.07), y = H * (k === 0 ? 0.555 : 0.61);
      const st = det ? 'red' : gp > 0.98 ? 'down' : gp < 0.02 ? 'up' : 'transit';
      if (st !== 'up') box(g, x - W * 0.03, y - H * 0.022, W * 0.06, H * 0.044, st === 'down' ? C.green : C.red, 2, '#000');
      if (st === 'down') text(g, '▼', x, y, H * 0.03, C.green); else if (st !== 'up') text(g, 'X', x, y, H * 0.03, C.red);
    });
    text(g, cmdDown ? 'GEAR DN' : 'GEAR UP', W * 0.8, H * 0.665, H * 0.024, C.white);
  }
  if (ac.spoilerPos > 0.05 || ac.controls.spoilersArmed) text(g, ac.spoilerPos > 0.05 ? `SPD BRK ${Math.round(ac.spoilerPos * 100)}%` : 'GND SPLR ARM', W * 0.5, H * 0.665, H * 0.024, ac.spoilerPos > 0.05 && !ac.onGround ? C.amber : C.green);
  // systems line
  const hyd = ac.hyd.systems.map((h) => `${h.name} ${Math.round(h.pressure / 100) * 100}`).join('  ');
  text(g, hyd ? `HYD ${hyd}` : '', W * 0.06, H * 0.71, H * 0.022, C.green, 'left', 'normal');
  text(g, `CAB ${Math.round(ac.press.cabinAltFt / 100) * 100} FT  ΔP ${ac.press.diffPsi.toFixed(1)}`, W * 0.06, H * 0.745, H * 0.022, ac.press.warning ? C.red : C.green, 'left', 'normal');
  text(g, `APU ${ac.apu.present ? ac.apu.state : '—'}`, W * 0.94, H * 0.745, H * 0.022, ac.apu.available ? C.green : C.white, 'right', 'normal');
  line(g, 0, H * 0.77, W, H * 0.77, C.grey, 1.5);
  // alerts
  const al = ac.alerts ?? { warnings: [], cautions: [] };
  let y = H * 0.8;
  for (const a of al.warnings) { text(g, a, W * 0.06, y, H * 0.03, C.red, 'left'); y += H * 0.038; }
  for (const a of al.cautions) { if (y > H * 0.98) break; text(g, a, W * 0.06, y, H * 0.03, C.amber, 'left'); y += H * 0.038; }
  if (!al.warnings.length && !al.cautions.length) text(g, ac.onGround ? 'T.O. / LDG MEMO' : 'NO ALERTS', W * 0.06, y, H * 0.026, C.green, 'left', 'normal');
}

// ======================================================================= standby
export function drawStandby(g, W, H, ac) {
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const d = airData(ac); if (ac.elec.busVolts < 10) return;
  const cx = W / 2, cy = H * 0.55, r = W * 0.36, ppd = r / 25;
  g.save(); g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.clip(); g.translate(cx, cy); g.rotate(-d.roll * D2R);
  g.fillStyle = C.sky; g.fillRect(-W, -W * 2 + d.pitch * ppd, W * 2, W * 2); g.fillStyle = C.ground; g.fillRect(-W, d.pitch * ppd, W * 2, W * 2);
  line(g, -W, d.pitch * ppd, W, d.pitch * ppd, C.white, 2); g.restore();
  line(g, cx - r * 0.5, cy, cx - r * 0.15, cy, C.amber, 4); line(g, cx + r * 0.15, cy, cx + r * 0.5, cy, C.amber, 4);
  text(g, String(Math.round(d.ias)), W * 0.14, H * 0.08, H * 0.09, C.white); text(g, String(Math.round(d.altFt / 10) * 10), W * 0.82, H * 0.08, H * 0.09, C.white);
}

// ======================================================================= fighter HUD
/** HUD symbology on a transparent canvas; fovDeg = vertical field of view represented by the canvas height. */
export function drawHUD(g, W, H, ac, fovDeg = 24) {
  g.clearRect(0, 0, W, H);
  if (ac.elec.busVolts < 18) return;
  const d = airData(ac), col = '#7dff8c', ppd = H / fovDeg, cx = W / 2, cy = H * 0.42;
  g.shadowColor = 'rgba(80,255,120,0.6)'; g.shadowBlur = 4;
  const L = (x0, y0, x1, y1, w = 2.5) => line(g, x0, y0, x1, y1, col, w);
  // pitch ladder (conformal)
  g.save(); g.translate(cx, cy); g.rotate(-d.roll * D2R);
  for (let p = -90; p <= 90; p += 5) {
    const y = (d.pitch - p) * ppd; if (Math.abs(y) > H * 0.45) continue;
    const w = W * (p === 0 ? 0.36 : 0.12), gap = W * 0.05;
    if (p < 0) g.setLineDash([10, 8]);
    L(-gap - w, y, -gap, y); L(gap, y, gap + w, y);
    if (p) { L(-gap - w, y, -gap - w, y + (p > 0 ? 10 : -10)); L(gap + w, y, gap + w, y + (p > 0 ? 10 : -10)); text(g, String(Math.abs(p)), -gap - w - 22, y, H * 0.035, col); text(g, String(Math.abs(p)), gap + w + 22, y, H * 0.035, col); }
    g.setLineDash([]);
  }
  g.restore();
  // flight path marker (velocity vector)
  const fx = cx + clamp(-(d.s.beta || 0), -10, 10) * ppd, fy = cy + clamp(d.s.alpha, -10, 25) * ppd;
  g.strokeStyle = col; g.lineWidth = 2.5; g.beginPath(); g.arc(fx, fy, 10, 0, TAU); g.stroke();
  L(fx - 24, fy, fx - 10, fy); L(fx + 10, fy, fx + 24, fy); L(fx, fy - 10, fx, fy - 20);
  // waterline / gun cross
  L(cx - 18, cy, cx - 6, cy); L(cx + 6, cy, cx + 18, cy); L(cx, cy - 6, cx, cy - 14);
  // heading tape
  const hy = H * 0.08, dpp = W * 0.4 / 30;
  for (let h = Math.floor(d.hdg - 16); h <= d.hdg + 16; h++) {
    if (h % 5) continue; const x = cx + (h - d.hdg) * dpp;
    L(x, hy, x, hy + (h % 10 ? 8 : 16), 2);
    if (h % 10 === 0) text(g, String(wrap360(h) / 10 | 0).padStart(2, '0'), x, hy + 30, H * 0.034, col);
  }
  L(cx, hy - 10, cx, hy - 2, 3);
  // airspeed and altitude boxes
  box(g, W * 0.1, cy - 22, W * 0.14, 44, col, 2.5); text(g, String(Math.round(d.ias)), W * 0.17, cy, H * 0.05, col);
  box(g, W * 0.76, cy - 22, W * 0.16, 44, col, 2.5); text(g, String(Math.round(d.altFt / 10) * 10), W * 0.84, cy, H * 0.05, col);
  text(g, `M ${d.mach.toFixed(2)}`, W * 0.17, cy + 48, H * 0.036, col);
  text(g, `G ${ac.nz.toFixed(1)}`, W * 0.17, cy + 82, H * 0.036, col);
  text(g, `α ${d.s.alpha.toFixed(1)}`, W * 0.17, cy + 116, H * 0.036, col);
  text(g, `${Math.round(d.vsFpm)} VV`, W * 0.84, cy + 48, H * 0.034, col);
  if (d.ra < 5000) text(g, `R ${Math.round(d.ra)}`, W * 0.84, cy + 82, H * 0.036, col);
  const e = ac.engines[0];
  text(g, e.afterburner ? 'AB' : `${Math.round(e.n2 ?? 0)}%`, W * 0.84, H * 0.86, H * 0.04, col);
  const ap = ac.autopilot; if (ap.engaged) text(g, `AP ${ap.lat} ${ap.vert}`, cx, H * 0.86, H * 0.034, col);
  if (ac.fbw?.protections?.length) text(g, ac.fbw.protections.join(' '), cx, H * 0.8, H * 0.034, col);
  if (ac.gearPos > 0.02) text(g, 'GEAR', W * 0.17, H * 0.86, H * 0.036, col);
  if (ac.warnings?.stall || d.s.alpha > 22) text(g, 'AOA', cx, H * 0.72, H * 0.05, '#ff6040');
  g.shadowBlur = 0;
}

// ======================================================================= fighter MFD (engine/fuel)
export function drawFighterMFD(g, W, H, ac) {
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  if (ac.elec.busVolts < 18) return;
  const e = ac.engines[0], r = W * 0.17;
  dial(g, W * 0.28, H * 0.22, r, e.n2 ?? 0, 0, 110, 103, 'RPM %', `${Math.round(e.n2 ?? 0)}`);
  dial(g, W * 0.72, H * 0.22, r, e.egt, 0, 1100, 980, 'FTIT °C', `${Math.round(e.egt)}`);
  text(g, `NOZ ${e.afterburner ? 'AB' : Math.round(clamp((e.n1 - 70) * 3, 0, 100)) + '%'}`, W * 0.5, H * 0.45, H * 0.045, e.afterburner ? C.amber : C.green);
  text(g, `FUEL ${Math.round(ac.fuel.massKg)} KG`, W * 0.5, H * 0.55, H * 0.05, C.green);
  text(g, `FF ${Math.round(e.fuelFlow * 3600)} KG/H`, W * 0.5, H * 0.63, H * 0.04, C.green);
  text(g, ac.gearPos > 0.98 ? 'GEAR DOWN' : ac.gearPos < 0.02 ? 'GEAR UP' : 'GEAR TRANSIT', W * 0.5, H * 0.72, H * 0.04, ac.gearPos > 0.98 ? C.green : ac.gearPos < 0.02 ? C.white : C.red);
  const al = ac.alerts ?? { warnings: [], cautions: [] };
  [...al.warnings.map((a) => [a, C.red]), ...al.cautions.map((a) => [a, C.amber])].slice(0, 4).forEach(([a, c], i) => text(g, a, W * 0.5, H * (0.8 + i * 0.05), H * 0.04, c));
}
