// Main menu: Flight setup (aircraft, airport search, start position), World Map, Weather & Time,
// Assistance & Damage, Graphics, Controls, About/attribution. All options feed the flight session.
import { h } from './dom.js';
import { WEATHER_PRESETS } from '../sim/weather/weather.js';
import { GRAPHICS, saveSettings } from '../app/settings.js';
import { DEFAULT_BINDINGS } from '../input/input.js';
import { TYPE_LABEL } from '../world/airports/airport-db.js';
import { DEG } from '../geo/wgs84.js';

const TABS = [['flight', 'Flight'], ['map', 'World Map'], ['weather', 'Weather & Time'], ['assist', 'Assistance & Damage'], ['graphics', 'Graphics & Sound'], ['controls', 'Controls'], ['about', 'About & Credits']];

const ACTION_LABELS = {
  pitchDown: 'Pitch down (push)', pitchUp: 'Pitch up (pull)', rollLeft: 'Roll left', rollRight: 'Roll right', yawLeft: 'Rudder left', yawRight: 'Rudder right',
  throttleUp: 'Throttle increase', throttleDown: 'Throttle decrease', throttleFull: 'Throttle full', throttleCut: 'Throttle idle', mixtureRich: 'Mixture richer', mixtureLean: 'Mixture leaner',
  flapsUp: 'Flaps up one notch', flapsDown: 'Flaps down one notch', flapsRetract: 'Flaps fully up', flapsFull: 'Flaps full', trimUp: 'Trim nose up', trimDown: 'Trim nose down',
  brakes: 'Brakes (hold)', parkingBrake: 'Parking brake', starter: 'Engine start (ignition to START while held)', magnetosUp: 'Magnetos +', magnetosDown: 'Magnetos −',
  view: 'Cycle view', cockpitView: 'Cockpit view', instrumentView: 'Instrument zoom view', hud: 'Toggle HUD', debug: 'Debug panel', pause: 'Pause', restart: 'Restart flight',
  menu: 'Menu', mouseYoke: 'Mouse-yoke mode', lookBack: 'Look back', resetView: 'Reset view', sound: 'Toggle sound', dgSync: 'Sync heading indicator to compass', directTo: 'GPS Direct-To nearest airport',
  timeAccel: 'Cycle time-of-day acceleration', landingLight: 'Landing light', strobe: 'Strobe lights', master: 'Master switch (BAT+ALT)',
};

export class Menu {
  constructor(root, app) {
    this.root = root; this.app = app; this.s = app.settings;
    this.tab = 'flight';
    this.el = h('div', { class: 'menu', id: 'menu' });
    this.airportInfo = null;
    root.append(this.el);
    this.render();
  }

  show() { this.el.style.display = ''; this.render(); }
  hide() { this.el.style.display = 'none'; }
  save() { saveSettings(this.s); }

  render() {
    const side = h('div', { class: 'side' },
      h('div', { class: 'brand' }, 'WORLD FLIGHT SIMULATOR', h('small', {}, 'Phase 2 prototype · v0.2')),
      ...TABS.map(([id, label]) => h('button', { class: 'tab' + (this.tab === id ? ' active' : ''), 'data-tab': id, onclick: () => { this.tab = id; this.render(); } }, label)),
      h('div', { style: { flex: 1 } }),
      h('button', { class: 'primary', id: 'start-flight', onclick: () => this.start() }, 'Start Flight ▸'),
    );
    const main = h('div', { class: 'main' });
    this[`tab_${this.tab}`](main);
    this.el.replaceChildren(side, main);
  }

  start() { this.save(); this.app.startFlight(this.s); }

  startBar(main) {
    const a = this.app.db.byIdent?.get(this.s.airport);
    main.append(h('div', { class: 'startbar' },
      h('button', { class: 'primary', onclick: () => this.start() }, 'Start Flight ▸'),
      h('div', { class: 'summary' }, `${this.app.aircraft[this.s.aircraft].name} · ${a ? `${a.ident} ${a.name}` : this.s.airport} · ${this.s.startMode === 'approach' ? `${this.s.approachNm} NM final` : this.s.startMode} · ${WEATHER_PRESETS[this.s.weatherPreset]?.label} · ${fmtHour(this.s.localHour)} local`)));
  }

