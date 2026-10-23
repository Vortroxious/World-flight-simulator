// A flight session: spawns the aircraft at the chosen airport, runs the fixed-step simulation, and keeps
// rendering, cockpit, camera, audio, HUD, crash handling and replay in sync with simulated state.
import * as THREE from 'three';
import { Aircraft, SIM_DT } from '../sim/aircraft.js';
import { createCommands } from '../sim/commands.js';
import { Weather, WEATHER_PRESETS } from '../sim/weather/weather.js';
import { Recorder } from '../sim/damage/replay.js';
import { DAMAGE_MODES } from '../sim/damage/damage.js';
import { LocalFrame, distance, bearing, wrap360 } from '../geo/wgs84.js';
import { bodyToNed } from '../core/math.js';
import { KT, NM } from '../core/units.js';
import { createAircraftModel } from '../render/models/index.js';
import { Cockpit } from '../cockpit/cockpit.js';
import { CockpitInteraction } from '../cockpit/interaction.js';
import { CameraRig } from '../render/cameras.js';
import { Effects } from '../render/effects.js';
import { Input } from '../input/input.js';
import { Hud } from '../ui/hud.js';
import { DebugPanel } from '../ui/debug.js';
import { Loading, pauseMenu, crashReport, replayBar } from '../ui/overlays.js';
import { utcFromLocal } from './settings.js';
import { MAGS } from '../sim/fdm/propulsion/piston.js';
import { TouchControls, isTouchDevice } from '../ui/touch.js';

const TIME_ACCEL = [1, 8, 32, 128];

export class Flight {
  constructor(app, settings) {
    this.app = app; this.s = { ...settings, weather: { ...settings.weather } };
    this.paused = false; this.crashed = false; this.replaying = false; this.ended = false;
    this.acc = 0; this.timeAccel = 1; this.stats = { steps: 0 };
    this.override = null; // controls injected by the debug/test API
    this.nav = { mode: 'NRST', target: null, targetIdent: null }; this.navTimer = 0;
    this.frameF = new LocalFrame(0, 0, 0);
    this.lastLanding = '';
  }

