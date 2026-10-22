> Phase 1 deliverable, as approved, before implementation. Kept for reference. Some details evolved during Phase 2: the fixed step is 240 Hz instead of 120 Hz, and the terrain fallback is global z4 plus the KSFO region at z12. Those changes are recorded in ARCHITECTURE.md and phase-2.md.

# WORLD FLIGHT SIMULATOR — Phase 1: Research, Architecture & Implementation Plan

## Context

The user wants a browser-based flight simulator inspired by Microsoft Flight Simulator: realistic 6-DOF flight physics, interactive 3D cockpits, real-world terrain/airports, weather, a physically driven crash/damage system, autopilot/FMS, sound, game modes, and tests. They explicitly asked to **start with Phase 1** (research, architecture, licensing, risks, plan) and to not begin full implementation until the plan is reviewed. This file is that Phase 1 deliverable. On approval, implementation starts with **Phase 2 (playable prototype)**, followed by a build + report, then later phases.

Working directory `/home/user` is empty (greenfield, not a git repo). Node 22.22 / npm 10.9 available; Chromium + Playwright preinstalled. Verified reachable from this environment: npm registry (three 0.186.1, vite 8.3.5, vitest 5.0.5, @dimforge/rapier3d-compat 0.21.0), OurAirports CSVs, AWS Terrain Tiles (Terrarium), Natural Earth GeoJSON.

### Honest scope statement
MSFS streams petabytes of licensed Bing aerial imagery and photogrammetry and uses a decade of proprietary engineering. A browser build **cannot** match that. What *is* achievable and will be delivered honestly:
- **Real global terrain elevation** (streamed DEM tiles), real coastlines, **every real airport/runway** (~40k airports from OurAirports) with correct position, heading, length, elevation.
- **Procedural** ground texturing, vegetation, towns and generic buildings where no data is available; **OSM-derived** layouts/buildings for a handful of "hero" airports/cities baked at build time.
- A real coefficient-based 6-DOF flight model with aircraft-specific data from public performance figures — plausible, **not certified** data.
- Simplified-but-functional systems (electrical, fuel, engines, hydraulics, pressurization), each labelled with its fidelity level in docs.

### Decisions (confirmed with user)
- **Hero airport for Phase 2: KSFO San Francisco** (OSM layout baked; bay water + coastal hills for terrain/water tests; runways 28L/R, 01L/R).
- **Delivery: GitHub repository.**
- **Scope this session: build Phase 2, test it, write `docs/PHASE_REPORTS/phase-2.md`, then stop for review.**

---

## 1. Research findings — datasets & licensing

| Need | Source | License / restriction | Use |
|---|---|---|---|
| Global elevation | AWS Terrain Tiles (Terrarium PNG, z0–15; SRTM/GMTED/ETOPO1/etc.) | Open; attribution to source datasets required | Runtime streaming; z0–5 subset bundled as offline fallback |
| Airports, runways, frequencies, navaids | OurAirports CSVs | Public domain | Preprocessed into search index + geographic shards |
| Coastlines, land, lakes, rivers, populated places | Natural Earth | Public domain | World map, water mask, city seeds |
| Airport layouts, buildings, roads | OpenStreetMap (Overpass API) | ODbL — attribution + share-alike on derived DB; Overpass rate limits | Build-time bake for hero airports/cities; optional cached runtime fetch |
| Satellite imagery | — | No free global imagery licensed for this use (Sentinel-2 cloudless is non-commercial; Bing/Google prohibited) | **Not used.** Procedural splat texturing; pluggable `ImageryProvider` adapter for user-supplied keyed sources |
| Surface textures | Procedural (generated in code); optional CC0 (ambientCG/Poly Haven) | CC0 | Terrain detail, runway asphalt |
| Live weather | METAR text (user-pasted, works offline); optional aviationweather.gov fetch | Public; CORS uncertain → documented proxy option | `WeatherProvider` adapter |
| Aircraft models | Built procedurally in code from parametric configs (fuselage loft, wings, tail, nacelles, gear) | Original | No third-party/MSFS assets |
| Audio | Synthesized with Web Audio; voice callouts via SpeechSynthesis | Original | No sample licensing |

