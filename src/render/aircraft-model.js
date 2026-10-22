// Parametric exterior model for the GA-172 (original geometry built in code). Model space: x = right, y = up,
// z = aft (forward is -z), origin at the aircraft CG. Named parts support animation and damage detachment.
import * as THREE from 'three';

const BODY = { white: [0.93, 0.93, 0.92], stripe: [0.12, 0.2, 0.42], stripe2: [0.62, 0.12, 0.14], glass: [0.06, 0.08, 0.1], cowl: [0.92, 0.92, 0.9] };

/** Fuselage cross-sections: [x_body(fwd), halfWidth, top, bottom] (model-up metres). */
export const FUSE_SECTIONS = [
  [2.36, 0.3, 0.25, -0.3], [2.25, 0.4, 0.33, -0.42], [1.9, 0.5, 0.43, -0.58], [1.5, 0.54, 0.47, -0.66], [1.1, 0.56, 0.52, -0.69],
  [0.9, 0.57, 0.58, -0.7], [0.7, 0.58, 0.75, -0.7], [0.5, 0.585, 0.9, -0.7], [0.3, 0.59, 1.0, -0.69], [0.1, 0.59, 1.04, -0.68],
  [-0.2, 0.59, 1.05, -0.67], [-0.5, 0.59, 1.05, -0.66], [-0.8, 0.58, 1.04, -0.64], [-1.1, 0.56, 1.0, -0.61], [-1.4, 0.53, 0.95, -0.57],
  [-1.8, 0.47, 0.85, -0.5], [-2.3, 0.38, 0.7, -0.38], [-3.0, 0.29, 0.55, -0.22], [-3.8, 0.21, 0.43, -0.08], [-4.6, 0.15, 0.36, 0.03],
  [-5.3, 0.1, 0.32, 0.1], [-5.85, 0.05, 0.3, 0.16],
];
const RING = 28;

function ringPoint(sec, k) {
  const [, hw, top, bot] = sec;
  const a = (k / RING) * Math.PI * 2; // 0 = top, increasing clockwise looking forward (towards +x right side first)
  const s = Math.sin(a), c = Math.cos(a);
  const pw = 2.6; // superellipse exponent -> boxy-round section
  const sx = Math.sign(s) * Math.pow(Math.abs(s), 2 / pw), sy = Math.sign(c) * Math.pow(Math.abs(c), 2 / pw);
  const mid = (top + bot) / 2, hh = (top - bot) / 2;
  return [sx * hw, mid + sy * hh];
}

export function isWindow(x, y, side) {
  const a = Math.abs(side);
  if (x > 0.15 && x < 0.85 && y > 0.5 && a < 0.86) return true; // windshield
  if (x > -1.55 && x < 0.85 && y > 0.36 && y < 0.96 && (x <= 0.15 || a >= 0.86)) return !(x > -0.62 && x < -0.48); // side windows, door post solid
  return false;
}