  async load() {
    const app = this.app, s = this.s;
    const L = (this.loading = new Loading(app.ui));
    try {
      L.step(`Loading airport ${s.airport}`, 0.05);
      const ap = await app.airports.ensure(s.airport, true);
      if (!ap) throw new Error(`Airport ${s.airport} not found`);
      this.airport = ap;
      const spawns = ap.spawnPoints();
      const want = s.startMode === 'parking' ? 'parking' : 'runway';
      let spawn = spawns.find((p) => p.id === s.spawn && p.type === want) || spawns.find((p) => p.type === want) || spawns[0];
      // prefer the runway end most aligned with the wind when none chosen
      if (!s.spawn && want === 'runway') {
        const w = { ...WEATHER_PRESETS[s.weatherPreset], ...s.weather };
        spawn = spawns.filter((p) => p.type === 'runway').sort((a, b) => Math.cos(((b.heading - w.windDir) * Math.PI) / 180) * b.length - Math.cos(((a.heading - w.windDir) * Math.PI) / 180) * a.length)[0] || spawn;
      }
      this.spawn = spawn;
      L.step(`${ap.ident}: ${ap.layout.procedural ? 'procedural layout' : 'OpenStreetMap layout'}, ${ap.runways.length} runway(s), start ${spawn.id}`, 0.15);
      app.origin.set(spawn.lat, spawn.lon);
      if (ap.ident === 'KSFO' || distance(spawn.lat, spawn.lon, 37.62, -122.38) < 80000) await app.ensureBayAreaScenery(L);

      // Weather, time
      this.weather = new Weather({ ...WEATHER_PRESETS[s.weatherPreset], ...s.weather, seed: (Math.random() * 1e9) | 0 });
      this.date = utcFromLocal(s.localHour, spawn.lon, s.dayOfYear);

      // Terrain under the start position (physics tiles) - stream with timeout, fallback data otherwise.
      const start = s.startMode === 'approach' ? ap.approachPoint(spawn, s.approachNm * NM) : { lat: spawn.lat, lon: spawn.lon, alt: spawn.elev + 2 };
      const t0 = performance.now();
      while (!app.terrain.physicsReady(start.lat, start.lon) && performance.now() - t0 < 15000) {
        app.terrain.update({ lat: start.lat, lon: start.lon, alt: start.alt + 2 }, start);
        L.progress(0.2 + 0.6 * Math.min(1, app.terrain.stats.loaded / 30));
        await new Promise((r) => setTimeout(r, 50));
      }
      const tr = app.terrain.stats;
      L.step(app.terrain.physicsReady(start.lat, start.lon) ? `Terrain ready (${tr.online} streamed, ${tr.fallback} from bundled data)` : 'Terrain streaming slow — using bundled fallback elevation', 0.82, app.terrain.physicsReady(start.lat, start.lon) ? 'ok' : 'warn');

      // Aircraft
      const cfg = app.aircraft[s.aircraft];
      const ac = (this.ac = new Aircraft(cfg, { damageMode: s.damageMode, assist: { autoRudder: s.autoRudder }, seed: (Math.random() * 1e9) | 0 }));
      ac.magvar = app.db.magneticVariation(spawn.lat, spawn.lon);
      ac.inst.kollsman = this.weather.qnh;
      this.cmd = createCommands(ac, { onCommand: () => app.audio.click() });
      const env = this.env();
      if (s.startMode === 'approach') {
        ac.placeAirborne(start.lat, start.lon, start.alt, spawn.heading, cfg.limits.Vref, { flapsLever: 2, flightPathDeg: -3, atmo: this.weather.atmosphereConditions });
        ac.elec.switches.landingLight = ac.elec.switches.navLights = ac.elec.switches.strobe = ac.elec.switches.beacon = true;
        ac.controls.throttle *= 0.75; // descending on the glidepath
        ac.step(1 / 240, env);
      } else {
        ac.placeOnGround(spawn.lat, spawn.lon, spawn.heading, env.ground);
        if (s.coldDark) ac.setColdAndDark(); else ac.setReadyState();
        if (s.startMode === 'runway' && !s.coldDark) ac.controls.parkingBrake = false;
        if (s.startMode === 'runway' && !s.coldDark) ac.setBrakesHeld = true;
      }
      ac.inst.dgBug = Math.round(wrap360(spawn.heading - ac.magvar));
      L.step(`Aircraft ${cfg.name} placed (${s.coldDark ? 'cold & dark' : 'engine running'})`, 0.88);

      // Visuals
      this.model = createAircraftModel(ac.cfg);
      app.scene.add(this.model.root);
      this.model.root.matrixAutoUpdate = false;
      this.cockpit = new Cockpit(ac, this.cmd);
      this.model.root.add(this.cockpit.root);
      this.cockpit.onDirectTo = () => this.directTo();
      this.rig = new CameraRig(app.camera);
      this.rig.eye.set(cfg.geometry.eyePoint[1], -cfg.geometry.eyePoint[2], -cfg.geometry.eyePoint[0]);
      this.effects = new Effects(app.scene, app.origin, app.ground);
      this.recorder = new Recorder(30, 30);
      ac.damage.onEvent = (ev) => this.onDamageEvent(ev);

      // UI + input
      this.hud = new Hud(app.ui); this.hud.setVisible(s.hud);
      this.debug = new DebugPanel(app.ui);
      this.input = new Input(app.canvas, { sensitivity: s.sensitivity });
      this.bindInput();
      this.touchEnabled = s.touchControls === 'on' || (s.touchControls !== 'off' && isTouchDevice());
      if (this.touchEnabled) {
        this.touchUI = new TouchControls(app.ui, this.input, this.cmd, {
          view: () => { this.rig.next(); this.hud.toast(`View: ${this.rig.mode}`); },
          instruments: () => this.rig.toggleInstrumentView(),
          hud: () => { this.hud.setVisible(!this.hud.visible); this.s.hud = this.hud.visible; },
          pause: () => this.togglePause(),
        }, { invertPitch: s.touchInvertPitch });
        document.body.classList.add('touch-on');
      }
      this.interaction = new CockpitInteraction(app.canvas, app.camera, this.rig, this.hud.tooltip);
      this.interaction.setControls(this.cockpit.controls);
      app.scene.add(this.interaction.highlight);
      app.audio.volume = s.volume;
      L.step('Ready', 1);
      this.syncVisuals(0);
    } finally {
      setTimeout(() => L.remove(), 250);
    }
    const tower = this.spawn ? this.airport.spawnPoints().find((p) => p.type === 'parking') : null;
    this.towerLL = tower || this.spawn;
    this.hud.toast(this.s.coldDark ? 'Cold & dark: see Controls tab for the start procedure'
      : this.touchEnabled ? 'Slide THR up to full · at ~55 kt drag the stick down to rotate · drag in the cockpit to look around'
      : 'Full throttle: F4 or PageUp · rotate ~55 kt with ↓ (or S) · V cycles views', 5000);
  }

