# Architecture

## Layers

```
input (keyboard / mouse / gamepad / cockpit clicks)
   └─► sim/commands.js ──► Aircraft.controls / switches / selectors
app/flight.js  (per frame)
   ├─ fixed-step loop: Aircraft.step(1/240 s) × N   ← render-rate independent
   │     weather.sample → aero → propulsion → contacts (gear, airframe, water, obstacles)
   │     → rigid-body integration → systems (electrical, fuel, instruments) → damage → warnings
   ├─ recorder (30 Hz ring buffer, 30 s) → crash replay / telemetry
   └─ visuals: floating origin, aircraft model, cockpit, cameras, terrain/scenery/airport streaming,
      sky, effects, audio, HUD, debug panel
```

Everything under `src/sim`, `src/geo`, `src/world/terrain/terrain-core.js` and `flatten.js` is DOM-free and runs in Node. The test suite uses those modules directly.

## Coordinate frames and precision

- **Simulation state**: geodetic latitude, longitude and altitude (float64), velocity in local NED (m/s), attitude as a body→NED quaternion, and body rates p, q, r. Body axes are x forward, y right, z down. Each step treats the local tangent plane as flat; position integrates through the WGS84 radii of curvature.
- **Rendering**: a *floating origin* (`render/floating-origin.js`). The scene is the local ENU frame (three.js x = East, y = Up, z = −North) of an origin re-centred whenever the aircraft is 4 km away. Every geo-placed object (terrain tile, airport, scenery tile, landmark, debris) is authored in its own local frame. Its matrix is recomputed in float64 on re-centre, so vertices stay small float32 numbers anywhere on Earth. A logarithmic depth buffer covers 4 cm (cockpit) to beyond 400 km.
- Local meshes such as runways and city blocks apply an Earth-curvature correction, `u = h − (e² + n²)/2R`.

## Flight dynamics (`sim/aircraft.js`, `sim/fdm/*`)

- **Aerodynamics** (`aero.js`): coefficient build-up in wind axes, rotated to body axes.
  - `CL(α)` comes from a table with post-stall drop. Flaps shift the curve and add ΔCL, ΔCD and ΔCm.
  - Lift also gets `CLq` and elevator terms.
  - Drag is `CD0 + k·CL²·φ_ground-effect + flaps + β²`, blending to flat-plate drag past the stall.
  - Moments use stability derivatives (Cmα split into wing-body and tail, Clβ, Cnβ), damping derivatives (Clp, Cmq, Cmα̇, Cnr) and control derivatives (Cm_de, Cl_da, Cn_da adverse yaw, Cn_dr, Cl_dr).
  - **Stall behaviour**: roll damping reverses sign in the stall (autorotation and wing drop), there is an asymmetric break, a nose-down pitch break, and buffet (camera shake).
  - Ground effect follows Wieselsberger/McCormick: lower induced drag, a small lift gain, and reduced tail downwash.
  - Damaged wings lose lift and create a rolling moment. Damaged tails lose stability and authority.
- **Propulsion** (`propulsion/piston.js`):
  - Manifold pressure follows throttle and ambient pressure. Mixture is modelled as an equivalence ratio that richens with altitude (∝ 1/√σ), with efficiency and combustion limits.
  - Magnetos, starter torque (needs bus voltage), friction and breakaway torque.
  - RPM comes from the torque balance against a fixed-pitch propeller using `Ct(J)` and `Cp(J)`. Thrust and absorbed power fall naturally with airspeed, and the propeller windmills when unpowered.
  - Fuel flow tracks airflow × mixture. EGT, CHT and oil temperature lag their targets. Oil pressure depends on RPM.
  - Torque reaction (partly cancelled by wing rigging), P-factor and slipstream yaw are included.
- **Landing gear** (`aircraft.contacts`):
  - Spring-damper struts with travel limits and bottoming.
  - Tyre friction in the wheel's ground frame: rolling resistance by surface, brakes (differential and parking), lateral friction limited by a friction circle, and nose-wheel steering by rudder.
- **Airframe contacts**: 14 hard points (prop tip, cowl, belly, tailcone, roof, fin, stabiliser tips, wing tips and mid-spans). Each is a stiff penalty contact with friction against terrain, runway and buildings. Water contact uses buoyancy (gradual flooding) and hydrodynamic drag. Tree crowns apply branch drag and damage; trunks are hard.
- **Integration**: semi-implicit Euler at **240 Hz**, chosen for contact stiffness. The full 6-DOF Euler equations include the gyroscopic `ω × Iω` term. Inertia scales with mass, and mass falls as fuel burns.

## Damage model (`sim/damage/damage.js`)