/** Loft the fuselage. interior=true builds the inward-facing cabin lining (windows open). */
export function fuselageGeometry(interior = false, xRange = [-99, 99]) {
  const pos = [], col = [], idx = [];
  const secs = FUSE_SECTIONS.filter((s) => s[0] >= xRange[0] - 0.01 && s[0] <= xRange[1] + 0.01);
  for (const s of secs) for (let k = 0; k <= RING; k++) {
    const [px, py] = ringPoint(s, k % RING);
    pos.push(px, py, -s[0]);
    let c = BODY.white;
    if (!interior) {
      const side = px / s[1];
      if (isWindow(s[0], py, side)) c = BODY.glass;
      else if (py > -0.28 && py < -0.12 && s[0] < 1.0) c = BODY.stripe;
      else if (py > -0.36 && py < -0.3 && s[0] < 1.0) c = BODY.stripe2;
    } else c = py < -0.3 ? [0.16, 0.16, 0.17] : py > 0.95 ? [0.5, 0.49, 0.47] : [0.3, 0.29, 0.28];
    col.push(...c);
  }
  const W = RING + 1;
  for (let i = 0; i < secs.length - 1; i++) for (let k = 0; k < RING; k++) {
    const a = i * W + k, b = a + 1, c = a + W, d = c + 1;
    if (interior) {
      const xm = (secs[i][0] + secs[i + 1][0]) / 2;
      const ym = (pos[a * 3 + 1] + pos[d * 3 + 1]) / 2, side = ((pos[a * 3] + pos[d * 3]) / 2) / secs[i][1];
      if (isWindow(xm, ym, side)) continue;
      idx.push(a, b, c, b, d, c);
    } else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Tapered wing panel with simple airfoil section. Span along +x (model right), chord along z. */
function wingPanel(span, rootChord, tipChord, thick, color, { dihedral = 0, sweep = 0 } = {}) {
  const N = 12, foil = [];
  for (let i = 0; i <= N; i++) { const t = i / N; foil.push([t, 0.6 * thick * Math.sqrt(t) * (1 - t) * 2.2]); }
  const sec = (t) => { const c = rootChord + (tipChord - rootChord) * t; return { c, x: span * t, y: Math.tan(dihedral) * span * t, z0: sweep * t }; };
  const pos = [], idx = [];
  for (const t of [0, 1]) {
    const s = sec(t);
    for (const [u, h] of foil) pos.push(s.x, s.y + h * s.c / rootChord, s.z0 + u * s.c);
    for (let i = N - 1; i > 0; i--) { const [u, h] = foil[i]; pos.push(s.x, s.y - 0.35 * h * s.c / rootChord, s.z0 + u * s.c); }
  }
  const M = pos.length / 6;
  for (let i = 0; i < M; i++) { const a = i, b = (i + 1) % M, c = M + i, d = M + ((i + 1) % M); idx.push(a, b, c, b, d, c); }
  // tip cap
  for (let i = 1; i < M - 1; i++) idx.push(M, M + i + 1, M + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n = g.attributes.position.count, cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) cols.set(color, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

function box(w, h, d, color) { const g = new THREE.BoxGeometry(w, h, d); const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.set(color, i * 3); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; }
function cyl(r0, r1, h, color, seg = 10) { const g = new THREE.CylinderGeometry(r0, r1, h, seg); const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.set(color, i * 3); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; }

/** Body (x fwd, y right, z down) -> model (x right, y up, z aft). */
export const b2m = (p) => new THREE.Vector3(p[1], -p[2], -p[0]);

export class AircraftModel {
  constructor() {
    this.root = new THREE.Group(); this.root.name = 'aircraft';
    this.exterior = new THREE.Group(); this.root.add(this.exterior);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.15 });
    this.parts = {};
    this.build();
  }

  part(name) { const g = new THREE.Group(); g.name = name; this.exterior.add(g); this.parts[name] = g; return g; }
  mesh(geo, parent, mat = this.mat) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }

  build() {
    const W = BODY.white;
    const fus = this.part('fuselage');
    this.fuselageMesh = this.mesh(fuselageGeometry(false), fus);
    // Wings (high wing at model y ~1.05, LE at z = -0.35 i.e. 0.35 m forward of CG).
    for (const side of [-1, 1]) {
      const name = side < 0 ? 'leftWing' : 'rightWing';
      const wing = this.part(name);
      const geo = wingPanel(5.0, 1.62, 1.12, 0.2, W, { dihedral: 1.7 * Math.PI / 180, sweep: 0.12 });
      if (side < 0) { geo.scale(-1, 1, 1); geo.index.array.reverse(); geo.computeVertexNormals(); }
      const wm = this.mesh(geo, wing); wm.position.set(side * 0.55, 1.02, -0.35);
      // aileron (outer) and flap (inner) as hinged surfaces
      const ail = new THREE.Group(); ail.position.set(side * 4.0, 1.06 + 0.08, -0.35 + 1.25); wing.add(ail);
      const am = this.mesh(box(1.9, 0.05, 0.36, W), ail); am.position.set(side * 0.05, 0, 0.18);
      const flap = new THREE.Group(); flap.position.set(side * 1.85, 1.05 + 0.05, -0.35 + 1.22); wing.add(flap);
      const fm = this.mesh(box(2.4, 0.05, 0.42, W), flap); fm.position.set(0, 0, 0.21);
      this.parts[name + 'Aileron'] = ail; this.parts[name + 'Flap'] = flap;
      // strut
      const s0 = new THREE.Vector3(side * 0.56, -0.42, 0.25), s1 = new THREE.Vector3(side * 2.55, 1.0, 0.05);
      const st = this.mesh(cyl(0.035, 0.035, s0.distanceTo(s1), [0.85, 0.85, 0.85], 6), wing);
      st.position.copy(s0).add(s1).multiplyScalar(0.5);
      st.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), s1.clone().sub(s0).normalize());
      // nav light housing at tip
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: side < 0 ? 0xff2020 : 0x20ff40 }));
      tip.position.set(side * 5.55, 1.18, -0.2); wing.add(tip);
      this.parts[name + 'NavLight'] = tip;
    }
    // Horizontal stabiliser + elevator
    const hs = this.part('hStab');
    for (const side of [-1, 1]) {
      const geo = wingPanel(1.7, 1.05, 0.75, 0.1, W);
      if (side < 0) { geo.scale(-1, 1, 1); geo.index.array.reverse(); geo.computeVertexNormals(); }
      const m = this.mesh(geo, hs); m.position.set(side * 0.08, 0.22, 4.95);
    }
    const elev = new THREE.Group(); elev.position.set(0, 0.24, 5.62); hs.add(elev);
    this.mesh(box(3.3, 0.04, 0.38, W), elev).position.set(0, 0, 0.19);
    this.parts.elevator = elev;
    // Vertical fin + rudder
    const vs = this.part('vStab');
    const finShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1.25, 0), new THREE.Vector2(1.35, 1.35), new THREE.Vector2(0.8, 1.4)]);
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.08, bevelEnabled: false });
    finGeo.rotateY(-Math.PI / 2); finGeo.translate(0.04, 0, 0);
    const fc = new Float32Array(finGeo.attributes.position.count * 3); for (let i = 0; i < fc.length; i += 3) fc.set(W, i);
    finGeo.setAttribute('color', new THREE.BufferAttribute(fc, 3));
    this.mesh(finGeo, vs).position.set(0, 0.3, 4.55);
    const rud = new THREE.Group(); rud.position.set(0, 0.3, 5.85); vs.add(rud);
    this.mesh(box(0.06, 1.35, 0.36, BODY.stripe), rud).position.set(0, 0.7, 0.16);
    this.parts.rudder = rud;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    beacon.position.set(0, 1.72, 5.5); vs.add(beacon); this.parts.beacon = beacon;
    // Engine cowl front, spinner, propeller
    const prop = this.part('propeller');
    prop.position.set(0, 0, -2.4);
    const spinner = this.mesh(new THREE.ConeGeometry(0.17, 0.32, 16).rotateX(-Math.PI / 2), prop);
    spinner.material = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.6, roughness: 0.3 });
    const blades = new THREE.Group(); prop.add(blades); this.parts.blades = blades;
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
    for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.78, 0.025), bladeMat); b.position.y = s * 0.43; b.rotation.y = s * 0.3; b.castShadow = true; blades.add(b); }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.83, 32), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    prop.add(disc); this.parts.propDisc = disc;
    // Landing gear: nose strut + wheel fairing, spring-steel mains.
    const black = [0.08, 0.08, 0.08], grey = [0.6, 0.6, 0.62];
    const mkWheel = (name, at, r, legFrom) => {
      const g = this.part(name);
      const wheelGroup = new THREE.Group(); wheelGroup.position.copy(at); g.add(wheelGroup);
      const tyre = this.mesh(cyl(r, r, 0.14, black, 14), wheelGroup); tyre.rotation.z = Math.PI / 2;
      const pant = this.mesh(new THREE.SphereGeometry(1, 12, 8).scale(0.13, 0.22, 0.48), wheelGroup);
      pant.material = this.mat; pant.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pant.geometry.attributes.position.count * 3).fill(0.93), 3));
      pant.position.y = 0.05;
      const leg = this.mesh(cyl(0.03, 0.04, 1, grey, 6), g);
      this.parts[name + 'Wheel'] = wheelGroup; this.parts[name + 'Leg'] = leg; leg.userData.from = legFrom;
      return g;
    };
    mkWheel('noseGear', b2m([1.15, 0, 1.15 - 0.19]), 0.19, b2m([1.25, 0, 0.6]));
    mkWheel('leftMainGear', b2m([-0.45, -1.15, 1.15 - 0.21]), 0.21, b2m([-0.4, -0.5, 0.62]));
    mkWheel('rightMainGear', b2m([-0.45, 1.15, 1.15 - 0.21]), 0.21, b2m([-0.4, 0.5, 0.62]));
    // Landing light (left wing leading edge)
    this.landingLight = new THREE.SpotLight(0xfff4e0, 0, 900, 0.2, 0.5, 1.2);
    this.landingLight.position.set(-2.3, 0.98, -0.4);
    this.landingLight.target.position.set(-2.3, 0.4, -40);
    this.exterior.add(this.landingLight, this.landingLight.target);
    this.strobes = [];
    for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff })); m.position.set(s * 5.56, 1.12, -0.1); this.exterior.add(m); this.strobes.push(m); }
    this.updateLegs({ wheelState: [{ compression: 0.09 }, { compression: 0.09 }, { compression: 0.09 }] });
  }

  updateLegs(ac) {
    const names = ['noseGear', 'leftMainGear', 'rightMainGear'], base = [1.15 - 0.19, 1.15 - 0.21, 1.15 - 0.21];
    names.forEach((n, i) => {
      const w = this.parts[n + 'Wheel'], leg = this.parts[n + 'Leg'];
      if (!w) return;
      const comp = ac.wheelState[i]?.compression ?? 0;
      w.position.y = -(base[i] - comp);
      const from = leg.userData.from, to = w.position;
      leg.position.copy(from).add(to).multiplyScalar(0.5);
      leg.scale.set(1, from.distanceTo(to), 1);
      leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    });
  }

  /** Animate control surfaces, propeller, gear and lights from the simulation state. */
  update(ac, dt, time, cockpitView) {
    const c = ac.cfg.controls, k = ac.controls, D = Math.PI / 180;
    const de = (k.elevator >= 0 ? k.elevator * c.elevatorUpDeg : k.elevator * c.elevatorDownDeg) * D + k.trim * 0.1;
    if (this.parts.elevator) this.parts.elevator.rotation.x = de;
    if (this.parts.rudder) this.parts.rudder.rotation.y = -k.rudder * c.rudderDeg * D;
    const da = k.aileron * c.aileronDeg * D;
    if (this.parts.leftWingAileron) this.parts.leftWingAileron.rotation.x = da;
    if (this.parts.rightWingAileron) this.parts.rightWingAileron.rotation.x = -da;
    for (const n of ['leftWingFlap', 'rightWingFlap']) if (this.parts[n]) this.parts[n].rotation.x = -ac.flapDeg * D * 0.9;
    const rpm = ac.engine.rpm;
    this.propAngle = (this.propAngle || 0) + (rpm / 60) * Math.PI * 2 * dt;
    if (this.parts.blades) {
      this.parts.blades.rotation.z = rpm > 900 ? this.propAngle % (Math.PI * 2) * 0.13 : this.propAngle;
      this.parts.blades.visible = !(rpm > 900 && cockpitView);
      this.parts.propDisc.material.opacity = rpm > 300 ? Math.min(0.22, rpm / 9000) : 0;
      this.parts.propDisc.visible = !cockpitView;
    }
    this.updateLegs(ac);
    const sw = ac.elec.switches, powered = ac.elec.busVolts > 18;
    const nav = powered && sw.navLights;
    for (const n of ['leftWingNavLight', 'rightWingNavLight']) if (this.parts[n]) this.parts[n].visible = nav;
    if (this.parts.beacon) this.parts.beacon.visible = powered && sw.beacon && (time % 1.4) < 0.15;
    const strobeOn = powered && sw.strobe && (time % 1.2) < 0.06;
    for (const s of this.strobes) s.visible = strobeOn;
    this.landingLight.intensity = powered && sw.landingLight ? 60000 : powered && sw.taxiLight ? 15000 : 0;
    // Detached / damaged parts
    for (const [name, det] of Object.entries(ac.damage.detached)) if (det && this.parts[name] && this.parts[name].visible) this.parts[name].visible = false;
  }
}