  env() {
    return { ground: this.app.ground, weather: this.weather, obstacles: this.app.collision };
  }

  bindInput() {
    const i = this.input, c = this.cmd, ac = this.ac, app = this.app;
    const on = (a, f) => i.on(a, () => { if (!this.replaying) f(); });
    on('flapsUp', () => c.flaps(-1)); on('flapsDown', () => c.flaps(1)); on('flapsRetract', () => c.setFlaps(0)); on('flapsFull', () => c.setFlaps(3));
    on('throttleFull', () => c.setThrottle(1)); on('throttleCut', () => c.setThrottle(0));
    on('parkingBrake', () => c.toggleParkingBrake());
    on('starter', () => c.setMagnetos(MAGS.START)); i.on('starter:up', () => c.releaseStarter());
    on('magnetosUp', () => c.magnetos(1)); on('magnetosDown', () => c.magnetos(-1));
    on('master', () => { const v = !ac.elec.switches.battery; c.setSwitch('battery', v); c.setSwitch('alternator', v); });
    on('landingLight', () => c.toggleSwitch('landingLight')); on('strobe', () => c.toggleSwitch('strobe'));
    on('dgSync', () => { c.dgSync(); this.hud.toast('Heading indicator synced to compass'); });
    on('directTo', () => this.directTo());
    i.on('view', () => { this.rig.next(); this.hud.toast(`View: ${this.rig.mode}`); });
    i.on('cockpitView', () => this.rig.setMode('cockpit'));
    i.on('instrumentView', () => this.rig.toggleInstrumentView());
    i.on('resetView', () => this.rig.resetView());
    i.on('lookBack', () => { this.rig.look.yaw = Math.PI * 0.95; });
    i.on('hud', () => { this.hud.setVisible(!this.hud.visible); this.s.hud = this.hud.visible; });
    i.on('debug', () => this.debug.toggle());
    i.on('pause', () => this.togglePause());
    i.on('menu', () => (this.pauseEl ? this.togglePause() : this.replaying ? this.stopReplay() : this.togglePause()));
    i.on('restart', () => app.restartFlight());
    i.on('mouseYoke', () => { i.mouseYoke = !i.mouseYoke; this.hud.toast(`Mouse yoke ${i.mouseYoke ? 'ON (mouse position = yoke)' : 'OFF'}`); });
    i.on('sound', () => { app.audio.enabled = !app.audio.enabled; this.hud.toast(`Sound ${app.audio.enabled ? 'on' : 'off'}`); });
    i.on('timeAccel', () => { this.timeAccel = TIME_ACCEL[(TIME_ACCEL.indexOf(this.timeAccel) + 1) % TIME_ACCEL.length]; this.hud.toast(`Time of day ×${this.timeAccel}`); });
    i.on('throttleAxis', (d) => c.throttle(d * 0.6));
  }

  togglePause() {
    if (this.crashed) return;
    this.paused = !this.paused;
    if (this.paused) this.pauseEl = pauseMenu(this.app.ui, { resume: () => this.togglePause(), restart: () => this.app.restartFlight(), menu: () => this.app.endFlight() });
    else { this.pauseEl?.remove(); this.pauseEl = null; }
  }