- There are 10 components, each with health in [0, 1]. Thresholds per component are in the aircraft config: `vSafe`, `vFail`, `loadLimit`, `sideLimit` and `scrapeEnergy`.
- **Impact**: `v_eff = v_normal · √(m/m_MTOW) / surfaceFactor (+ tangential terms)`, and `severity = (v_eff² − vSafe²)/(vFail² − vSafe²)`.
  - Because only the normal component counts, angle matters.
  - Mass matters through the √(m/m_MTOW) factor.
  - Surface matters through the factor: building 0.55, grass 1.15, water 1.25, tree 2.5, and so on.
- Other damage sources:
  - Gear structural overload: strut force and side load.
  - Scraping work divided by the component's energy capacity.
  - Over-G: overstress above the limit load, wing failure above the ultimate load (1.5×).
  - Flutter above Vne × 1.12.
- **Consequences** feed straight back into physics:
  - A detached gear leg loses its wheel contact, so the belly hard points take over.
  - Wing and tail health scale the aerodynamic terms.
  - A propeller strike causes sudden engine stoppage.
  - Engine damage reduces power and oil pressure.
  - Fire means fuel leaks.
- "Destroyed" means fuselage failure or both wings lost. "Ditched" means the aircraft came to rest afloat.
- Modes: Realistic, Simplified (the flight ends when any component drops below 50 %), Off (events are still logged).

## World streaming (`world/terrain/*`)

- **Quadtree LOD** on Web-Mercator tiles. Roots are at z5 around the camera, split by distance relative to tile size (quality preset), up to z13. The physics tiles (z13, 3×3 around the aircraft) are always requested first.
- **Worker meshing** (`terrain-worker.js`):
  - Fetches the Terrarium PNG (9 s timeout). After 4 consecutive failures it backs off to offline mode for 60 s.
  - Falls back to baked packs: KSFO region at z12 (129² samples per tile), then global z4 (65²).
  - Applies airport flattening zones, then builds positions, normals and vertex colours plus skirts.
- **Fallback-ancestor rendering**: while a leaf tile is loading, its nearest loaded ancestor is drawn and the overlapping descendants are hidden, so there are no holes and no overlap. Tiles are evicted LRU against a per-quality budget.
- **Physics ground** (`TerrainManager.sample`):
  1. Airport paved surfaces (runway or taxiway/apron polygons and ribbons) return the exact surface height.
  2. Otherwise the best loaded z13…z6 grid is sampled with the **same triangulation as the rendered mesh**.
  3. Otherwise the baked packs with zones applied are used.
  - The result is classified as water, grass (inside an airport zone) or terrain.
- **Flattening zones** (`flatten.js`): a convex hull of runways, taxiways and aprons, grown 40 m. Inside it the terrain follows the runway profile (the nearest runway's interpolated elevation), sitting 15 cm below the pavement. It blends to the DEM over 250–400 m.

## Airports (`world/airports/*`)

- `airport-db.js`: search index (`index.json`, about 2.3 MB) plus 10° shards holding runways, frequencies and navaids. Magnetic variation comes from inverse-distance weighting of nearby navaid declinations.
- `airport.js` builds, in one local frame:
  - Runways with a baked canvas marking texture (threshold piano keys, designators, centreline, aiming point, TDZ bars for precision runways, displaced-threshold arrows).
  - Taxiway ribbons with yellow centrelines, aprons, and extruded buildings with a window texture that lights up at night.
  - Lights: edge, threshold and end, centreline, simplified ALSF approach lights with sequenced flashers, blue taxiway edge lights, and a **PAPI** whose four units turn red or white from the viewer's elevation angle (3.5° / 3.17° / 2.83° / 2.5°).
  - Obstacles, the flattening zone, a paved-surface index, and spawn points (runway ends, stands, and a 3° final approach).
  - Hero layout from OSM where baked; otherwise a procedural apron, parallel taxiway, terminal, hangars, tower and stands.
- `airport-manager.js`: keeps the departure airport plus airports within 25 km built, and releases those beyond 60 km.

## Cockpit (`cockpit/*`)

- Interior shell: the fuselage loft with inward faces and open windows. Panel, glareshield, seats, console, yoke and pedals are animated from the control positions.
- Instruments: one `CanvasTexture` per gauge, redrawn at about 30 Hz from the instrument models. Each is emissive with the panel lights at night.
- Controls are meshes with a `userData.ctl` descriptor (`click`, `down`, `up`, `drag`, `wheel`, `label`, `value`). `CockpitInteraction` raycasts, highlights, shows a tooltip, and handles right-drag free look and wheel zoom.

## Data formats

- `src/aircraft/<id>/config.json`: everything aircraft-specific (mass and inertia, geometry, aero tables and derivatives, controls, engine and propeller, fuel, electrical, gear, contact points, damage thresholds, V-speeds). Adding an aircraft is primarily a new config. Phase 3 adds turboprop and turbofan engine modules and per-aircraft cockpits.
- `public/data/hero/<ICAO>.json`: OSM layout in local metres around a reference point.
- Terrain packs: Int16 heights plus a JSON manifest (`z`, `n`, `scale`, tile list).