Trademarks: aircraft are named as classes ("GA-172 (Cessna 172-class)", "NB-320 (A320-class)" etc.), no manufacturer logos/liveries.
ILS: OurAirports has no ILS data → **synthetic ILS** generated for qualifying runways (3° GS, localizer on centerline), clearly labelled synthetic; VOR/DME/NDB from real `navaids.csv`.

## 2. Technology decisions

- **Three.js 0.186 (WebGL2)**, ES modules, **Vite** dev server/static build (deployable to GitHub Pages/Netlify), **Vitest** unit tests, **Playwright** browser smoke tests.
- **Flight dynamics in plain JS (float64)** in the main thread at fixed **120 Hz** with accumulator (render-rate independent). Rationale: one aircraft FDM costs <0.1 ms/step; WASM adds build complexity for no gain. Revisit only if profiling says so.
- **Web Workers** for terrain tile decode/meshing, OSM/airport shard parsing, and building generation.
- **Collisions**: custom deterministic contact-point model (gear, wingtips, nose, tail, nacelles, belly) against terrain heightfield + spatial-hash of buildings/trees/aircraft — testable in Node. **Rapier (Apache-2.0, WASM)** only for detached debris rigid bodies (Phase 5).
- **Precision**: sim state in geodetic lat/lon/alt (float64) + NED velocities; renderer uses **floating origin** (ECEF → local ENU of an origin re-centered every ~5 km) so vertices stay float32-safe; logarithmic depth buffer for cockpit (0.05 m) to horizon (300+ km).
- Instruments rendered to **CanvasTexture** surfaces mapped onto 3D panel meshes; interactive controls via raycast hit-meshes bound to sim commands.

## 3. Architecture

```
world-flight-sim/
  index.html                 # entry; menu + canvas
  vite.config.js  package.json  README.md
  docs/ ARCHITECTURE.md DATASETS.md LICENSES.md RISKS.md ROADMAP.md PHASE_REPORTS/ FLIGHTPLAN_FORMAT.md
  scripts/                   # Node build-time data pipeline
    build-airports.mjs       # OurAirports CSV -> public/data/airports/{index.json, shards/<lat>_<lon>.json}
    build-navaids.mjs
    bake-osm-airport.mjs     # Overpass -> public/data/hero/<ICAO>.json (taxiways, aprons, buildings)
    bake-terrain-fallback.mjs# Terrarium z0-5 (+ hero-region z12-13) -> public/data/terrain-fallback/
    build-worldmap.mjs       # Natural Earth -> simplified land/coast JSON
  public/data/ ...           # generated data (with attribution files)
  src/
    main.js  app/            # App bootstrap, state machine (Menu/Loading/Flight/Paused/Crashed/Replay)
    core/                    # loop.js (fixed-step), events.js, settings.js, units.js, math/ (vec, quat, pid)
    geo/                     # wgs84.js (geodetic<->ECEF<->ENU), tilemath.js, greatcircle.js, magvar.js
    sim/
      atmosphere.js          # ISA + temperature/pressure offsets
      fdm/ rigidbody.js aero.js propulsion/{piston.js,turboprop.js,turbofan.js} gear.js groundeffect.js massbalance.js
      systems/ electrical.js fuel.js engines-start.js hydraulics.js pressurization.js warnings.js gpws.js
      autopilot/ autopilot.js modes.js autothrottle.js
      nav/ fms.js flightplan.js radios.js vor.js ils.js gps.js
      damage/ components.js impact.js breakup.js ditching.js replay.js
      collision/ contacts.js spatialhash.js heightquery.js
      aircraft.js            # assembles FDM + systems from config
    aircraft/ <id>/config.json  cockpit.json  sound.json   (c172, kingair, a320, b737, b787, a350, fighter, cargo)
    world/
      terrain/ quadtree.js tile-loader.js tile-worker.js tile-mesh.js terrain-material.js heightfield-cache.js
      providers/ ElevationProvider.js TerrariumProvider.js FallbackProvider.js ImageryProvider.js
      airports/ airport-db.js airport-builder.js runway-markings.js lighting.js procedural-layout.js
      scenery/ vegetation.js buildings.js cities.js water.js
      weather/ weather-model.js clouds.js precipitation.js metar.js wind.js turbulence.js storms.js icing.js
      sky/ sun.js atmosphere-sky.js stars.js
    render/ renderer.js floating-origin.js cameras.js postfx.js quality.js lod.js aircraft-model-builder.js effects/{fire,smoke,debris,particles}.js
    cockpit/ cockpit-builder.js interaction.js instruments/{asi,ai,alt,vsi,hi,tc,compass,pfd,nd,eicas,fmc-cdu,engine,fuel,gear-panel,ap-panel,hud}.js
    audio/ audio-engine.js engine-synth.js wind.js alerts.js voice.js
    input/ keyboard.js mouse.js gamepad.js bindings.js
    ui/ menu/ hud/ debug-panel.js worldmap.js airport-search.js flightplan-ui.js settings-ui.js loading-screen.js crash-screen.js
    modes/ scenario-runner.js scenarios/*.json scoring.js
  tests/ unit/*.test.js  scenario/*.test.js  e2e/*.spec.js
```

