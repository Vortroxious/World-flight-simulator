# Phase 3 report: aircraft and cockpit systems

**Build:** v0.3.0 (branch `phase-3`). **Tests:** 138 unit and scenario tests passing, 2 deliberately skipped (Vitest); 13/13 browser end-to-end tests (Playwright + Chromium with software GL, including an emulated touch phone).

All aircraft are named by class. They use original, code-generated geometry and class-typical data from public dimensions and performance figures. **None of it is certified or manufacturer data.**

## Fleet

| Aircraft | Class | Engines | Flight controls | Flight deck |
|---|---|---|---|---|
| GA-172 Skyfarer | Cessna 172-class | 1 × piston, fixed-pitch prop | conventional | analogue six-pack (Phase 2) |
| TP-200 Stratus | King Air 200-class, T-tail | 2 × turboprop (governed, auto-feather, beta/reverse) | conventional, yaw damper | glass: PFD / MFD / engine display, yoke |
| NB-320 Meridian | A320-class narrowbody | 2 × turbofan with reversers | fly-by-wire, Airbus-type normal law | glass: 2 PFD, 2 ND, E/WD, MCP, CDU, overhead, sidestick |
| NB-738 Cascade | 737-800-class narrowbody | 2 × turbofan with reversers | conventional, yaw damper | glass, yoke |
| WB-789 Horizon | 787-9-class widebody | 2 × turbofan with reversers | fly-by-wire, Boeing-type law | glass, yoke |
| WB-359 Aurora | A350-900-class widebody | 2 × turbofan with reversers | fly-by-wire, Airbus-type normal law | glass, sidestick |
| FX-16 Kestrel | F-16-class fighter | 1 × afterburning turbofan | fly-by-wire: 9 g / 25° AoA limiter, 240°/s roll | HUD + 2 MFDs, side-stick |
| CT-130 Packhorse | C-130-class tactical transport | 4 × turboprop | conventional, yaw damper | glass, yoke |

## Completed features

### Simulation core
- The aircraft model now supports N engines of three kinds: **piston**, **turbofan** and **turboprop**.
  - Each engine applies thrust at its real position along its thrust axis, so an engine failure produces real asymmetric yaw.
  - **Turbofan:** N1/N2 spool lag, bleed-air or electric start, light-off, thrust lapse with density and Mach (with ram recovery for the fighter), TSFC, EGT, reversers (ground only, hydraulic transit) and afterburner.
  - **Turboprop:** gas generator (Ng), flat-rated shaft power, governed propeller speed (Np), momentum-theory thrust, auto-feather, beta/reverse, torque and ITT.
- **Retractable gear** with transit time, hydraulic dependence, squat-switch interlock, Vle/Vlo overspeed damage and gear drag. Gear contacts are inactive while retracted.
- **Spoilers and speed brakes.** Ground spoilers deploy when armed, at idle, with the wheels spun up (above ~60 kt) or reverse selected.
- **Flaps and slats** with drive rates and hydraulic dependence. The fighter has automatic manoeuvre flaps.
- **Mach effects:** compressibility drag rise for transports, and transonic/supersonic wave drag for the fighter (top speed about Mach 1.6 at FL300, about Mach 2 at FL400). Mmo-based flutter damage.
- **Systems:**
  - hydraulics (engine-driven and electric pumps per system)
  - cabin pressurisation (schedule limited by maximum differential, CABIN ALT warning)
  - APU (start sequence, bleed, generator)
  - generators per engine
- **Alerts:** warnings and cautions with latching MASTER WARNING / MASTER CAUTION and a reset. Warnings: STALL, OVERSPEED, CONFIG (take-off configuration), GEAR, CABIN ALT, AP DISC, OVER G and FIRE. Cautions: FLAP SPEED, HYD LO, GEN OFF, FUEL LOW, ENG FAIL and SPD BRK.
- **GPWS** (simplified modes 1–6) and radio-altitude callouts, spoken with speech synthesis:
  - SINK RATE / PULL UP
  - TERRAIN (radio-altitude closure)
  - DON'T SINK
  - TOO LOW GEAR / FLAPS
  - GLIDESLOPE
  - BANK ANGLE
  - "2500 … 10", MINIMUMS, RETARD