  // ---------------- Flight ----------------
  tab_flight(main) {
    main.append(h('h2', {}, 'Flight setup'), h('div', { class: 'sub' }, 'Choose aircraft, departure airport and starting position.'));
    const grid = h('div', { class: 'grid2' });
    // Aircraft
    const ac = h('div', { class: 'card' }, h('h3', {}, 'Aircraft'));
    for (const [id, cfg] of Object.entries(this.app.aircraft)) {
      ac.append(h('div', { class: 'list' }, h('div', { class: 'row sel' }, h('b', {}, cfg.id.toUpperCase()), cfg.name, h('span', {}, cfg.class))));
      const L = cfg.limits;
      ac.append(h('div', { class: 'kv', style: { marginTop: '10px' } },
        h('div', {}, 'Engine'), h('div', {}, cfg.engine.name), h('div', {}, 'Max takeoff mass'), h('div', {}, `${cfg.mass.maxTakeoff} kg`),
        h('div', {}, 'Stall (flaps up / full)'), h('div', {}, `${L.Vs1} / ${L.Vs0} KCAS`), h('div', {}, 'Rotate · Vy · Vne'), h('div', {}, `${L.Vr} · ${L.Vy} · ${L.Vne} kt`),
        h('div', {}, 'Fuel'), h('div', {}, `${Math.round(cfg.fuel.tanks.reduce((s, t) => s + t.capacityL, 0) / 3.785)} US gal`)));
      ac.append(h('div', { class: 'note' }, cfg.fidelity));
    }
    ac.append(h('div', { class: 'note' }, 'More aircraft (turboprop, airliners, fighter, cargo) arrive in Phase 3 — see docs/ROADMAP.md.'));
    // Airport search
    const ap = h('div', { class: 'card' }, h('h3', {}, 'Departure airport'));
    const input = h('input', { type: 'text', id: 'airport-search', placeholder: 'Search ICAO / IATA / name / city (e.g. KSFO, SFO, Oakland)', value: '' });
    const list = h('div', { class: 'list', id: 'airport-results' });
    const fill = () => {
      list.replaceChildren(...this.app.db.search(input.value, 40).map((r) => h('div', { class: 'row' + (r.ident === this.s.airport ? ' sel' : ''), 'data-ident': r.ident, onclick: () => this.selectAirport(r.ident) },
        h('b', {}, r.ident), `${r.name}`, h('span', {}, `${r.iata ? r.iata + ' · ' : ''}${r.city ? r.city + ', ' : ''}${r.country} · ${TYPE_LABEL[r.type]}${this.app.hasHero(r.ident) ? ' · detailed' : ''}`))));
    };
    input.addEventListener('input', fill);
    ap.append(input, h('div', { style: { height: '8px' } }), list);
    fill();
    // Start position
    const pos = h('div', { class: 'card', id: 'start-position' }, h('h3', {}, 'Start position'));
    this.renderStart(pos);
    grid.append(ac, ap, pos);
    main.append(grid);
    this.startBar(main);
  }

  async selectAirport(ident) {
    this.s.airport = ident; this.s.spawn = ''; this.airportInfo = null; this.save();
    if (this.tab !== 'flight') { this.tab = 'flight'; }
    this.render();
  }