Key data flow: `input → controls → sim (120 Hz: weather sample → FDM → collision/damage → systems → AP) → state snapshot → render/instruments/audio (frame rate)`. Sim modules are DOM-free so they run in Node tests.

### 3.1 Flight dynamics model
- 6-DOF rigid body, quaternion attitude, body-axis inertia tensor from config; semi-implicit integration at 120 Hz (RK4 on rotational state if needed for stiffness).
- Aero coefficient build-up per aircraft: `CL(α, flaps)` tabulated with post-stall drop and hysteresis; `CD = CD0 + k·CL² + ΔCD_flaps + ΔCD_gear + ΔCD_spoilers + wave drag(Mach)`; moments with stability (Cm_α, Cl_β, Cn_β), damping (Cl_p, Cm_q, Cn_r) and control derivatives; trim tab effect; downwash lag; buffet near CLmax; asymmetric stall → wing drop/spin tendency.
- Propulsion: piston (power vs density/RPM/mixture, prop efficiency vs advance ratio, P-factor/torque), turboprop (shaft HP, prop beta/reverse), turbofan (N1/N2 spool lag, thrust lapse with density & Mach, reversers), afterburner for fighter.
- Ground effect (Wieselsberger induced-drag reduction, lift boost within ~1 span), wind + gusts + Dryden turbulence applied as airmass velocity, runway slope from terrain sampling.
- Landing gear: spring-damper struts, tire longitudinal/lateral friction by surface (asphalt/grass/wet/ice), differential and parking brakes, nosewheel steering, gear-extension drag + transit time + limits (VLE/VLO).
- Fuel burn (SFC/BSFC) reduces mass and shifts CG.

### 3.2 Cockpit
Per-aircraft `cockpit.json` declares panel geometry, instrument placements, and control widgets (`lever`, `knob`, `switch`, `button`, `guarded-switch`) each bound to a sim command (e.g. `ELEC_MASTER`, `FLAPS_SET`, `AP_HDG_SEL`). Builder generates 3D cockpit meshes (panel, glareshield, yoke/sidestick animated by control input, throttle quadrant, pedals, overhead). Instruments: C172 steam six-pack + engine gauges; King Air hybrid; airliners PFD/ND/EICAS/FMC-CDU; fighter HUD. All read the same sim state (no decorative values). Interaction: hover highlight, click/drag/scroll on raycast hits, instrument zoom (snap views), free-look (right-drag / hat), keyboard equivalents.

