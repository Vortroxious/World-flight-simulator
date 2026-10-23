// Interactive glass flight decks for the Phase 3 fleet, laid out around each aircraft's eye point:
//   glass-airliner : 2×PFD + 2×ND + upper EICAS + standby, glareshield MCP (SPD/HDG/ALT/VS, AP, A/THR, modes,
//                    baro, ND range), master warning/caution, pedestal thrust levers (+reverse latches),
//                    speedbrake, flap and gear levers, parking brake, CDU, overhead (lights, APU, hydraulics,
//                    packs, engine start/fuel), sidestick or yoke.
//   glass-turboprop: PFD/MFD/engine display, power/prop/condition levers, overhead start panel, yoke.
//   fighter-hud    : conformal HUD on a combiner glass, two MFDs, throttle and side-stick, gear handle.
// Model space matches the exterior model (x right, y up, z aft, origin at CG). Interactive meshes use the same
// {label, value, click, wheel, drag, down, up} contract as the GA cockpit.
import * as THREE from 'three';
import { drawPFD, drawND, drawEICAS, drawStandby, drawHUD, drawFighterMFD, text, C } from './displays.js';
import { Cdu, keyLayout } from './cdu.js';

const B = (x, y, z) => new THREE.Vector3(y, -z, -x);
const ND_RANGES = [5, 10, 20, 40, 80, 160];

function canvasPlane(w, h, px, { transparent = false } = {}) {
  const c = document.createElement('canvas');
  c.width = px; c.height = Math.round((px * h) / w);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mat = transparent
    ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
    : new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  return { mesh, canvas: c, ctx: c.getContext('2d'), tex, mat };
}

