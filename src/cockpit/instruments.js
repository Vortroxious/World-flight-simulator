// Canvas-rendered flight instruments. Every indication reads the simulated instrument model
// (pitot-static, gyros, engine, electrical) — nothing here is decorative.
import { KT } from '../core/units.js';
import { clamp } from '../core/math.js';

const TAU = Math.PI * 2;
const FONT = '"Helvetica Neue", Arial, sans-serif';

function bezel(g, S) {
  g.fillStyle = '#0b0b0c'; g.fillRect(0, 0, S, S);
  const r = S / 2;
  const grd = g.createRadialGradient(r, r, r * 0.86, r, r, r);
  grd.addColorStop(0, '#2b2b2e'); grd.addColorStop(1, '#0d0d0f');
  g.fillStyle = grd; g.beginPath(); g.arc(r, r, r, 0, TAU); g.fill();
  g.fillStyle = '#111214'; g.beginPath(); g.arc(r, r, r * 0.9, 0, TAU); g.fill();
}
function glass(g, S) {
  const r = S / 2;
  const grd = g.createLinearGradient(0, 0, S, S);
  grd.addColorStop(0, 'rgba(255,255,255,0.07)'); grd.addColorStop(0.5, 'rgba(255,255,255,0)'); grd.addColorStop(1, 'rgba(255,255,255,0.03)');
  g.fillStyle = grd; g.beginPath(); g.arc(r, r, r * 0.9, 0, TAU); g.fill();
}
function needle(g, cx, cy, ang, len, w, color = '#f2f2f2', tail = 0.15) {
  g.save(); g.translate(cx, cy); g.rotate(ang);
  g.fillStyle = color;
  g.beginPath(); g.moveTo(-w, len * tail); g.lineTo(-w * 0.6, -len * 0.85); g.lineTo(0, -len); g.lineTo(w * 0.6, -len * 0.85); g.lineTo(w, len * tail); g.closePath(); g.fill();
  g.restore();
  g.fillStyle = '#222'; g.beginPath(); g.arc(cx, cy, w * 1.6, 0, TAU); g.fill();
}
function ticks(g, cx, cy, r, a0, a1, n, len, w, color = '#eee') {
  g.strokeStyle = color; g.lineWidth = w;
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n - Math.PI / 2;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.lineTo(cx + Math.cos(a) * (r - len), cy + Math.sin(a) * (r - len)); g.stroke();
  }
}
function arc(g, cx, cy, r, a0, a1, w, color) {
  g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.arc(cx, cy, r, a0 - Math.PI / 2, a1 - Math.PI / 2); g.stroke();
}
function text(g, s, x, y, size, color = '#eee', align = 'center', weight = 'bold') {
  g.fillStyle = color; g.font = `${weight} ${size}px ${FONT}`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y);
}

// ---------- Airspeed indicator ----------
const asiAng = (kt) => (kt < 40 ? (kt / 40) * (TAU * 0.08) : TAU * 0.08 + ((Math.min(kt, 200) - 40) / 160) * TAU * 0.84);
export function drawASI(g, S, ac) {
  bezel(g, S);
  const c = S / 2, r = S * 0.42, L = ac.cfg.limits;
  arc(g, c, c, r - S * 0.02, asiAng(L.Vs0), asiAng(L.Vfe[1][1]), S * 0.02, '#f0f0f0');
  arc(g, c, c, r - S * 0.045, asiAng(L.Vs1), asiAng(L.Vno), S * 0.025, '#19b34a');
  arc(g, c, c, r - S * 0.045, asiAng(L.Vno), asiAng(L.Vne), S * 0.025, '#e6c21a');
  ticks(g, c, c, r, asiAng(L.Vne) - 0.004, asiAng(L.Vne) + 0.004, 1, S * 0.08, S * 0.012, '#e02020');
  for (let kt = 40; kt <= 200; kt += 10) {
    const a = asiAng(kt) - Math.PI / 2, big = kt % 20 === 0;
    g.strokeStyle = '#eee'; g.lineWidth = S * 0.008;
    g.beginPath(); g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r); g.lineTo(c + Math.cos(a) * (r - (big ? S * 0.07 : S * 0.04)), c + Math.sin(a) * (r - (big ? S * 0.07 : S * 0.04))); g.stroke();
    if (big) text(g, String(kt), c + Math.cos(a) * r * 0.7, c + Math.sin(a) * r * 0.7, S * 0.075);
  }
  text(g, 'AIRSPEED', c, c - S * 0.12, S * 0.05, '#bbb', 'center', 'normal');
  text(g, 'KNOTS', c, c + S * 0.14, S * 0.05, '#bbb', 'center', 'normal');
  needle(g, c, c, asiAng(ac.inst.ias / KT), r * 0.92, S * 0.018);
  glass(g, S);
}