### 3.3 Damage & crash model
- Airframe split into components (nose/main gears, inner/outer wings L/R, h-stab, v-stab, fwd/aft fuselage, engines) each with contact points/hulls, health, and config thresholds scaled by mass & structural class.
- Each contact computes normal/tangential impact velocity, angle, impacted surface (terrain/runway/water/building/tree/aircraft) → damage energy vs component strength. Different impacts → different outcomes (no scripted animation).
- Consequences feed back into physics: gear collapse (contact point moves to belly → scraping friction), wing damage (lift loss, roll moment), tail loss (pitch/yaw authority loss), engine damage (thrust loss, fire, failure warnings), in-flight over-G structural failure, ditching with buoyancy/drag, runway overrun detection.
- Breakup: components exceeding detach threshold spawn Rapier debris bodies with inherited velocity; remaining airframe mass/inertia/aero updated. Fire/smoke particles.
- 30 s state ring buffer → crash replay with orbit camera; post-crash state screen with telemetry; restart / return to menu.
- Modes: Realistic / Simplified (threshold-based end of flight) / Off (invulnerable).

### 3.4 World streaming
- Chunked quadtree LOD on Terrarium tiles (screen-space-error driven), tiles meshed in a worker with skirts, placed in ECEF relative to floating origin (correct curvature).
- Priority queue: physics heightfield tiles under/ahead of aircraft first → frustum-visible near → far. LRU GPU/memory budget per quality preset; persistent Cache API storage; retry with backoff; fallback to bundled low-res tiles, then procedural noise — flight never blocks on network.
- Physics height queries use a dedicated high-res heightfield cache independent of render LOD; airports flatten terrain to runway elevation with blended skirts.
- Scenery: instanced vegetation by elevation/latitude/slope; procedural towns seeded from Natural Earth populated places; hero OSM buildings where baked. Water from DEM ≤0 + Natural Earth mask, reflective water shader.

### 3.5 Airports, navigation, autopilot
- Airport DB: search by ICAO/IATA/name/city; shards loaded by area. Builder makes runways with correct markings (designators, threshold, TDZ, aiming point, centerline), edge/centerline/approach lights (ALS), PAPI, procedural taxiways/apron/terminal/hangars/parking stands; hero airports use baked OSM layouts.
- FMS: waypoints (airports, navaids, user lat/lon), direct-to, great-circle legs, XTK/DTK, ETE/ETA, altitude/speed constraints; JSON flight-plan import/export (documented format) + simple `.pln`-like export. VOR/DME (line-of-sight range), CDI, synthetic ILS LOC/GS with deviation.
- Autopilot: cascaded PID controllers acting **only on control surfaces/throttle**: HDG, ALT, VS, SPD/autothrottle, LNAV/NAV, APP (LOC+GS), with armed/active mode annunciation and per-aircraft limits (bank/pitch/rate limits, C172 has no autothrottle).