- **Fly-by-wire:** model-based pitch and roll rate loops with feed-forward, auto-trim, flight-path hold, bank hold, and load-factor and AoA protections with prediction. Pitch-attitude and high-speed protection on transports. The laws blend to direct law on the ground and below about 40 ft.
- **Autopilot / autothrottle / flight director:**
  - Lateral modes: ROL, HDG, NAV (direct-to course), LOC.
  - Vertical modes: PIT, VS, ALT, ALT*, FLC (pitch-on-speed), GS, FLARE and ROLLOUT for aircraft with autoland.
  - Autothrottle: SPD, THR CLB, IDLE, RETARD.
  - Interlocks: no engagement on the ground; disconnect on a firm pilot input, at the stall warning, and at minimum-use height on aircraft without autoland. The AP disconnect warning sounds.
- **Navigation:**
  - GPS direct-to: distance, desired track, cross-track error, ETE.
  - A **synthetic ILS** for every runway end (OurAirports has no ILS data). It is tuned automatically to the departure or approach runway, or from the CDU APPR page. Localizer and glideslope deviations follow standard sensing.
- **Trim solution:** `placeAirborne` solves angle of attack, stabiliser trim and thrust together with the full aerodynamic model, including the thrust-line pitching moment and Mach effects. Approach and teleport starts are therefore genuinely trimmed.

### Visuals
- **Parametric exterior models** generated from each configuration for four families:
  - Airliner (narrowbody and widebody; sharklet, blended, raked and curved winglets).
  - Twin turboprop with T-tail.
  - Four-turboprop high-wing cargo aircraft with sponsons and rear ramp.
  - Fighter with blended body, canopy, ventral intake, tailerons and an afterburner plume.
- Model details:
  - Fuselage lofts with a nose crown line anchored to the pilots' eyes, windshield panels and instanced cabin windows.
  - Multi-station swept wings with Fowler flaps, slats, spoiler panels and ailerons.
  - Fin, rudder and elevators. Turbofan nacelles with translating reverser sleeves, and turboprop props that feather.
  - Bogie gear that retracts.
  - Nav, beacon, strobe and landing lights.
- Every damage component maps to a model part, so detached parts become debris.
- The chase and orbit cameras scale with aircraft size.

### Flight decks
- **Glass transports:**
  - PFD: FMA, speed tape with trend, VLS/VS and max-speed barber poles, altitude tape, VSI, heading tape, flight director, LOC/GS scales, radio altitude, GPWS and stall messages.
  - ND: arc mode with range rings, heading bug, track, nearby airports, direct-to course and synthetic ILS course, wind, GS/TAS, ETE.
  - EICAS / E-WD: N1/EGT or TRQ/ITT dials, N2/NP/NG, fuel flow, FOB, flaps/slats, gear lights, speed brake, hydraulics, cabin, APU, alert list.
  - Standby instrument.
  - Glareshield MCP with SPD/HDG/ALT/VS knobs and AP, A/THR, FD, HDG, NAV, APP, ALT, FLC and VS buttons, plus EFIS baro and ND range. Master warning and caution.
  - Thrust or power levers with reverse; prop and condition levers on turboprops. Speed brake (with arming), flap and gear levers, and the parking brake.
  - **CDU** with INIT, PERF (V1/VR/V2/VREF scaled with weight), PROG (EFOB at destination), DIR (nearest airports) and APPR (runway ILS selection, approach arming).
  - **Overhead** panel: battery and generators, lights, APU, hydraulic pumps, packs, probe heat, fuel pumps, and engine start and fuel per engine.
  - Sidestick or yoke, animated from the controls.
- **Flight deck shell:** an inward lining generated from the fuselage loft, with real windshield apertures and window posts.
- **Fighter:** a conformal HUD on a combiner glass covering about 24° vertically. It shows a pitch ladder, flight-path marker, heading tape, speed and altitude boxes, Mach, g, AoA, AB, protections and gear. Also two MFDs (engine/fuel/alerts, and ND), throttle and side-stick, gear handle, an up-front AP panel, and start switches.

