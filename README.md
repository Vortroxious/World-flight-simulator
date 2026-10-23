# World Flight Simulator

A browser flight simulator built with Three.js / WebGL2. It has a real 6-degree-of-freedom flight model, an interactive 3D cockpit, real terrain elevation, the world's airports, and a physics-driven crash and damage model.

> **Status: Phase 2 playable prototype.** This is **not** a Microsoft Flight Simulator replacement. It contains no MSFS assets and no satellite imagery. See [docs/PHASE_REPORTS/phase-2.md](docs/PHASE_REPORTS/phase-2.md) for exactly what works, what is simplified, and the known bugs. See [docs/ROADMAP.md](docs/ROADMAP.md) for what comes next.

## What you can do today

- **Fly the GA-172 Skyfarer**, a Cessna 172-class aircraft.
  - Coefficient-based 6-DOF flight model, tuned to public C172S POH numbers. Automated tests check it against them:
    - Takeoff roll about 300 m.
    - Best-rate climb about 650 fpm.
    - Full-throttle cruise about 116 KTAS at 8,000 ft.
    - Stall about 46 KCAS clean and about 41 KCAS with full flaps.
  - Piston engine and fixed-pitch propeller: manifold pressure, mixture/altitude effects, magnetos, starter, P-factor and torque.
  - Systems: electrical bus, battery and alternator, two fuel tanks with a selector, vacuum-driven gyros, pitot-static instruments, electric flaps, brakes and nose-wheel steering.
- **Interactive cockpit.**
  - Steam-gauge six-pack, tachometer, engine cluster, annunciators, magnetic compass, and a GPS/COM/transponder unit.
  - Clickable, draggable and scrollable controls: throttle, mixture, flap lever, trim wheel, ignition key, master and light switches, fuel selector, parking brake, altimeter setting, heading bug, COM tuning, squawk.
  - Every indication is computed from the simulated state.
- **Real world data.**
  - **29,145 airports and 34,311 runways** worldwide from OurAirports, searchable by ICAO, IATA, name or city.
  - Real terrain elevation streamed from AWS Terrain Tiles, with bundled offline fallbacks.
  - **KSFO** has its OpenStreetMap layout: 244 taxiways, 18 aprons, 4,031 buildings and stands. Downtown San Francisco has 569 OSM towers. A Golden Gate Bridge model sits at its real position.
  - Every other airport gets real runways with baked markings, plus lighting and a procedural apron, taxiway and terminal layout.
- **Crashes are simulated, not scripted.**
  - Every gear leg, wing, tail, the propeller, the engine and the fuselage has its own health. Damage depends on impact speed, impact angle, aircraft mass, surface type and component strength.
  - Outcomes include gear collapse, prop strike, wing separation, over-G structural failure, flutter, building and tree strikes, ditching, fire and smoke, and debris.
  - After a crash you get a 30 s replay, a telemetry report, restart, and return to menu.
- **Weather and time.**
  - Wind profile, gusts, turbulence (with a rotational component), QNH and temperature, and visibility fog.
  - Real solar position for any date and time, a night sky, and runway, approach and taxi lighting with a working PAPI.
- **Sound**, all synthesised in Web Audio: engine, propeller, starter, wind, stall horn, flap motor, tyres, impacts.
- **Phones and tablets:** touch stick, throttle lever, rudder, brakes, flaps and trim buttons, touch look-around and pinch zoom, and a responsive menu.
- **UI.** Main menu with flight setup, a world map of every airport, weather and time, assistance and damage mode, graphics presets (Low to Ultra, plus dynamic resolution), and a controls reference. In flight: HUD, debug/telemetry panel, pause menu.

## Requirements

- Node.js 20 or newer (developed on 22) and npm.
- A desktop browser with **WebGL2** and hardware acceleration: recent Chrome, Edge or Firefox. Safari 17+ should work but has not been tested.
- An internet connection is optional. It is used to stream real terrain worldwide. Offline, the simulator uses bundled elevation: detailed around San Francisco, coarse everywhere else.

## Run locally

```bash
npm install
npm run dev          # http://localhost:5173
```

Opening `index.html` directly from disk does not work, because browsers block ES modules and workers on `file://`. Use the dev server or a static server.

