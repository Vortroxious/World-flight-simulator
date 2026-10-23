// Control display unit (simplified FMS): INIT, PERF, PROG, DIR (direct-to) and APPR (synthetic ILS tuning)
// pages with line-select keys. Data comes from the simulation and from a provider supplied by the flight
// session (nearest airports, runways, direct-to and ILS tuning) so the CDU itself stays DOM- and app-free.
import { KT } from '../../core/units.js';
import { C, text } from './displays.js';

const ROWS = 14, COLS = 24;
export const CDU_PAGES = ['INIT', 'PERF', 'PROG', 'DIR', 'APPR'];

export class Cdu {
  constructor(ac, provider = {}) {
    this.ac = ac; this.p = provider;
    this.page = 'INIT'; this.scratch = ''; this.msg = ''; this.list = []; this.runways = []; this.rwyFor = null; this.listT = -1;
  }

  /** Speeds scaled from the reference figures with weight (V ∝ √W). */
  speeds() {
    const ac = this.ac, L = ac.cfg.limits, f = Math.sqrt(ac.mass / ac.cfg.mass.maxTakeoff);
    const r = (v) => Math.round((v ?? 0) * f);
    return { v1: r(L.Vr) - 3, vr: r(L.Vr), v2: r(L.V2), vref: Math.round((L.Vref ?? 0) * Math.sqrt(ac.mass / (ac.cfg.mass.maxLanding ?? ac.cfg.mass.maxTakeoff * 0.85))) };
  }

  key(k) {
    this.msg = '';
    if (CDU_PAGES.includes(k)) { this.page = k; this.listT = -1; return; }
    const m = /^([LR])(\d)$/.exec(k); if (!m) return;
    const side = m[1], n = +m[2], ac = this.ac, ap = ac.autopilot, sp = this.speeds();
    if (this.page === 'PERF') {
      if (side === 'R' && n === 2) { ap.sel.spd = sp.v2; this.msg = 'V2 SET ON SPD'; }
      if (side === 'R' && n === 4) { ap.sel.spd = sp.vref + 5; this.msg = 'VAPP SET ON SPD'; }
    } else if (this.page === 'DIR' && side === 'L' && this.list[n - 1]) {
      const a = this.list[n - 1]; this.p.directTo?.(a); this.msg = `DIR TO ${a.ident}`; this.rwyFor = null;
    } else if (this.page === 'APPR') {
      if (side === 'L' && this.runways[n - 1]) { const r = this.runways[n - 1]; this.p.tuneIls?.(this.rwyFor, r); this.msg = `ILS ${r.runway} TUNED`; }
      if (side === 'R' && n === 6) { ac.nav.setIls(null); this.msg = 'ILS OFF'; }
      if (side === 'R' && n === 5 && ac.autopilot.cfg.app) { ac.autopilot.setLateral('APP', ac); this.msg = ac.autopilot.latArm === 'LOC' ? 'APPR ARMED' : 'APPR OFF'; }
    } else if (this.page === 'PROG' && side === 'R' && n === 6) {
      ap.sel.alt = Math.round(ac.alt / 0.3048 / 100) * 100;
    }
  }

  refresh(time) {
    if (this.page === 'DIR' && (this.listT < 0 || time - this.listT > 5)) { this.list = this.p.nearest?.(5) ?? []; this.listT = time; }
    if (this.page === 'APPR') {
      const ident = this.ac.nav.dto?.ident ?? this.p.nearest?.(1)?.[0]?.ident;
      if (ident && ident !== this.rwyFor) { this.rwyFor = ident; this.runways = []; Promise.resolve(this.p.runways?.(ident)).then((r) => { if (this.rwyFor === ident) this.runways = (r ?? []).slice(0, 5); }); }
    }
  }

