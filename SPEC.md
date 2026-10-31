# SPEC — "SUNSET DASH" (working title). Core gameplay + visuals

Genre: one-button speed slider over endless hills (mechanics reference: Tiny Wings).
Format: portrait 9:16, touch/mouse/space, browser, itch.io. Jam theme: **Speed**.
Player fantasy: "a tiny bird builds speed on the hills and outruns the sunset."

---

## 0. Hard constraints
- Portrait, logical resolution 720×1280, playable in a phone browser. Otherwise the game is not rated.
- Judging: Fun / Visual Appeal / Theme Following, equal weight. Speed must read within the first 10 seconds.
- Nothing from Tiny Wings except mechanics: our own name, character and graphics.

## 1. Controls
One action: "hold". `held = active pointers > 0 || space held`.
Pointer events on the root element (touch + mouse), `setPointerCapture`. Reset `held` on
`pointercancel`, `lostpointercapture`, `blur`, `visibilitychange`. UI buttons (pause/sound) do not
count as a press. Block: contextmenu, gesturestart, double-tap zoom, scrolling.

## 2. Architecture
```
src/
  main.ts                 bootstrap, resize, state machine
  config.ts               ALL numbers (sections physics/terrain/islands/night/score/camera/fx/audio)
  core/  loop.ts (fixed 1/240, max 8 steps/frame, alpha for interpolation)
         rng.ts (mulberry32) · input.ts · events.ts (typed bus)
  world/ terrain.ts (key points, h/h'/h'', streaming, isWater) · islands.ts · collectibles.ts
  sim/   bird.ts (reference port) · scoring.ts · night.ts · bot.ts (planner from reference)
  render/ renderer.ts · camera.ts · palette.ts · sky.ts · parallax.ts · terrainMesh.ts · water.ts
          birdView.ts (rig + scarf) · fx/ (particles.ts, trail.ts, speedlines.ts) · shaders/*.glsl
  ui/    hud.ts · screens.ts · popups.ts · styles.css
  audio/ audio.ts
  debug/ debug.ts (lil-gui, physics overlay)
tools/  sim.ts (npm run sim) · shot.ts (npm run shot)
```
Events: `takeoff`, `land{kind:'great'|'ok'|'bad'|'splash',angle,airTime,streak}`, `feverStart`,
`feverEnd`, `skyTouch`, `coin{type}`, `island{index}`, `speedTier{tier}`, `caught`, `points`,
`islandLaunch{k,x,y,targetX,targetY,apexX,apexY,duration,speed}`, `islandLand{k,kind,x,y,speed}`.
States: `Title → Playing ⇄ Paused → Caught (1.2 s) → Results → Playing` (restart ≤ 1 s).

## 3. Physics v4 — `src/sim/bird.ts` (gameplay v4, 2026-10-31)
Same circle-center model as v2 (below). v4 knobs (preset `tw`, the default; all in `PHYSICS_PRESETS`):
- **Ground vs air gravity.** `gRelease`/`gDive` act on the GROUND only (how hard slopes brake / pump);
  `gAirRelease`/`gAirDive` in the AIR (how floaty a flight is / how fast a tap pulls down).
  Keep `gAirRelease ≤ gRelease` (otherwise convex slopes chatter ground↔air; Tune shows a red warning).
- **Parachute.** `fallCap`/`fallCapDive`: soft terminal FALL speed (released / held), pulled back with
  `fallTau`. From high up the bird comes down at an angle that matches the slopes → catchable landings.
- **Soft limits.** `vSoft`/`vSoftK`: extra drag `vSoftK·(v − vSoft)²` (ground + air) — no runaway speed.
  `ceilAlt`/`ceilK`: while RISING above `peakY + ceilAlt`, extra downward accel `ceilK·(height above)`.