export class GlassCockpit {
  constructor(ac, cmd, { model = null, provider = {} } = {}) {
    this.ac = ac; this.cmd = cmd; this.model = model;
    this.root = new THREE.Group(); this.root.name = 'cockpit';
    this.controls = []; this.screens = []; this.anim = [];
    this.nd = { range: 20, airports: [] };
    this.cdu = new Cdu(ac, provider); this.provider = provider;
    this.type = ac.cfg.cockpit?.type ?? 'glass-airliner';
    this.frame = 0; this.panelLight = 0.7; this.nav = null;
    this.mats = {
      panel: new THREE.MeshStandardMaterial({ color: ac.cfg.fbw?.law === 'airbus' ? 0x4a5560 : 0x4c4f55, roughness: 0.8 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.7 }),
      black: new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.6 }),
      knob: new THREE.MeshStandardMaterial({ color: 0x202226, roughness: 0.4, metalness: 0.3 }),
      white: new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 }),
      red: new THREE.MeshStandardMaterial({ color: 0xb01818, roughness: 0.5 }),
      blue: new THREE.MeshStandardMaterial({ color: 0x2a55b0, roughness: 0.5 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.25, metalness: 0.85 }),
      seat: new THREE.MeshStandardMaterial({ color: 0x2f3237, roughness: 1 }),
    };
    const ep = ac.cfg.geometry.eyePoint;
    this.E = B(ep[0], ep[1], ep[2]); this.eyeX = ep[0];
    if (this.type === 'fighter-hud') this.buildFighter(); else this.buildTransport();
    this.flood = new THREE.PointLight(0xffe0b8, 0, 2.5, 1.5); this.flood.position.copy(this.E).add(new THREE.Vector3(0, 0.3, -0.3)); this.root.add(this.flood);
  }

  setNav(nav) { this.nav = nav; }
  interactive(mesh, ctl) { mesh.userData.ctl = ctl; this.controls.push(mesh); return mesh; }
  add(geo, mat, x, y, z, parent = this.root) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = false; m.receiveShadow = true; parent.add(m); return m; }
  screen(w, h, px, x, y, z, draw, every = 2, opts = {}) {
    const s = canvasPlane(w, h, px, opts); s.mesh.position.set(x, y, z); this.root.add(s.mesh);
    s.draw = draw; s.every = every; this.screens.push(s); return s;
  }
  button(x, y, z, label, ctl, { w = 0.03, h = 0.02, mat = this.mats.dark, lit = null } = {}) {
    const m = this.add(new THREE.BoxGeometry(w, h, 0.012), mat.clone(), x, y, z);
    if (lit) this.anim.push(() => { const on = lit(); m.material.emissive.setHex(on ? 0x2aff7a : 0x000000); m.material.emissiveIntensity = on ? 0.8 : 0; });
    return this.interactive(m, { label, ...ctl });
  }
  knob(x, y, z, r, label, ctl) {
    const m = this.add(new THREE.CylinderGeometry(r, r, 0.02, 16).rotateX(Math.PI / 2), this.mats.knob, x, y, z);
    return this.interactive(m, { label, ...ctl });
  }

  // ===================================================================== transports
  buildTransport() {
    const ac = this.ac, cmd = this.cmd, ap = ac.autopilot, E = this.E, M = this.mats;
    const turboprop = this.type === 'glass-turboprop', ex = E.x, n = ac.engines.length;
    // Shell (inward lining with window apertures) from the exterior model
    const shell = this.model?.flightDeckShell?.(this.eyeX); if (shell) this.root.add(shell);
    const pz = E.z - (turboprop ? 0.72 : 0.86), top = E.y - (turboprop ? 0.16 : 0.18), bot = E.y - 0.66;
    const halfW = Math.min(ac.cfg.geometry.fuselageDia / 2 * 0.82, Math.max(0.65, Math.abs(ex) + (turboprop ? 0.4 : 0.42)));
    this.add(new THREE.BoxGeometry(halfW * 2, top - bot, 0.05), M.panel, 0, (top + bot) / 2, pz - 0.025);
    // Glareshield + floor + seats
    const glareD = 0.32;
    this.add(new THREE.BoxGeometry(halfW * 2 + 0.06, 0.08, glareD), M.black, 0, top + 0.04, pz + glareD / 2 - 0.05);
    this.add(new THREE.BoxGeometry(halfW * 2 + 0.4, 0.03, 2.4), M.dark, 0, E.y - 1.12, E.z + 0.2);
    for (const s of [-1, 1]) {
      this.add(new THREE.BoxGeometry(0.5, 0.12, 0.5), M.seat, s * Math.abs(ex), E.y - 0.75, E.z + 0.25);
      this.add(new THREE.BoxGeometry(0.5, 0.8, 0.12), M.seat, s * Math.abs(ex), E.y - 0.3, E.z + 0.62);
    }
    // ---- Displays ----
    const D = turboprop ? 0.18 : 0.2, dy = (top + bot) / 2 + 0.03, dz = pz + 0.004;
    const pfd = (x) => this.screen(D, D, 512, x, dy, dz, (g, W, H) => drawPFD(g, W, H, ac), 2);
    const nd = (x) => this.screen(D, D, 512, x, dy, dz, (g, W, H) => drawND(g, W, H, ac, this.nd), 3);
    pfd(ex - D * 0.6); nd(ex + D * 0.6); pfd(-ex + D * 0.6); nd(-ex - D * 0.6);
    const ew = turboprop ? 0.17 : 0.2;
    this.screen(ew, ew * 1.15, 512, 0, dy + 0.012, dz, (g, W, H) => drawEICAS(g, W, H, ac), 4);
    this.screen(0.075, 0.075, 192, 0, bot + 0.055, dz, (g, W, H) => drawStandby(g, W, H, ac), 3);
    // ---- Glareshield MCP ----
    const my = top + 0.035, mz = pz + glareD - 0.05 + 0.002, mw = Math.min(1.0, halfW * 1.2);
    const mcp = this.screen(mw, 0.06, 1024, 0, my, mz + 0.001, (g, W, H) => this.drawMcp(g, W, H), 3);
    mcp.mesh.position.z = mz;
    const kz = mz + 0.012, fx = (f) => -mw / 2 + f * mw;
    const k = (f, lbl, field, steps) => this.knob(fx(f), my - 0.008, kz, 0.011, lbl, {
      value: () => (field === 'alt' ? `${ap.sel.alt} ft` : field === 'vs' ? `${ap.sel.vs} fpm` : field === 'hdg' ? `${ap.sel.hdg}°` : `${ap.sel.spd} kt`),
      wheel: (d, ev) => cmd.apBump(field, d * (ev?.shiftKey ? steps[1] : steps[0])), click: (b) => (b === 2 ? cmd.apSync(field) : cmd.apBump(field, steps[0])),
    });
    k(0.12, 'Speed select (scroll; shift = ×10; right-click = sync)', 'spd', [1, 10]);
    k(0.37, 'Heading select (scroll; shift = ×10; right-click = sync)', 'hdg', [1, 10]);
    k(0.66, 'Altitude select (scroll ±100; shift ±1000; right-click = sync)', 'alt', [100, 1000]);
    k(0.86, 'Vertical speed select (scroll ±100)', 'vs', [100, 500]);
    const bt = (f, lbl, label, fn, lit, row = 0) => this.button(fx(f), my - 0.008 - row * 0.0, kz, label, { click: fn, value: () => (lit() ? 'ON' : 'off') }, { w: 0.032, h: 0.016, lit });
    bt(0.22, 'A/THR', 'Autothrottle', () => cmd.atToggle(), () => ap.atEngaged);
    bt(0.47, 'HDG', 'Heading mode', () => cmd.apLateral('HDG'), () => ap.lat === 'HDG');
    bt(0.52, 'NAV', 'NAV (direct-to course)', () => cmd.apLateral('NAV'), () => ap.lat === 'NAV' || ap.latArm === 'NAV');
    bt(0.57, 'APP', 'Approach (LOC + G/S)', () => cmd.apLateral('APP'), () => ap.latArm === 'LOC' || ap.lat === 'LOC');
    bt(0.74, 'ALT', 'Altitude hold', () => cmd.apVertical('ALT'), () => ap.vert === 'ALT' || ap.vert === 'ALT*');
    bt(0.79, ap.cfg.flcLabel ?? 'FLC', 'Level change / FLC', () => cmd.apVertical('FLC'), () => ap.vert === 'FLC');
    bt(0.93, 'VS', 'Vertical speed mode', () => cmd.apVertical('VS'), () => ap.vert === 'VS');
    bt(0.29, 'AP', 'Autopilot engage', () => cmd.apToggle(), () => ap.engaged);
    bt(0.03, 'FD', 'Flight director', () => cmd.fdToggle(), () => ap.fd);
    // EFIS: baro + ND range (captain side, left of MCP)
    this.knob(-mw / 2 - 0.06, my - 0.008, kz, 0.012, 'Baro (scroll; click = STD/QNH)', { value: () => `${Math.round(ac.inst.kollsman / 100)} hPa`, wheel: (d) => cmd.kollsman(d * 0.01), click: () => { this._qnh = this._qnh ?? ac.inst.kollsman; if (Math.abs(ac.inst.kollsman - 101325) < 1) cmd.setKollsman(this._qnh); else { this._qnh = ac.inst.kollsman; cmd.setKollsman(101325); } } });
    this.knob(-mw / 2 - 0.11, my - 0.008, kz, 0.012, 'ND range (scroll)', { value: () => `${this.nd.range} NM`, wheel: (d) => { const i = ND_RANGES.indexOf(this.nd.range); this.nd.range = ND_RANGES[Math.max(0, Math.min(ND_RANGES.length - 1, i + (d > 0 ? 1 : -1)))]; }, click: (b) => { const i = ND_RANGES.indexOf(this.nd.range); this.nd.range = ND_RANGES[(i + (b === 2 ? ND_RANGES.length - 1 : 1)) % ND_RANGES.length]; } });
    // Master warning / caution
    for (const s of [-1, 1]) {
      const xw = s * (mw / 2 + 0.05);
      this.button(xw, my + 0.005, kz, 'MASTER WARNING (click to reset)', { click: () => cmd.masterReset() }, { w: 0.035, h: 0.018, mat: M.red, lit: () => ac.masterWarning && Math.floor(performance.now() / 350) % 2 === 0 });
      this.button(xw, my - 0.018, kz, 'MASTER CAUTION (click to reset)', { click: () => cmd.masterReset() }, { w: 0.035, h: 0.018, mat: new THREE.MeshStandardMaterial({ color: 0x8a6a10 }), lit: () => ac.masterCaution });
    }
    // ---- Gear lever (centre panel) ----
    if (ac.cfg.gear.retractable) {
      const gx = turboprop ? 0.16 : 0.24, gy = bot + 0.12;
      this.add(new THREE.BoxGeometry(0.05, 0.14, 0.01), M.black, gx, gy, dz + 0.004);
      const lever = new THREE.Group(); lever.position.set(gx, gy, dz + 0.02); this.root.add(lever);
      const handle = this.add(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 16).rotateX(Math.PI / 2), M.white, 0, 0, 0.04, lever);
      this.add(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 8).rotateX(Math.PI / 2), M.chrome, 0, 0, 0.015, lever);
      this.interactive(handle, { label: 'Landing gear lever', value: () => `${ac.controls.gearDown ? 'DOWN' : 'UP'} (${ac.gearPos > 0.98 ? 'down & locked' : ac.gearPos < 0.02 ? 'up' : 'in transit'})`, click: () => cmd.gear() });
      this.anim.push(() => { lever.position.y = gy + (ac.controls.gearDown ? -0.04 : 0.04); });
    }
    // ---- Pedestal ----
    const pedTop = E.y - 0.62, pedZ0 = pz + 0.02, pedZ1 = E.z + 0.25, pw = turboprop ? 0.3 : 0.36;
    this.add(new THREE.BoxGeometry(pw, 0.45, pedZ1 - pedZ0), M.panel, 0, pedTop - 0.225, (pedZ0 + pedZ1) / 2);
    // Thrust / power levers
    const tlz = pedZ0 + 0.22;
    const levers = [];
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * (turboprop ? 0.04 : 0.06);
      const g = new THREE.Group(); g.position.set(x, pedTop, tlz); this.root.add(g);
      this.add(new THREE.BoxGeometry(0.012, 0.16, 0.012), M.chrome, 0, 0.08, 0, g);
      const h = this.add(new THREE.BoxGeometry(turboprop ? 0.03 : 0.045, 0.025, 0.03), M.black, 0, 0.165, 0, g);
      this.interactive(h, { label: `${turboprop ? 'Power' : 'Thrust'} lever ${i + 1} (drag / scroll; right-click = reverse)`, value: () => `${Math.round(ac.controls.throttle * 100)}%${ac.controls.reverse ? ' REV' : ''}`, drag: (dx, dy) => cmd.throttle(-dy * 0.004), wheel: (d) => cmd.throttle(d * 0.03), click: (b) => { if (b === 2) cmd.reverse(); } });
      levers.push(g);
    }
    this.anim.push(() => { const t = ac.controls.throttle, rev = ac.controls.reverse > 0; for (const g of levers) g.rotation.x = -0.6 + t * 1.1 + (rev ? -0.35 : 0); });
    if (turboprop) {
      // prop (blue) and condition (red) levers
      for (const [mat, label, get, set, xoff] of [[M.blue, 'Propeller levers (scroll: high RPM ↔ feather)', () => ac.controls.prop, (d) => cmd.prop(d), 0.1], [M.red, 'Condition levers (click: fuel cut-off / run, all engines)', () => (ac.engines.every((e) => e.fuelOn) ? 1 : 0), null, 0.13]]) {
        const g = new THREE.Group(); g.position.set(xoff, pedTop, tlz + 0.02); this.root.add(g);
        this.add(new THREE.BoxGeometry(0.01, 0.13, 0.01), M.chrome, 0, 0.065, 0, g);
        const h = this.add(new THREE.BoxGeometry(0.03, 0.022, 0.025), mat, 0, 0.135, 0, g);
        this.interactive(h, set ? { label, value: () => `${Math.round(get() * 100)}%`, wheel: (d) => set(d * 0.05), drag: (dx, dy) => set(-dy * 0.004) } : { label, value: () => (get() ? 'RUN' : 'CUT-OFF'), click: () => { const on = !ac.engines.every((e) => e.fuelOn); ac.engines.forEach((_, i) => cmd.engineFuel(i, on)); } });
        this.anim.push(() => { g.rotation.x = -0.5 + get() * 0.9; });
      }
    }
    // Speed brake (left) and flap (right) levers
    const sbG = new THREE.Group(); sbG.position.set(-pw / 2 + 0.035, pedTop, tlz + 0.02); this.root.add(sbG);
    this.add(new THREE.BoxGeometry(0.01, 0.12, 0.01), M.chrome, 0, 0.06, 0, sbG);
    const sbH = this.add(new THREE.BoxGeometry(0.03, 0.02, 0.035), M.white, 0, 0.12, 0, sbG);
    if (ac.cfg.aero.spoilers) this.interactive(sbH, { label: 'Speed brake (scroll / drag; click = arm ground spoilers)', value: () => `${Math.round(ac.controls.speedbrake * 100)}%${ac.controls.spoilersArmed ? ' ARMED' : ''}`, wheel: (d) => cmd.speedbrake(d * 0.15), drag: (dx, dy) => cmd.speedbrake(dy * 0.006), click: (b) => (b === 0 ? cmd.armSpoilers() : cmd.setSpeedbrake(0)) });
    this.anim.push(() => { sbG.rotation.x = -ac.controls.speedbrake * 0.7; sbG.position.y = pedTop + (ac.controls.spoilersArmed ? 0.012 : 0); });
    const flG = new THREE.Group(); flG.position.set(pw / 2 - 0.035, pedTop, tlz + 0.02); this.root.add(flG);
    this.add(new THREE.BoxGeometry(0.01, 0.12, 0.01), M.chrome, 0, 0.06, 0, flG);
    const flH = this.add(new THREE.BoxGeometry(0.04, 0.02, 0.03), M.white, 0, 0.12, 0, flG);
    const nf = ac.cfg.aero.flaps.length - 1;
    this.interactive(flH, { label: 'Flap lever (click: left = extend, right = retract; scroll)', value: () => `${ac.cfg.aero.flaps[ac.controls.flapsLever].label} (actual ${ac.flapDeg.toFixed(0)}°)`, click: (b) => cmd.flaps(b === 2 ? -1 : 1), wheel: (d) => cmd.flaps(d > 0 ? -1 : 1) });
    this.anim.push(() => { flG.rotation.x = -0.4 + (ac.controls.flapsLever / Math.max(nf, 1)) * 0.9; });
    // Parking brake
    this.button(0, pedTop + 0.01, pedZ1 - 0.12, 'Parking brake', { click: () => cmd.toggleParkingBrake(), value: () => (ac.controls.parkingBrake ? 'SET' : 'OFF') }, { w: 0.06, h: 0.025, mat: M.red, lit: () => ac.controls.parkingBrake }).rotation.x = -Math.PI / 2;
    // CDU on the pedestal (tilted towards the pilots)
    const cw = turboprop ? 0.14 : 0.16, ch = cw * 1.3, cduY = pedTop + 0.05, cduZ = tlz + 0.2;
    const cdu = this.screen(cw, ch, 512, 0, cduY, cduZ, (g, W, H) => { this.cdu.refresh(performance.now() / 1000); this.cdu.draw(g, W, H); }, 6);
    cdu.mesh.rotation.x = -1.0;
    for (const kk of keyLayout()) {
      const hit = new THREE.Mesh(new THREE.PlaneGeometry(kk.w * cw, kk.h * ch), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set((kk.x + kk.w / 2 - 0.5) * cw, (0.5 - (kk.y + kk.h / 2)) * ch, 0.004); cdu.mesh.add(hit);
      this.interactive(hit, { label: `CDU ${kk.id}`, click: () => { this.cdu.key(kk.id); cdu.dirty = true; } });
    }
    // ---- Overhead panel ----
    const roof = ac.cfg.geometry.fuselageDia / 2 - (ac.cfg.geometry.eyePoint[2] - ((ac.cfg.layout.bellyZ + ac.cfg.layout.roofZ) / 2)) * -1;
    const oy = E.y + Math.min(0.42, Math.max(0.3, roof - 0.12)), oz = E.z - 0.12, ow = Math.min(halfW * 1.1, 1.1), oh = 0.45;
    const over = this.screen(ow, oh, 768, 0, oy, oz, (g, W, H) => this.drawOverhead(g, W, H), 8);
    over.mesh.rotation.x = Math.PI / 2 - 0.35; // faces down and aft towards the pilots
    this.add(new THREE.BoxGeometry(ow + 0.04, 0.02, oh + 0.04), M.panel, 0, oy + 0.012, oz).rotation.x = -0.35;
    this.overheadButtons(over, ow, oh);
    // ---- Sidestick or yoke ----
    if ((ac.cfg.cockpit?.input ?? 'yoke') === 'sidestick') {
      const sx = ex - 0.38;
      this.add(new THREE.BoxGeometry(0.16, 0.06, 0.4), M.dark, sx, E.y - 0.62, E.z - 0.15);
      this.stick = new THREE.Group(); this.stick.position.set(sx, E.y - 0.59, E.z - 0.2); this.root.add(this.stick);
      this.add(new THREE.CylinderGeometry(0.016, 0.02, 0.15, 10), M.black, 0, 0.075, 0, this.stick);
      this.anim.push(() => { const s = ac.controls; this.stick.rotation.x = -s.elevator * 0.3; this.stick.rotation.z = -s.aileron * 0.3; });
    } else {
      this.yoke = new THREE.Group(); this.yoke.position.set(ex, E.y - 0.42, pz + 0.05); this.root.add(this.yoke);
      this.add(new THREE.CylinderGeometry(0.018, 0.018, 0.32, 8).rotateX(Math.PI / 2), M.dark, 0, 0, 0.16, this.yoke);
      this.yokeHead = new THREE.Group(); this.yokeHead.position.z = 0.32; this.yoke.add(this.yokeHead);
      this.add(new THREE.BoxGeometry(0.3, 0.035, 0.035), M.black, 0, 0, 0, this.yokeHead);
      for (const s of [-1, 1]) this.add(new THREE.BoxGeometry(0.035, 0.12, 0.04), M.black, s * 0.15, 0.045, 0, this.yokeHead);
      this.anim.push(() => { const s = ac.controls; this.yoke.position.z = pz + 0.05 + 0.05 - s.elevator * 0.07; this.yokeHead.rotation.z = -s.aileron * 0.7; });
    }
  }

  overheadButtons(over, ow, oh) {
    const ac = this.ac, cmd = this.cmd;
    const items = this.overheadItems();
    this.overItems = items;
    items.forEach((it) => {
      const hit = new THREE.Mesh(new THREE.PlaneGeometry(it.w * ow, it.h * oh), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set((it.x + it.w / 2 - 0.5) * ow, (0.5 - (it.y + it.h / 2)) * oh, 0.004); over.mesh.add(hit);
      this.interactive(hit, { label: it.label, value: () => (it.on() ? 'ON' : 'OFF'), click: () => { it.click(); over.dirty = true; } });
    });
    void ac; void cmd;
  }

  overheadItems() {
    const ac = this.ac, cmd = this.cmd, sw = ac.elec.switches, out = [];
    const row = (y, defs) => defs.forEach((d, i) => out.push({ ...d, x: 0.04 + i * (0.92 / defs.length), y, w: 0.92 / defs.length - 0.02, h: 0.13 }));
    const sws = (name, label) => ({ text: label, label: `${label} switch`, on: () => sw[name], click: () => cmd.toggleSwitch(name) });
    row(0.08, [{ text: 'BAT', label: 'Battery + generators', on: () => sw.battery, click: () => { const v = !sw.battery; cmd.setSwitch('battery', v); cmd.setSwitch('alternator', v); cmd.setSwitch('avionics', v); } },
      sws('navLights', 'NAV'), sws('beacon', 'BCN'), sws('strobe', 'STROBE'), sws('landingLight', 'LAND'), sws('taxiLight', 'TAXI')]);
    row(0.3, [
      ...(ac.apu.present ? [{ text: 'APU', label: 'APU master / start', on: () => ac.apu.switch, click: () => cmd.apu(), status: () => ac.apu.state }] : []),
      ...(ac.hyd.systems.length ? [{ text: 'HYD PUMPS', label: 'Hydraulic pumps (all)', on: () => ac.hyd.systems.every((h) => h.engPump), click: () => cmd.hydPumps() }] : []),
      { text: 'PACKS', label: 'Air conditioning packs', on: () => ac.press.packs, click: () => cmd.packs() },
      sws('pitotHeat', 'PROBE HT'), sws('fuelPump', 'FUEL PUMPS')]);
    row(0.52, ac.engines.map((e, i) => ({ text: `ENG ${i + 1} START`, label: `Engine ${i + 1} starter`, on: () => e.starter, click: () => cmd.engineStart(i), status: () => (e.running ? 'RUN' : e.starting ? 'START' : '') })));
    row(0.74, ac.engines.map((e, i) => ({ text: `ENG ${i + 1} FUEL`, label: `Engine ${i + 1} master (fuel)`, on: () => e.fuelOn, click: () => cmd.engineFuel(i) })));
    return out;
  }

  drawOverhead(g, W, H) {
    g.fillStyle = '#3d454e'; g.fillRect(0, 0, W, H);
    const powered = this.ac.elec.busVolts > 18 || this.ac.elec.switches.battery;
    text(g, 'ELEC / LIGHTS', W * 0.5, H * 0.04, H * 0.03, '#ddd'); text(g, 'APU · HYD · AIR', W * 0.5, H * 0.26, H * 0.03, '#ddd');
    text(g, 'ENGINE START', W * 0.5, H * 0.48, H * 0.03, '#ddd'); text(g, 'ENGINE MASTER / FUEL', W * 0.5, H * 0.7, H * 0.03, '#ddd');
    for (const it of this.overItems ?? []) {
      const x = it.x * W, y = it.y * H, w = it.w * W, h = it.h * H, on = it.on();
      g.fillStyle = '#1b1e22'; g.fillRect(x, y, w, h);
      g.fillStyle = on && powered ? '#2be36a' : '#2a2e33'; g.fillRect(x + w * 0.12, y + h * 0.58, w * 0.76, h * 0.28);
      text(g, on ? 'ON' : 'OFF', x + w / 2, y + h * 0.72, h * 0.22, on && powered ? '#04210c' : '#888');
      text(g, it.text, x + w / 2, y + h * 0.3, Math.min(h * 0.26, w * 0.16), '#f0f0f0');
      const st = it.status?.(); if (st) text(g, st, x + w / 2, y + h * 1.12, h * 0.2, C.cyan);
    }
  }

  drawMcp(g, W, H) {
    const ap = this.ac.autopilot, powered = this.ac.elec.busVolts > 18;
    g.fillStyle = '#31373e'; g.fillRect(0, 0, W, H);
    const win = (f, label, val) => { const x = f * W; g.fillStyle = '#05080a'; g.fillRect(x - W * 0.05, H * 0.2, W * 0.1, H * 0.42); text(g, label, x, H * 0.12, H * 0.16, '#ddd'); if (powered) text(g, val, x, H * 0.42, H * 0.3, '#ffb21a'); };
    win(0.12, 'SPD', String(ap.sel.spd)); win(0.37, 'HDG', String(ap.sel.hdg).padStart(3, '0')); win(0.66, 'ALT', String(ap.sel.alt)); win(0.86, 'V/S', (ap.sel.vs > 0 ? '+' : '') + ap.sel.vs);
    const lbl = (f, s) => text(g, s, f * W, H * 0.88, H * 0.15, '#ddd');
    lbl(0.03, 'FD'); lbl(0.22, 'A/THR'); lbl(0.29, 'AP'); lbl(0.47, 'HDG'); lbl(0.52, 'NAV'); lbl(0.57, 'APP'); lbl(0.74, 'ALT'); lbl(0.79, ap.cfg.flcLabel ?? 'FLC'); lbl(0.93, 'VS');
  }

  // ===================================================================== fighter
  buildFighter() {
    const ac = this.ac, cmd = this.cmd, E = this.E, M = this.mats, ap = ac.autopilot;
    const pz = E.z - 0.62;
    // tub, side rails, panel, glareshield
    this.add(new THREE.BoxGeometry(0.72, 0.36, 0.05), M.dark, 0, E.y - 0.38, pz);
    this.add(new THREE.BoxGeometry(0.3, 0.05, 0.22), M.black, 0, E.y - 0.18, pz + 0.08);
    for (const s of [-1, 1]) this.add(new THREE.BoxGeometry(0.12, 0.08, 1.3), M.dark, s * 0.36, E.y - 0.5, E.z - 0.05);
    this.add(new THREE.BoxGeometry(0.5, 0.8, 0.12), M.seat, 0, E.y - 0.45, E.z + 0.35);
    // canopy bow behind the head
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.02, 6, 24, Math.PI), M.dark); bow.position.set(0, E.y - 0.3, E.z + 0.45); this.root.add(bow);
    // HUD combiner (conformal: its angular size defines the symbology scale)
    const hz = E.z - 0.52, hh = 0.15, fov = 2 * Math.atan(hh / 2 / 0.52) * 180 / Math.PI;
    const hud = this.screen(0.15, hh, 640, 0, E.y - 0.02, hz, (g, W, H) => drawHUD(g, W, H, ac, fov), 1, { transparent: true });
    hud.mesh.renderOrder = 10;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.012, 0.03), M.black); frame.position.set(0, E.y - 0.1, hz); this.root.add(frame);
    // MFDs
    this.screen(0.13, 0.13, 384, -0.16, E.y - 0.36, pz + 0.03, (g, W, H) => drawFighterMFD(g, W, H, ac), 4);
    this.nd.range = 40;
    this.screen(0.13, 0.13, 384, 0.16, E.y - 0.36, pz + 0.03, (g, W, H) => drawND(g, W, H, ac, this.nd), 4);
    // gear handle (left panel)
    const gh = this.add(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 12).rotateX(Math.PI / 2), M.white, -0.3, E.y - 0.3, pz + 0.05);
    this.interactive(gh, { label: 'Landing gear handle', value: () => (ac.controls.gearDown ? 'DOWN' : 'UP'), click: () => cmd.gear() });
    this.anim.push(() => { gh.position.y = E.y - 0.3 + (ac.controls.gearDown ? -0.03 : 0.03); });
    // AP panel (up-front)
    const bt = (x, label, fn, lit) => this.button(x, E.y - 0.24, pz + 0.04, label, { click: fn, value: () => (lit() ? 'ON' : 'off') }, { w: 0.03, h: 0.016, lit });
    bt(-0.07, 'Autopilot (attitude hold / heading select)', () => cmd.apToggle(), () => ap.engaged);
    bt(-0.03, 'Heading select', () => cmd.apLateral('HDG'), () => ap.lat === 'HDG');
    bt(0.01, 'Altitude hold', () => cmd.apVertical('ALT'), () => ap.vert === 'ALT' || ap.vert === 'ALT*');
    this.knob(0.06, E.y - 0.24, pz + 0.04, 0.01, 'Heading select (scroll)', { value: () => `${ap.sel.hdg}°`, wheel: (d, ev) => cmd.apBump('hdg', d * (ev?.shiftKey ? 10 : 1)), click: (b) => (b === 2 ? cmd.apSync('hdg') : cmd.apBump('hdg', 1)) });
    // throttle (left console) and side-stick (right console)
    this.thr = new THREE.Group(); this.thr.position.set(-0.36, E.y - 0.46, E.z - 0.2); this.root.add(this.thr);
    const th = this.add(new THREE.BoxGeometry(0.04, 0.09, 0.05), M.black, 0, 0.045, 0, this.thr);
    this.interactive(th, { label: 'Throttle (drag / scroll; full forward = afterburner)', value: () => `${Math.round(ac.controls.throttle * 100)}%${ac.engines[0].afterburner ? ' AB' : ''}`, drag: (dx, dy) => cmd.throttle(-dy * 0.004), wheel: (d) => cmd.throttle(d * 0.03) });
    this.stick = new THREE.Group(); this.stick.position.set(0.36, E.y - 0.46, E.z - 0.15); this.root.add(this.stick);
    this.add(new THREE.CylinderGeometry(0.014, 0.018, 0.12, 10), M.black, 0, 0.06, 0, this.stick);
    this.anim.push(() => {
      const s = ac.controls; this.thr.position.z = E.z - 0.2 - s.throttle * 0.12;
      this.stick.rotation.x = -s.elevator * 0.12; this.stick.rotation.z = -s.aileron * 0.12;
    });
    this.button(-0.25, E.y - 0.43, E.z - 0.35, 'Engine start (JFS)', { click: () => cmd.engineStart(0), value: () => (ac.engines[0].starter ? 'ON' : 'OFF') }, { w: 0.03, h: 0.02, lit: () => ac.engines[0].starter }).rotation.x = -Math.PI / 2;
    this.button(-0.29, E.y - 0.43, E.z - 0.35, 'Engine master / fuel', { click: () => cmd.engineFuel(0), value: () => (ac.engines[0].fuelOn ? 'ON' : 'OFF') }, { w: 0.03, h: 0.02, mat: M.red, lit: () => ac.engines[0].fuelOn }).rotation.x = -Math.PI / 2;
    this.button(-0.33, E.y - 0.43, E.z - 0.35, 'Main power (battery + generator)', { click: () => { const v = !ac.elec.switches.battery; cmd.setSwitch('battery', v); cmd.setSwitch('alternator', v); cmd.setSwitch('avionics', v); }, value: () => (ac.elec.switches.battery ? 'ON' : 'OFF') }, { w: 0.03, h: 0.02, lit: () => ac.elec.switches.battery }).rotation.x = -Math.PI / 2;
    this.button(0.27, E.y - 0.43, E.z - 0.35, 'Parking brake', { click: () => cmd.toggleParkingBrake(), value: () => (ac.controls.parkingBrake ? 'SET' : 'OFF') }, { w: 0.03, h: 0.02, mat: M.red, lit: () => ac.controls.parkingBrake }).rotation.x = -Math.PI / 2;
  }

  // ===================================================================== per frame
  update(dt, ambientDark) {
    this.frame++;
    for (const f of this.anim) f();
    const lit = this.ac.elec.busVolts > 18 ? this.panelLight : 0;
    this.flood.intensity = lit * ambientDark * 0.8;
    if (this.nav !== this._lastNav) this._lastNav = this.nav;
    this.nd.airports = this.provider.nearest ? (this.frame % 60 === 1 || !this._apts ? (this._apts = this.provider.nearest(8)) : this._apts) : [];
    for (const s of this.screens) {
      if (!s.dirty && this.frame % s.every !== 0 && s.drawn) continue;
      s.draw(s.ctx, s.canvas.width, s.canvas.height);
      s.tex.needsUpdate = true; s.drawn = true; s.dirty = false;
    }
  }
}
