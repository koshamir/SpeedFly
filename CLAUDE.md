# CLAUDE.md — project rules (Slapjam #2, theme: Speed)

You are the lead developer. You are building a mobile portrait browser game in the spirit of Tiny Wings
(sliding over hills, speed is earned through timing). Full spec: `SPEC.md`; reference physics:
`reference/physics-sim.mjs`. If code and SPEC disagree, SPEC wins.
The user writes in Russian — reply in Russian, short and to the point.

## Deadline
The jam ends 2026-10-31 15:00 UTC. Priority is always: playable on a phone > beautiful > features.
Never leave main unplayable for longer than one milestone.

## Stack (do not change without being asked)
- Vite + TypeScript strict + three.js (OrthographicCamera, ShaderMaterial, BufferGeometry, InstancedMesh)
- UI: HTML/CSS overlay above the canvas. Audio: WebAudio (synthesized SFX). No React/frameworks.
- No physics engines (Box2D/Matter/Planck). Physics = 1:1 port of `reference/physics-sim.mjs`.
- No EffectComposer/UnrealBloom post-processing (too expensive on mobile). Glow = additive sprites.
- Fonts: `@fontsource/lilita-one`, `@fontsource/fredoka` (bundled, no CDN at runtime).
- Dev dependencies: `lil-gui`, `playwright`, `tsx` (to run `tools/*.ts` in node).

## Commands (create them in M1)
- `npm run dev` — vite with `--host` (test from a phone over LAN)
- `npm run build` — typecheck + production build to `dist/` (vite `base: './'`)
- `npm run sim` — headless bot simulation (node, no three/DOM), prints the acceptance table
- `npm run shot` — playwright: 720×1280 @2x, `?bot=1&seed=3`, screenshots into `shots/`
- `npm run zip` — `release/game.zip` with `index.html` at the archive root

## Architecture rules
- `src/sim/` and `src/world/` must not import three.js or the DOM. Deterministic: seeded RNG (mulberry32).
- Every numeric constant lives only in `src/config.ts` (one object, live-editable via lil-gui with `?debug=1`).
- Fixed timestep 1/240 s (max 8 steps per frame); rendering interpolates between states.
- Systems communicate through a typed event bus (`core/events.ts`). Render/audio/UI only subscribe.
- No allocations in hot loops (sim step, particles, mesh updates).
- No third-party IP: no Tiny Wings names, character or assets.

## Workflow for every milestone
1. Short plan (3–7 bullets) → implement.
2. `npm run build` with no errors → `npm run sim` (check against the acceptance table in SPEC §12) →
   `npm run shot` and ALWAYS look at the screenshots (Read the png files) and honestly assess the visuals.
3. `git commit` with a clear message.
4. Report to the user: what was done, what to check by hand on a phone, known issues.

## Do not "fix" the physics
If the feel is off, change only values in `config.ts` (and report which ones). Do not add forward-pushing
forces, speed clamps (other than `sMin`), or elastic bounces in the physics.
A port deviating > 15% from the reference table is a porting bug, not a reason to retune.