- `assistAngle`: landing assist applies to downslope landings up to this angle.
- Scripted island flight: `bird.flyG > 0` = exact parabola with that gravity, input ignored (§4.2).
- tw: gGround 1050/3600, gAir 900/3400, fallCap 950/2000, vSoft 1700 (k 0.004), ceilAlt 950 (k 2.2),
  muGround 0.012, drag 0.00002, diveRamp 0.03, greatAngle 20, okAngle 32, landingAssist 0.5, assist 60°.
- Metrics: `npm run gameplay` (micro-loop per skill bot), `npm run feel` (guards), `npm run sim` (classic pins v2).

### Physics v2 (feel pass, 2026-10-30)
The bird is a **circle of radius R**; the physics state (x, y) is its **center = the sprite center**.
On the ground the center rides the offset curve `C(u) = P(u) + R·n(u)` of the contact point u
(center-path curvature `κc = κ/(1 − Rκ)`); in the air the center flies ballistically (exact step
`x += v·dt + a·dt²/2`); touchdown = the center reaches the offset curve (contact u by Newton).
A takeoff integrates the rest of its step in the air. A graze inside the takeoff step is no event.
Knobs on top of v1: `diveRamp` (s, gravity eases to the held/released value), `airLift` (share of g
cancelled while released AND falling), `takeoffMargin` (stickier crests). Presets: `PHYSICS_PRESETS`
in `src/config.ts` — classic / smooth (default) / rush / floaty. Regression: `npm run sim`; feel: `npm run feel`.
Why v2: v1 chattered ground↔air every step on convex upslopes (9–16 takeoffs/s, bird moving at half
speed until the real launch) and drew the sprite with a blended normal offset (lurch after takeoff,
snap on landing). v2: 0.3–0.8 takeoffs/s, no sprite pops.

The mechanism below (gravity switch, N < 0 takeoff, inelastic landing) is unchanged from v1.

### v1 mechanism (still valid)
The bird is a **contact point** on a height function `y = h(x)`, Y up, units = world px (720 px = screen width at zoom 1).

Mechanism (why it works — do not "simplify"):
- Holding → gravity `gDive` (3000); released → `gRelease` (1000). Slopes convert gravity into speed:
  descending a height H the bird gains `gDive·H`; climbing it loses only `gRelease·H`.
  Net gain per hill ≈ `(gDive − gRelease)·H` — a "pump", like a skater in a half-pipe.
- Takeoff: on the ground the required normal acceleration is `N = g·cosθ + v²·κ`. On the convex part of a
  climb, when `N < 0` the ground falls away faster than gravity can bend the path → flight. Faster = earlier,
  steeper launch. Holding over a crest → high g keeps the bird glued (no launch). Releasing → launch.
  This is "release on the uphill".
- Landing is inelastic: the normal velocity component is removed, the tangential remains. Loss ≈ sin²α
  (α = angle between velocity and slope). Touching down tangentially on a downslope keeps everything.
- Friction `muGround·N` punishes "hold forever". `sMin` — the bird flaps and crawls, never stops.

| parameter | value | meaning |
|---|---|---|
| dt | 1/240 | fixed step |
| gRelease / gDive | 1000 / 3000 | gravity released / held (ground and air) |
| drag | 0.00004 | quadratic drag |
| muGround | 0.03 | friction `a = mu·N` |
| sMin | 150 | minimum ground speed |
| hopMinAir / hopMinAlt | 0.12 s / 10 px | shorter and lower = micro-hop, no events |
| greatAngle / greatSlope | 15° / h' ≤ −0.12 | GREAT: landing on a downslope almost tangentially |
| okAngle | 28° | worse = BAD (or landing on an upslope with α > 15°) |
| greatBoost | ×1.05 | speed bonus on GREAT |
| landingAssist | 0.35 | on a downslope with α ≤ 30°: speed = max(vt, \|v\|·cos(α·0.65)) |
| birdRadius | 22 | sprite center = contact + normal·R (in air, blend to (0,R) over 0.15 s) |

