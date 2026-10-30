Read CLAUDE.md and SPEC.md first. This is a FEEL PASS on physics, terrain and camera — no visual work (M3) until it is done. Time budget: ~90 minutes.

## Context (already diagnosed and measured headless on this repo — do not re-derive)
The bird felt jerky/abrupt vs Tiny Wings. Root causes found in v1:
1. Integration bug: the takeoff step did not move the bird and the air step was semi-implicit Euler (fell g·dt² instead of g·dt²/2). On every convex upslope the bird chattered ground↔air EVERY step (9–16 takeoffs/s) and moved at HALF speed until the real launch → the jerk "after the ramp".
2. The sprite was drawn at contact + normal·R with a blended normal in the air → lurch forward after each takeoff, snap back on each landing.
3. Camera used first-order easing toward targets that jump → velocity kinks at every landing; zoom "breathed" fast.
4. Terrain randomized every half-wave independently (asymmetric slopes, curvature jumps at peaks) → unpredictable launches.

`feel-v2.patch` (in the project root) fixes all four. It is validated: `npm run sim` PASS (rebaselined, preset classic), `npm run feel` guards PASS, build OK, `npm run shot` OK. Results v1 → v2: takeoffs/s 5.5–15 → 0.3–0.8; sprite pops per run 37–121 → 0; camera jerk p99 4.6–9.7 → 0.7–1.0 px/frame²; zoom-rate p99 1.2–1.7 → 0.55–0.78.
What it contains: circle-center physics (state x,y = sprite center, ground = offset curve, exact air step, takeoff continues in the air), knobs `diveRamp`/`airLift`/`takeoffMargin`, physics presets `classic | smooth (default) | rush | floaty` in `src/config.ts` (`PHYSICS_PRESETS`, `applyPreset`), typed symmetric hill rhythm (`CONFIG.hills`: normal/deep/wide), spring camera (`camera.wZoomOut/wZoomIn/wY/wRef/wX`), `npm run feel`, docs updated.

## Task 1 — apply and verify
1. `git am feel-v2.patch` (it was made against commit 92e4cc1). If main has moved on and it conflicts, resolve keeping ALL patch logic in `src/sim/bird.ts`, `src/render/camera.ts`, `src/world/islands.ts`, `tools/feel.ts`, `tools/sim.ts` exactly as in the patch.
2. `npm run build`, `npm run sim`, `npm run feel` — all must PASS. Show me the `npm run feel` table.
3. Code that still assumes `bird.x/y` is the CONTACT point is now wrong (it is the circle center; contact x is `bird.u` while grounded). grep the whole repo (including anything added after 92e4cc1: FX, particles, audio, shots) and fix every such place.
4. Takeoff events are now rare and meaningful (≤ 1 per real flight). Make sure no FX/sound is bound to `EV_HOP`.

## Task 2 — tuning workflow (the main deliverable)
I tune by feel on my phone and PC. Build this:
1. `tuning.json` in the project root = my chosen values: `{ "preset": "smooth", "physics": {}, "hills": {}, "camera": {} }` (the three objects are overrides on top of the preset/CONFIG defaults; empty by default). Loaded at boot and merged into CONFIG (`applyPreset(preset)` first, then overrides). Bundled into the production build, so whatever is in this file is what ships.
2. Live reload: in dev, editing and saving `tuning.json` applies instantly in every open tab, including my phone over LAN (`import.meta.hot.accept`), without a page reload. Physics/camera changes apply on the next step; `hills` changes restart the run with the same seed (the world must be regenerated).
3. In-game Tune panel with `?tune=1` (works in dev AND in the production build; hidden otherwise). Must be usable on a phone: collapsible drawer at the TOP of the screen (the bottom 25% is the thumb zone), all elements `[data-ui]` so they never count as a press, large touch targets. Contents:
   - preset chips: classic / smooth / rush / floaty (one tap = apply + restart same seed);
   - "A/B" toggle: remembers two presets and swaps between them with one tap (same seed);
   - sliders (with live numeric value) — physics: gRelease 600–1600, gDive 1800–5000, diveRamp 0–0.15, airLift 0–0.4, muGround 0–0.06, drag 0–0.00008, greatAngle 8–25, greatBoost 1–1.2, landingAssist 0–0.8, takeoffMargin 0–0.3; hills: w and h of each type, weights, jitter, growFrom, growTo, islands.sxStep/sxMax/syStep/syMax; camera: wX, wY, wZoomOut, wZoomIn, lookAhead, zMin;
   - readout: speed px/s and km/h, last landing kind + angle, streak, island, zoom;
   - buttons: Restart (same seed), New seed, Copy JSON (the current diff vs the preset, in `tuning.json` format), Save.
   - Save: in dev, POST to a Vite dev-server middleware (`configureServer` in `vite.config.ts`, route `/__tuning`) that writes `tuning.json` (pretty-printed). In the production build Save falls back to Copy JSON.
4. Desktop keys while `?tune=1`: 1–4 presets, R restart same seed, T toggle panel.
5. Keep the existing `?debug=1` lil-gui as is (it is the full config dump); the Tune panel is the curated one.

## Task 3 — check and report
1. `npm run feel` for the final defaults (all guards PASS) and `npm run shot`; look at the screenshots, especially at high speed: the camera zooms out with speed, so on late islands the hills can look like small ripples. If they do, propose (do not apply) per-island hill scale values (`islands.sxStep/sxMax/syStep/syMax`) that keep hills readable on screen, with a feel table for them.
2. Commit. Report in Russian: what you changed, the feel table, and exactly how I use the tuning workflow on PC and phone (URLs, how to open the panel, how saving works).

Rules: no visual/art work in this pass; do not change the physics model in `src/sim/bird.ts` (only numbers via config/tuning); keep `src/sim` and `src/world` free of three.js and the DOM; no allocations in the sim step.
