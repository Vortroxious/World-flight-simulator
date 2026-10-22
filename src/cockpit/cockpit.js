// 3D interactive cockpit for the GA-172: interior shell, panel with live canvas instruments, and clickable /
// draggable / scrollable controls bound to the command layer. Model space matches AircraftModel
// (x right, y up, z aft, origin at CG).
import * as THREE from 'three';
import { fuselageGeometry } from '../render/aircraft-model.js';
import * as I from './instruments.js';
import { SWITCHES, SELECTOR, MAG_LABEL } from '../sim/commands.js';
import { KT } from '../core/units.js';

const PANEL_Z = -1.02; // panel face (model z), pilot eye at z ~ -0.4

function canvasPlane(w, h, px, draw, round = false) {
  const c = document.createElement('canvas');
  c.width = px; c.height = Math.round((px * h) / w);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const geo = round ? new THREE.CircleGeometry(w / 2, 40) : new THREE.PlaneGeometry(w, h);
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(0xffe2b0), emissiveIntensity: 0, roughness: 0.4, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, canvas: c, ctx: c.getContext('2d'), tex, draw, mat };
}

export class Cockpit {
  constructor(ac, cmd) {
    this.ac = ac; this.cmd = cmd;
    this.root = new THREE.Group(); this.root.name = 'cockpit';
    this.gauges = [];
    this.controls = [];
    this.annTest = false;
    this.nav = null;
    this.build();
  }

  addGauge(name, x, y, w, h, px, draw, round = false) {
    const g = canvasPlane(w, h, px, draw, round);
    g.mesh.position.set(x, y, PANEL_Z + 0.032);
    g.mesh.name = name;
    this.root.add(g.mesh);
    this.gauges.push(g);
    return g;
  }

  /** Register an interactive mesh. ctl: {label, value(), click(btn, ev), wheel(d), drag(dx, dy), down(), up()} */
  interactive(mesh, ctl) { mesh.userData.ctl = ctl; this.controls.push(mesh); return mesh; }