```bash
npm run build        # static bundle in dist/ (deploy to any static host, e.g. GitHub Pages)
npm run preview      # serve the production build locally
npm run build:artifact  # build + smoke-test the shareable preview page (see CLAUDE.md)
```

## First flight

1. **Start Flight** (defaults: GA-172 at KSFO, on the runway, engine running).
2. Press **F4** for full throttle and keep straight with **Z / X** (rudder).
3. At about 55 kt, pull back with **↓** (or **S**) to about 8° nose-up. Climb at 74 kt.
4. **V** cycles views (cockpit, chase, orbit, tower). **I** zooms on the instruments. Right-drag to look around. **H** toggles the HUD, **`** toggles the debug panel, **Esc** pauses.

**On a phone or tablet** (landscape recommended), on-screen controls appear automatically:
- **Left stick** — drag down to pull (nose up), up to push, sideways to roll. It re-centres when you let go.
- **◀ ▶** — rudder and nose-wheel steering.
- **THR lever** (right) — slide up for power.
- **BRK** (hold) and **PARK** — brakes and parking brake.
- **Top-right buttons** — flaps, trim, VIEW, PANEL (instrument zoom), HUD and pause.

In the cockpit, tap switches and knobs, drag empty space to look around, and pinch to zoom. You can force the controls on or off, or invert the stick, under Menu → Controls.

The full key list is under **Menu → Controls**. The cold-and-dark start procedure is also there. A gamepad works too (left stick, right stick X for rudder, triggers for throttle).

## Tests

```bash
npm test             # 75 unit + scenario tests (Vitest, Node): geodesy, atmosphere, aero, engine,
                     # systems, instruments, collision, damage, terrain, airports, full-flight scenarios
npm run test:e2e     # 11 browser end-to-end tests (incl. an emulated touch phone) (Playwright + Chromium): boot, search, world map,
                     # start flight, keyboard + mouse cockpit input, takeoff/climb, crash → replay → restart,
                     # procedural airport approach, no runtime errors. Screenshots in tests/e2e/output/
```

`test:e2e` needs a Chromium that Playwright can launch. Install one with `npx playwright install chromium`, or set `CHROMIUM_PATH`.

## Data pipeline (optional; generated data is committed)

```bash
NODE_USE_ENV_PROXY=1 node scripts/build-airports.mjs        # OurAirports -> public/data/airports, navaids/magvar
NODE_USE_ENV_PROXY=1 node scripts/bake-osm-airport.mjs KSFO # OSM (Overpass) -> public/data/hero/KSFO.json
NODE_USE_ENV_PROXY=1 node scripts/bake-terrain-fallback.mjs # Terrarium -> public/data/terrain/*.bin
NODE_USE_ENV_PROXY=1 node scripts/build-places.mjs          # Natural Earth -> public/data/places.json
```

`NODE_USE_ENV_PROXY=1` is only needed behind an HTTPS proxy.

## Project layout

```
src/
  sim/       DOM-free simulation: aircraft.js (6-DOF assembly), fdm/ (aero, piston engine), systems/,
             damage/, collision/, weather/, atmosphere.js, commands.js
  geo/       WGS84 geodesy, Web-Mercator tile maths
  world/     terrain/ (streaming, worker meshing, flattening), airports/, scenery/, sky/
  render/    floating origin, aircraft model, cameras, effects
  cockpit/   3D cockpit, canvas instruments, mouse interaction
  ui/ input/ audio/ app/
  aircraft/ga172/config.json   all aircraft-specific data
scripts/     build-time data pipeline
tests/       unit/, scenario/, e2e/
docs/        ARCHITECTURE, LICENSES (data attribution), RISKS, ROADMAP, PHASE_REPORTS/
```

## Licensing and attribution

See [docs/LICENSES.md](docs/LICENSES.md). In short:
- Airport data: OurAirports, public domain.
- Elevation: AWS Terrain Tiles (Mapzen/Tilezen sources, attribution required).
- KSFO and San Francisco buildings: © OpenStreetMap contributors (ODbL).
- Populated places: Natural Earth, public domain.
- Libraries: three.js (MIT); Vite, Vitest and Playwright (dev, MIT/Apache-2.0).

The aircraft model, textures and sounds are original, generated in code. Aircraft are named by class, with no manufacturer trademarks or liveries. No licence has been chosen yet for the project's own code; the repository owner should add one.
