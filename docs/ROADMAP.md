# Roadmap

## Phase 1 – Research and architecture ✅
Datasets and licensing, architecture and risks: [PHASE_REPORTS/phase-1-plan.md](PHASE_REPORTS/phase-1-plan.md).

## Phase 2 – Playable prototype ✅ (this build)
GA-172, KSFO hero airport, worldwide airports and runways, streamed terrain, interactive cockpit, crash and damage, tests. See [PHASE_REPORTS/phase-2.md](PHASE_REPORTS/phase-2.md).

## Phase 3 – Aircraft and cockpit systems
- Engine modules: turboprop (shaft power, beta and reverse) and turbofan (N1/N2 spool, thrust lapse, reversers, afterburner).
- Aircraft configs and parametric models:
  - King Air-class turboprop
  - A320-class and 737-class narrowbodies
  - 787-class and A350-class widebodies
  - A fighter
  - A cargo aircraft
- Glass cockpits: PFD, ND, EICAS and FMC/CDU. Fighter HUD. Overhead panels.
- Retractable gear with hydraulics, pressurisation, master caution and warning, GPWS callouts.
- **Autopilot**, built as cascaded controllers on the control surfaces: HDG, ALT, VS, SPD/autothrottle, NAV, APP, with mode annunciation.

## Phase 4 – Geographic expansion
- World map with Natural Earth coastlines.
- Persistent tile cache (Cache API) and more hero airports and cities (for example EGLL, KJFK, WIII, LOWI, RJTT).
- Navaids, VOR/DME, synthetic ILS. FMS flight plans with documented JSON import and export.
- Optional `ImageryProvider`. Basic AI ground and air traffic.

## Phase 5 – Weather, damage and graphics
- Cloud layers: impostors, then raymarched volumetrics. Rain and snow particles, thunderstorm cells, icing, METAR parsing and an optional live fetch.
- Rapier debris rigid bodies, fuel-fire spread, improved ditching.
- Water reflections and post-processing (Ultra preset).
- Game modes and scenarios: training, landing, crosswind and weather challenges, emergencies, systems practice, with scoring.

## Phase 6 – Testing and optimisation
- Per-aircraft flight-test matrix.
- Real-GPU performance and memory soak tests.
- Bug fixing and final documentation.