Sprite rotation: target `atan2(vy, vx)` (on ground: tangent), smoothing τ = 0.06 s; diving (held in air) adds −10° nose-down.
Water (§4.2): `muWater = 0.25`, `sMinWater = 120`, landing on water = `splash` (resets streak, no classification).

## 4. World
### 4.0 Hill generator (island mode, v4: key points, decoupled)
Key points alternate PEAK / VALLEY with a shaped segment between them (Tikhonov / haqu tiny-wings
principle). One hill = a valley then the next peak; `CONFIG.hills`, fixed 6 RNG draws per hill (stream alignment).
- Three INDEPENDENT numbers: `width` (peak→peak, the valley sits in the middle of a symmetric bowl),
  `height` (peak→valley), `peakY` (peak level). The slope angle is a consequence (≈ atan(π·height/width));
  nothing auto-widens (v3's "depth changes width" coupling is gone). `slopeLimit` only LOWERS an extreme valley.
- `mode 0` peaks (default): peaks at `peakY ± peakJitter`; each valley `height·(1 ± heightJitter)` below the lower
  neighbouring peak; `deepChance` ×`deepMul` deeper, `wideChance` ×`wideMul` wider; `noRepeat`.
- `mode 1` zigzag (haqu): each key point = previous ∓ (`zzMinDY` + rand·`zzRangeDY`), clamped to [`zzMinY`, `zzMaxY`].
- Height grows `growFrom → growTo` along the island; per-island scale `islands.sx*/sy*`.
- Per-segment sharpness q (`segEval`): q = 1 cosine; q > 1 pointier peaks + flatter valleys (still C1).
- **Island styles** `islands.styles` cycle per island (island k = styles[(k−1) mod n]): rolling (q 1),
  pointy (q 1.35, w 1.05, h 0.95), long (w 1.22, h 1.05), steep (q 1.2, w 0.95, h 1.12); w/h multiply width/height.
  tuning.json merges them by `name`: `"islands": { "styles": [{ "name": "pointy", "sharp": 1.5 }] }`.
- Tuned live in the Tune panel's Hills tab (strips per style, island end + jump parabolas, style editor).
  `?terrain=reference` keeps v1.

### 4.1 Height function
Key points alternate valley/peak; between them cosine interpolation
`y = y0 + A(1 − cos(πt))`, `A = (y1 − y0)/2` (smooth, zero slope at key points). h, h', h'' analytic,
cached segment index. Generation as in reference: half-wavelength dx ∈ [260, 420]·sX, peak height above
valley = dx·[0.35, 0.60]·sY, valleys at y ∈ [−60, 60], |h'| ≤ 1.0 (dx widened to satisfy). Streaming:
keep key points ≥ 3 screen widths ahead, drop those > 2 screens behind.
`?terrain=reference` — plain reference generator without islands (for `npm run sim` acceptance).

### 4.2 Islands (v4)
| island k | hills | sX (width) | sY (height) | style | palette | bands |
|---|---|---|---|---|---|---|
| 1 | 24 | 1.00 | 1.00 | rolling | PALETTES[seed % 6] | strata |
| k | min(24+6(k−1), 60) | min(1+0.05(k−1), 1.4) | min(1+0.06(k−1), 1.45) | styles[(k−1) % 4] | next | alternate |

- Start: nest on a peak at x=0, y=200, bird asleep. The day starts on the first touch.
- Island 1: first 3 hills are gentle (height ×`onboardH`, no deep/wide valleys) for onboarding.
- **Island end = a mountain (v5)**: climb (, ) → one long smooth descent of
  × px (drop , sharper below the summit ) — measured
  4.2–6.4 s for every bot in  (column ) → launch valley → ramp (, ) →
  lip → cliff → sea ( under the lip) → landing hill. Snow cap () and rock tone in the hill shader.
  Bumps (, , ) are VISUAL only: a mesh mound + sprite squash kick + dust + camera nudge + thump.
- **Safe sequence**: from  px before the summit to the landing target a landing is never worse than GOOD
  () and the night stands still ().  in npm run gameplay = 0.
- **Scripted island jump**: from the upper ramp or the lip an exact parabola () to the target on the
  landing slope (); the launch angle is chosen so the arrival is TANGENT to the slope there (≥ ),
  speed clamped to [, ] only changes the time: 3.8–4.9 s measured. Input ignored; GREAT landing.
  Events  / ; sky coins along the parabola.
- **Camera**: no wide shot. By position: zoom IN × on the descent (speed zoom only, view centred on the bird),
  bird focus at  from the ramp through the flight, back to the normal rig over  after the target.
- Passing the landing-hill peak fires `island{k+1}` (the banner already showed at the apex).

### 4.3 Island-end cinematic (render / audio / UI)
Descent: speed streaks grow (), bump kicks. Launch: burst + dust off the lip, back-flip on fast launches.
Flight: slow-mo 0.8 at the apex, wind streaks, long ribbon, apex clouds, sun glare, palette crossfade, ISLAND banner at the
apex, whoosh/sting. Landing: sparkles, PERFECT LANDING + 300·k, hit-stop, chord.

### 4.4 Collectibles
- Gold coins: on 35% of hills an arc of 5–8 coins along the downslope, +45 px along the normal;
  in the launch valley and over the island ramp an arc of 12–16 coins.
- Blue speed coin: 15% of valleys (not on the first 4 hills), +30 px above the bottom.
  Effect: speed ×1.12 (at least +120), flash + whoosh.
- Pickup: distance from sprite center ≤ 34 px.

### 4.5 Cloud ceiling
World height `cloudY = 1100`. Bird center above it → `skyTouch` (once per flight). A row of clouds is drawn
at that height in the world — the player sees the target when the camera zooms out.

## 5. Game systems
- **Landing judge (v4)**: only REAL flights are judged — air time ≥ `judgeMinAir` (0.25 s) OR height ≥
  `judgeMinAlt` (40 px); shorter/lower = a silent skim (physics as usual, streak untouched, no popup).
  Angle α = between the velocity and the slope at touchdown; downhill = h' ≤ `greatSlope`.
  | kind | rule | streak / Fever | feedback |
  |---|---|---|---|
  | GREAT | downhill, α ≤ `greatAngle` (20°) | +1, boost ×`greatBoost` | "GREAT xN", bell, sparkles |
  | GOOD (`ok`) | downhill α ≤ `okAngle` (32°), or uphill α ≤ greatAngle | kept | small "NICE", dots glint |
  | BAD | anything else | 0, Fever ends | no text: thud, dots flash red + shake |
  | SPLASH | water | 0, Fever ends | "SPLASH!" |
  v3 judged 12.5° hard and broke the combo on every "almost" landing and on skims ("random" feeling).
- **Streak/Fever**: streak ≥ 3 → Fever (×2 to all points, fire-rainbow trail, separate audio layer; does not
  change physics). 3 HUD dots show the progress toward Fever.
- **Night**: `xNight(t) = −2500 + 300t + 4t²` (t from the first touch). `gap = bird.x − xNight`,
  `daylight = clamp(gap/2500, 0, 1)` → time of day (§7.1). gap ≤ 0 → `caught` → bird falls asleep → Results.
  New island: xNight −= 1200 (pushes night back; our design choice, not a confirmed Tiny Wings rule).
- **Score** (×2 in Fever): distance 1 pt/10 px · flight ≥ 1 s: 50·airTime · GREAT 100+20·(streak−1) (≤200) ·
  skyTouch 300 · coin 20 · blue coin 50 · island 500·k · island landing 300·k. Best score in localStorage (try/catch).
- **Speed tiers** (px/s → label): <700 —, ≥700 CRUISE, ≥1300 FAST, ≥1900 BLAZING, ≥2500 SONIC.
  The tier drives speed lines, trail, wind volume, speedometer color. First entry into SONIC per flight →
  "sonic boom": shockwave ring + 14 px shake + sound (3 s cooldown).
  Speedometer: km/h = px/s × 0.12 (3000 px/s = 360 km/h).

## 6. Camera (portrait — the main difference from the original)
v2: zoom (log space), Y and the ground reference are critically damped springs (`wZoomOut/wZoomIn/wY/wRef`);
X tracks the anchored target with velocity feed-forward (`wX`, 0 = locked). Rates below are v1 history.
View width at zoom 1 = 720 world px; height = 720 × (screen H/W). Portrait's problem is little forward
visibility, so the camera adapts:
- Bird X anchor: 27% of width at v ≤ 600 → 20% at v ≥ 2000.
- `zSpeed = clamp((1 − anchorX)·720 / max(520, vx·0.7), 0.36, 1)` — always ~0.7 s of path visible ahead.
- Reference ground `yRef` = min of h over [x−100, x+0.6·width] (40 px step); placed at 30% of height from bottom.
  The bottom ~25% of the screen is the "thumb zone" — only ground mass there.
- `zAlt = 0.62·H_log / max(1, birdY − yRef + 160)`; final `z = min(zSpeed, zAlt)`.
- Zoom smoothing: out at rate 6/s, in at 2.2/s. Camera Y rate 5/s. X has no lag (interpolated).
- Bird visual scale `clamp(1/√z, 1, 1.55)` for readability when zoomed out.
- Shake: bad 10 px, sonic 14 px, decay 0.25 s.
- Screen wider than 9:16 (desktop): logical height 1280, width up to 960, beyond that sky-colored side bars.
  Phone in landscape → "rotate your phone" overlay.

## 7. Visuals — "modern mobile arcade"
Direction: clean vector shapes + soft light. Flat colors with subtle gradients, a bright rim on crests,
atmospheric perspective, glossy accents, juicy particles. The character has a dark outline (pops on any
background); the environment has no outlines. All graphics procedural (shaders + Canvas2D textures
generated at load): infinite world, crisp at any DPR, editable in minutes.

### 7.1 Time of day (sky keyframes, top → horizon; daylight 1 → 0)
| daylight | top | horizon | sun/moon |
|---|---|---|---|
| 1.0 day | #49B8F5 | #BDEBFF | #FFF4C9 high |
| 0.6 golden hour | #6FA8E8 | #FFD39A | #FFE7A8 lower |
| 0.3 dusk | #3B3F8F | #FF8A73 | #FF6F4E near horizon |
| 0.0 night | #0E1233 | #2B2C66 | moon #F4F1D0 + stars |
Fog color of all background layers = current horizon (automatic harmony). Hills get time-of-day grading
(multiply by warm/violet/blue tint, −35% brightness at night).
Night front: if xNight is in frame — a dark gradient from the left edge, 600 world px wide.

### 7.2 Island palettes (bands top to bottom; rim)
1. Meadow Pop: #9BE15D #4CC06B #2A9D8F #F6C85F #F28F5C; rim #E9FFB0
2. Candy Coast: #FF8FB1 #FFC46B #FF6B6B #B388EB #6BCBFF; rim #FFF1D6
3. Lagoon: #3DDCC5 #1FA6B8 #F7E07B #F49D6E #2D6A9F; rim #D8FFF6
4. Ember Mesa: #FFB547 #FF7A45 #E84A5F #8E3B76 #FFD27A; rim #FFF0C2
5. Mint Berry: #B8F2A0 #6DD3A8 #A06CD5 #F7A1C4 #4E9F6E; rim #F3FFE4
6. Glacier: #BDE8FF #7FB8F0 #E0F7F4 #8C9EF0 #5A6FD6; rim #FFFFFF
Palettes may be adjusted from screenshots, but keep 4–5 colors with one dark band for contrast.

### 7.3 Hill shader (one strip mesh, 1024 px chunks, vertex every 8 px)
Attributes: worldX, depth d (0 at surface, grows downward). Fragment:
- rim d < 4 px: rim color (AA via smoothstep over pixel width `pxPerWorld`);
- inner shadow below rim: ×(0.85 + 0.15·smoothstep(4, 16, d));
- bands: `u = d + 18·sin(x·0.004+s) + 10·sin(x·0.011+2s)` (strata, follow the terrain) or
  `u = d·0.7 + x·0.35` (diagonal); band width 70–110 px per island; color = palette[floor(u/w) mod 5];
  inside a band ×(1.06 − 0.12·fract(u/w)); soft band edges (1.5 px);
- depth shading ×mix(1, 0.72, smoothstep(0, 900, d)); grain ±2.5%; time-of-day grading;
- onboarding (§9): rim tinted green on downslopes / amber on upslopes with `teacherAlpha`.

### 7.4 Background
Sky — fullscreen shader (gradient, sun disk + soft halo, hashed stars at night).
3 parallax layers (silhouettes from summed sines, flat color + vertical gradient into fog):
far mountains 0.1, mid hills 0.25, near hills 0.5 on X (half that on Y). Layer scale `1 − (1−z)·k`
so the background doesn't shrink when zooming out. Clouds — soft blobs (radial gradients generated in
Canvas2D), 2 drifting layers + the cloud ceiling §4.4. Water: gradient, foam line, moving highlights.