  lines() {
    const ac = this.ac, s = ac.snapshot(), sp = this.speeds(), out = Array.from({ length: ROWS }, () => []);
    const put = (row, str, col = C.white, align = 'left', small = false) => out[row].push({ str: String(str), col, align, small });
    put(0, this.page === 'DIR' ? 'DIR TO' : this.page === 'APPR' ? 'APPROACH / ILS' : `${this.page}`, C.white, 'center');
    const lbl = (n, l, r) => { if (l) put(n * 2 - 1, l, C.white, 'left', true); if (r) put(n * 2 - 1, r, C.white, 'right', true); };
    if (this.page === 'INIT') {
      lbl(1, 'AIRCRAFT', 'CLASS'); put(2, ac.cfg.name, C.green); put(2, ac.cfg.class.split(',')[0].slice(0, 12), C.green, 'right');
      lbl(2, 'GW (KG)', 'MTOW'); put(4, Math.round(ac.mass), C.green); put(4, ac.cfg.mass.maxTakeoff, C.white, 'right');
      lbl(3, 'FOB (KG)', 'PAYLOAD'); put(6, Math.round(ac.fuel.massKg), C.green); put(6, Math.round(ac.payload), C.green, 'right');
      lbl(4, 'CRZ ALT', 'CEILING'); put(8, `FL${Math.round((ac.autopilot.sel.alt ?? 0) / 100)}`, C.cyan); put(8, `FL${Math.round(ac.cfg.limits.serviceCeilingFt / 100)}`, C.white, 'right');
      lbl(5, 'POS', ''); put(10, `${s.lat >= 0 ? 'N' : 'S'}${Math.abs(s.lat).toFixed(3)} ${s.lon >= 0 ? 'E' : 'W'}${Math.abs(s.lon).toFixed(3)}`, C.green);
      put(12, 'DATA: CLASS-TYPICAL, NOT CERTIFIED', C.amber, 'left', true);
    } else if (this.page === 'PERF') {
      const fl = ac.cfg.aero.flaps[ac.cfg.limits.takeoffFlap ?? 1]?.label;
      lbl(1, 'V1', 'FLAPS T/O'); put(2, sp.v1, C.green); put(2, fl, C.green, 'right');
      lbl(2, 'VR', 'V2'); put(4, sp.vr, C.green); put(4, `${sp.v2} >`, C.cyan, 'right');
      lbl(3, 'VREF (FULL)', ''); put(6, sp.vref, C.green);
      lbl(4, 'VAPP', 'SET SPD'); put(8, sp.vref + 5, C.green); put(8, `${sp.vref + 5} >`, C.cyan, 'right');
      lbl(5, 'TRANS ALT', 'MMO'); put(10, '18000', C.white); put(10, ac.cfg.limits.Mmo ? `M${ac.cfg.limits.Mmo}` : '--', C.white, 'right');
    } else if (this.page === 'PROG') {
      const near = this.p.nearest?.(1)?.[0], dto = ac.nav.dtoInfo;
      lbl(1, 'GS / TAS', 'MACH'); put(2, `${Math.round(s.gs / KT)} / ${Math.round(s.tas / KT)}`, C.green); put(2, s.mach.toFixed(2), C.green, 'right');
      lbl(2, 'TO', 'DIST / ETE');
      if (dto) { put(4, dto.ident, C.magenta); put(4, `${(dto.dist / 1852).toFixed(0)} NM ${dto.eteSec ? Math.round(dto.eteSec / 60) + ' MIN' : ''}`, C.green, 'right'); }
      else put(4, '----', C.white);
      lbl(3, 'EFOB AT DEST', 'FUEL FLOW');
      const efob = dto?.eteSec ? ac.fuel.massKg - (ac.totalFuelFlow ?? 0) * dto.eteSec : null;
      put(6, efob != null ? `${Math.round(efob)} KG` : '----', efob != null && efob < 0 ? C.amber : C.green); put(6, `${Math.round((ac.totalFuelFlow ?? 0) * 3600)} KG/H`, C.green, 'right');
      lbl(4, 'NEAREST', ''); if (near) put(8, `${near.ident} ${(near.dist / 1852).toFixed(0)} NM`, C.cyan);
      lbl(5, 'ILS', ''); const i = ac.nav.ilsInfo; put(10, i ? `${i.ident} ${(i.dist / 1852).toFixed(1)} NM` : '----', C.magenta);
      put(12, 'ALT SEL = CURRENT >', C.cyan, 'right');
    } else if (this.page === 'DIR') {
      this.list.forEach((a, k) => { put(k * 2 + 1, a.name.slice(0, 22), C.white, 'left', true); put(k * 2 + 2, `< ${a.ident}`, C.cyan); put(k * 2 + 2, `${(a.dist / 1852).toFixed(0)} NM`, C.green, 'right'); });
      if (!this.list.length) put(2, 'NO AIRPORTS NEARBY', C.amber);
    } else if (this.page === 'APPR') {
      put(1, `RUNWAYS ${this.rwyFor ?? ''}`, C.white, 'left', true);
      this.runways.forEach((r, k) => { put(k * 2 + 2, `< ILS ${r.runway}`, C.cyan); put(k * 2 + 2, `${String(Math.round(r.course)).padStart(3, '0')}° ${Math.round(r.length)} M`, C.green, 'right'); });
      if (!this.runways.length) put(2, this.rwyFor ? 'LOADING...' : 'SELECT DIR TO FIRST', C.amber);
      put(10, ac.autopilot.latArm === 'LOC' || ac.autopilot.lat === 'LOC' ? 'APPR ARMED' : 'ARM APPR >', C.cyan, 'right');
      put(12, 'ILS OFF >', C.cyan, 'right');
    }
    if (this.msg) put(13, this.msg, C.amber);
    return out;
  }

