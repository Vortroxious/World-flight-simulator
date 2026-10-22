# Technical risks and mitigations

| Risk | Impact | Mitigation (status) |
|---|---|---|
| No free global aerial imagery | Ground cannot look photoreal like MSFS | Procedural colouring by elevation, slope, latitude and urban density, plus a noise detail shader (done). `ImageryProvider` adapter for user-supplied keyed sources (Phase 4). |
| OSM coverage and Overpass rate limits | Detailed airports and cities only where baked | Build-time bake of hero areas with mirror fallback (done for KSFO). Procedural layouts elsewhere (done). |
| Float precision at planetary scale | Jitter, z-fighting | float64 sim, floating origin, logarithmic depth, curvature-corrected local meshes (done). |
| Flight-model fidelity from public data | Handling is plausible, not certified | Per-aircraft validation targets enforced in automated tests (done for GA-172). |
| Browser GPU and memory limits | Stutter or crashes with large view distances | Quality presets, LRU tile budget, worker meshing, dynamic resolution (done). **Not yet measured on real GPUs**: this environment has only software GL. |
| Runtime network dependency for terrain | Coarse terrain offline | Bundled packs (KSFO z12, global z4) and procedural relief on coarse tiles (done). Persistent Cache API storage (Phase 4). |
| Headless testing uses software rendering | Browser tests can't measure performance | Physics and logic tested in Node. Browser tests are functional, using a synchronous `__sim.advance()` hook. Performance testing is in Phase 6 on real hardware. |
| Contact stiffness vs. timestep | Instability in violent crashes | 240 Hz fixed step, angular-rate clamp, friction smoothing. Debris is visual only (Rapier rigid bodies planned for Phase 5). |
| Scope (MSFS-level ambition) | Unbounded effort | Strict phases, each with a working build and an honest report. |