### 7.5 Character (original)
A chubby round chick: cream-white body with lavender shading, tiny wings, yellow beak,
**amber flight goggles** and a **long red scarf** (verlet chain, 8 nodes × 12 px; wind = −velocity
direction × speed — the scarf itself "draws" speed). Outline #241B3A 4 px, cel shading + highlight.
Parts (body, belly, wing ×2, eyes+goggles, beak) drawn with Canvas2D paths into 2× textures at load →
cut-out rig on planes. Procedural spring animation:
| state | look |
|---|---|
| asleep (title, end) | eyes closed, Zzz, breathing |
| flying, released | wings open, 2 Hz small-amplitude flap |
| dive (held) | wings tucked, body stretched 1.12×0.9 along velocity, squint |
| crawling (v≈sMin) | rapid 8 Hz flapping, sweat drop |
| landing | squash 0.75 for 0.12 s; GREAT — sparkles; BAD — feathers + stars |
| Fever | aura + fire-rainbow trail, sparkling eyes |
| skyTouch | happy face, cloud burst |
The rig must allow replacing procedural parts with PNGs without code changes (`birdParts` in config).

### 7.6 FX (pool ≤ 300 particles, InstancedMesh)
Landing dust (rim color), GREAT sparkles, BAD feathers, skyTouch cloud puffs, coin glints,
speed lines (screen-space, from FAST, density grows with tier), ribbon trail (24 points, tapered;
BLAZING+ white, Fever fire-rainbow), sonic boom ring, light vignette.