  draw(g, W, H) {
    g.fillStyle = '#1d1f23'; g.fillRect(0, 0, W, H);
    const sx = W * 0.12, sy = H * 0.04, sw = W * 0.76, sh = H * 0.46;
    g.fillStyle = '#020403'; g.fillRect(sx, sy, sw, sh);
    if (this.ac.elec.busVolts > 18) {
      const rh = sh / ROWS, cw = sw / COLS;
      this.lines().forEach((row, r) => row.forEach((it) => text(g, it.str, it.align === 'left' ? sx + cw * 0.5 : it.align === 'right' ? sx + sw - cw * 0.5 : sx + sw / 2, sy + rh * (r + 0.55), rh * (it.small ? 0.62 : 0.82), it.col, it.align, it.small ? 'normal' : 'bold')));
    }
    // key caps (positions shared with the hit boxes, see keyLayout)
    for (const k of keyLayout()) {
      g.fillStyle = '#34373d'; g.fillRect(k.x * W, k.y * H, k.w * W, k.h * H);
      g.strokeStyle = '#555a62'; g.lineWidth = 2; g.strokeRect(k.x * W, k.y * H, k.w * W, k.h * H);
      text(g, k.label, (k.x + k.w / 2) * W, (k.y + k.h / 2) * H, k.h * H * 0.42, k.label === this.page ? C.cyan : '#e8e8e8');
    }
  }
}

/** Key rectangles in normalised CDU-face coordinates (x right, y down). */
export function keyLayout() {
  const keys = [];
  for (let i = 0; i < 6; i++) {
    const y = 0.04 + (0.46 / 14) * (i * 2 + 1.6);
    keys.push({ id: `L${i + 1}`, label: '—', x: 0.02, y, w: 0.08, h: 0.03 }, { id: `R${i + 1}`, label: '—', x: 0.9, y, w: 0.08, h: 0.03 });
  }
  ['INIT', 'PERF', 'PROG', 'DIR', 'APPR'].forEach((p, i) => keys.push({ id: p, label: p, x: 0.06 + i * 0.18, y: 0.56, w: 0.16, h: 0.08 }));
  return keys;
}