// ---------- Attitude indicator ----------
export function drawAI(g, S, ac) {
  const c = S / 2, r = S * 0.42;
  g.fillStyle = '#0b0b0c'; g.fillRect(0, 0, S, S);
  g.save(); g.beginPath(); g.arc(c, c, r, 0, TAU); g.clip();
  const roll = (ac.inst.aiRoll * Math.PI) / 180, pitch = ac.inst.aiPitch;
  const ppd = S * 0.012; // px per degree
  g.translate(c, c); g.rotate(-roll);
  g.fillStyle = '#2f7fd0'; g.fillRect(-S, -S * 2 + pitch * ppd, S * 2, S * 2);
  g.fillStyle = '#7a4d26'; g.fillRect(-S, pitch * ppd, S * 2, S * 2);
  g.strokeStyle = '#fff'; g.lineWidth = S * 0.008;
  g.beginPath(); g.moveTo(-S, pitch * ppd); g.lineTo(S, pitch * ppd); g.stroke();
  for (let p = -30; p <= 30; p += 5) {
    if (!p) continue;
    const y = (pitch - p) * ppd, w = p % 10 === 0 ? S * 0.14 : S * 0.07;
    g.beginPath(); g.moveTo(-w / 2, y); g.lineTo(w / 2, y); g.stroke();
    if (p % 10 === 0) { text(g, String(Math.abs(p)), -w / 2 - S * 0.04, y, S * 0.045, '#fff'); }
  }
  // bank scale on the rotating card
  for (const b of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
    const a = (b * Math.PI) / 180 - Math.PI / 2;
    const l = Math.abs(b) % 30 === 0 ? S * 0.07 : S * 0.04;
    g.beginPath(); g.moveTo(Math.cos(a) * r, Math.sin(a) * r); g.lineTo(Math.cos(a) * (r - l), Math.sin(a) * (r - l)); g.stroke();
  }
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -r + S * 0.075); g.lineTo(-S * 0.025, -r + S * 0.025); g.lineTo(S * 0.025, -r + S * 0.025); g.fill();
  g.restore();
  // fixed aircraft symbol + bank pointer
  g.strokeStyle = '#ff9a1a'; g.lineWidth = S * 0.018; g.lineCap = 'round';
  g.beginPath(); g.moveTo(c - S * 0.2, c); g.lineTo(c - S * 0.07, c); g.lineTo(c - S * 0.035, c + S * 0.035); g.moveTo(c + S * 0.2, c); g.lineTo(c + S * 0.07, c); g.lineTo(c + S * 0.035, c + S * 0.035); g.stroke();
  g.fillStyle = '#ff9a1a'; g.beginPath(); g.arc(c, c, S * 0.014, 0, TAU); g.fill();
  g.beginPath(); g.moveTo(c, c - r + S * 0.03); g.lineTo(c - S * 0.025, c - r - S * 0.01); g.lineTo(c + S * 0.025, c - r - S * 0.01); g.fill();
  if (ac.inst.aiSpin < 0.5) text(g, 'GYRO', c, c + S * 0.28, S * 0.05, '#ff5a3c');
  const grd = g.createRadialGradient(c, c, r * 0.9, c, c, r * 1.12); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, '#151517');
  g.fillStyle = grd; g.beginPath(); g.arc(c, c, r * 1.12, 0, TAU); g.fill();
  glass(g, S);
}

