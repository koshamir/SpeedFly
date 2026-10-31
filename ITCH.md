# Sunset Dash — itch.io page

## Description (EN)
A tiny goggled bird races the sunset across endless rainbow hills: hold to dive down the slopes,
let go to launch off the crests, and chain perfect landings into blazing **speed**.
Every island pushes the night back, so the faster you go, the longer your day lasts — from CRUISE
through FAST and BLAZING all the way to a SONIC boom.
A one-button jam game about the theme **Speed**, made for phones (portrait) and the browser.

## Controls
- **Hold** (touch / mouse button / Space) — dive: heavier on downslopes, faster in the air.
- **Let go** — glide and launch off the crest of an uphill.
- Land smoothly on a downslope = **GREAT**; 3 GREATs in a row = **FEVER** (double points).
- Touch the clouds for a SKY TOUCH bonus. Esc / P — pause. Sound toggle top-right.

## Made with
- Human: **Koshhh** — game direction, design decisions, feel tuning, testing.
- AI tools: **Claude** (Anthropic) via **Claude Code** — code, shaders, procedural art (all graphics
  are drawn by code: shaders + Canvas2D), synthesized sound effects, tooling, this page text.
- Libraries: three.js, Vite, TypeScript; fonts Lilita One and Fredoka (SIL OFL, bundled).
- No third-party art or sound assets.

## itch.io settings
- Kind of project: **HTML**
- Upload `release/game.zip` → tick **"This file will be played in the browser"**
- Viewport dimensions: **540 × 960**
- **Mobile friendly: ON**, orientation **Portrait**
- **Fullscreen button: ON**
- **SharedArrayBuffer support: OFF**
- (Optional) Automatically start on page load: OFF (the game waits for a tap anyway)

## Screenshot moments (portrait 720×1280, `?seed=3`; `npm run shot` captures similar ones)
1. **Fever at speed** — rainbow fire trail, SONIC label in the HUD, speed lines, the bird
   mid-air over a striped island (`shots/10-sky.png` / `07-fever.png`).
2. **Island jump** — the bird flying over the water gap toward the next island, banner
   "ISLAND 2 · MINT BERRY" (`shots/06-island2.png`, `05-water.png`).
3. **The sunset catching up** — dusk/night sky with the moon rising behind the mountains,
   stars, the day dial almost empty (`shots/12-dusk.png`, `13-night.png`).

## Cover image 630 × 500 — composition idea
Diagonal action shot: the bird large in the left third, diving down a glossy rainbow hill toward
the lower right, goggles on, red scarf streaming back in an S-curve, a fire-rainbow trail behind.
Background: a huge orange setting sun on the right half sinking behind violet parallax mountains,
the sky going from deep blue (top) to peach (horizon) — the night creeping in from the left edge.
Logo "SUNSET DASH" top-left in the in-game yellow/orange outlined lettering; a small "SONIC!"
burst ring near the bird. Keep the bottom 15% simple (itch overlays the title on hover).