### 7.7 UI (HTML overlay, safe-area aware)
- Top-left: day dial (sun→moon, 88 px). Top-center: score (Lilita One, white with dark outline).
  Under the score: km/h speedometer + tier label + 3 streak dots (Fever progress). Top-right: pause, sound.
- Popups near the bird: "GREAT!", "+100", "FEVER!", "SKY TOUCH!", "SONIC!" — bounce 0.25 s, rise 40 px,
  fade 0.7 s, max 4 at once. Banner "ISLAND k".
- Title: game name, sleeping bird in its nest over the live world, 2-panel hint "Downhill: HOLD /
  Uphill: LET GO", "Tap to start", best score.
- Results: "Night fell" — breakdown (distance, GREATs, Fever time, sky touches, coins, islands, max km/h),
  NEW BEST, Retry button (0.6 s input lock against accidental taps).
- Bottom 25% of the screen: no UI.

## 8. Audio (WebAudio, unlocked on first pointerdown)
Wind: looped filtered noise, volume and cutoff rise with speed (louder while diving).
Landing: dull thud (BAD — lower + "boing"). GREAT: bell, +1 pentatonic step per streak step.
Fever: arpeggio + shimmering loop. Coins: short blip with rising pitch within a chain.
skyTouch: airy bell. Island: 3-note fanfare. Night: descending soft tones.
Music: optional `public/music.mp3` (loop), lowpass opens with speed tier. Mute button.