// ---------- Altimeter ----------
export function drawALT(g, S, ac) {
  bezel(g, S);
  const c = S / 2, r = S * 0.42;
  ticks(g, c, c, r, 0, TAU, 50, S * 0.035, S * 0.006);
  ticks(g, c, c, r, 0, TAU, 10, S * 0.07, S * 0.012);
  for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU - Math.PI / 2; text(g, String(i), c + Math.cos(a) * r * 0.72, c + Math.sin(a) * r * 0.72, S * 0.09); }
  // Kollsman window (inHg)
  const inHg = ac.inst.kollsman / 3386.389;
  g.fillStyle = '#000'; g.fillRect(c + S * 0.12, c - S * 0.045, S * 0.2, S * 0.09);
  text(g, inHg.toFixed(2), c + S * 0.22, c, S * 0.06, '#fff');
  text(g, 'ALT', c, c - S * 0.16, S * 0.05, '#bbb', 'center', 'normal');
  const ft = ac.inst.altitude / 0.3048;
  needle(g, c, c, ((ft / 100000) % 1) * TAU, r * 0.95, S * 0.006, '#ddd', 0);
  needle(g, c, c, ((ft / 10000) % 1) * TAU, r * 0.55, S * 0.03);
  needle(g, c, c, ((ft / 1000) % 1) * TAU, r * 0.88, S * 0.017);
  glass(g, S);
}

// ---------- Turn coordinator ----------
export function drawTC(g, S, ac) {
  bezel(g, S);
  const c = S / 2;
  text(g, 'L', c - S * 0.3, c + S * 0.12, S * 0.07); text(g, 'R', c + S * 0.3, c + S * 0.12, S * 0.07);
  text(g, 'TURN COORDINATOR', c, c - S * 0.25, S * 0.045, '#bbb', 'center', 'normal');
  text(g, '2 MIN', c, c + S * 0.32, S * 0.045, '#bbb', 'center', 'normal');
  g.strokeStyle = '#eee'; g.lineWidth = S * 0.014;
  for (const s of [-1, 1]) for (const a of [0, 15]) { const ang = (a * Math.PI) / 180; g.beginPath(); g.moveTo(c + s * Math.cos(ang) * S * 0.33, c + Math.sin(ang) * S * 0.33); g.lineTo(c + s * Math.cos(ang) * S * 0.4, c + Math.sin(ang) * S * 0.4); g.stroke(); }
  // inclinometer
  g.fillStyle = '#e8e8e0'; g.beginPath(); g.ellipse(c, c + S * 0.22, S * 0.2, S * 0.045, 0, 0, TAU); g.fill();
  g.strokeStyle = '#111'; g.lineWidth = S * 0.008; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(c + s * S * 0.035, c + S * 0.18); g.lineTo(c + s * S * 0.035, c + S * 0.26); g.stroke(); }
  const bx = clamp(-ac.inst.slip, -1, 1) * S * 0.16;
  g.fillStyle = '#111'; g.beginPath(); g.arc(c + bx, c + S * 0.22, S * 0.03, 0, TAU); g.fill();
  // miniature aircraft
  const bank = (clamp(ac.inst.turnRate, -2, 2) * 15 * Math.PI) / 180;
  g.save(); g.translate(c, c); g.rotate(bank);
  g.fillStyle = '#f2f2f2'; g.fillRect(-S * 0.33, -S * 0.012, S * 0.66, S * 0.024); g.beginPath(); g.arc(0, 0, S * 0.045, 0, TAU); g.fill(); g.fillRect(-S * 0.01, -S * 0.1, S * 0.02, S * 0.08);
  g.restore();
  if (ac.inst.tcSpin < 0.5) { g.fillStyle = '#d02020'; g.fillRect(c - S * 0.08, c - S * 0.16, S * 0.16, S * 0.06); text(g, 'OFF', c, c - S * 0.13, S * 0.045, '#fff'); }
  glass(g, S);
}