### 3.6 Weather, sky, audio, modes, UI
- Weather model: wind layers, gusts, turbulence intensity, cloud layers (base/top/coverage/type), visibility/fog, rain/snow, temperature/QNH, thunderstorm cells (up/downdrafts, severe turbulence, lightning), icing (accretion in moisture 0…−20 °C → CLmax/drag penalty, anti-ice). Presets + manual editor + METAR parse.
- Sky: physical sun position from date/time/lat/lon, scattering sky, stars/night lighting, time acceleration. Clouds: impostor billboards (Low/Med) → raymarched volumetric layer (High/Ultra).
- Audio (Web Audio): engine synth by RPM/N1, prop/jet character, wind ∝ dynamic pressure, gear/flap motors, stall horn, overspeed clacker, GPWS & altitude callouts (SpeechSynthesis), tire squeal, rain/thunder, impacts.
- Modes via scenario JSON (initial state, weather, failures, objectives, scoring): Free Flight, Airport-to-Airport, Training lessons, Landing/Crosswind/Weather challenges, Emergencies, Systems practice.
- UI: HTML/CSS aviation-style menus (World Map on custom canvas from Natural Earth — no third-party tile dependency; Aircraft, Airport, Flight Plan, Weather, Assistance, Graphics, Controls, Start), in-flight HUD (toggle `H`), debug panel (`` ` ``) with position/alt/IAS/VS/attitude/AoA/engine/timestep/FPS/collision events/damage.
- Graphics presets Low/Medium/High/Ultra + dynamic resolution (drops pixel ratio to hold target FPS). Documented target: WebGL2 desktop browser; Medium @1080p 60 fps on GTX 1060/Apple M1 class; Low for integrated GPUs.

## 4. Technical risks

1. No free global aerial imagery → procedural ground look (documented, adapter for keyed imagery).
2. OSM/Overpass rate limits & uneven coverage → bake hero sets at build time, cache runtime fetches, procedural fallback.
3. Float precision across Earth → float64 sim + floating origin + log depth.
4. FDM fidelity is approximate (public data, no wind-tunnel tables) → per-aircraft validation targets (stall speed, Vr, climb rate, cruise speed) in automated tests.
5. Browser memory/GPU limits → strict LRU budgets per preset, worker meshing, progressive loading.
6. Runtime internet needed for global terrain → bundled fallback + prototype region baked locally.
7. Headless testing has software GL only → physics/logic tested in Node; browser tests are smoke/functional, not perf.
8. Scope: this is a multi-phase, multi-session effort; each phase ships a working build + honest report.

## 5. Phased implementation

**Phase 2 — Playable prototype (next, after approval)**
- Vite project, docs (ARCHITECTURE, DATASETS, LICENSES, RISKS, ROADMAP), data pipeline for airports + prototype-region terrain bake.
- One aircraft: **GA-172 (C172-class)** with full FDM, piston engine (mags/starter/mixture start), electrical master/avionics, fuel, flaps, fixed gear with brakes/steering.
- One recognizable airport (hero OSM bake) + surrounding real terrain streaming with fallback.
- 3D interactive cockpit with six-pack, tach, fuel/oil gauges, throttle/mixture/flap lever/trim wheel/parking brake/master switches; exterior chase + cockpit + free-look cameras.
- Terrain/runway/building collision, component damage, crash → telemetry → restart/menu.
- Menu with airport selection (search across all OurAirports; non-hero airports procedural), HUD, debug panel, basic sound, Low/Med/High presets.
- Tests: atmosphere, lift/drag, thrust, stall detection, control response, instruments, fuel burn, collision/damage, tile math, flight-plan math; Playwright smoke (load, start, scripted takeoff via `window.__sim` debug API, screenshot).

**Phase 3** — Remaining 7 aircraft (configs, parametric models, cockpits incl. glass PFD/ND/EICAS/CDU and fighter HUD), turboprop/turbofan engines, hydraulics/pressurization, autopilot + autothrottle, retractable gear, warnings/GPWS.
**Phase 4** — Global terrain streaming at scale, full airport DB + procedural airports worldwide, navaids/VOR/ILS, FMS + flight plans, world map, procedural towns/cities, more hero airports/cities, AI ground/air traffic (basic).
**Phase 5** — Full weather (clouds, precip, storms, icing, METAR), volumetric clouds & sky, water, night lighting, breakup/debris/fire/ditching/replay, full audio, game modes & scenarios, Ultra preset/post-FX.
**Phase 6** — Test & optimization pass: flight-test matrix per aircraft (takeoff, stall, turns, landings, collisions, altitudes, weather), streaming/memory soak tests, bug fixing, final docs.

Each phase ends with: working build, `docs/PHASE_REPORTS/phase-N.md` (completed features, simplifications, known bugs), green test suite.

## 6. Verification (per phase)
- `npm run test` — Vitest unit + scenario tests (e.g. GA-172 full throttle at sea level ISA lifts off in plausible distance, climbs ~700 fpm at Vy, stalls within ±5% of configured VS1/VS0; AP holds altitude ±50 ft over 5 min calm; gear collapses above configured sink rate; fuel burn matches config SFC).
- `npm run test:e2e` — Playwright with preinstalled Chromium: app loads with no console errors, airport search works, flight starts, scripted takeoff/climb/landing reach expected states, crash → restart works, screenshots captured for the report.
- `npm run dev` manual play-check; `npm run build` produces static deployable bundle.