  directTo() {
    const s = this.ac.snapshot();
    const near = this.app.db.nearest(s.lat, s.lon, 3).filter((a) => a.dist > 2500);
    const pick = near[0];
    if (!pick) return;
    this.nav = { mode: 'DTO', targetIdent: pick.ident, target: null };
    this.updateNav();
    this.hud.toast(`Direct-To ${pick.ident} ${pick.name}`);
  }

  updateNav() {
    const ac = this.ac, s = ac.snapshot();
    let t = this.nav.mode === 'DTO' ? this.app.db.byIdent.get(this.nav.targetIdent) : this.app.db.nearest(s.lat, s.lon, 1)[0];
    if (!t) return;
    const brg = bearing(s.lat, s.lon, t.lat, t.lon), dist = distance(s.lat, s.lon, t.lat, t.lon);
    this.nav.target = { ident: t.ident, brgMag: wrap360(brg - ac.magvar), distNm: dist / NM, eteMin: s.gs > 10 ? dist / s.gs / 60 : null };
    this.cockpit.setNav(this.nav);
  }

  onDamageEvent(ev) {
    const app = this.app;
    if (ev.type === 'detached' && this.model.parts[ev.component] && this.app.settings.damageMode !== DAMAGE_MODES.OFF) {
      const v = this.velocityThree();
      this.effects.addDebris(this.model.parts[ev.component], v);
      this.model.parts[ev.component].visible = false;
      app.audio.impact(1);
    } else if (ev.type === 'damage') app.audio.impact(Math.min(1.2, ev.severity * 2));
    else if (ev.type === 'fire' && !this.fireEm) {
      this.fireEm = this.effects.addEmitter('fire', () => this.engineWorld(), 60);
      this.smokeEm = this.effects.addEmitter('smoke', () => this.engineWorld(), 25);
    }
    if (ev.type === 'destroyed' || ev.type === 'ditched') this.onCrash();
  }

  engineWorld() {
    const burning = this.ac.engines.findIndex((e) => e.failed || e.health < 0.5);
    const p = this.model.engineAnchor ? this.model.engineAnchor(Math.max(0, burning)) : new THREE.Vector3(0, 0.2, -1.6);
    return p.applyMatrix4(this.model.root.matrix);
  }

  velocityThree() {
    const v = this.ac.v; // NED
    return this.app.origin.dirToThree(this.frameF, v[1], v[0], -v[2]);
  }

  onCrash() {
    if (this.crashed) return;
    this.crashed = true; this.crashAt = performance.now();
    this.touchUI?.setVisible(false);
    this.hud.toast(this.ac.damage.ditched && !this.ac.damage.destroyed ? 'Ditched' : `CRASH: ${this.ac.damage.destroyedReason}`, 4000);
  }

  showCrashReport() {
    if (this.crashEl) return;
    this.crashEl = crashReport(this.app.ui, this.ac, this.recorder, {
      replay: () => this.startReplay(), restart: () => this.app.restartFlight(), menu: () => this.app.endFlight(),
    });
  }

  startReplay() {
    this.crashEl?.remove(); this.crashEl = null;
    this.replaying = true; this.replayT = 0;
    this.rig.setMode('orbit'); this.rig.orbit.dist = 30;
    this.replayUI = replayBar(this.app.ui, { stop: () => this.stopReplay() });
  }
  stopReplay() {
    this.replaying = false; this.replayUI?.el.remove(); this.replayUI = null;
    for (const [k, det] of Object.entries(this.ac.damage.detached)) if (this.model.parts[k]) this.model.parts[k].visible = !det;
    this.syncVisuals(0);
    if (this.crashed) this.showCrashReport();
  }

