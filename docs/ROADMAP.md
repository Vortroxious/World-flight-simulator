# Roadmap

## Phase 1 – Research and architecture ✅
Datasets and licensing, architecture and risks: [PHASE_REPORTS/phase-1-plan.md](PHASE_REPORTS/phase-1-plan.md).

## Phase 2 – Playable prototype ✅
GA-172, KSFO hero airport, worldwide airports and runways, streamed terrain, interactive cockpit, crash and damage, tests. See [PHASE_REPORTS/phase-2.md](PHASE_REPORTS/phase-2.md).

## Phase 3 – Aircraft and cockpit systems ✅ (this build)
Eight aircraft (King Air-, A320-, 737-, 787-, A350-, F-16- and C-130-class added), turbofan and turboprop engines, retractable gear, hydraulics, pressurisation, APU, alerts and GPWS, fly-by-wire laws, autopilot/autothrottle with autoland, direct-to and synthetic ILS, parametric exterior models, glass flight decks with MCP/CDU/overhead and a fighter HUD. See [PHASE_REPORTS/phase-3.md](PHASE_REPORTS/phase-3.md).

Carried forward from Phase 3: flight plans and LNAV/VNAV in the CDU, TO/GA and FLEX autothrottle modes, alternate/direct law degradation, fire handles, fuel transfer controls, textured liveries.

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
