// Application shell: renderer, scene and persistent world systems (terrain, airports, scenery, sky),
// menu <-> flight state machine, render loop with dynamic resolution, and a debug/test API on window.__sim.
import * as THREE from 'three';
import { FloatingOrigin } from '../render/floating-origin.js';
import { SkySystem } from '../world/sky/sky.js';
import { TerrainManager } from '../world/terrain/terrain-manager.js';
import { AirportDB } from '../world/airports/airport-db.js';
import { AirportManager } from '../world/airports/airport-manager.js';
import { Scenery } from '../world/scenery/scenery.js';
import { goldenGateBridge } from '../world/scenery/landmarks.js';
import { CollisionWorld } from '../sim/collision/obstacles.js';
import { AudioEngine } from '../audio/audio.js';
import { Menu } from '../ui/menu.js';
import { Flight } from './flight.js';
import { SIM_DT } from '../sim/aircraft.js';
import { loadSettings, saveSettings, GRAPHICS } from './settings.js';
import ga172 from '../aircraft/ga172/config.json';

export class App {
  constructor(canvas, ui) {
    this.canvas = canvas; this.ui = ui;
    this.settings = loadSettings();
    this.aircraft = { ga172 };
    this.flight = null;
    this.stats = { originShifts: 0 };
    this.fps = 60; this.frameMs = 16;
  }