// ---------- Heading indicator (DG) ----------
export function drawHI(g, S, ac) {
  bezel(g, S);
  const c = S / 2, r = S * 0.4;
  g.save(); g.translate(c, c); g.rotate((-ac.inst.dgHeading * Math.PI) / 180);
  for (let d = 0; d < 360; d += 5) {
    const a = (d * Math.PI) / 180 - Math.PI / 2, l = d % 10 === 0 ? S * 0.06 : S * 0.035;
    g.strokeStyle = '#eee'; g.lineWidth = S * 0.008;
    g.beginPath(); g.moveTo(Math.cos(a) * r, Math.sin(a) * r); g.lineTo(Math.cos(a) * (r - l), Math.sin(a) * (r - l)); g.stroke();
    if (d % 30 === 0) {
      g.save(); g.rotate((d * Math.PI) / 180);
      const lbl = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d] ?? String(d / 10);
      text(g, lbl, 0, -r * 0.72, S * 0.085, d % 90 === 0 ? '#fff' : '#ddd');
      g.restore();
    }
  }
  // heading bug
  g.rotate((ac.inst.dgBug * Math.PI) / 180);
  g.fillStyle = '#ff9a1a'; g.fillRect(-S * 0.035, -r - S * 0.005, S * 0.07, S * 0.035);
  g.restore();
  g.strokeStyle = '#ff9a1a'; g.lineWidth = S * 0.012;
  g.beginPath(); g.moveTo(c, c - S * 0.12); g.lineTo(c, c + S * 0.1); g.moveTo(c - S * 0.1, c); g.lineTo(c + S * 0.1, c); g.moveTo(c - S * 0.04, c + S * 0.08); g.lineTo(c + S * 0.04, c + S * 0.08); g.stroke();
  g.fillStyle = '#ff9a1a'; g.beginPath(); g.moveTo(c, c - r + S * 0.01); g.lineTo(c - S * 0.025, c - r - S * 0.035); g.lineTo(c + S * 0.025, c - r - S * 0.035); g.fill();
  glass(g, S);
}

// ---------- Vertical speed indicator ----------
const vsiAng = (fpm) => (clamp(fpm, -2000, 2000) / 2000) * (TAU * 0.47) - TAU / 4;
export function drawVSI(g, S, ac) {
  bezel(g, S);
  const c = S / 2, r = S * 0.42;
  for (let f = -2000; f <= 2000; f += 100) {
    const a = vsiAng(f) - Math.PI / 2, big = f % 500 === 0;
    g.strokeStyle = '#eee'; g.lineWidth = S * (big ? 0.012 : 0.006);
    g.beginPath(); g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r); g.lineTo(c + Math.cos(a) * (r - (big ? S * 0.07 : S * 0.035)), c + Math.sin(a) * (r - (big ? S * 0.07 : S * 0.035))); g.stroke();
    if (f % 500 === 0 && f !== 0) text(g, String(Math.abs(f) / 100), c + Math.cos(a) * r * 0.7, c + Math.sin(a) * r * 0.7, S * 0.075);
  }
  text(g, '0', c - r * 0.72, c, S * 0.08);
  text(g, 'UP', c - S * 0.12, c - S * 0.16, S * 0.045, '#bbb', 'center', 'normal');
  text(g, 'DN', c - S * 0.12, c + S * 0.16, S * 0.045, '#bbb', 'center', 'normal');
  text(g, 'VERTICAL SPEED', c + S * 0.05, c + S * 0.06, S * 0.04, '#bbb', 'center', 'normal');
  text(g, '100 FT/MIN', c + S * 0.05, c + S * 0.11, S * 0.035, '#bbb', 'center', 'normal');
  needle(g, c, c, vsiAng(ac.inst.vsi / 0.3048 * 60), r * 0.92, S * 0.018);
  glass(g, S);
}