### UI, input, audio
- **Aircraft picker** in the menu, with class, engines, rating, mass, speeds, fuel and flight-deck description.
- **HUD and debug panel per engine type:** N1 or TQ, gear, flaps label, speed brake, Mach, fuel in kg, AP modes and selected values, alerts. The debug panel adds per-engine internals, AP targets, FBW protections, hydraulics and cabin.
- **New keys:**
  - `G` gear, `/` speed brake, `Shift+/` arm spoilers, `R` reverse, `Shift+PgUp/PgDn` prop levers, `Ctrl+Shift+E` automatic turbine start, `Shift+Q` master reset.
  - Autopilot: `Shift+Z` AP, `Shift+R` A/THR, `Shift+H` HDG, `Shift+N` NAV, `Shift+A` APPR, `Shift+L` ALT, `Shift+V` V/S, `Shift+F` FLC.
  - Selectors: `Shift+←/→` heading bug, `Shift+↑/↓` altitude, `Ctrl+↑/↓` speed, `Ctrl+Shift+↑/↓` V/S.
  - Direct-To moved to `Shift+G`.
  - Ctrl+letter shortcuts are avoided because browsers reserve them.
- **Touch:** GEAR, SPD BRK, REV, AP and A/THR buttons appear on aircraft that have those systems. The flap readout shows the lever label.
- **Audio (synthesised):**
  - Turbofan: shaft buzz, turbine whine and jet roar, plus an afterburner rumble.
  - Turboprop: blade-passage tone.
  - Gear motor.
  - Repetitive warning chime, caution chime, AP disconnect tone and overspeed clacker.
  - GPWS and stall speech.
- **Approach starts on transports:** the aircraft starts in landing configuration on the glide path with the runway ILS tuned. Runway starts set the take-off flap setting and arm the spoilers.

## Measured performance (automated scenario tests, default load, ISA, calm)

| Aircraft | Take-off (T/O flaps, full power) | Cruise (trimmed) | Stall vs lift-curve prediction | ILS approach |
|---|---|---|---|---|
| King Air class | ~430 m, lift-off ~104 kt | 280 KTAS at FL250 at ~96 % power | within 15 % (1-g equivalent) | AP to minimums, hand-flown flare |
| A320 class | ~1.0 km, ~150 kt | M0.78 at FL350, ~2,000 kg/h | ±7 % | autoland: 323 fpm, 328 m past threshold, on centreline |
| 737-800 class | ~1.0 km, ~146 kt | M0.79 at FL350 | ±10 % | autoland: 288 fpm |
| 787-9 class | ~1.3 km, ~160 kt | M0.85 at FL350, ~5,400 kg/h | ±5 % | autoland: 214 fpm |
| A350-900 class | ~1.2 km, ~155 kt | M0.85 at FL350, ~6,000 kg/h | ±7 % | autoland: 212 fpm |
| Fighter | ~640 m with AB, ~210 kt | M0.85 at FL300 at ~50 %; max ~M1.6 at FL300, ~M2.0 at FL400 | AoA-limited (no classical stall) | — |
| C-130 class | ~0.94 km, ~131 kt | 292 KTAS at FL200 at ~91 % | within 15 % | AP to minimums, hand-flown flare |

Other automated checks:
- every multi-engine aircraft climbs at more than 300 fpm with one engine failed after take-off;
- the autopilot captures heading and altitude (±150 ft after 200 s, holding within ±100 ft) on every aircraft;
- Airbus-type load-factor and AoA protections hold under full back stick;
- the fighter pulls 7.5–9.4 g and stays below its AoA limit;
- a neutral sidestick holds bank and path;
- GPWS sink-rate, TOO LOW GEAR and callouts work;
- gear and reverse interlocks hold;
- engine start, spool and lapse behave as expected;
- hydraulics, pressurisation and the APU behave as expected.

