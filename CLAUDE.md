# World Flight Simulator — working rules

## Shared preview (Claude Artifact) — keep it in sync after EVERY change
The owner plays and shares the build at **https://claude.ai/artifact/RaMNjP2ByxPgw9KgJipyGC**. After any change that affects the app (code, data, styles), finish the change with:

1. `npm test` (and `npm run test:e2e` when UI, input, cockpit or rendering changed). Fix failures first; never publish a red build.
2. `npm run build:artifact`. This builds, encodes terrain packs for the artifact host, writes `dist/artifact.html`, and smoke-tests the bundle in headless Chromium (menu, terrain packs, flight start). It then prints the changed-file map, also saved as `.artifact/files-N.json`.
3. Publish with the Artifact tool:
   - `file_path`: `dist/artifact.html`
   - `url`: the link above
   - `files`: the printed map. Use one publish per batch; `null` entries remove stale bundles.
   - Omit `icon`.
4. `node scripts/build-artifact.mjs --no-build --commit-manifest` to record what is now live (`scripts/artifact-manifest.json`).
5. Commit, including the manifest. Tell the user the preview was updated.

Notes:
- `vite build` wipes `dist/`, so always regenerate through `npm run build:artifact`. Never hand-edit `dist/`.
- The artifact host blocks external fetches. Terrain there comes from the bundled packs (detailed around KSFO, coarse elsewhere), loaded from `*.bin.json` via `loadBinary()` in `src/world/terrain/terrain-manager.js`.
- The artifact is private. Only the owner can share it, from the page's Share menu.

## Project
- Tests: `npm test` (Vitest, Node) · `npm run test:e2e` (Playwright, starts its own Vite server).
- Architecture and status: `docs/ARCHITECTURE.md`, `docs/PHASE_REPORTS/`, `docs/ROADMAP.md`.
- Commit attribution lines are supplied by the session environment.