  /** Main per-frame update. */
  frame(dt) {
    const app = this.app, ac = this.ac;
    if (!ac) return;
    const realDt = Math.min(dt, 0.25);
    // Controls
    const axes = this.input.update(realDt, ac);
    if (!this.replaying && !this.crashed) {
      const o = this.override;
      ac.controls.elevator = o?.elevator ?? axes.elevator;
      ac.controls.aileron = o?.aileron ?? axes.aileron;
      ac.controls.rudder = o?.rudder ?? axes.rudder;
      const i = this.input, c = this.cmd;
      if (i.isHeld('throttleUp')) c.throttle(0.5 * realDt);
      if (i.isHeld('throttleDown')) c.throttle(-0.5 * realDt);
      if (i.isHeld('mixtureRich')) c.mixture(0.4 * realDt);
      if (i.isHeld('mixtureLean')) c.mixture(-0.4 * realDt);
      if (i.isHeld('trimUp')) c.trim(0.3 * realDt);
      if (i.isHeld('trimDown')) c.trim(-0.3 * realDt);
      const brake = i.isHeld('brakes') || i.gpBrake || i.touchBrake ? 1 : 0;
      this.touchUI?.update(realDt, ac);
      if (ac.setBrakesHeld && (ac.controls.throttle > 0.25 || brake)) ac.setBrakesHeld = false;
      const b = o?.brake ?? (ac.setBrakesHeld ? 1 : brake);
      c.setBrakes(b, b);
    }
    // Fixed-step simulation
    let steps = 0;
    const frozen = this.paused || this.replaying || (this.crashed && (performance.now() - this.crashAt > 6000 || ac.damage.mode === DAMAGE_MODES.SIMPLIFIED));
    if (!frozen) {
      this.acc += realDt;
      const env = this.env();
      while (this.acc >= SIM_DT && steps < 60) { ac.step(SIM_DT, env); this.acc -= SIM_DT; steps++; }
      if (steps >= 60) this.acc = 0;
      if (!this.crashed) this.recorder.record(realDt, ac);
      this.date = new Date(this.date.getTime() + realDt * 1000 * this.timeAccel);
    }
    this.stats.steps = steps;
    if (this.crashed && performance.now() - this.crashAt > (ac.damage.mode === DAMAGE_MODES.SIMPLIFIED ? 800 : 4500) && !this.replaying) this.showCrashReport();

    // Landing report
    if (ac.touchdown && ac.touchdown !== this._td) {
      this._td = ac.touchdown;
      const fpm = Math.round((ac.touchdown.sinkRate / 0.3048) * 60);
      this.lastLanding = `${fpm} fpm on ${ac.touchdown.surface}`;
      if (ac.time > 3 && !this.crashed && fpm < 1500) this.hud.toast(`Touchdown: ${fpm} fpm${fpm < 200 ? ' — smooth' : fpm < 400 ? ' — firm' : fpm < 600 ? ' — hard' : ' — very hard'}`);
    }
    // Magnetic variation / nav every second
    this.navTimer -= realDt;
    if (this.navTimer <= 0) { this.navTimer = 1; ac.magvar = app.db.magneticVariation(ac.lat, ac.lon); this.updateNav(); }

    // Floating origin re-centre
    if (app.origin.distanceTo(ac.lat, ac.lon) > 4000) {
      const before = new THREE.Vector3().setFromMatrixPosition(this.model.root.matrix);
      app.origin.set(ac.lat, ac.lon);
      app.stats.originShifts++;
      this.syncVisuals(0);
      const after = new THREE.Vector3().setFromMatrixPosition(this.model.root.matrix);
      this.effects.shift(before.sub(after));
      this.rig.chasePos = null; this.rig.towerPos = null;
    }
    this.syncVisuals(realDt);
  }