// ---------- Tachometer ----------
const tachAng = (rpm) => (clamp(rpm, 0, 3500) / 3500) * TAU * 0.75 - TAU * 0.375;
export function drawTach(g, S, ac) {
  bezel(g, S);
  const c = S / 2, r = S * 0.42;
  arc(g, c, c, r - S * 0.03, tachAng(2100), tachAng(2700), S * 0.03, '#19b34a');
  ticks(g, c, c, r, tachAng(2700) - 0.005, tachAng(2700) + 0.005, 1, S * 0.08, S * 0.014, '#e02020');
  for (let rpm = 0; rpm <= 3500; rpm += 100) {
    const a = tachAng(rpm) - Math.PI / 2, big = rpm % 500 === 0;
    g.strokeStyle = '#eee'; g.lineWidth = S * (big ? 0.012 : 0.006);
    g.beginPath(); g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r); g.lineTo(c + Math.cos(a) * (r - (big ? S * 0.07 : S * 0.035)), c + Math.sin(a) * (r - (big ? S * 0.07 : S * 0.035))); g.stroke();
    if (big) text(g, String(rpm / 100), c + Math.cos(a) * r * 0.7, c + Math.sin(a) * r * 0.7, S * 0.07);
  }
  text(g, 'RPM', c, c - S * 0.14, S * 0.05, '#bbb', 'center', 'normal');
  text(g, 'x100', c, c - S * 0.08, S * 0.04, '#bbb', 'center', 'normal');
  g.fillStyle = '#000'; g.fillRect(c - S * 0.12, c + S * 0.18, S * 0.24, S * 0.07);
  text(g, (ac.hobbs || 0).toFixed(1).padStart(6, '0'), c, c + S * 0.215, S * 0.05, '#eee', 'center', 'normal');
  needle(g, c, c, tachAng(ac.engine.rpm), r * 0.92, S * 0.018);
  glass(g, S);
}

// ---------- Engine cluster (vertical strip of bar gauges) ----------
export function drawEngineCluster(g, W, H, ac) {
  g.fillStyle = '#0d0d0f'; g.fillRect(0, 0, W, H);
  const e = ac.engine, el = ac.elec, f = ac.fuel;
  const powered = el.busVolts > 18;
  const items = [
    ['FUEL L', 'GAL', powered ? f.tanks[0].qty / 3.785 : 0, 0, 28, [[0, 2, '#e02020'], [2, 28, '#19b34a']]],
    ['FUEL R', 'GAL', powered ? f.tanks[1].qty / 3.785 : 0, 0, 28, [[0, 2, '#e02020'], [2, 28, '#19b34a']]],
    ['EGT', '°F', powered ? (e.egt - 273.15) * 1.8 + 32 : 0, 900, 1650, [[900, 1650, '#3a3a3a']]],
    ['FUEL FLOW', 'GPH', powered ? (e.fuelFlow / 0.72) * 3600 / 3.785 : 0, 0, 20, [[0, 20, '#19b34a']]],
    ['OIL TEMP', '°F', powered ? (e.oilTemp - 273.15) * 1.8 + 32 : 0, 75, 250, [[100, 245, '#19b34a'], [245, 250, '#e02020']]],
    ['OIL PRES', 'PSI', powered ? e.oilPress : 0, 0, 115, [[0, 20, '#e02020'], [50, 90, '#19b34a'], [100, 115, '#e02020']]],
    ['VAC', 'INHG', ac.inst.vacuum, 3, 7, [[4.5, 5.5, '#19b34a']]],
    ['AMPS', '', el.batteryAmps, -60, 60, [[-60, 0, '#7a2a2a'], [0, 60, '#2a6a2a']]],
  ];
  const rowH = H / items.length;
  items.forEach(([label, unit, v, lo, hi, bands], i) => {
    const y = i * rowH;
    text(g, label, W * 0.05, y + rowH * 0.22, rowH * 0.2, '#ccc', 'left', 'normal');
    text(g, unit, W * 0.95, y + rowH * 0.22, rowH * 0.17, '#999', 'right', 'normal');
    const bx = W * 0.08, bw = W * 0.84, by = y + rowH * 0.45, bh = rowH * 0.22;
    for (const [a, b, col] of bands) { g.fillStyle = col; g.fillRect(bx + ((a - lo) / (hi - lo)) * bw, by, ((b - a) / (hi - lo)) * bw, bh); }
    g.strokeStyle = '#666'; g.lineWidth = 1; g.strokeRect(bx, by, bw, bh);
    const x = bx + clamp((v - lo) / (hi - lo), 0, 1) * bw;
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x, by - 2); g.lineTo(x - rowH * 0.08, by - rowH * 0.14); g.lineTo(x + rowH * 0.08, by - rowH * 0.14); g.fill();
    g.fillRect(x - 1.5, by, 3, bh + 3);
  });
}