## 9. Onboarding (Touch Teacher)
Until the player lands 3 GREATs (flag in localStorage): downslope rims green with "HOLD", upslope rims
amber with "LET GO", a pulsing ghost finger before entering a downslope; under the label the whole loop in one
line: "release on the uphill — fly — tap to land on a downhill". Fades out after 3 GREATs or at the end of island 1.

## 10. Tools
- `?debug=1`: lil-gui over the whole config (live edits + "Copy config JSON"), FPS, physics overlay
- `?tune=1` (dev and prod): curated Tune drawer at the top — presets, A/B, grouped sliders with Russian hints,
  readout (speed, slope under the bird, last landing kind/angle/slope), Restart/New seed/Copy JSON/Save.
  Physics tab: predicted flight paths while airborne ("keep releasing" / "hold now", coloured by landing kind).
  Hills tab: strips per island style, island end + jump parabolas, readouts, island-style editor.
  `tuning.json` = shipped values (dev Save → vite `/__tuning` → file → HMR in all tabs). Help: TUNE-HELP.txt.
  (key points, normal, landing angle, speed, state, N).
- `?bot=1` — planner autopilot from the reference. `?seed=N`. `?terrain=reference`.
- `npm run sim` / `npm run shot` / `npm run feel` / `npm run gameplay` — see CLAUDE.md.