  async renderStart(card) {
    const ident = this.s.airport;
    card.append(h('div', { class: 'note' }, 'Loading airport data…'));
    if (!this.airportInfo || this.airportInfo.ident !== ident) this.airportInfo = await this.app.describeAirport(ident);
    const info = this.airportInfo;
    card.replaceChildren(h('h3', {}, 'Start position'));
    if (!info) { card.append(h('div', { class: 'note' }, 'Airport not found.')); return; }
    const d = info.data;
    card.append(h('div', { class: 'kv' },
      h('div', {}, 'Airport'), h('div', {}, `${info.ident} ${d.name}`), h('div', {}, 'Elevation'), h('div', {}, `${Math.round(d.elev / 0.3048)} ft`),
      h('div', {}, 'Layout'), h('div', {}, info.hero ? 'Detailed (OpenStreetMap)' : 'Procedural (runways real)'),
      ...d.runways.flatMap((r) => [h('div', {}, `Runway ${r.le}/${r.he}`), h('div', {}, `${Math.round(r.len / 0.3048)} × ${Math.round(r.wid / 0.3048)} ft ${r.surf || ''}`)])));
    const mode = h('select', { id: 'start-mode' }, ...[['runway', 'On runway, ready for takeoff'], ['parking', 'Parking / stand'], ['approach', 'On final approach']].map(([v, l]) => h('option', { value: v, selected: this.s.startMode === v }, l)));
    const spawnSel = h('select', { id: 'spawn' });
    const fillSpawns = () => {
      const want = this.s.startMode === 'parking' ? 'parking' : 'runway';
      const opts = info.spawns.filter((s) => s.type === want);
      spawnSel.replaceChildren(...opts.map((s) => h('option', { value: s.id, selected: s.id === this.s.spawn }, `${s.id}${s.type === 'runway' ? ` (heading ${Math.round(s.heading)}°T)` : ''}`)));
      if (!opts.some((s) => s.id === this.s.spawn)) this.s.spawn = opts[0]?.id || '';
    };
    mode.addEventListener('change', () => { this.s.startMode = mode.value; fillSpawns(); this.save(); this.render(); });
    spawnSel.addEventListener('change', () => { this.s.spawn = spawnSel.value; this.save(); });
    fillSpawns();
    card.append(h('label', {}, 'Start'), mode, h('label', {}, this.s.startMode === 'parking' ? 'Stand' : 'Runway'), spawnSel);
    if (this.s.startMode === 'approach') {
      const nm = h('select', {}, ...[2, 3, 5, 8].map((n) => h('option', { value: n, selected: this.s.approachNm === n }, `${n} NM final (${Math.round(Math.tan(3 * DEG) * n * 1852 / 0.3048 + 50)} ft AGL)`)));
      nm.addEventListener('change', () => { this.s.approachNm = +nm.value; this.save(); });
      card.append(h('label', {}, 'Distance'), nm);
    }
    const cold = h('input', { type: 'checkbox', id: 'cold-dark', checked: this.s.coldDark });
    cold.addEventListener('change', () => { this.s.coldDark = cold.checked; this.save(); });
    if (this.s.startMode !== 'approach') card.append(h('label', {}, 'Systems'), h('div', {}, cold, ' Cold & dark (engine off — practise the start procedure)'));
  }