  /** Place the aircraft model (or replay ghost) and update every visual/audio system. */
  syncVisuals(dt) {
    const app = this.app, ac = this.ac;
    let st = ac;
    if (this.replaying) {
      this.replayT = (this.replayT + dt) % Math.max(this.recorder.duration, 0.1);
      const f = this.recorder.frameAt(this.replayT);
      if (f) {
        st = { lat: f.lat, lon: f.lon, alt: f.alt, q: f.q };
        for (const [k, det] of Object.entries(f.detached)) if (this.model.parts[k]) this.model.parts[k].visible = !det;
      }
      this.replayUI?.setTime(this.replayT, this.recorder.duration);
    }
    this.frameF.set(st.lat, st.lon, st.alt);
    const m = app.origin.matrixFor(this.frameF, this.model.root.matrix);
    const q = st.q;
    const toThree = (b) => { const v = bodyToNed(q, b); return new THREE.Vector3(v[1], -v[2], -v[0]); };
    const rot = new THREE.Matrix4().makeBasis(toThree([0, 1, 0]), toThree([0, 0, -1]), toThree([-1, 0, 0]));
    m.multiply(rot);
    this.model.root.matrixWorldNeedsUpdate = true;
    this.model.root.updateMatrixWorld(true);
    if (!dt) return;

    const night = app.sky.night;
    const cockpitView = this.rig.isCockpit && !this.replaying;
    if (!this.replaying) this.model.update(ac, dt, performance.now() / 1000, cockpitView);
    this.cockpit.root.visible = cockpitView;
    if (cockpitView) this.cockpit.update(dt, Math.max(night, 0.15 * (this.weather.cloudCover || 0)));
    this.interaction.enabled = cockpitView;
    this.interaction.highlight.visible = cockpitView && this.interaction.highlight.visible;
    this.interaction.refreshHighlight();

    const up = app.origin.dirToThree(this.frameF, 0, 0, 1);
    const tw = this.towerLL;
    this.rig.update(dt, this.model.root, ac, {
      up, velocity: this.velocityThree(),
      towerPosition: tw ? app.origin.toThree(tw.lat, tw.lon, tw.elev + 35) : null,
      groundAt: (p) => { const g = app.origin.frame.enuToGeodetic(p.x, -p.z, p.y); const s = app.ground.sample(g.lat, g.lon, {}); return p.y - (g.h - Math.max(s.h, 0)); },
    });
    const camPos = app.camera.position;
    const camGeo = app.origin.frame.enuToGeodetic(camPos.x, -camPos.z, camPos.y);
    app.terrain.update({ lat: camGeo.lat, lon: camGeo.lon, alt: camGeo.h }, ac);
    app.scenery.update({ lat: camGeo.lat, lon: camGeo.lon, alt: camGeo.h });
    app.airports.update(dt, ac.lat, ac.lon, camPos, night, performance.now() / 1000, app.renderer.getPixelRatio());
    app.sky.update(this.date, { lat: ac.lat, lon: ac.lon }, camPos, new THREE.Vector3().setFromMatrixPosition(this.model.root.matrix), { visibilityKm: this.weather.visibilityKm, cloudCover: this.weather.cloudCover }, dt);
    app.scenery.setNight(night);
    app.terrain.setTime(performance.now() / 1000);
    this.effects.update(dt, app.origin.dirToThree(this.frameF, ac.windNed[1], ac.windNed[0], 0));
    app.audio.update(ac, this.rig.mode, this.weather);
    this.hud.update(dt, ac, { view: this.replaying ? 'replay' : this.rig.instrumentView ? 'instruments' : this.rig.mode, timeAccel: this.timeAccel, mouseYoke: this.input.mouseYoke, paused: this.paused, nav: this.nav, visibilityKm: this.weather.visibilityKm, lastLanding: this.lastLanding });
    this.debug.update(dt, ac, app.debugStats());
  }

  dispose() {
    const app = this.app;
    this.input?.dispose();
    this.touchUI?.remove(); document.body.classList.remove('touch-on');
    this.hud?.remove(); this.debug?.remove(); this.pauseEl?.remove(); this.crashEl?.remove(); this.replayUI?.el.remove(); this.loading?.remove();
    this.effects?.clear();
    if (this.model) { app.scene.remove(this.model.root); this.model.root.traverse((o) => { o.geometry?.dispose(); }); }
    if (this.interaction) { app.scene.remove(this.interaction.highlight); this.interaction.dispose(); }
    app.audio.stopAll();
    this.ac = null;
  }
}

export { KT };