## 11. Mobile compatibility and performance
- `<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">`;
  html/body 100% `dvh`, `overflow:hidden`, `overscroll-behavior:none`, `touch-action:none`,
  `user-select:none`, `-webkit-touch-callout:none`, `-webkit-tap-highlight-color:transparent`.
- Size from `visualViewport`/ResizeObserver; DPR = min(devicePixelRatio, 2); WebGL `antialias:false`
  (AA in shaders). Pause rendering when the tab is hidden.
- Target: 60 fps on a mid-range Android, ≤ 30 draw calls, no per-frame allocations, assets < 5 MB.
- No external requests at runtime (itch iframe, offline-safe).

## 12. Milestones and acceptance
| M | Scope | Done when |
|---|---|---|
| M1 | Skeleton, input, loop, physics port, generation, debug line rendering, bot, `npm run sim` | sim table within tolerances below |
| M2 | Camera, islands/water, collectibles, streak/Fever, night, score, rough HUD/screens, restart | full loop playable on a phone |
| M3 | Sky, hill shader, parallax, water, character + scarf, FX, UI polish | screenshots look release-ready |
| M4 | Audio, onboarding, speed tiers, sonic boom, juice | speed feels strong with and without sound |
| M5 | Perf, mobile edge cases, `npm run zip` | 60 fps, no stuck input |

Physics acceptance (`npm run sim`, `?terrain=reference`, 240 s, seeds 7/11/23; reference results):
| bot | night catches at | v p50 | GREAT/landings |
|---|---|---|---|
| none | 22–26 s | ~290 | — |
| always | 34–41 s | ~320 | — |
| naive | 53–63 s | ~610 | <10% |
| planner+100ms | 84–94 s | ~850 | <10% |
| planner+50ms | 193–228 s | 1280–1440 | ~25% |
| planner | >240 s | 2200–2420 | ≥90% |

Manual feel acceptance: holding on a downslope visibly accelerates; releasing near the crest launches;
holding through a crest "glues"; tapping in the air makes the bird drop noticeably faster; no ground
jitter or micro-hops; 3 GREATs in a row achievable on island 1 within the first 30 s of deliberate play.

## 13. Do not
Meta-progression (TW nests/objectives), shops, ad placeholders, physics engines, external CDNs,
React, EffectComposer, physics changes outside config, any Tiny Wings assets/names.