  // ---------------- World map ----------------
  tab_map(main) {
    main.append(h('h2', {}, 'World map'), h('div', { class: 'sub' }, `${this.app.db.rows.length.toLocaleString()} airports with runways. Drag to pan, scroll to zoom, click to select the nearest airport.`));
    const canvas = h('canvas', { id: 'worldmap' });
    const info = h('div', { class: 'note' });
    main.append(canvas, info);
    const view = this.mapView || (this.mapView = { lon: -40, lat: 25, zoom: 1 });
    const rows = this.app.db.rows;
    const draw = () => {
      const W = (canvas.width = canvas.clientWidth * devicePixelRatio), H = (canvas.height = canvas.clientHeight * devicePixelRatio);
      const g = canvas.getContext('2d');
      g.fillStyle = '#06101a'; g.fillRect(0, 0, W, H);
      const scale = (W / 360) * view.zoom;
      const px = (lon) => W / 2 + (lon - view.lon) * scale, py = (lat) => H / 2 - (lat - view.lat) * scale;
      g.strokeStyle = '#11263a'; g.lineWidth = 1;
      for (let l = -180; l <= 180; l += 30) { g.beginPath(); g.moveTo(px(l), 0); g.lineTo(px(l), H); g.stroke(); }
      for (let l = -90; l <= 90; l += 30) { g.beginPath(); g.moveTo(0, py(l)); g.lineTo(W, py(l)); g.stroke(); }
      const col = { L: '#ffd34d', M: '#4fc3ff', S: 'rgba(110,170,200,0.55)' };
      for (const t of ['S', 'M', 'L']) {
        g.fillStyle = col[t];
        const sz = (t === 'L' ? 3 : t === 'M' ? 2 : 1.2) * devicePixelRatio;
        for (const r of rows) { if (r.type !== t) continue; const x = px(r.lon), y = py(r.lat); if (x < 0 || y < 0 || x > W || y > H) continue; g.fillRect(x - sz / 2, y - sz / 2, sz, sz); }
      }
      const sel = this.app.db.byIdent.get(this.s.airport);
      if (sel) { g.strokeStyle = '#7ee08f'; g.lineWidth = 2 * devicePixelRatio; g.beginPath(); g.arc(px(sel.lon), py(sel.lat), 9 * devicePixelRatio, 0, Math.PI * 2); g.stroke(); }
      info.textContent = sel ? `Selected: ${sel.ident} — ${sel.name}, ${sel.city} ${sel.country} (${sel.lat.toFixed(3)}, ${sel.lon.toFixed(3)})` : '';
      canvas._px = px; canvas._py = py; canvas._scale = scale;
    };
    let drag = null, moved = 0;
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; moved = 0; });
    window.addEventListener('pointerup', (e) => {
      if (drag && moved < 4 && e.target === canvas) {
        const r = canvas.getBoundingClientRect(), mx = (e.clientX - r.left) * devicePixelRatio, my = (e.clientY - r.top) * devicePixelRatio;
        let best = null, bd = 14 * devicePixelRatio;
        const pri = { L: 0, M: 2, S: 4 };
        for (const a of rows) { const d = Math.hypot(canvas._px(a.lon) - mx, canvas._py(a.lat) - my) + pri[a.type] * devicePixelRatio; if (d < bd) { bd = d; best = a; } }
        if (best) { this.s.airport = best.ident; this.s.spawn = ''; this.airportInfo = null; this.save(); draw(); }
      }
      drag = null;
    });
    canvas.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; moved += Math.abs(dx) + Math.abs(dy); drag = { x: e.clientX, y: e.clientY }; view.lon -= (dx * devicePixelRatio) / canvas._scale; view.lat += (dy * devicePixelRatio) / canvas._scale; draw(); });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.zoom = Math.min(400, Math.max(0.8, view.zoom * (e.deltaY < 0 ? 1.25 : 0.8))); draw(); }, { passive: false });
    requestAnimationFrame(draw);
    main.append(h('div', { class: 'note' }, 'Coastlines/country borders come with the Phase 4 world map; dots show real airport locations from OurAirports.'));
    this.startBar(main);
  }

  // ---------------- Weather & time ----------------
  tab_weather(main) {
    const s = this.s;
    main.append(h('h2', {}, 'Weather & time'), h('div', { class: 'sub' }, 'Wind, gusts and turbulence act on the flight model; visibility drives fog. Clouds/precipitation visuals are basic in Phase 2.'));
    const card = h('div', { class: 'card' });
    const preset = h('select', { id: 'weather-preset' }, ...Object.entries(WEATHER_PRESETS).map(([k, p]) => h('option', { value: k, selected: s.weatherPreset === k }, p.label)));
    preset.addEventListener('change', () => { s.weatherPreset = preset.value; s.weather = {}; this.save(); this.render(); });
    card.append(h('label', {}, 'Preset'), preset);
    const w = { ...WEATHER_PRESETS[s.weatherPreset], ...s.weather };
    const slider = (key, label, min, max, step, fmt) => {
      const out = h('span', { class: 'pill' }, fmt(w[key]));
      const inp = h('input', { type: 'range', min, max, step, value: w[key] });
      inp.addEventListener('input', () => { s.weather[key] = +inp.value; out.textContent = fmt(+inp.value); this.save(); });
      card.append(h('label', {}, label, ' ', out), inp);
    };
    slider('windDir', 'Wind from', 0, 359, 1, (v) => `${Math.round(v)}° true`);
    slider('windKt', 'Wind speed', 0, 40, 1, (v) => `${v} kt`);
    slider('gustKt', 'Gusts to', 0, 55, 1, (v) => `${v} kt`);
    slider('turbulence', 'Turbulence', 0, 1, 0.05, (v) => (v < 0.1 ? 'none' : v < 0.35 ? 'light' : v < 0.7 ? 'moderate' : 'severe'));
    slider('visibilityKm', 'Visibility', 0.5, 80, 0.5, (v) => `${v} km`);
    slider('cloudCover', 'Cloud cover', 0, 1, 0.05, (v) => `${Math.round(v * 8)}/8`);
    const t = h('div', { class: 'card' });
    const hourOut = h('span', { class: 'pill' }, fmtHour(s.localHour));
    const hour = h('input', { type: 'range', min: 0, max: 23.99, step: 0.25, value: s.localHour, id: 'local-hour' });
    hour.addEventListener('input', () => { s.localHour = +hour.value; hourOut.textContent = fmtHour(s.localHour); this.save(); });
    const dayOut = h('span', { class: 'pill' }, dayLabel(s.dayOfYear));
    const day = h('input', { type: 'range', min: 1, max: 365, step: 1, value: s.dayOfYear });
    day.addEventListener('input', () => { s.dayOfYear = +day.value; dayOut.textContent = dayLabel(s.dayOfYear); this.save(); });
    t.append(h('h3', {}, 'Time of day'), h('label', {}, 'Local solar time ', hourOut), hour, h('label', {}, 'Date ', dayOut), day,
      h('div', { class: 'note' }, 'Sun position is computed astronomically for the airport. In flight, press T to accelerate time of day.'));
    main.append(h('div', { class: 'grid2' }, card, t));
    this.startBar(main);
  }

  // ---------------- Assistance & damage ----------------
  tab_assist(main) {
    const s = this.s;
    main.append(h('h2', {}, 'Assistance & damage'));
    const card = h('div', { class: 'card' });
    const dm = h('select', { id: 'damage-mode' }, ...[['realistic', 'Realistic — component damage, breakup, fire'], ['simplified', 'Simplified — flight ends at critical damage'], ['off', 'Off — invulnerable (collisions still logged)']].map(([v, l]) => h('option', { value: v, selected: s.damageMode === v }, l)));
    dm.addEventListener('change', () => { s.damageMode = dm.value; this.save(); });
    const ar = h('input', { type: 'checkbox', checked: s.autoRudder });
    ar.addEventListener('change', () => { s.autoRudder = ar.checked; this.save(); });
    const sens = h('input', { type: 'range', min: 0.4, max: 2, step: 0.05, value: s.sensitivity });
    sens.addEventListener('input', () => { s.sensitivity = +sens.value; this.save(); });
    card.append(h('label', {}, 'Damage model'), dm, h('label', {}, 'Coordination'), h('div', {}, ar, ' Auto-rudder (in flight only)'), h('label', {}, 'Control sensitivity'), sens,
      h('div', { class: 'note' }, 'Damage depends on impact speed, angle, aircraft mass, surface and component strength (see docs/ARCHITECTURE.md).'));
    main.append(h('div', { class: 'grid2' }, card));
    this.startBar(main);
  }

  // ---------------- Graphics ----------------
  tab_graphics(main) {
    const s = this.s;
    main.append(h('h2', {}, 'Graphics & sound'));
    const card = h('div', { class: 'card' });
    const q = h('select', { id: 'graphics' }, ...Object.entries(GRAPHICS).map(([k, g]) => h('option', { value: k, selected: s.graphics === k }, g.label)));
    q.addEventListener('change', () => { s.graphics = q.value; this.save(); this.app.applyGraphics?.(); });
    const dyn = h('input', { type: 'checkbox', checked: s.dynamicResolution });
    dyn.addEventListener('change', () => { s.dynamicResolution = dyn.checked; this.save(); });
    const online = h('input', { type: 'checkbox', checked: s.online });
    online.addEventListener('change', () => { s.online = online.checked; this.save(); });
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.volume });
    vol.addEventListener('input', () => { s.volume = +vol.value; this.save(); if (this.app.audio) this.app.audio.volume = s.volume; });
    card.append(h('label', {}, 'Preset'), q, h('div', { class: 'note' }, 'Controls render resolution, shadow quality, terrain view distance/detail and scenery density. Anti-aliasing changes apply after reload.'),
      h('label', {}, 'Adaptive'), h('div', {}, dyn, ' Dynamic resolution (holds ~50 fps)'),
      h('label', {}, 'Terrain data'), h('div', {}, online, ' Stream real elevation tiles (AWS Terrain Tiles). Off = bundled data only.'),
      h('label', {}, 'Volume'), vol);
    main.append(h('div', { class: 'grid2' }, card));
    this.startBar(main);
  }

  // ---------------- Controls ----------------
  tab_controls(main) {
    main.append(h('h2', {}, 'Controls'), h('div', { class: 'sub' }, 'Keyboard, mouse and gamepad. In the cockpit: click/drag/scroll controls; right-drag to look around; scroll elsewhere to zoom.'));
    const b = h('div', { class: 'bindings' });
    for (const [a, keys] of Object.entries(DEFAULT_BINDINGS)) b.append(h('div', {}, ACTION_LABELS[a] || a), h('div', {}, ...keys.map((k, i) => [i ? ' / ' : '', h('code', {}, k.replace('Key', '').replace('Digit', ''))])));
    main.append(h('div', { class: 'grid2' }, h('div', { class: 'card' }, b), h('div', { class: 'card' }, h('h3', {}, 'Gamepad'), h('div', { class: 'note' }, 'Left stick: pitch/roll · right stick X: rudder · right/left trigger: throttle up/down · A: brakes. Deadzone 8%.'),
      h('h3', { style: { marginTop: '14px' } }, 'Engine start (cold & dark)'),
      h('ol', { class: 'note' }, h('li', {}, 'Parking brake SET, fuel selector BOTH'), h('li', {}, 'BAT master ON, beacon ON'), h('li', {}, 'Mixture RICH, throttle ~10%'), h('li', {}, 'Ignition key to START (hold E or click-and-hold the key) until the engine fires'), h('li', {}, 'ALT ON, AVIONICS ON, check oil pressure'), h('li', {}, 'Click the heading-indicator knob to sync it to the compass')))));
    this.startBar(main);
  }

  tab_about(main) {
    main.append(h('h2', {}, 'About & credits'), h('div', { class: 'card', html: `
      <p><b>World Flight Simulator</b> is an original browser flight simulator (Three.js/WebGL2). It is <b>not</b> Microsoft Flight Simulator and contains no MSFS assets.
      This Phase 2 build is a playable prototype: one aircraft, real-world terrain and airports, interactive cockpit, crash/damage model.</p>
      <p class="note">Data: airports/runways/navaids — OurAirports (public domain). Elevation — AWS Terrain Tiles / Mapzen (SRTM, GMTED2010, ETOPO1, NED and others; see docs/LICENSES.md).
      KSFO layout and San Francisco buildings — © OpenStreetMap contributors (ODbL). Populated places — Natural Earth (public domain).
      Aircraft model, textures and sounds are generated in code.</p>` }));
  }
}

function fmtHour(hh) { const m = Math.round((hh % 1) * 60); return `${String(Math.floor(hh)).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
function dayLabel(d) { const dt = new Date(Date.UTC(2025, 0, 1) + (d - 1) * 86400000); return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }); }