  build() {
    const ac = this.ac, cmd = this.cmd;
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2c2f, roughness: 0.85 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.6 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xc9c9c9, roughness: 0.25, metalness: 0.9 });
    const red = new THREE.MeshStandardMaterial({ color: 0xb01818, roughness: 0.5 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 });
    const lining = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    const shell = new THREE.Mesh(fuselageGeometry(true, [-2.3, 0.9]), lining);
    shell.receiveShadow = true; this.root.add(shell);
    // Window frames: thin posts so the cabin reads correctly
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.62, 0.05), dark); post.position.set(s * 0.57, 0.67, 0.55); this.root.add(post);
      const ap = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.6, 0.04), dark); ap.position.set(s * 0.53, 0.72, -0.5); ap.rotation.x = -0.55; this.root.add(ap);
    }
    const center = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.55, 0.03), dark); center.position.set(0, 0.72, -0.52); center.rotation.x = -0.6; this.root.add(center);
    // Panel, glareshield, floor, seats
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.8, 0.06), dark); panel.position.set(0, 0.02, PANEL_Z); panel.receiveShadow = true; this.root.add(panel);
    const glare = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.04, 0.24), black); glare.position.set(0, 0.44, PANEL_Z + 0.08); this.root.add(glare);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.02, 2.4), new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 1 })); floor.position.set(0, -0.62, 0.0); this.root.add(floor);
    for (const s of [-1, 1]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.5), new THREE.MeshStandardMaterial({ color: 0x3b3530, roughness: 1 })); seat.position.set(s * 0.3, -0.3, 0.15); this.root.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.7, 0.1), seat.material); back.position.set(s * 0.3, 0.05, 0.45); back.rotation.x = -0.15; this.root.add(back);
    }
    const console_ = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.5), dark); console_.position.set(0, -0.5, -0.78); this.root.add(console_);

    // --- Instruments (six-pack centred in front of the left seat) ---
    const D = 0.086, px = 320;
    this.addGauge('ASI', -0.43, 0.27, D, D, px, (g, S) => I.drawASI(g, S, ac), true);
    this.addGauge('AI', -0.33, 0.27, D, D, px, (g, S) => I.drawAI(g, S, ac), true);
    this.addGauge('ALT', -0.23, 0.27, D, D, px, (g, S) => I.drawALT(g, S, ac), true);
    this.addGauge('TC', -0.43, 0.17, D, D, px, (g, S) => I.drawTC(g, S, ac), true);
    this.addGauge('HI', -0.33, 0.17, D, D, px, (g, S) => I.drawHI(g, S, ac), true);
    this.addGauge('VSI', -0.23, 0.17, D, D, px, (g, S) => I.drawVSI(g, S, ac), true);
    this.addGauge('TACH', -0.33, 0.07, D, D, px, (g, S) => I.drawTach(g, S, ac), true);
    this.addGauge('ENGINE', -0.515, 0.155, 0.06, 0.25, 160, (g, W) => I.drawEngineCluster(g, W, (W * 0.25) / 0.06, ac));
    this.addGauge('ANNUN', -0.33, 0.355, 0.24, 0.03, 480, (g, W) => I.drawAnnunciator(g, W, W / 8, ac, this.annTest));
    this.addGauge('GPS', 0.0, 0.25, 0.17, 0.11, 400, (g, W) => I.drawGPS(g, W, (W * 0.11) / 0.17, ac, this.nav));
    const comp = this.addGauge('COMPASS', 0.0, 0.5, 0.09, 0.035, 240, (g, W) => I.drawCompass(g, W, (W * 0.035) / 0.09, ac));
    comp.mesh.position.z = PANEL_Z + 0.12;
    const compBody = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.07), black); compBody.position.set(0, 0.5, PANEL_Z + 0.08); this.root.add(compBody);

    // Instrument knobs
    const knob = (x, y, r = 0.009, mat = black) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.02, 14).rotateX(Math.PI / 2), mat); m.position.set(x, y, PANEL_Z + 0.045); this.root.add(m); return m; };
    this.interactive(knob(-0.262, 0.232), { label: 'Altimeter setting (Kollsman)', value: () => `${(ac.inst.kollsman / 3386.389).toFixed(2)} inHg`, wheel: (d) => cmd.kollsman(d * 0.01), click: (b) => cmd.kollsman(b === 2 ? -0.01 : 0.01) });
    this.interactive(knob(-0.37, 0.132), { label: 'Heading indicator: click = sync to compass, scroll = drift adjust', value: () => `${Math.round(ac.inst.dgHeading)}°`, wheel: (d) => { ac.inst.dgHeading = (ac.inst.dgHeading + d + 360) % 360; }, click: () => cmd.dgSync() });
    this.interactive(knob(-0.29, 0.132, 0.009, red), { label: 'Heading bug', value: () => `${Math.round(ac.inst.dgBug)}°`, wheel: (d) => cmd.dgBug(d * 5), click: (b) => cmd.dgBug(b === 2 ? -5 : 5) });
    // GPS / COM buttons
    const btn = (x, y, w, h, mat = black) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), mat); m.position.set(x, y, PANEL_Z + 0.04); this.root.add(m); return m; };
    this.interactive(btn(-0.065, 0.183, 0.025, 0.012), { label: 'COM ⇄ (swap active/standby)', click: () => cmd.comSwap(), value: () => `${ac.avionics.com1.toFixed(3)}` });
    this.interactive(knob(0.07, 0.183, 0.011), { label: 'COM standby tune (scroll, shift = MHz)', value: () => ac.avionics.com1Stby.toFixed(3), wheel: (d, ev) => cmd.comTune(ev?.shiftKey ? d : d * 0.025), click: (b) => cmd.comTune(b === 2 ? -0.025 : 0.025) });
    this.interactive(btn(-0.02, 0.183, 0.03, 0.012), { label: 'Direct-To nearest airport', click: () => this.onDirectTo?.(), value: () => (this.nav?.target ? this.nav.target.ident : '—') });
    this.interactive(btn(0.025, 0.183, 0.03, 0.012), { label: 'Transponder mode STBY/ALT', click: () => cmd.xpdrMode(), value: () => `${ac.avionics.xpdrCode} ${ac.avionics.xpdrMode}` });
    for (let i = 0; i < 4; i++) this.interactive(knob(-0.06 + i * 0.02, 0.165, 0.006), { label: `Squawk digit ${i + 1}`, value: () => ac.avionics.xpdrCode, wheel: (d) => cmd.xpdrDigit(i, d > 0 ? 1 : -1), click: (b) => cmd.xpdrDigit(i, b === 2 ? -1 : 1) });
    this.interactive(btn(-0.33, 0.385, 0.03, 0.012, white), { label: 'Annunciator TEST (hold)', down: () => { this.annTest = true; }, up: () => { this.annTest = false; } });

    // --- Switch row (rocker switches) ---
    this.switchMeshes = {};
    SWITCHES.forEach(([name, label], i) => {
      const x = -0.49 + i * 0.034, y = -0.09;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.034, 0.014), name === 'battery' || name === 'alternator' ? red : white);
      m.position.set(x, y, PANEL_Z + 0.04); this.root.add(m);
      this.switchMeshes[name] = m;
      this.interactive(m, { label: `${label} switch`, value: () => (ac.elec.switches[name] ? 'ON' : 'OFF'), click: () => cmd.toggleSwitch(name) });
      const lbl = this.addGauge('lbl' + name, x, y - 0.03, 0.034, 0.012, 96, (g, W) => { g.fillStyle = '#2b2c2f'; g.fillRect(0, 0, W, W); g.fillStyle = '#ddd'; g.font = 'bold 18px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, W / 2, (W * 0.012) / 0.034 / 2 + 1); });
      lbl.static = true;
    });
    // Magneto / ignition key
    const keyBase = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.01, 20).rotateX(Math.PI / 2), chrome); keyBase.position.set(-0.53, -0.02, PANEL_Z + 0.035); this.root.add(keyBase);
    this.key = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.03, 0.02), chrome); this.key.position.set(-0.53, -0.02, PANEL_Z + 0.05); this.root.add(this.key);
    this.interactive(keyBase, {
      label: 'Ignition: left/right click = rotate OFF·R·L·BOTH·START (hold START)', value: () => MAG_LABEL[ac.engine.magnetos],
      click: (b) => { if (b === 2) cmd.magnetos(-1); else if (ac.engine.magnetos < 3) cmd.magnetos(1); },
      down: (b) => { if (b === 0 && ac.engine.magnetos === 3) cmd.setMagnetos(4); }, up: () => cmd.releaseStarter(),
    });
    this.key.userData.ctl = keyBase.userData.ctl; this.controls.push(this.key);

    // --- Engine controls: throttle (black), mixture (red) push-pull plungers ---
    const plunger = (x, mat) => {
      const g = new THREE.Group(); g.position.set(x, -0.15, PANEL_Z + 0.03); this.root.add(g);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.12, 8).rotateX(Math.PI / 2), chrome); shaft.position.z = 0.06; g.add(shaft);
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 16).rotateX(Math.PI / 2), mat); g.add(k);
      return { g, k };
    };
    this.throttleCtl = plunger(-0.02, black);
    this.mixtureCtl = plunger(0.05, red);
    this.interactive(this.throttleCtl.k, { label: 'Throttle (drag / scroll)', value: () => `${Math.round(ac.controls.throttle * 100)}%`, drag: (dx, dy) => cmd.throttle(-dy * 0.004), wheel: (d) => cmd.throttle(d * 0.03) });
    this.interactive(this.mixtureCtl.k, { label: 'Mixture (drag / scroll)', value: () => `${Math.round(ac.controls.mixture * 100)}%`, drag: (dx, dy) => cmd.mixture(-dy * 0.004), wheel: (d) => cmd.mixture(d * 0.03) });

    // --- Flap lever (right side) with position indicator ---
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.13, 0.005), black); slot.position.set(0.22, -0.11, PANEL_Z + 0.033); this.root.add(slot);
    this.flapLever = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.016, 0.04), white); this.flapLever.position.set(0.22, -0.05, PANEL_Z + 0.05); this.root.add(this.flapLever);
    this.interactive(this.flapLever, { label: 'Flap lever: click up/down half, scroll', value: () => `${ac.cfg.aero.flaps[ac.controls.flapsLever].deg}° (actual ${ac.flapDeg.toFixed(0)}°)`, click: (b) => cmd.flaps(b === 2 ? -1 : 1), wheel: (d) => cmd.flaps(d > 0 ? -1 : 1) });
    this.addGauge('flapScale', 0.25, -0.11, 0.025, 0.13, 64, (g, W) => { const H = (W * 0.13) / 0.025; g.fillStyle = '#2b2c2f'; g.fillRect(0, 0, W, H); g.fillStyle = '#ddd'; g.font = 'bold 18px Arial'; g.textAlign = 'center'; ['0', '10', '20', 'FULL'].forEach((t, i) => g.fillText(t, W / 2, 20 + i * (H - 40) / 3)); g.font = 'bold 14px Arial'; }).static = true;
    // Actual flap position indicator needle
    this.flapInd = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.003, 0.004), red); this.root.add(this.flapInd);

    // --- Trim wheel (console) ---
    this.trimWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 24).rotateZ(Math.PI / 2), black);
    this.trimWheel.position.set(0, -0.36, -0.62); this.root.add(this.trimWheel);
    this.interactive(this.trimWheel, { label: 'Elevator trim (scroll / drag)', value: () => `${ac.controls.trim > 0 ? 'NOSE UP' : 'NOSE DN'} ${Math.abs(Math.round(ac.controls.trim * 100))}%`, wheel: (d) => cmd.trim(d * 0.02), drag: (dx, dy) => cmd.trim(-dy * 0.003) });
    // --- Fuel selector (floor) ---
    this.fuelSel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.12), red); this.fuelSel.position.set(0, -0.6, -0.4); this.root.add(this.fuelSel);
    const fsBase = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.01, 24), dark); fsBase.position.set(0, -0.61, -0.4); this.root.add(fsBase);
    this.interactive(this.fuelSel, { label: 'Fuel selector LEFT/BOTH/RIGHT/OFF', value: () => ac.fuel.selector, click: (b) => cmd.fuelSelector(b === 2 ? -1 : 1) });
    this.fuelSel.userData.base = fsBase;
    // --- Parking brake handle ---
    this.pbrake = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.018, 0.02), black); this.pbrake.position.set(-0.45, -0.3, PANEL_Z + 0.04); this.root.add(this.pbrake);
    this.interactive(this.pbrake, { label: 'Parking brake', value: () => (ac.controls.parkingBrake ? 'SET' : 'RELEASED'), click: () => cmd.toggleParkingBrake() });
    // --- Panel light dimmer ---
    this.dimmer = knob(-0.16, -0.17, 0.008);
    this.panelLight = 0.6;
    this.interactive(this.dimmer, { label: 'Panel lights dimmer', value: () => `${Math.round(this.panelLight * 100)}%`, wheel: (d) => { this.panelLight = Math.min(1, Math.max(0, this.panelLight + d * 0.1)); } });

    // --- Yoke (animated) and rudder pedals ---
    this.yoke = new THREE.Group(); this.yoke.position.set(-0.3, 0.02, PANEL_Z + 0.05); this.root.add(this.yoke);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8).rotateX(Math.PI / 2), chrome); col.position.z = 0.15; this.yoke.add(col);
    this.yokeHead = new THREE.Group(); this.yokeHead.position.z = 0.3; this.yoke.add(this.yokeHead);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.03), black); this.yokeHead.add(bar);
    for (const s of [-1, 1]) { const h = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.035), black); h.position.set(s * 0.13, 0.04, 0); this.yokeHead.add(h); }
    this.pedals = [];
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.02), black); p.position.set(-0.3 + s * 0.09, -0.52, -0.85); p.rotation.x = -0.5; this.root.add(p); this.pedals.push(p); }
    // Panel flood light for night
    this.flood = new THREE.PointLight(0xffd8a8, 0, 1.2, 1.5); this.flood.position.set(-0.2, 0.42, PANEL_Z + 0.2); this.root.add(this.flood);
    this.frame = 0;
  }

  setNav(nav) { this.nav = nav; }

  /** Update control animations each frame; redraw instruments at ~30 Hz. */
  update(dt, ambientDark) {
    const ac = this.ac, k = ac.controls;
    this.yoke.position.z = PANEL_Z + 0.05 + 0.06 - k.elevator * 0.07;
    this.yokeHead.rotation.z = -k.aileron * 0.6;
    this.pedals[0].position.z = -0.85 + k.rudder * 0.04; this.pedals[1].position.z = -0.85 - k.rudder * 0.04;
    this.throttleCtl.g.position.z = PANEL_Z + 0.03 + (1 - k.throttle) * 0.07;
    this.mixtureCtl.g.position.z = PANEL_Z + 0.03 + (1 - k.mixture) * 0.07;
    this.flapLever.position.y = -0.05 - (k.flapsLever / 3) * 0.12;
    this.flapInd.position.set(0.207, -0.05 - (ac.flapDeg / 30) * 0.12, PANEL_Z + 0.04);
    this.trimWheel.rotation.x = -k.trim * 4;
    this.fuelSel.rotation.y = { LEFT: 0.9, BOTH: 0, RIGHT: -0.9, OFF: Math.PI / 2 }[ac.fuel.selector];
    this.pbrake.position.z = PANEL_Z + 0.04 + (k.parkingBrake ? 0.05 : 0);
    this.key.rotation.z = -[0, 0.5, 1.0, 1.5, 2.0][ac.engine.magnetos];
    for (const [name, m] of Object.entries(this.switchMeshes)) m.rotation.x = ac.elec.switches[name] ? -0.35 : 0.35;
    const lit = ac.elec.busVolts > 18 ? this.panelLight : 0;
    const panelGlow = lit * ambientDark;
    this.flood.intensity = panelGlow * 0.6;
    this.frame++;
    const redraw = this.frame % 2 === 0;
    for (const g of this.gauges) {
      g.mat.emissiveIntensity = panelGlow * 0.55;
      if (g.static && g.drawn) continue;
      if (!redraw && g.drawn) continue;
      g.draw(g.ctx, g.canvas.width, ac);
      g.tex.needsUpdate = true;
      g.drawn = true;
    }
  }
}

export { KT, SELECTOR };