  async init(onProgress = () => {}) {
    const g = GRAPHICS[this.settings.graphics] || GRAPHICS.medium;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: g.antialias, logarithmicDepthBuffer: true, powerPreference: 'high-performance' }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1016);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 2.0e6);
    this.origin = new FloatingOrigin();
    this.origin.set(37.6189, -122.375);
    this.sky = new SkySystem(this.scene, r);
    this.collision = new CollisionWorld();
    this.audio = new AudioEngine();
    onProgress('Loading airport database', 0.2);
    this.db = await new AirportDB('./data/').init();
    onProgress('Loading terrain data', 0.5);
    this.terrain = new TerrainManager(this.scene, this.origin, { quality: g.terrain, online: this.settings.online });
    await this.terrain.init('./data/terrain/');
    const places = await fetch('./data/places.json').then((x) => x.json()).catch(() => ({ rows: [] }));
    this.terrain.setPlaces(places.rows);
    this.airports = new AirportManager({ db: this.db, scene: this.scene, origin: this.origin, terrain: this.terrain, collision: this.collision });
    this.terrain.surfaceProvider = (lat, lon) => this.airports.surfaceAt(lat, lon);
    this.ground = { sample: (lat, lon, out) => this.terrain.sample(lat, lon, out) };
    this.scenery = new Scenery(this.scene, this.origin, this.terrain, this.collision, g.scenery);
    this.applyGraphics();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.menu = new Menu(this.ui, this);
    this.installTestApi();
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.loop());
    onProgress('Ready', 1);
  }

  hasHero(ident) { return this.airports.hasHero(ident); }

  async describeAirport(ident) {
    const ap = await this.airports.describe(ident);
    if (!ap) return null;
    return { ident, data: ap.data, hero: !!ap.hero, spawns: ap.spawnPoints() };
  }

  /** San Francisco Bay hero scenery: downtown OSM towers + Golden Gate Bridge (built once). */
  async ensureBayAreaScenery(loading) {
    if (this.bayArea) return;
    this.bayArea = true;
    const hero = await this.airports.hero('KSFO');
    for (const c of hero?.cities || []) { this.scenery.addHeroCity(c, (lat, lon) => this.terrain.heightAt(lat, lon).h); loading?.step(`${c.name}: ${c.buildings.length} OSM buildings`); }
    const ggb = goldenGateBridge(this.origin, this.collision);
    this.scene.add(ggb.group);
    loading?.step('Landmark: Golden Gate Bridge');
  }

  applyGraphics() {
    const g = GRAPHICS[this.settings.graphics] || GRAPHICS.medium;
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, g.pixelRatio);
    this.renderer.setPixelRatio(this.basePixelRatio);
    this.renderer.shadowMap.enabled = g.shadows > 0;
    if (g.shadows) { this.sky.sun.shadow.mapSize.set(g.shadows, g.shadows); this.sky.sun.shadow.map?.dispose(); this.sky.sun.shadow.map = null; }
    this.sky.sun.castShadow = g.shadows > 0;
    this.terrain.setQuality(g.terrain);
    this.scenery.setQuality(g.scenery);
    this.terrain.online = this.settings.online;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  async startFlight(settings) {
    this.settings = settings; saveSettings(settings);
    this.applyGraphics();
    this.menu.hide();
    await this.audio.start().catch(() => {});
    const f = new Flight(this, settings);
    this.flight = f;
    try { await f.load(); this.canvas.focus(); }
    catch (e) { console.error(e); alert('Could not start flight: ' + e.message); this.endFlight(); }
  }

  async restartFlight() { const s = this.settings; this.endFlight(false); await this.startFlight(s); }

  endFlight(showMenu = true) {
    this.flight?.dispose();
    this.flight = null;
    if (showMenu) this.menu.show();
  }

  debugStats() {
    const info = this.renderer.info.render;
    return { fps: this.fps, frameMs: this.frameMs, steps: this.flight?.stats.steps ?? 0, pixelRatio: this.renderer.getPixelRatio(), calls: info.calls, tris: info.triangles, terrain: this.terrain.stats, sceneryTiles: this.scenery.tiles.size, airports: this.airports.built.size, obstacles: this.collision.groups.size, originShifts: this.stats.originShifts };
  }

  /** Idle menu backdrop: slow orbit over the selected airport. */
  idle(dt) {
    const a = this.db.byIdent.get(this.settings.airport) || { lat: 37.6189, lon: -122.375, elev: 4 };
    if (this.origin.distanceTo(a.lat, a.lon) > 4000) this.origin.set(a.lat, a.lon);
    this.idleT = (this.idleT || 0) + dt * 0.03;
    const p = this.origin.toThree(a.lat, a.lon, a.elev + 600);
    this.camera.position.set(p.x + Math.sin(this.idleT) * 5000, p.y + 900, p.z + Math.cos(this.idleT) * 5000);
    this.camera.up.set(0, 1, 0); this.camera.lookAt(p.x, p.y - 600, p.z);
    if (this.camera.fov !== 55) { this.camera.fov = 55; this.camera.updateProjectionMatrix(); }
    const g = this.origin.frame.enuToGeodetic(this.camera.position.x, -this.camera.position.z, this.camera.position.y);
    this.terrain.update({ lat: g.lat, lon: g.lon, alt: g.h }, null);
    const d = new Date(); d.setUTCHours(18, 0, 0, 0);
    this.sky.update(d, a, this.camera.position, p, { visibilityKm: 60, cloudCover: 0.2 }, dt);
  }

  loop() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    this.frameMs = this.frameMs * 0.9 + dt * 1000 * 0.1;
    this.fps = 1000 / this.frameMs;
    try {
      if (this.flight?.ac) this.flight.frame(dt);
      else this.idle(dt);
      this.renderer.render(this.scene, this.camera);
    } catch (e) { console.error(e); this.lastError = String(e?.stack || e); }
    // Dynamic resolution: hold ~50 fps by trading pixel ratio.
    if (this.settings.dynamicResolution) {
      this.drTimer = (this.drTimer || 0) + dt;
      if (this.drTimer > 2) {
        this.drTimer = 0;
        const pr = this.renderer.getPixelRatio();
        if (this.fps < 42 && pr > this.basePixelRatio * 0.5) this.renderer.setPixelRatio(Math.max(this.basePixelRatio * 0.5, pr * 0.85));
        else if (this.fps > 57 && pr < this.basePixelRatio) this.renderer.setPixelRatio(Math.min(this.basePixelRatio, pr * 1.1));
      }
    }
  }

  /** Programmatic API used by automated browser tests and for debugging from the console. */
  installTestApi() {
    const app = this;
    window.__sim = {
      app,
      get ac() { return app.flight?.ac; },
      get flight() { return app.flight; },
      state: () => app.flight?.ac?.snapshot(),
      damage: () => app.flight?.ac?.damage.summary(),
      start: (over = {}) => app.startFlight({ ...app.settings, ...over }),
      restart: () => app.restartFlight(),
      menu: () => app.endFlight(),
      setControls: (c) => { if (app.flight) app.flight.override = c ? { ...(app.flight.override || {}), ...c } : null; if (c && app.flight?.ac) { const k = app.flight.ac.controls; for (const key of ['throttle', 'mixture', 'flapsLever', 'trim', 'parkingBrake']) if (key in c) k[key] = c[key]; } },
      view: (m) => app.flight?.rig.setMode(m),
      /** Reposition the aircraft in trimmed flight (debug/testing). */
      teleport: (lat, lon, altFt, hdg, kt = 100) => { const f = app.flight; if (!f) return; f.ac.placeAirborne(lat, lon, altFt * 0.3048, hdg, kt, { atmo: f.weather.atmosphereConditions }); f.ac.step(SIM_DT, f.env()); },
      setTime: (localHour) => { const f = app.flight; if (f) { const d = new Date(f.date); const utcH = localHour - f.ac.lon / 15; d.setUTCHours(0, 0, 0, 0); f.date = new Date(d.getTime() + ((utcH + 24) % 24) * 3600000); } },
      stats: () => app.debugStats(),
      lastError: () => app.lastError || null,
      /** Run the simulation synchronously for `sec` seconds (tests). pilot(state, ac) may set ac.controls each step. */
      advance: (sec, pilot) => {
        const f = app.flight; if (!f?.ac) return null;
        const env = f.env();
        const n = Math.round(sec / SIM_DT);
        for (let i = 0; i < n; i++) {
          if (pilot && i % 4 === 0) pilot(f.ac.snapshot(), f.ac);
          f.ac.step(SIM_DT, env);
          f.recorder.record(SIM_DT, f.ac);
          if (i % 240 === 0) app.terrain.update({ lat: f.ac.lat, lon: f.ac.lon, alt: f.ac.alt + 2 }, f.ac);
          if (f.crashed) break;
        }
        return f.ac.snapshot();
      },
    };
  }
}
