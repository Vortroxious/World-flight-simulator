// Parametric exterior models for the Phase 3 fleet, generated in code from each aircraft's configuration
// (geometry, layout, engines, gear) — original geometry, no third-party assets. Families:
//   airliner (narrowbody / widebody, winglet variants), twin-turboprop (T-tail), cargo-4prop (high wing,
//   upswept tail with ramp), fighter (blended body, cropped delta, canopy, afterburner).
// Model space matches the GA model: x = right, y = up, z = aft, origin at the CG. Part names match the damage
// components (fuselage, leftWing, rightWing, hStab, vStab, noseGear, leftMainGear, rightMainGear, engineN,
// propellerN) so detached components can be turned into debris.
import * as THREE from 'three';

const D2R = Math.PI / 180;
/** Body (x fwd, y right, z down) -> model (x right, y up, z aft). */
const B = (x, y, z) => new THREE.Vector3(y, -z, -x);

function paint(geo, color) {
  const n = geo.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(color, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
const box = (w, h, d, color) => paint(new THREE.BoxGeometry(w, h, d), color);
const cyl = (r0, r1, h, color, seg = 12) => paint(new THREE.CylinderGeometry(r0, r1, h, seg), color);

/** Surface of revolution along model -z (forward) from a body-x profile [[x, r], ...] (x descending = aft). */
function lathe(profile, color, seg = 20) {
  const pts = profile.map(([x, r]) => new THREE.Vector2(Math.max(r, 0.001), x));
  const g = new THREE.LatheGeometry(pts, seg);
  g.rotateX(-Math.PI / 2); // lathe axis y -> model -z (body +x)
  return paint(g, color);
}

/**
 * Loft through cross-sections {x, hw, top, bot, n} (body x, model-up half extents); ring superellipse
 * exponent n (2 = ellipse). colorAt(x, y, side, i) returns per-vertex colour.
 */
function loft(sections, colorAt, ring = 32) {
  const pos = [], col = [], idx = [];
  sections.forEach((s, i) => {
    for (let k = 0; k <= ring; k++) {
      const a = (k / ring) * Math.PI * 2, sn = Math.sin(a), cs = Math.cos(a), pw = s.n ?? 2;
      const sx = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / pw), sy = Math.sign(cs) * Math.pow(Math.abs(cs), 2 / pw);
      const mid = (s.top + s.bot) / 2, hh = (s.top - s.bot) / 2;
      const px = sx * s.hw, py = mid + sy * hh;
      pos.push(px, py, -s.x);
      col.push(...colorAt(s.x, py, s.hw > 0 ? px / s.hw : 0, i, s));
    }
  });
  const W = ring + 1;
  for (let i = 0; i < sections.length - 1; i++) for (let k = 0; k < ring; k++) {
    const a = i * W + k, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Cross-section at body x, interpolated from a loft's section list (ordered nose -> tail). */
function sectionAt(secs, x) {
  for (let i = 1; i < secs.length; i++) {
    if (secs[i].x <= x) {
      const a = secs[i - 1], b = secs[i], t = (a.x - x) / Math.max(a.x - b.x, 1e-6);
      return { x, hw: a.hw + (b.hw - a.hw) * t, top: a.top + (b.top - a.top) * t, bot: a.bot + (b.bot - a.bot) * t, n: a.n };
    }
  }
  return secs[secs.length - 1];
}
/** Point on a section's superellipse at ring angle a (0 = top, +pi/2 = right side), pushed out by `off`. */
function ringAt(s, a, off = 0) {
  const sn = Math.sin(a), cs = Math.cos(a), pw = s.n ?? 2;
  const sx = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / pw), sy = Math.sign(cs) * Math.pow(Math.abs(cs), 2 / pw);
  const mid = (s.top + s.bot) / 2, hh = (s.top - s.bot) / 2;
  return [sx * (s.hw + off), mid + sy * (hh + off)];
}
/** Thin coloured patch on a lofted surface over body x in [x0, x1] and ring angle a0(x)..a1(x) (both sides). */
function shellPatch(secs, x0, x1, a0, a1, color, off = 0.012) {
  const U = 24, V = 10, pos = [], idx = [];
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= U; i++) {
      const x = x0 + (x1 - x0) * (i / U), s = sectionAt(secs, x), A0 = a0(x), A1 = a1(x);
      for (let j = 0; j <= V; j++) { const [px, py] = ringAt(s, A0 + (A1 - A0) * (j / V), off); pos.push(side * px, py, -x); }
    }
    for (let i = 0; i < U; i++) for (let j = 0; j < V; j++) {
      const a = base + i * (V + 1) + j, b = a + 1, c = a + V + 1, d = c + 1;
      if (side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return paint(g, color);
}

/**
 * Lifting surface through stations [{le: [x, y, z] body, chord}] with chord running aft (-x body). `up` is the
 * body-space thickness direction of the upper surface; tc = thickness/chord; sym = symmetric section.
 */
function surface(stations, tc, color, { up = [0, 0, -1], sym = false } = {}) {
  const N = 10, foil = [];
  for (let i = 0; i <= N; i++) { const t = i / N, u = 0.5 - 0.5 * Math.cos(Math.PI * t); foil.push([u, tc * 2.6 * Math.sqrt(u) * (1 - u)]); }
  const lowerScale = sym ? 1 : 0.55;
  const pos = [], idx = [];
  const ring = [];
  for (const [u, h] of foil) ring.push([u, h]);
  for (let i = N - 1; i > 0; i--) ring.push([foil[i][0], -foil[i][1] * lowerScale]);
  const M = ring.length;
  for (const st of stations) {
    for (const [u, h] of ring) {
      const x = st.le[0] - u * st.chord, t = h * st.chord;
      const p = B(x + up[0] * t, st.le[1] + up[1] * t, st.le[2] + up[2] * t);
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let s = 0; s < stations.length - 1; s++) for (let i = 0; i < M; i++) {
    const a = s * M + i, b = s * M + ((i + 1) % M), c = (s + 1) * M + i, d = (s + 1) * M + ((i + 1) % M);
    idx.push(a, b, c, b, d, c);
  }
  const last = (stations.length - 1) * M;
  for (let i = 1; i < M - 1; i++) { idx.push(last, last + i + 1, last + i); idx.push(0, i, i + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return paint(g, color);
}

/** Point on a station list at fraction f of the span (linear between stations by spanwise distance). */
function stationAt(st, f) {
  const span = (p) => Math.hypot(p.le[1] - st[0].le[1], p.le[2] - st[0].le[2]);
  const total = span(st[st.length - 1]), d = f * total;
  for (let i = 1; i < st.length; i++) {
    const s1 = span(st[i]);
    if (d <= s1 + 1e-6 || i === st.length - 1) {
      const s0 = span(st[i - 1]), t = s1 > s0 ? (d - s0) / (s1 - s0) : 0;
      const a = st[i - 1], b = st[i];
      return { le: a.le.map((v, k) => v + (b.le[k] - v) * t), chord: a.chord + (b.chord - a.chord) * t };
    }
  }
  return st[st.length - 1];
}

const COL = {
  glass: [0.05, 0.07, 0.09], grey: [0.62, 0.64, 0.66], dark: [0.12, 0.12, 0.13], tyre: [0.06, 0.06, 0.06],
  metal: [0.7, 0.71, 0.73], belly: [0.72, 0.74, 0.76], fighter: [0.47, 0.5, 0.53], fighterDark: [0.36, 0.39, 0.42],
  cargo: [0.36, 0.42, 0.33], cargoDark: [0.27, 0.31, 0.25], kingair: [0.95, 0.95, 0.94], stripe: [0.1, 0.2, 0.45], gold: [0.72, 0.55, 0.2],
};

export class ParametricModel {
  constructor(cfg) {
    this.cfg = cfg;
    this.root = new THREE.Group(); this.root.name = 'aircraft';
    this.exterior = new THREE.Group(); this.root.add(this.exterior);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.2 });
    this.matDS = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide });
    this.parts = {}; this.surfaces = []; this.gearLegs = []; this.props = []; this.reversers = []; this.flames = [];
    this.anchors = [];
    const t = cfg.model?.type;
    this.family = t;
    this.livery = cfg.model?.livery ?? (t === 'cargo-4prop' ? COL.cargo : t === 'fighter' ? COL.fighter : COL.kingair);
    this.tail = cfg.model?.tail ?? (t === 'cargo-4prop' ? COL.cargoDark : t === 'fighter' ? COL.fighterDark : COL.stripe);
    this.build();
  }

  part(name) { if (this.parts[name]) return this.parts[name]; const g = new THREE.Group(); g.name = name; this.exterior.add(g); this.parts[name] = g; return g; }
  mesh(geo, parent, mat = this.mat) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }

  build() {
    const c = this.cfg, t = this.family;
    if (t === 'fighter') this.buildFighter(); else this.buildTransport();
    this.buildGear();
    this.buildLights();
    // Initial pose
    this.update({ ...mockState(c) }, 0, 0, false);
  }

  // ---------------------------------------------------------------- transports
  buildTransport() {
    const c = this.cfg, g = c.geometry, L = c.layout ?? {}, t = this.family;
    const R = g.fuselageDia / 2, zc = ((L.bellyZ ?? R) + (L.roofZ ?? -R)) / 2, yc = -zc;
    const xNose = L.noseTipX, xTail = L.noseTipX - g.length;
    const cargo = t === 'cargo-4prop', turboprop = t === 'twin-turboprop', wide = c.model?.variant === 'widebody';
    const lNose = R * (cargo ? 2.2 : turboprop ? 3.4 : wide ? 3.0 : 3.3), lTail = R * (cargo ? 5.0 : turboprop ? 6.5 : 5.6);
    const n = cargo ? 2.5 : turboprop ? 2.15 : 2.0;
    // Crown line of the nose: full height aft of the flight deck, windshield top ~0.3 m above the pilots' eyes,
    // sill ~0.25 m below them, then a steep drop to the radome (so the nose stays below the glareshield view).
    const ep = c.geometry.eyePoint, eyeX = ep?.[0] ?? xNose - lNose * 0.6, eyeY = ep ? -ep[2] : yc + R * 0.4;
    const ctrl = [[xNose, yc + R * (cargo ? 0.05 : -0.15)], [eyeX + (cargo ? 1.5 : 1.25), eyeY - (cargo ? 0.35 : 0.25)], [eyeX + 0.45, eyeY + 0.32], [eyeX - 1.2, yc + R]];
    const crown = (x) => {
      if (x >= ctrl[0][0]) return ctrl[0][1];
      for (let i = 1; i < ctrl.length; i++) if (x >= ctrl[i][0]) { const [x0, y0] = ctrl[i - 1], [x1, y1] = ctrl[i], t = (x0 - x) / (x0 - x1); const u = t * t * (3 - 2 * t); return y0 + (y1 - y0) * u; }
      return yc + R;
    };
    const secs = [];
    const step = Math.max(0.25, g.length / 120);
    for (let x = xNose; x >= xTail - 1e-6; x -= xNose - x < lNose * 1.05 ? Math.min(step, 0.1 + R * 0.03) : step) {
      const fromNose = xNose - x, toTail = x - xTail;
      let hw = R, top = yc + R, bot = yc - R;
      if (fromNose < lNose) {
        const s = fromNose / lNose, e = Math.sqrt(1 - (1 - s) ** 2.2);
        hw = R * Math.max(e, 0.04); const droop = (cargo ? 0.1 : 0.28) * R * (1 - s) ** 1.5;
        top = Math.min(yc - droop + R * Math.max(e, 0.04), crown(x)); bot = yc - droop - R * Math.max(e, 0.04);
        if (top < bot + 0.05) top = bot + 0.05;
      } else if (toTail < lTail) {
        const s = 1 - toTail / lTail;
        hw = R * (1 - 0.9 * s ** 1.4);
        top = yc + R - R * (cargo ? 0.25 : 0.62) * s ** 2.2;
        bot = yc - R + R * (cargo ? 1.6 : 1.45) * s ** (cargo ? 0.9 : 1.25);
        if (bot > top - 0.08) bot = top - 0.08;
      }
      secs.push({ x, hw, top, bot, n });
    }
    const liv = this.livery, tail = this.tail;
    const cabinStart = xNose - lNose * 1.25, cabinEnd = xTail + lTail * 0.85;
    const winPitch = turboprop ? 0.9 : wide ? 0.62 : 0.53;
    const colorAt = (x, y, side, i) => {
      const yy = y - yc, fromNose = xNose - x;
      if (cargo) return yy < -R * 0.55 ? COL.cargoDark : liv;
      if (yy < -R * 0.45) return COL.belly;
      if (x < cabinStart && yy > -R * 0.12 && yy < 0 && Math.abs(side) > 0.6) return tail; // cheatline
      return liv;
    };
    this.mesh(loft(secs, colorAt, 36), this.part('fuselage'));
    // Flight-deck windows: front panes wrap over the nose, side panes further aft (posts left in livery colour).
    // Windshield anchored to the pilots' eye point: front panes ahead of the eye, side windows abeam it.
    const ex = c.geometry.eyePoint?.[0] ?? xNose - lNose * 0.7;
    const xw0 = Math.min(xNose - 0.4, ex + (cargo ? 1.3 : turboprop ? 1.0 : 1.15)), xFront = ex + (cargo ? 0.55 : 0.45), xw1 = ex - (cargo ? 0.9 : turboprop ? 0.6 : 0.8);
    const aTop = (x) => (x > xFront ? 0.1 : cargo ? 0.35 : 0.78), aBot = (x) => (x > xFront ? (cargo ? 1.7 : 1.62) : cargo ? 1.45 : 1.38);
    this.windshield = [
      this.mesh(shellPatch(secs, xw0, xFront - 0.02, aTop, aBot, COL.glass), this.parts.fuselage, this.matDS),
      this.mesh(shellPatch(secs, xFront + (xw1 - xFront) * 0.08, xw1, aTop, aBot, COL.glass), this.parts.fuselage, this.matDS),
    ];
    this.deck = { secs, xw0, xw1, xFront, aTop, aBot, xNose, R, yc };
    // Cabin windows: instanced dark panes on the fuselage sides (one row; widebodies get larger panes).
    if (!cargo) {
      const wy = R * (turboprop ? 0.2 : 0.24), wh = turboprop ? 0.42 : wide ? 0.42 : 0.34, ww = turboprop ? 0.38 : wide ? 0.3 : 0.24;
      const xs = []; for (let x = cabinStart; x > cabinEnd; x -= winPitch) xs.push(x);
      const win = new THREE.InstancedMesh(paint(new THREE.BoxGeometry(0.02, wh, ww), COL.glass), this.mat, xs.length * 2);
      const m4 = new THREE.Matrix4(); let k = 0;
      for (const x of xs) {
        const sec = secs.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
        const hh = (sec.top - sec.bot) / 2, mid = (sec.top + sec.bot) / 2, yy = Math.min(0.95, Math.abs((yc + wy - mid) / hh));
        const px = sec.hw * Math.sqrt(1 - yy * yy) + 0.005;
        for (const sd of [-1, 1]) { m4.makeTranslation(sd * px, yc + wy, -x); win.setMatrixAt(k++, m4); }
      }
      win.count = k; this.parts.fuselage.add(win);
    }
    if (cargo) this.buildRampAndSponsons(R, yc, xTail, lTail);
    this.buildWings(R, yc);
    this.buildTail(R, yc, xTail);
    c.engines.forEach((e, i) => (e.type === 'turbofan' ? this.buildTurbofan(e, i) : this.buildTurboprop(e, i)));
  }

  buildRampAndSponsons(R, yc, xTail, lTail) {
    const L = this.cfg.layout, fus = this.parts.fuselage;
    // Main-gear sponsons along the lower fuselage sides.
    for (const s of [-1, 1]) {
      const sp = this.mesh(new THREE.CapsuleGeometry(0.75, 5.2, 6, 12), fus);
      paint(sp.geometry, COL.cargoDark);
      sp.rotation.x = Math.PI / 2; sp.position.copy(B(L.mainX, s * (R + 0.15), -yc + R * 0.55));
      sp.scale.set(1, 1, 0.9);
    }
    // Rear ramp outline (darker panel under the upswept tail).
    const ramp = this.mesh(box(R * 1.5, 0.05, lTail * 0.55, COL.cargoDark), fus);
    ramp.position.copy(B(xTail + lTail * 0.62, 0, -yc + R * 0.55)); ramp.rotation.x = -0.32;
    // Nose radome
    const rad = this.mesh(new THREE.SphereGeometry(R * 0.55, 16, 10), fus); paint(rad.geometry, COL.dark);
    rad.position.copy(B(L.noseTipX - R * 0.5, 0, -yc + 0.1)); rad.scale.set(1, 0.9, 1.1);
  }

  wingStations(R, yc) {
    const c = this.cfg, g = c.geometry, L = c.layout, t = this.family;
    const lam = t === 'fighter' ? 0.2 : t === 'twin-turboprop' ? 0.45 : t === 'cargo-4prop' ? 0.5 : 0.24;
    const b2 = g.span / 2, yr = t === 'cargo-4prop' ? 0 : R * 0.6;
    const cr = (2 * g.wingArea) / (g.span * (1 + lam)), ct = cr * lam;
    const sweepLE = ((g.sweepDeg ?? 0) + (g.sweepDeg ? 4 : 1)) * D2R, dih = (g.dihedralDeg ?? 0) * D2R;
    const ymac = (b2 / 3) * (1 + 2 * lam) / (1 + lam), mac = (2 / 3) * cr * (1 + lam + lam * lam) / (1 + lam);
    const xr = (ymac - yr) * Math.tan(sweepLE) + 0.25 * mac + (t === 'cargo-4prop' ? 0.3 : 0);
    const z = (y) => L.wingZ - (y - yr) * Math.tan(dih);
    const st = (y, chord) => ({ le: [xr - (y - yr) * Math.tan(sweepLE), y, z(y)], chord });
    if (t === 'airliner') {
      // Kinked trailing edge (Yehudi) at ~35 % semispan.
      const yk = yr + (b2 - yr) * 0.33, ck = cr - (yk - yr) * (Math.tan(sweepLE) - Math.tan(sweepLE * 0.15));
      return [st(yr, cr * 1.12), st(yk, Math.max(ck * 0.95, ct * 1.6)), st(b2, ct)];
    }
    return [st(yr, cr), st(b2, ct)];
  }

  buildWings(R, yc) {
    const c = this.cfg, t = this.family, g = c.geometry;
    const st = this.wingStations(R, yc);
    const tc = t === 'airliner' ? 0.11 : 0.15;
    this.wingSt = st;
    for (const side of [-1, 1]) {
      const name = side < 0 ? 'leftWing' : 'rightWing', wing = this.part(name);
      const s2 = st.map((s) => ({ le: [s.le[0], s.le[1] * side, s.le[2]], chord: s.chord }));
      this.mesh(surface(s2, tc, this.family === 'cargo-4prop' ? this.livery : COL.grey.map((v, i) => (v + this.livery[i]) / 2), {}), wing, this.matDS);
      // Root fairing under the fuselage for low wings
      // Winglets
      const tip = s2[s2.length - 1], wl = c.model?.winglet;
      if (wl === 'sharklet' || wl === 'blended' || wl === 'curved') {
        const h = g.span * (wl === 'curved' ? 0.055 : 0.07);
        const wst = [
          { le: tip.le, chord: tip.chord * 0.95 },
          { le: [tip.le[0] - tip.chord * 0.6, tip.le[1] + side * h * (wl === 'blended' ? 0.18 : 0.08), tip.le[2] - h], chord: tip.chord * 0.32 },
        ];
        this.mesh(surface(wst, 0.08, this.tail, { up: [0, side, 0], sym: true }), wing, this.matDS);
      } else if (wl === 'raked') {
        const rk = [{ le: tip.le, chord: tip.chord }, { le: [tip.le[0] - tip.chord * 1.1, tip.le[1] + side * g.span * 0.035, tip.le[2] - 0.2], chord: tip.chord * 0.25 }];
        this.mesh(surface(rk, 0.08, COL.grey), wing, this.matDS);
      }
      // Movable surfaces along the trailing edge (hinge lines from model-left to model-right).
      const te = (f, frac = 1) => { const s = stationAt(s2, f); return [s.le[0] - s.chord * frac, s.le[1], s.le[2]]; };
      const hinged = (kind, f0, f1, chordFrac, opts = {}) => {
        const a = stationAt(s2, f0), b = stationAt(s2, f1);
        const pa = te(f0, 1 - chordFrac), pb = te(f1, 1 - chordFrac);
        const [p0, p1] = side < 0 ? [pb, pa] : [pa, pb];
        const A = B(...p0), Bv = B(...p1), len = A.distanceTo(Bv);
        const grp = new THREE.Group(); grp.position.copy(A);
        grp.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), Bv.clone().sub(A).normalize());
        const hinge = new THREE.Group(); grp.add(hinge);
        const ch = ((a.chord + b.chord) / 2) * chordFrac;
        const m = this.mesh(box(len, Math.max(0.04, ch * 0.08), ch, opts.color ?? COL.grey), hinge, this.matDS);
        m.position.set(len / 2, opts.top ? ch * 0.04 : 0, opts.lead ? -ch / 2 : ch / 2);
        wing.add(grp);
        this.surfaces.push({ kind, side, hinge, grp, base: grp.position.clone(), chord: ch });
      };
      const tp = this.family;
      if (tp === 'airliner') {
        hinged('flap', 0.06, 0.33, 0.28); hinged('flap', 0.36, 0.74, 0.26);
        hinged('aileron', 0.76, 0.95, 0.22);
        for (const [f0, f1] of [[0.38, 0.5], [0.5, 0.62], [0.62, 0.74]]) {
          // spoiler panels sit ahead of the flaps on the upper surface, hinged at their leading edge
          const a = stationAt(s2, f0), b = stationAt(s2, f1);
          const pa = [a.le[0] - a.chord * 0.6, a.le[1], a.le[2] - a.chord * 0.05], pb = [b.le[0] - b.chord * 0.6, b.le[1], b.le[2] - b.chord * 0.05];
          const [p0, p1] = side < 0 ? [pb, pa] : [pa, pb];
          const A = B(...p0), Bv = B(...p1), len = A.distanceTo(Bv), ch = (a.chord + b.chord) / 2 * 0.14;
          const grp = new THREE.Group(); grp.position.copy(A); grp.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), Bv.clone().sub(A).normalize());
          const hinge = new THREE.Group(); grp.add(hinge);
          this.mesh(box(len, 0.04, ch, COL.metal), hinge, this.matDS).position.set(len / 2, 0.03, ch / 2);
          wing.add(grp); this.surfaces.push({ kind: 'spoiler', side, hinge, grp });
        }
        // Leading-edge slats
        const a = stationAt(s2, 0.2), b = stationAt(s2, 0.95);
        const [p0, p1] = side < 0 ? [b.le, a.le] : [a.le, b.le];
        const A = B(...p0), Bv = B(...p1), len = A.distanceTo(Bv);
        const grp = new THREE.Group(); grp.position.copy(A); grp.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), Bv.clone().sub(A).normalize());
        const hinge = new THREE.Group(); grp.add(hinge);
        const ch = (a.chord + b.chord) / 2 * 0.12;
        this.mesh(box(len, ch * 0.18, ch, COL.metal), hinge, this.matDS).position.set(len / 2, 0, -ch * 0.2);
        wing.add(grp); this.surfaces.push({ kind: 'slat', side, hinge, grp, base: grp.position.clone(), chord: ch });
      } else {
        hinged('flap', 0.05, 0.62, 0.28); hinged('aileron', 0.66, 0.96, 0.26);
      }
      this.anchors[name] = B(...te(0.5));
    }
  }

  buildTail(R, yc, xTail) {
    const c = this.cfg, g = c.geometry, L = c.layout, t = this.family;
    const tTail = t === 'twin-turboprop';
    // Vertical fin
    const vs = this.part('vStab');
    const finH = Math.abs(L.finTopZ - (L.roofZ ?? -R)) * 1.02;
    const finRootX = L.finX + finH * 0.25 + (t === 'airliner' ? 2.0 : 1.2), finRootC = finH * (t === 'airliner' ? 0.95 : t === 'cargo-4prop' ? 0.75 : 0.95);
    const sweep = (t === 'cargo-4prop' ? 18 : t === 'twin-turboprop' ? 35 : 40) * D2R;
    const zRoot = (L.roofZ ?? -R) + R * 0.25, zTop = L.finTopZ;
    const fin = [{ le: [finRootX, 0, zRoot], chord: finRootC }, { le: [finRootX - (zRoot - zTop) * Math.tan(sweep), 0, zTop], chord: finRootC * (t === 'cargo-4prop' ? 0.62 : 0.4) }];
    this.mesh(surface(fin, 0.1, this.tail, { up: [0, 1, 0], sym: true }), vs, this.matDS);
    // Rudder hinge along the fin trailing edge (vertical, bottom -> top along model +y)
    const fr = fin[0], ft = fin[1];
    const r0 = [fr.le[0] - fr.chord * 0.72, 0, fr.le[2] - 0.05], r1 = [ft.le[0] - ft.chord * 0.72, 0, ft.le[2] + 0.1];
    const A = B(...r0), Bv = B(...r1), len = A.distanceTo(Bv);
    const rg = new THREE.Group(); rg.position.copy(A); rg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bv.clone().sub(A).normalize()); vs.add(rg);
    const rud = new THREE.Group(); rg.add(rud);
    const rch = (fr.chord + ft.chord) / 2 * 0.28;
    this.mesh(box(0.12, len, rch, this.tail), rud, this.matDS).position.set(0, len / 2, rch / 2);
    this.parts.rudder = rud;
    // Horizontal stabiliser (on the fin top for the T-tail)
    const hs = this.part('hStab');
    const stabPivot = new THREE.Group(); hs.add(stabPivot);
    const sx = tTail ? ft.le[0] - ft.chord * 0.1 : L.stabX + (g.stabSpan / 2) * 0.2 + 1.2, sz = tTail ? zTop + 0.05 : L.stabZ;
    const sweepS = (g.sweepDeg ? g.sweepDeg + 5 : 8) * D2R, crS = g.stabSpan * (t === 'airliner' ? 0.3 : 0.26), lamS = 0.38;
    for (const side of [-1, 1]) {
      const st = [{ le: [sx, side * 0.2, sz], chord: crS }, { le: [sx - (g.stabSpan / 2) * Math.tan(sweepS), side * g.stabSpan / 2, sz - (g.stabSpan / 2) * Math.tan((t === 'airliner' ? 6 : 0) * D2R)], chord: crS * lamS }];
      this.mesh(surface(st, 0.1, this.family === 'cargo-4prop' ? this.livery : COL.grey, {}), stabPivot, this.matDS);
      const a = st[0], b = st[1];
      const pa = [a.le[0] - a.chord * 0.7, a.le[1], a.le[2]], pb = [b.le[0] - b.chord * 0.7, b.le[1], b.le[2]];
      const [p0, p1] = side < 0 ? [pb, pa] : [pa, pb];
      const E0 = B(...p0), E1 = B(...p1), l2 = E0.distanceTo(E1);
      const eg = new THREE.Group(); eg.position.copy(E0); eg.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), E1.clone().sub(E0).normalize()); stabPivot.add(eg);
      const el = new THREE.Group(); eg.add(el);
      const ech = (a.chord + b.chord) / 2 * 0.3;
      this.mesh(box(l2, 0.05, ech, COL.grey), el, this.matDS).position.set(l2 / 2, 0, ech / 2);
      this.surfaces.push({ kind: 'elevator', side, hinge: el });
    }
    stabPivot.position.copy(B(sx - crS * 0.25, 0, sz)); stabPivot.children.forEach((ch) => ch.position.sub(stabPivot.position));
    this.stabPivot = stabPivot;
  }

  buildTurbofan(e, i) {
    const n = i + 1, part = this.part(`engine${n}`), R = e.nacelleRadius ?? 1, [x, y, z] = e.position;
    const Lr = R * (this.cfg.model?.variant === 'widebody' ? 3.0 : 3.3);
    const xf = x + Lr * 0.5, xa = x - Lr * 0.5;
    const grp = new THREE.Group(); grp.position.copy(B(x, y, z)); part.add(grp);
    const rel = (bx) => bx - x;
    // Fixed forward cowl (inlet lip -> fan case)
    const fwd = [[rel(xf), R * 0.86], [rel(xf) + 0.02, R * 0.93], [rel(xf) - 0.05, R * 0.99], [rel(xf) - Lr * 0.18, R], [rel(xf) - Lr * 0.52, R * 0.97]];
    this.mesh(lathe(fwd, this.livery, 28), grp);
    // Translating reverser sleeve
    const sleeve = new THREE.Group(); grp.add(sleeve);
    this.mesh(lathe([[rel(xf) - Lr * 0.52, R * 0.97], [rel(xf) - Lr * 0.75, R * 0.86], [rel(xf) - Lr * 0.82, R * 0.74]], this.livery, 28), sleeve);
    this.reversers.push({ engine: i, sleeve, travel: Lr * 0.18 });
    // Core cowl and exhaust plug
    this.mesh(lathe([[rel(xf) - Lr * 0.78, R * 0.6], [rel(xa) + Lr * 0.12, R * 0.48], [rel(xa) + 0.02, R * 0.38], [rel(xa) - 0.01, R * 0.36]], COL.metal, 24), grp);
    this.mesh(lathe([[rel(xa) + 0.2, R * 0.3], [rel(xa) - Lr * 0.12, R * 0.04]], COL.dark, 16), grp);
    // Fan face + spinner
    const fan = this.mesh(new THREE.CircleGeometry(R * 0.86, 28), grp, new THREE.MeshStandardMaterial({ color: 0x24272b, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }));
    fan.position.set(0, 0, -rel(xf) + Lr * 0.06);
    const sp = this.mesh(paint(new THREE.ConeGeometry(R * 0.26, R * 0.5, 16).rotateX(-Math.PI / 2), [0.85, 0.85, 0.87]), grp);
    sp.position.set(0, 0, -rel(xf) + Lr * 0.04 - R * 0.2);
    this.props.push({ engine: i, blades: fan, kind: 'fan' });
    // Pylon up to the wing lower surface
    const wingZ = this.wingSurfaceZ(y), h = Math.max(0.3, z - R * 0.85 - wingZ);
    const py = this.mesh(box(R * 0.28, h + 0.6, Lr * 0.8, this.livery), grp, this.matDS);
    py.position.set(0, R * 0.85 + h / 2, Lr * 0.2);
    this.anchors.push(B(x - Lr * 0.45, y, z));
  }

  wingSurfaceZ(y) {
    const st = this.wingSt; if (!st) return 0;
    const ay = Math.abs(y), a = st[0], b = st[st.length - 1];
    const f = Math.min(1, Math.max(0, (ay - a.le[1]) / (b.le[1] - a.le[1])));
    return a.le[2] + (b.le[2] - a.le[2]) * f + 0.15;
  }

  buildTurboprop(e, i) {
    const n = i + 1, c = this.cfg, part = this.part(`engine${n}`), [x, y, z] = e.position;
    const cargo = this.family === 'cargo-4prop';
    const Rn = cargo ? 0.75 : 0.42, len = cargo ? 6.2 : 4.4, xFront = x + (e.propX ?? 1.2) - 0.25;
    const grp = new THREE.Group(); grp.position.copy(B(x, y, z)); part.add(grp);
    const rel = (bx) => bx - x;
    const prof = [[rel(xFront), Rn * 0.55], [rel(xFront) - 0.3, Rn * 0.9], [rel(xFront) - len * 0.3, Rn], [rel(xFront) - len * 0.75, Rn * 0.85], [rel(xFront) - len, Rn * 0.2]];
    this.mesh(lathe(prof, this.livery, 20), grp);
    // exhaust stub
    const ex = this.mesh(cyl(Rn * 0.22, Rn * 0.25, 0.5, COL.dark, 10), grp);
    ex.rotation.z = Math.PI / 2; ex.position.set(Math.sign(y) * Rn * 0.95, 0.05, -rel(xFront) + len * 0.35);
    this.anchors.push(B(x - 0.8, y, z));
    // Propeller
    const prop = this.part(`propeller${n}`);
    const pg = new THREE.Group(); pg.position.copy(B(x + (e.propX ?? 1.2), y, z)); prop.add(pg);
    const spin = this.mesh(paint(new THREE.ConeGeometry(Rn * 0.62, Rn * 1.3, 18).rotateX(-Math.PI / 2), cargo ? COL.grey : [0.15, 0.15, 0.16]), pg);
    spin.position.z = -Rn * 0.5;
    const blades = new THREE.Group(); pg.add(blades);
    const nb = c.sound?.blades ?? 4, Rp = (e.propDiameter ?? c.engines[i].propDiameter ?? 2.5) / 2;
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
    const pitchGroups = [];
    for (let k = 0; k < nb; k++) {
      const arm = new THREE.Group(); arm.rotation.z = (k / nb) * Math.PI * 2; blades.add(arm);
      const pitch = new THREE.Group(); pitch.position.y = Rp * 0.55; arm.add(pitch);
      const b = new THREE.Mesh(new THREE.BoxGeometry(Rp * 0.13, Rp * 0.9, 0.04), bladeMat); b.castShadow = true; pitch.add(b);
      const tipC = new THREE.Mesh(new THREE.BoxGeometry(Rp * 0.13, Rp * 0.06, 0.042), new THREE.MeshBasicMaterial({ color: 0xffd23a })); tipC.position.y = Rp * 0.44; pitch.add(tipC);
      pitchGroups.push(pitch);
    }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(Rp, 32), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    pg.add(disc);
    this.props.push({ engine: i, blades, pitchGroups, disc, kind: 'prop', rpm: c.engines[i].propRPM ?? 2000 });
  }

  // ---------------------------------------------------------------- fighter
  buildFighter() {
    const c = this.cfg, g = c.geometry, L = c.layout;
    const xNose = L.noseTipX, xTail = xNose - g.length, R = g.fuselageDia / 2;
    const secs = [];
    for (let x = xNose; x >= xTail - 1e-6; x -= 0.18) {
      const f = xNose - x, toTail = x - xTail;
      let hw = R * 0.85, top = R * 0.75, bot = -R * 0.7, n = 2.4;
      if (f < 4.2) { const s = f / 4.2, e = Math.pow(s, 0.62); hw = R * 0.8 * e + 0.02; top = R * 0.62 * e + 0.02 - 0.1 * (1 - s); bot = -R * 0.62 * e - 0.02 - 0.1 * (1 - s); n = 2; }
      else if (f < 6.5) { const s = (f - 4.2) / 2.3; hw = R * (0.8 + 0.25 * s); top = R * (0.62 + 0.25 * s); bot = -R * (0.62 + 0.2 * s); }
      else if (toTail < 3.2) { const s = 1 - toTail / 3.2; hw = R * (1.05 - 0.45 * s); top = R * (0.87 - 0.35 * s); bot = -R * (0.82 - 0.3 * s); }
      else { hw = R * 1.05; top = R * 0.87; bot = -R * 0.82; }
      secs.push({ x, hw, top, bot, n });
    }
    const liv = this.livery;
    this.mesh(loft(secs, (x, y) => (x > xNose - 1.2 ? COL.fighterDark : y < -R * 0.4 ? [0.55, 0.58, 0.6] : liv), 28), this.part('fuselage'));
    const fus = this.parts.fuselage;
    // Canopy (tinted bubble)
    const can = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5a4a20, metalness: 0.9, roughness: 0.08, transparent: true, opacity: 0.55 }));
    can.scale.set(0.48, 0.55, 1.65); can.position.copy(B(L.noseTipX - 3.3, 0, -R * 0.55)); fus.add(can); this.canopy = can;
    // Ventral intake
    const intake = this.mesh(box(R * 1.1, R * 0.75, 3.6, COL.fighterDark), fus); intake.position.copy(B(L.noseTipX - 6.3, 0, R * 0.95));
    const lip = this.mesh(new THREE.TorusGeometry(R * 0.45, 0.06, 6, 18), fus, new THREE.MeshStandardMaterial({ color: 0x222222 })); lip.scale.set(1.2, 0.8, 1); lip.position.copy(B(L.noseTipX - 4.45, 0, R * 0.95));
    // Wings: cropped delta with leading-edge extensions
    this.wingSt = [{ le: [1.2, R * 0.9, L.wingZ], chord: 4.6 }, { le: [1.2 - (g.span / 2 - R * 0.9) * Math.tan(40 * D2R), g.span / 2, L.wingZ], chord: 1.05 }];
    for (const side of [-1, 1]) {
      const name = side < 0 ? 'leftWing' : 'rightWing', wing = this.part(name);
      const s2 = this.wingSt.map((s) => ({ le: [s.le[0], s.le[1] * side, s.le[2]], chord: s.chord }));
      this.mesh(surface(s2, 0.04, liv, { sym: true }), wing, this.matDS);
      const lex = [{ le: [L.noseTipX - 4.2, side * R * 0.75, 0.05], chord: 0.4 }, { le: [1.25, side * R * 0.95, L.wingZ], chord: 2.2 }];
      this.mesh(surface(lex, 0.03, liv, { sym: true }), wing, this.matDS);
      // Flaperon
      const a = stationAt(s2, 0.05), b = stationAt(s2, 0.6);
      const pa = [a.le[0] - a.chord * 0.8, a.le[1], a.le[2]], pb = [b.le[0] - b.chord * 0.8, b.le[1], b.le[2]];
      const [p0, p1] = side < 0 ? [pb, pa] : [pa, pb];
      const A = B(...p0), Bv = B(...p1), len = A.distanceTo(Bv);
      const grp = new THREE.Group(); grp.position.copy(A); grp.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), Bv.clone().sub(A).normalize()); wing.add(grp);
      const hinge = new THREE.Group(); grp.add(hinge);
      this.mesh(box(len, 0.05, 0.75, liv), hinge, this.matDS).position.set(len / 2, 0, 0.37);
      this.surfaces.push({ kind: 'flaperon', side, hinge });
      // Wingtip rail + training round
      const rail = this.mesh(cyl(0.065, 0.065, 3.0, [0.85, 0.85, 0.85], 8), wing); rail.rotation.x = Math.PI / 2; rail.position.copy(B(s2[1].le[0] - 0.6, side * (g.span / 2 + 0.1), L.wingZ));
      this.anchors[name] = B(-1, side * 2.5, L.wingZ);
    }
    // Vertical fin + rudder
    const vs = this.part('vStab');
    const fin = [{ le: [-3.4, 0, -R * 0.8], chord: 3.4 }, { le: [-3.4 - 2.4 * Math.tan(45 * D2R), 0, L.finTopZ], chord: 1.1 }];
    this.mesh(surface(fin, 0.05, liv, { up: [0, 1, 0], sym: true }), vs, this.matDS);
    const r0 = B(fin[0].le[0] - fin[0].chord * 0.75, 0, fin[0].le[2] - 0.2), r1 = B(fin[1].le[0] - fin[1].chord * 0.7, 0, fin[1].le[2] + 0.15);
    const rg = new THREE.Group(); rg.position.copy(r0); rg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), r1.clone().sub(r0).normalize()); vs.add(rg);
    const rud = new THREE.Group(); rg.add(rud);
    this.mesh(box(0.06, r0.distanceTo(r1), 0.6, liv), rud, this.matDS).position.set(0, r0.distanceTo(r1) / 2, 0.3);
    this.parts.rudder = rud;
    // All-moving tailerons (rotate as a whole)
    const hs = this.part('hStab');
    this.tailerons = [];
    for (const side of [-1, 1]) {
      const piv = new THREE.Group(); piv.position.copy(B(-5.4, side * R * 0.95, L.stabZ)); hs.add(piv);
      const st = [{ le: [0.9, 0, 0], chord: 2.6 }, { le: [0.9 - 2.0 * Math.tan(42 * D2R), side * (g.stabSpan / 2 - R * 0.95), 0.25], chord: 0.9 }];
      this.mesh(surface(st, 0.04, liv, { sym: true }), piv, this.matDS);
      this.tailerons.push({ side, piv });
    }
    // Nozzle + afterburner flame
    const eng = this.part('engine1');
    const nz = new THREE.Group(); nz.position.copy(B(xTail + 0.6, 0, 0)); eng.add(nz);
    this.mesh(lathe([[0.9, R * 0.62], [0.2, R * 0.6], [-0.6, R * 0.5]], [0.32, 0.3, 0.28], 18), nz);
    const inner = this.mesh(new THREE.CircleGeometry(R * 0.45, 18), nz, new THREE.MeshBasicMaterial({ color: 0x1c1410 })); inner.position.z = -0.5; inner.rotation.y = Math.PI;
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(R * 0.42, 3.6, 16, 1, true).rotateX(Math.PI / 2), flameMat);
    flame.position.z = 2.2; nz.add(flame);
    const core = new THREE.Mesh(new THREE.ConeGeometry(R * 0.25, 2.0, 12, 1, true).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    core.position.z = 1.4; nz.add(core);
    this.flames.push({ engine: 0, flame, core });
    this.anchors.push(B(xTail + 1.5, 0, 0));
  }

  // ---------------------------------------------------------------- gear
  buildGear() {
    const c = this.cfg, L = c.layout ?? {}, t = this.family, wide = c.model?.variant === 'widebody';
    const names = ['noseGear', 'leftMainGear', 'rightMainGear'];
    c.gear.wheels.forEach((w, i) => {
      if (i > 2) return;
      const part = this.part(names[i]);
      const r = w.radius ?? 0.5, nose = i === 0;
      const attachZ = nose ? (L.bellyZ ?? 1) - 0.2 : t === 'cargo-4prop' ? (L.bellyZ ?? 2) - 0.6 : t === 'fighter' ? (L.bellyZ ?? 0.6) - 0.1 : Math.min(L.wingZ ?? 1, (L.bellyZ ?? 1)) - 0.1;
      const pivot = new THREE.Group(); pivot.position.copy(B(w.pos[0], w.pos[1], attachZ)); part.add(pivot);
      const legLen = Math.max(0.3, w.pos[2] - r - attachZ);
      const leg = this.mesh(cyl(r * 0.16, r * 0.2, 1, COL.metal, 8), pivot);
      const wheels = new THREE.Group(); pivot.add(wheels);
      const tyreGeo = cyl(r, r, r * 0.55, COL.tyre, 16).rotateZ(Math.PI / 2);
      const hub = cyl(r * 0.5, r * 0.5, r * 0.57, [0.75, 0.75, 0.77], 10).rotateZ(Math.PI / 2);
      const layout = nose ? (t === 'fighter' || t === 'twin-turboprop' ? [[0, 0]] : [[-0.32, 0], [0.32, 0]].map(([s, f]) => [s * r * 1.3, f]))
        : wide ? [[-0.65, -0.85], [0.65, -0.85], [-0.65, 0.85], [0.65, 0.85]].map(([s, f]) => [s * r * 1.5, f * r * 1.8])
          : t === 'cargo-4prop' ? [[0, -r * 1.15], [0, r * 1.15]] : t === 'fighter' ? [[0, 0]] : [[-r * 0.65, 0], [r * 0.65, 0]];
      for (const [dx, dz] of layout) {
        const ty = this.mesh(tyreGeo, wheels); ty.position.set(dx, 0, dz);
        const hb = this.mesh(hub, wheels); hb.position.set(dx, 0, dz);
      }
      if (wide && !nose) { const bogie = this.mesh(box(r * 0.25, r * 0.25, r * 3.6, COL.metal), wheels); bogie.position.y = r * 0.1; }
      this.gearLegs.push({ i, pivot, leg, wheels, legLen, r, nose, side: Math.sign(w.pos[1]) });
    });
  }

  buildLights() {
    const c = this.cfg, g = c.geometry;
    const st = this.wingSt, tip = st[st.length - 1];
    const mk = (color, size = 0.09) => new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), new THREE.MeshBasicMaterial({ color }));
    this.navLights = [];
    for (const side of [-1, 1]) {
      const l = mk(side < 0 ? 0xff2020 : 0x20ff40); l.position.copy(B(tip.le[0] - 0.2, side * (tip.le[1] + 0.15), tip.le[2]));
      this.parts[side < 0 ? 'leftWing' : 'rightWing'].add(l); this.navLights.push(l);
    }
    this.strobes = [];
    for (const side of [-1, 1]) { const s = mk(0xffffff, 0.1); s.position.copy(B(tip.le[0] - tip.chord * 0.6, side * (tip.le[1] + 0.15), tip.le[2])); this.parts[side < 0 ? 'leftWing' : 'rightWing'].add(s); this.strobes.push(s); }
    const L = c.layout, R = g.fuselageDia / 2;
    this.beacons = [mk(0xff2020, 0.12), mk(0xff2020, 0.12)];
    this.beacons[0].position.copy(B(0, 0, (L.roofZ ?? -R) - 0.08)); this.beacons[1].position.copy(B(-2, 0, (L.bellyZ ?? R) + 0.08));
    this.beacons.forEach((b) => this.parts.fuselage.add(b));
    this.landingLight = new THREE.SpotLight(0xfff4e0, 0, 1500, 0.22, 0.5, 1.2);
    const nose = c.gear.wheels[0].pos;
    this.landingLight.position.copy(B(nose[0] + 0.5, 0, (L.bellyZ ?? R) + 0.2));
    this.landingLight.target.position.copy(B(nose[0] + 60, 0, (L.bellyZ ?? R) + 6));
    this.exterior.add(this.landingLight, this.landingLight.target);
  }

  /**
   * Inward-facing flight-deck lining (nose to a few metres aft of the eye) with the windshield openings cut
   * out, so the cockpit view looks out through real window apertures. Null for the fighter (open canopy).
   */
  flightDeckShell(eyeX) {
    const dk = this.deck; if (!dk) return null;
    const ring = 64, x0 = dk.xNose - 0.05, x1 = Math.min(eyeX - 3.5, dk.xw1 - 1.5);
    const secs = dk.secs.filter((q) => q.x <= x0 && q.x >= x1);
    const pos = [], col = [], idx = [];
    for (const q of secs) for (let k = 0; k <= ring; k++) {
      const a = (k / ring) * Math.PI * 2, [px, py] = ringAt(q, a, -0.04);
      pos.push(px, py, -q.x);
      const yy = py - dk.yc;
      col.push(...(yy < -dk.R * 0.35 ? [0.2, 0.21, 0.22] : yy > dk.R * 0.75 ? [0.62, 0.63, 0.64] : [0.48, 0.5, 0.52]));
    }
    const W = ring + 1;
    const isGlass = (x, a) => {
      const aa = a > Math.PI ? Math.PI * 2 - a : a; // mirror to the right side, 0 = top
      if (x > dk.xw0 || x < dk.xw1) return false;
      if (Math.abs(x - dk.xFront) < 0.05) return false; // window post
      return aa >= dk.aTop(x) + 0.03 && aa <= dk.aBot(x) - 0.03;
    };
    for (let i = 0; i < secs.length - 1; i++) for (let k = 0; k < ring; k++) {
      const xm = (secs[i].x + secs[i + 1].x) / 2, am = ((k + 0.5) / ring) * Math.PI * 2;
      if (isGlass(xm, am)) continue;
      const a = i * W + k, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 }));
    m.receiveShadow = true;
    return m;
  }

  /** Model-space position of engine i (fire/smoke emitters). */
  engineAnchor(i = 0) { return (this.anchors[i] ?? new THREE.Vector3()).clone(); }

  // ---------------------------------------------------------------- animation
  update(ac, dt, time, cockpitView) {
    const c = this.cfg, k = ac.controls, cc = c.controls;
    const surf = ac.surf ?? { elevator: k.elevator, aileron: k.aileron };
    const ail = surf.aileron ?? 0, flap = ac.flapDeg ?? 0, maxFlap = c.aero.flaps[c.aero.flaps.length - 1].deg || 1;
    const fr = flap / maxFlap, sp = ac.spoilerPos ?? 0;
    const trimDe = k.trim * cc.trimRangeRad, de = (ac.totalDe ?? 0) - (this.family === 'fighter' ? 0 : trimDe);
    for (const s of this.surfaces) {
      if (s.kind === 'flap') { s.hinge.rotation.x = flap * D2R * 0.9; if (s.base && this.family === 'airliner') s.grp.position.copy(s.base).add(new THREE.Vector3(0, -0.15 * fr * s.chord, 0.7 * fr * s.chord)); }
      else if (s.kind === 'aileron') s.hinge.rotation.x = -s.side * ail * cc.aileronDeg * D2R;
      else if (s.kind === 'flaperon') s.hinge.rotation.x = -s.side * ail * cc.aileronDeg * D2R + flap * D2R * 0.8;
      else if (s.kind === 'elevator') s.hinge.rotation.x = -de;
      else if (s.kind === 'spoiler') { const roll = Math.max(0, -s.side * ail - 0.15) * 0.9; s.hinge.rotation.x = -Math.min(1, sp + roll) * 50 * D2R; }
      else if (s.kind === 'slat') { const ext = flap > 0.5 ? 1 : 0; s.hinge.rotation.x = ext * 18 * D2R; if (s.base) s.grp.position.copy(s.base).add(new THREE.Vector3(0, -0.2 * ext * s.chord, -0.35 * ext * s.chord)); }
    }
    if (this.stabPivot) this.stabPivot.rotation.x = -trimDe * 0.5;
    if (this.tailerons) for (const t of this.tailerons) t.piv.rotation.x = -(de + t.side * ail * 0.12);
    if (this.parts.rudder) this.parts.rudder.rotation.y = -k.rudder * cc.rudderDeg * D2R;
    // Engines
    const engines = ac.engines ?? [];
    for (const p of this.props) {
      const e = engines[p.engine]; if (!e) continue;
      if (p.kind === 'prop') {
        const rpm = e.np ?? e.rpm ?? 0;
        p.angle = ((p.angle ?? 0) + (rpm / 60) * Math.PI * 2 * dt) % (Math.PI * 2);
        p.blades.rotation.z = rpm > 400 ? p.angle * 0.11 : p.angle;
        const feather = e.feathered ? 1.45 : e.reverse > 0.05 && e.running ? -0.25 : 0.35;
        for (const pg of p.pitchGroups) pg.rotation.y += (feather - pg.rotation.y) * Math.min(1, dt * 2);
        p.disc.material.opacity = rpm > 300 ? Math.min(0.2, rpm / (p.rpm * 5)) : 0;
        p.disc.visible = !cockpitView;
      } else if (p.kind === 'fan') {
        p.blades.rotation.z += ((e.n1 ?? 0) / 100) * 50 * dt;
      }
    }
    for (const r of this.reversers) {
      const e = engines[r.engine]; r.sleeve.position.z = (e?.reverser ?? 0) * r.travel;
    }
    for (const f of this.flames) {
      const e = engines[f.engine], ab = !!e?.afterburner;
      const flick = 0.85 + 0.15 * Math.sin(time * 61) * Math.sin(time * 23);
      f.flame.visible = ab; f.core.visible = ab || (e?.n1 ?? 0) > 95;
      f.flame.scale.set(1, 1, flick); f.core.scale.set(1, 1, ab ? 1.1 * flick : 0.4);
    }
    // Gear: retraction (pivot rotation) and strut compression
    const gp = ac.gearPos ?? 1;
    for (const g of this.gearLegs) {
      const comp = ac.wheelState?.[g.i]?.compression ?? 0;
      const len = Math.max(0.1, g.legLen - comp);
      g.wheels.position.y = -len; g.leg.scale.set(1, len, 1); g.leg.position.y = -len / 2;
      const up = 1 - gp;
      // nose gear folds forward; airliner/fighter mains fold inboard; turboprop mains fold forward into the nacelles/sponsons
      if (g.nose) g.pivot.rotation.x = up * 1.5; else if (this.family === 'airliner' || this.family === 'fighter') g.pivot.rotation.z = -g.side * up * 1.5; else g.pivot.rotation.x = up * 1.45;
      g.pivot.visible = gp > 0.02;
    }
    // Lights
    const sw = ac.elec?.switches ?? {}, powered = (ac.elec?.busVolts ?? 0) > 18;
    for (const l of this.navLights) l.visible = powered && sw.navLights;
    const beaconOn = powered && sw.beacon && (time % 1.1) < 0.12;
    for (const b of this.beacons) b.visible = beaconOn;
    const strobeOn = powered && sw.strobe && (time % 1.25) < 0.06;
    for (const s of this.strobes) s.visible = strobeOn;
    this.landingLight.intensity = powered && sw.landingLight ? 90000 : powered && sw.taxiLight ? 20000 : 0;
    if (this.canopy) this.canopy.visible = !cockpitView;
    if (this.windshield) for (const w of this.windshield) w.visible = !cockpitView;
    for (const [name, det] of Object.entries(ac.damage?.detached ?? {})) if (det && this.parts[name] && this.parts[name].visible) this.parts[name].visible = false;
  }
}

/** Neutral state for the initial pose (before the simulation runs). */
function mockState(cfg) {
  return {
    controls: { elevator: 0, aileron: 0, rudder: 0, trim: 0 }, flapDeg: 0, spoilerPos: 0, totalDe: 0, gearPos: 1,
    engines: cfg.engines.map(() => ({ np: 0, n1: 0, reverser: 0, feathered: false })), wheelState: cfg.gear.wheels.map(() => ({ compression: 0.1 })),
    elec: { switches: {}, busVolts: 0 }, damage: { detached: {} },
  };
}
