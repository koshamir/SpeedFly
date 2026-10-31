# Sunset Dash — itch.io page

## Description (EN)
A tiny goggled bird races the sunset across endless rainbow islands. Hold to dive down the slopes, let go
to launch off the crests, and touch down along a downhill for a **GREAT** — chain them into **FEVER**.
**Speed and skill buy daylight**: fly fast, chain GREATs, touch the clouds and reach new islands to push the
night back; play slow and it creeps in. Every island ends in a mountain: rush down its long slope at full
**speed**, hit the ramp and soar over the sea to the next island.
A one-button jam game about the theme **Speed**, made for phones (portrait) and the browser.

**Two modes**
- **Endless run** — beat your records (score, distance, island, GREAT chain, top speed). A flag marks
  your best distance; pass it for a NEW RECORD.
- **Race** — 3 hand-made tracks against 4 rival birds: *Meadow Rings* (boost rings high in the sky),
  *Candy Draft* (steal a rival's slipstream), *Ember Sunset* (the night puts the last bird to sleep).
  Gold / silver / bronze times, best time per track.

## Controls
- **Hold** (touch / mouse button / Space) — dive: heavier on downslopes, faster drop in the air.
- **Let go** — launch off the crest of an uphill and glide.
- **Tilt control (phones, Settings ⚙)** — tilt the phone to the right = hold, back to neutral = release
  (calibrated to how you hold the phone; sensitivity slider).
- Land along a downslope = **GREAT**; 3 in a row = **FEVER** (double points). Esc / P — pause.
- First launch shows a short illustrated "How to fly" card (the **?** button on the title reopens it);
  the on-screen hints fade out by themselves once you have the hang of it.

## Made with
- Human: **Koshhh** — game direction, design decisions, feel tuning, testing.
- AI tools: **Claude** (Anthropic, model Claude Opus) via **Claude Code** (CLI) — code, shaders, procedural
  art (all graphics are drawn by code: shaders + Canvas2D), the synthesized soundtrack and sound effects
  (WebAudio), race tracks and AI rivals, test/QA tooling (Playwright bots), this page text.
  No other AI tools were used (no image / music / voice generators).
- Libraries: three.js, Vite, TypeScript; fonts Lilita One and Fredoka (SIL OFL, bundled).
- No third-party art or sound assets.

## itch.io settings
- Kind of project: **HTML**
- Upload `release/game.zip` → tick **"This file will be played in the browser"**
- Viewport dimensions: **540 × 960**
- **Mobile friendly: ON**, orientation **Portrait**
- **Fullscreen button: ON**
- **SharedArrayBuffer support: OFF**
- Automatically start on page load: OFF (the game waits for a tap anyway)

## Screenshots (portrait 720×1280, `npm run shot`, in this order)
1. **Mountain descent** — zoomed in on the bird rushing down the island's mountain, speed lines (`shots/41-descent-mid.png`).
2. **Island flight** — launch off the ramp toward the next island over the sea (`shots/43-ramp-lip.png`, `44-flight-mid.png`).
3. **Landing** — ISLAND 2 banner + PERFECT LANDING (`shots/46-landing.png`).
4. **Race** — place / time / progress bar with the rivals (`shots/71-race-mid.png`), results with a medal (`72-race-results.png`).
5. **How to fly** card (`shots/60-tutorial.png`) and **Fever at speed** (`07-fever.png`).
6. **Dusk / night** — the day meter almost empty (`shots/12-dusk.png`, `13-night.png`).

## Cover image 630 × 500 — composition idea
Diagonal action shot: the bird large in the left third, diving down a snow-capped rainbow mountain toward
the lower right, goggles on, red scarf streaming back, speed lines. Background: a huge orange setting sun
sinking behind violet parallax mountains, the night creeping in from the left. Logo "SUNSET DASH" top-left.
Keep the bottom 15% simple (itch overlays the title on hover).