The browser e2e suite flies an A320-class aircraft at KSFO:
- it selects the aircraft in the menu;
- verifies the glass cockpit;
- checks the gear and AP interlocks by keyboard;
- sets a direct-to on the CDU;
- then from an 8 NM final with AP + APPR + A/THR flies to an autoland and a full stop on 28R.

## Simplified, approximate or not yet done
- **Flight-deck fidelity.** Displays and panels are generic for each family, not replicas of a specific type.
  - The CDU has no flight plan, navigation database, SIDs/STARs or VNAV. NAV mode follows a single direct-to course.
  - There are no VOR/NDB receivers yet; navaids are Phase 4.
  - ILS is synthetic on every runway end.
- **Autopilot.** Autothrottle is SPD / THR CLB / IDLE / RETARD only: no TO/GA, FLEX or thrust-lever detents. No LNAV/VNAV, holding or go-around mode.
  - Autoland was verified on the flat test runway and on KSFO 28R; it has not been tested in crosswinds above about 15 kt.
- **Fly-by-wire.**
  - Normal law only. No degradation to alternate or direct law after failures, apart from the ground and flare blend.
  - The Boeing-type law uses the same pitch core as the Airbus-type law.
  - The fighter cannot be prevented from departing in a zoom climb to below about 80 kt: there is no nose-down authority left at that speed, which matches reality.
- **Engines.** Engine-out handling has no rudder trim control; use the rudder keys. Turboprop beta range and propeller synchronisation are simplified. Engine fire handles and extinguishers are not modelled.
- **Systems.**
  - Hydraulics are a pressure-availability model with no fluid quantity or leaks.
  - Pressurisation has no outflow valve.
  - Fuel is used centre tank first, with no transfer or cross-feed controls.
  - Electrical system: one bus model per aircraft.
- **GPWS** uses radio altitude and closure rate only. There is no terrain database look-ahead (EGPWS).
- **Exterior models** are parametric, with single-colour liveries and no textures. The King Air nacelles and fighter intake are simplified shapes.
- **Performance.** Data are class-typical; tolerances in the tests are deliberately generous (about 10–15 %). Fuel burn and climb figures are plausible but not validated against operator manuals.

## Known bugs and limitations
- **Rendering performance** is still unverified on real GPUs. Under software GL (the CI and build environment) the airliner scenes run at about 5–7 fps, the same as the GA-172 in Phase 2. Measuring on hardware is Phase 6.
- Under software GL, a single dark frame can be captured while new shaders compile right after an aircraft loads. This was not observed as a persistent problem.
- **Flaky-test hardening.** Browser tests had become timing-sensitive at software-GL frame rates. They now wait for the rendered camera to settle and click animated overlay buttons through the DOM. Phase 3 fixed a related bug: starting a new flight while one was active left the previous aircraft in the scene.
- The speech voice for GPWS depends on the browser's speech-synthesis voices and may be silent where none are installed.

## Bugs fixed during Phase 3 (found by the new tests)
- **Yaw damper** tracked `g·tan φ / V` as its ideal yaw rate. At steep bank this forced a skid, which rolled conventional aircraft over into a spiral. It is now a washout yaw damper.
- **Autopilot:** the vertical-speed integrator wound up (±4.6° within 2 s), the autothrottle gains were too hot for turbofan spool lag, and the flight-path loop was under-damped at approach speed (ζ≈0.3). The fix adds path-rate damping, anti-windup and filtered speed trend.
- **Fly-by-wire:** the integrator was seeded from a full-deflection direct-law frame right after an airborne placement, which overshot to 12 g. The fix initialises air data on placement and adds feed-forward and predictive limits.
- **Pressurisation:** the cabin differential was computed against sea-level pressure instead of ambient.
- **Fuselage geometry:** tail-strike angles were 2–3° too small on the widebodies, so the tail stopped rotation. Nose-gear struts were sized from the static share and bottomed out on derotation.
- The engine `setRunning` argument was a throttle value passed where RPM was expected (piston), which stopped the GA engine at airborne starts.
