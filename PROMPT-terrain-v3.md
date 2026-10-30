Read CLAUDE.md first. This pass replaces the terrain generator and rebuilds the Hills tab of the Tune panel. No art work. Time budget: ~60 minutes.

## Context
The "hill types" rhythm (normal/deep/wide whole waves) was a wrong model of Tiny Wings. Tiny Wings terrain = KEY POINTS alternating peak/valley with cosine interpolation between them (the principle of Sergey Tikhonov's demo and github.com/haqu/tiny-wings: `dx = minDX + rand*rangeDX`, `dy = minDY + rand*rangeDY`, sign flips every point, clamped, `y = ymid + ampl*cos(...)` per segment). Observed in Tiny Wings: peaks sit at roughly one level and are evenly spaced; what varies is the DEPTH of each valley and sometimes a slightly WIDER valley.

`terrain-v3.patch` (project root, made against commit 3f565df) implements this — validated: build OK, `npm run sim` PASS, `npm run feel` guards PASS in both modes.
- `CONFIG.hills` is now: `mode` (0 = peaks: level peaks + varied valleys, default; 1 = zigzag: haqu random walk), `halfW`, `halfWJitter`, `symmetric`, `peakY`, `peakJitter`, `depth`, `depthJitter`, `deepChance`, `deepMul`, `wideChance`, `wideMul`, `noRepeat`, `growFrom`, `growTo`, `maxSlope`, `zzMinDY`, `zzRangeDY`, `zzMinY`, `zzMaxY`. `hills.types` is gone.
- `IslandGen.addHill` draws a FIXED number of random values per hill (stream alignment); keep it that way.
- The Tune slider list was updated minimally so it compiles.

## Task 1 — apply and clean up
1. `git am terrain-v3.patch`. If it conflicts, keep the patch's `addHill` and `CONFIG.hills` exactly.
2. Remove every leftover of hill types: `tuning.ts` (the `types` special cases in merge/diff), `TUNE-HELP.txt`, `tuning.json` (drop any `hills.types`), SPEC §4.0 (rewrite it for the key-point generator, 5–8 lines), feel.ts comments. Old `tuning.json` files with `hills.types` must load with a warning, not crash.
3. `npm run build`, `npm run sim`, `npm run feel -- tuning` and `FEEL_SET="hills.mode=1" npm run feel -- tuning` — all PASS; show me both tables.

## Task 2 — Hills tab of the Tune panel (main deliverable)
Goal: I shape the terrain by hand on phone and PC and SEE the result instantly.
1. **Live profile preview** at the top of the Hills tab: a canvas (full panel width, ~110 px tall) drawing the terrain the current values generate for the current seed — the next ~14 hills from the start of island 1, plus a second small strip for island 4 (to see growth). Same aspect ratio as the world (no vertical exaggeration), peak level as a dashed line, key points as dots, the bird radius as a tiny circle for scale. Regenerate from a throwaway `World(seed, 'islands')` on every slider `input` event (throttle to one frame) — no game restart while dragging. Must stay < 4 ms per update on a phone (sample every 8 px, only the needed range).
2. **Apply**: the running game restarts with the same seed on slider release (as now), plus a "Preview only" toggle that suppresses restarts while I experiment.
3. **Mode chips**: `Peaks` / `Zigzag` instead of the 0/1 slider; `symmetric` and `noRepeat` as on/off switches, not sliders. Zigzag-only sliders (`zz*`) are shown only in Zigzag mode; `peakY/peakJitter/depth*/deep*/wide*` only in Peaks mode.
4. Group the Hills tab into short labelled blocks with one-line hints in Russian:
   - Ритм: halfW, halfWJitter, symmetric
   - Вершины: peakY, peakJitter
   - Впадины: depth, depthJitter, deepChance, deepMul, wideChance, wideMul, noRepeat
   - Рост: growFrom, growTo, islands.sxStep/sxMax/syStep/syMax, maxSlope
   - Zigzag: zzMinDY, zzRangeDY, zzMinY, zzMaxY
5. Readout under the preview: hills per island, average whole-hill width, valley depth min/avg/max, steepest slope in degrees, for the previewed island.
6. "Reset Hills" button (defaults for `hills` + `islands` only). Save / Copy JSON keep working and write only the diff.
7. Update TUNE-HELP.txt (RU): what each hill parameter does to the feel (deeper valleys = more speed per hill but harder landings; wider = softer slopes, longer flights; peak jitter = less predictable launches, etc.).

## Task 3 — verify and report
`npm run shot` and look at the screenshots, plus one screenshot of the open Hills tab with the preview (add a shot `?tune=1` with the panel open on the Hills tab). Commit. Report in Russian: what changed, the two feel tables, and how to use the Hills tab.

Rules: do not change `src/sim/bird.ts` or the camera; keep `src/world` free of three.js/DOM; no allocations in the sim step (the preview may allocate, it is UI).