// ---------- Annunciator panel ----------
export function drawAnnunciator(g, W, H, ac, test) {
  g.fillStyle = '#050505'; g.fillRect(0, 0, W, H);
  const w = ac.warnings || {};
  const powered = ac.elec.busVolts > 18;
  const lights = [['FUEL L', w.lowFuelL, '#f2b51c'], ['OIL PRESS', w.oilPress, '#e02a20'], ['LOW VAC', w.vacuum, '#f2b51c'], ['VOLTS', w.lowVolts, '#e02a20'], ['FUEL R', w.lowFuelR, '#f2b51c'], ['STALL', w.stall, '#e02a20']];
  const n = lights.length, cw = W / n;
  lights.forEach(([label, on, col], i) => {
    const lit = powered && (on || test);
    g.fillStyle = lit ? col : '#1b1b1b';
    g.fillRect(i * cw + 3, 3, cw - 6, H - 6);
    text(g, label, i * cw + cw / 2, H / 2, H * 0.34, lit ? '#111' : '#444');
  });
}

// ---------- Magnetic compass (card strip) ----------
export function drawCompass(g, W, H, ac) {
  g.fillStyle = '#111'; g.fillRect(0, 0, W, H);
  const hdg = ac.inst.compass, ppd = W / 60;
  for (let d = Math.floor(hdg - 35); d <= hdg + 35; d++) {
    const dd = ((d % 360) + 360) % 360, x = W / 2 + (d - hdg) * ppd;
    if (dd % 5 === 0) { g.fillStyle = '#eee'; g.fillRect(x - 1, H * 0.62, 2, dd % 10 === 0 ? H * 0.3 : H * 0.18); }
    if (dd % 30 === 0) text(g, { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[dd] ?? String(dd / 10), x, H * 0.35, H * 0.4, '#f0f0f0');
  }
  g.fillStyle = '#e02020'; g.fillRect(W / 2 - 1.5, 0, 3, H);
}

// ---------- GPS / COM unit ----------
export function drawGPS(g, W, H, ac, nav) {
  g.fillStyle = '#1c1d20'; g.fillRect(0, 0, W, H);
  const on = ac.elec.avionicsPowered;
  g.fillStyle = on ? '#071018' : '#050505'; g.fillRect(W * 0.04, H * 0.08, W * 0.92, H * 0.84);
  if (!on) return;
  const s = ac.snapshot();
  const av = ac.avionics;
  const col = '#5cf08a', dim = '#2ea85a', mag = '#f0c040';
  text(g, `COM ${av.com1.toFixed(3)}`, W * 0.07, H * 0.17, H * 0.1, col, 'left');
  text(g, `STBY ${av.com1Stby.toFixed(3)}`, W * 0.93, H * 0.17, H * 0.08, dim, 'right', 'normal');
  text(g, `GS ${(s.gs / KT).toFixed(0).padStart(3)} KT`, W * 0.07, H * 0.33, H * 0.1, col, 'left');
  text(g, `TRK ${String(Math.round((s.track - ac.magvar + 360) % 360)).padStart(3, '0')}°`, W * 0.93, H * 0.33, H * 0.1, col, 'right');
  const latS = `${s.lat >= 0 ? 'N' : 'S'}${Math.abs(s.lat).toFixed(4)}`, lonS = `${s.lon >= 0 ? 'E' : 'W'}${Math.abs(s.lon).toFixed(4)}`;
  text(g, `${latS} ${lonS}`, W * 0.07, H * 0.48, H * 0.08, dim, 'left', 'normal');
  if (nav && nav.target) {
    const t = nav.target;
    text(g, `${nav.mode === 'DTO' ? 'D→' : 'NRST'} ${t.ident}`, W * 0.07, H * 0.63, H * 0.1, mag, 'left');
    text(g, `BRG ${String(Math.round(t.brgMag)).padStart(3, '0')}°  ${t.distNm.toFixed(1)} NM`, W * 0.07, H * 0.78, H * 0.09, mag, 'left');
    text(g, t.eteMin != null ? `ETE ${Math.floor(t.eteMin)}:${String(Math.round((t.eteMin % 1) * 60)).padStart(2, '0')}` : 'ETE --:--', W * 0.93, H * 0.78, H * 0.08, mag, 'right', 'normal');
  }
  text(g, `XPDR ${av.xpdrCode} ${av.xpdrMode}`, W * 0.93, H * 0.48, H * 0.08, av.xpdrMode === 'ALT' ? col : dim, 'right', 'normal');
}
