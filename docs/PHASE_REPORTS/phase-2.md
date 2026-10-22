# Phase 2 report: playable prototype

**Build:** v0.2.0. **Tests:** 75/75 unit and scenario tests (Vitest), 11/11 browser end-to-end tests (Playwright + Chromium, software GL, including an emulated touch phone).

## Acceptance criteria (from the brief)

| Criterion | Status | Evidence |
|---|---|---|
| Controllable 3D aircraft | ✅ | GA-172 parametric model with animated surfaces. Keyboard, mouse-yoke and gamepad input. |
| Recognisable airport environment | ✅ | KSFO from OpenStreetMap (taxiways, aprons, terminals, stands), real runways with markings, lights and PAPI. Any of 29,145 airports, procedural apart from the runways. |
| Working takeoff and landing | ✅ | Scenario tests: takeoff roll 230–420 m; a scripted 3° approach, flare and landing with no damage; rollout and braking. E2E: takeoff and climb at KSFO on real terrain. |
| Detailed, interactive cockpit | ✅ (GA level) | Six-pack, tachometer, engine cluster, annunciators, compass, GPS/COM/XPDR. About 30 clickable, draggable or scrollable controls. E2E test clicks the beacon switch. |
| Instruments show simulated values | ✅ | Pitot-static (IAS lag, altimeter with Kollsman setting, VSI lag), vacuum gyros that spin up and topple, electric turn coordinator, compass turning error. Unit-tested. |
| Functional throttle, flaps, gear | ✅ | Throttle drives manifold pressure, RPM and thrust. Electric flaps change lift, drag and pitch and need bus power (tested). Gear is fixed on this aircraft: struts, brakes and steering are simulated; retractable gear is Phase 3. |
| Working camera system | ✅ | Cockpit (free look, instrument zoom, buffet shake), chase, orbit, tower/flyby, replay orbit. |
| Realistic response to inputs | ✅ (approximate) | Against POH: Vy climb about 630–670 fpm, full-throttle cruise about 116 KTAS at 8,000 ft, stall 45.6 / 41 KCAS. Adverse yaw, P-factor, stall wing drop. |
| Terrain collision detection | ✅ | 3 gear struts plus 14 airframe hard points against the same triangulated terrain the renderer draws. Buildings, trees and water also collide. |
| Functioning crash and damage system | ✅ | Per-component damage depending on speed, angle, mass and surface. Gear collapse, prop strike, wing separation, over-G failure, ditching, fire and smoke, debris. Unit and scenario tests. |
| Restart after crash | ✅ | Crash report, then replay, restart or menu (E2E). |
| Airport selection interface | ✅ | Search by ICAO, IATA, name or city; world map click; runway, stand or final-approach start. |
| Stable performance on documented hardware | ⚠️ **Not verified** | No GPU in the build environment: software rendering gave about 5–8 fps. The simulation stays stable because of the fixed step. Real-hardware measurement is Phase 6. Use the Low preset and dynamic resolution on integrated GPUs. |

## Mobile / touch (added after the first Phase 2 build)
- On-screen controls appear on touch devices (setting: Auto / On / Off):
  - virtual stick with an expo curve
  - throttle lever
  - rudder, brake and parking-brake buttons
  - flaps, trim, view, panel-zoom, HUD and pause buttons
- One-finger look-around and pinch zoom in the cockpit. Tap-to-operate cockpit controls with a short tooltip.
- The menu becomes a scrollable tab strip with a floating Start button on small screens. All touch elements respect safe-area insets.
- **Verified only with Chromium's phone emulation** (touch events, 844×390 landscape and portrait). It has **not** been tested on real iOS or Android devices, and real-device performance is unmeasured.
- Fixed along the way: a CSS rule made every overlay capture pointer events, so the HUD blocked clicks on desktop and the touch layer would have blocked the cockpit.

## Simplified or approximate (by design, documented)
- **Flight model** comes from public data with approximate derivatives. It is not certified. Wind and turbulence are an airmass model: mean wind profile, gusts, first-order Markov turbulence and roll gusts.
- **Ground look**: no imagery. Procedural vertex colours plus a detail shader. Urban areas are procedural boxes seeded from Natural Earth populated places. Only KSFO and downtown SF come from OSM.
- **Clouds and precipitation are not rendered yet.** "Cloud cover" affects sky haze and sunlight only. Rain is audio only. Visibility uses fog. Volumetric clouds are Phase 5.
- **Debris** follows simple gravity and bounce, and does not collide with the aircraft. Rapier is planned for Phase 5.
- **Lights are omnidirectional**, so threshold green and end red are both visible from every direction.
- **Avionics**: GPS has nearest-airport and Direct-To (bearing, distance, ETE) only. COM tuning has no ATC audio. The transponder mode has no effect yet. No VOR, ILS or flight plan yet (Phase 4).
- **Magnetic variation** is interpolated from nearby navaid declinations, not computed from WMM.
- **Time acceleration** affects time of day only, not physics.
- **Lakes above sea level** are not detected as water; only the ocean or bay below 0 m is.

## Known bugs and limitations
- If the frame rate falls below 4 fps, simulation time runs slower than real time (at most 0.25 s of simulation per frame).
- The cockpit interior lining is a coarse loft, so window edges look faceted.
- Parking brake on steep slopes can creep a few centimetres per minute (viscous friction model).
- Changing anti-aliasing needs a page reload. Other graphics settings apply immediately.
- Airports built while flying (within 25 km) appear about 4 s after they come into range.
- When the network is slow, distant terrain shows coarser tiles for a few seconds. Holes are prevented by drawing fallback ancestor tiles.

## Bugs found and fixed during Phase 2 testing
- Engine would not crank: static friction was modelled as power ÷ ω, giving huge torque near 0 rpm. It is now a breakaway torque.
- Prop strike under heavy braking: nose strut too soft and prop tip too low. Clearance is now about 0.2 m.
- Urban areas missing: an inverted slope filter and an undersized city radius.
- Over-exposed scene and linear-vs-sRGB vertex colours.
- Cockpit eye point and window layout.
- Replay showed parts detached from the start; per-frame detached state is now recorded.

## How to verify
```
npm install
npm test            # 75 tests
npm run test:e2e    # 11 browser tests + screenshots in tests/e2e/output/
npm run dev         # fly
```
