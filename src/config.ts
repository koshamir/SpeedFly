// Every tunable number of the game lives here (CLAUDE.md). One object, live-editable with ?debug=1.
// Physics v2 (feel pass): circle-center contact, exact air step, presets below. Retune only here.

/** Physics presets: each overrides CONFIG.physics. Pick with CONFIG.physicsPreset / applyPreset(). */
export const PHYSICS_PRESETS = {
  // v1 numbers on the v2 model
  classic: { gRelease: 1000, gDive: 3000, diveRamp: 0, airLift: 0, muGround: 0.03, drag: 0.00004, greatBoost: 1.05, landingAssist: 0.35, greatAngle: 15 },
  // best guess at the Tiny Wings feel: softer dive onset, slight glide while falling, more forgiving landings
  smooth: { gRelease: 1000, gDive: 3200, diveRamp: 0.05, airLift: 0.12, muGround: 0.02, drag: 0.000035, greatBoost: 1.08, landingAssist: 0.45, greatAngle: 17 },
  // fastest acceleration, big speed payoff for good timing
  rush: { gRelease: 900, gDive: 3600, diveRamp: 0.03, airLift: 0, muGround: 0.015, drag: 0.00003, greatBoost: 1.1, landingAssist: 0.5, greatAngle: 17 },
  // long floaty flights, slow dive onset
  floaty: { gRelease: 800, gDive: 3000, diveRamp: 0.08, airLift: 0.25, muGround: 0.02, drag: 0.000035, greatBoost: 1.06, landingAssist: 0.45, greatAngle: 18 },
};
export type PresetName = keyof typeof PHYSICS_PRESETS;

export const CONFIG = {
  physicsPreset: 'smooth' as PresetName,

  physics: {
    dt: 1 / 240, // fixed step (s)
    gRelease: 1000, // gravity, finger up (ground + air)
    gDive: 3000, // gravity, finger down (ground + air)
    drag: 0.00004, // quadratic drag: a = drag * v^2
    muGround: 0.03, // ground friction: a = mu * N
    sMin: 150, // min tangential ground speed (bird flaps, never stops)
    hopMinAir: 0.12, // flights shorter (s) AND lower (px) than this are micro-hops: no events
    hopMinAlt: 10,
    greatAngle: 15, // deg between velocity and tangent at touchdown
    greatSlope: -0.12, // h'(x) must be <= this for GREAT
    okAngle: 28, // worse = BAD
    greatBoost: 1.05,
    landingAssist: 0.35,
    birdRadius: 22, // the bird is a circle: state x,y = its CENTER (= sprite center)
    diveRamp: 0, // s: gravity eases toward the held/released value (0 = instant switch)
    airLift: 0, // share of gravity cancelled while released AND falling (wings open, glide)
    takeoffMargin: 0, // leave the ground only when N < -margin * g (0 = pure physics; >0 = stickier crests)
    muWater: 0.25,
    sMinWater: 120,
    startSpeed: 300,
  },

  loop: {
    maxSteps: 8, // fixed steps per frame
    maxFrame: 0.25, // s, clamp of a single frame delta
  },

  terrain: {
    dxMin: 260, // half-wavelength (valley -> peak)
    dxMax: 420,
    hFracMin: 0.35, // peak height above valley as a fraction of dx
    hFracMax: 0.6,
    valleyJitter: 60, // valleys at y in [-60, 60]
    maxSlope: 1.0, // max |h'| of the reference generator and the island end; dx is widened to respect it
    nestY: 200, // start peak (the nest) at x = 0
    prerollDx: 420, // key points behind the nest (visual only)
    prerollY: 40,
    // reference generator (?terrain=reference, npm run sim)
    refRampPoints: 600,
    refRampSx: 0.35,
    refRampSy: 0.25,
    refStartX: 40,
    // streaming
    screenWorld: 2000, // world width of one screen at max zoom-out (720 / 0.36)
    aheadScreens: 3,
    behindScreens: 2,
    trimBatch: 64, // compact arrays only when this many points can go
    updateEvery: 60, // sim steps between streaming updates
  },

  islands: {
    hillsBase: 16,
    hillsStep: 4,
    hillsMax: 40,
    sxStep: 0.05, // per-island width scale of the hills (hills.halfW)
    sxMax: 1.4,
    syStep: 0.07, // per-island height scale (hills.depth / zigzag dy)
    syMax: 1.5,
    onboardHills: 3, // first hills of island 1: no deep/wide valleys, depth x onboardH
    onboardH: 0.7,
    launchValleyY: -120,
    launchValleyDx: 420,
    lipY: 380,
    rampDx: 720,
    waterY: -220,
    cliffDx: 260,
    landingPeakY: 260,
    landingAim: 60, // R is measured where the trajectory crosses landingPeakY + landingAim
    launchAngle: 32, // deg
    vTBase: 950,
    vTStep: 110,
    vTMax: 2000,
    riseMin: 420,
    riseFrac: 0.55,
    waterMin: 150,
    waterSurface: 14, // visible water surface above waterY
    bandWidthMin: 70,
    bandWidthMax: 110,
    paletteCount: 6,
  },

  // Hills (island mode). Key points alternate PEAK / VALLEY; cosine interpolation between them
  // (Tikhonov / haqu tiny-wings principle). Two generators:
  //  mode 0 'peaks' (default, Tiny Wings look): peaks sit at ~one level, every valley has its own
  //         depth; now and then a valley is deep (bigger pump) or wide (longer, softer slopes).
  //  mode 1 'zigzag' (haqu/Tikhonov original): each key point = previous +- (minDY..minDY+rangeDY),
  //         clamped to [zzMinY, zzMaxY] -> peaks drift up and down (random walk).
  // halfW = horizontal distance peak -> valley; depth = peak -> valley drop. Per-island scale:
  // islands.sxStep/sxMax (halfW), islands.syStep/syMax (depth / dy).
  hills: {
    mode: 0, // 0 peaks, 1 zigzag
    halfW: 380, // peak -> valley distance (a whole hill = 2 * halfW)
    halfWJitter: 0.08, // +-8%
    symmetric: 1, // 1: both slopes of a valley share one width (a symmetric bowl); 0: each slope rolls its own
    peakY: 200, // peak level (the nest is at 200)
    peakJitter: 12, // +- px per peak
    depth: 170, // peak -> valley drop
    depthJitter: 0.15, // +-15%
    deepChance: 0.2, // share of valleys that are deep
    deepMul: 1.45, // depth multiplier of a deep valley
    wideChance: 0.15, // share of valleys that are wide
    wideMul: 1.35, // halfW multiplier of a wide valley
    noRepeat: 1, // 1: a deep/wide valley is never followed by another special one
    growFrom: 0.85, // depth multiplier along the island: first valley -> last valley
    growTo: 1.12,
    maxSlope: 1.1, // max |h'| (a slope's width is widened to respect it)
    // zigzag mode (haqu: minDY 60, rangeDY 60 on a 320 px tall screen, clamp [20, 320]; x1.5 for our 720 px width)
    zzMinDY: 90,
    zzRangeDY: 90,
    zzMinY: -60,
    zzMaxY: 330,
  },

  coins: {
    hillChance: 0.35, // share of downslopes with a gold arc
    arcMin: 5,
    arcMax: 8,
    arcT0: 0.15, // arc spans this part of the downslope
    arcT1: 0.85,
    lift: 45, // px above the surface along the normal
    launchMin: 12,
    launchMax: 16,
    launchT0: 0.5, // starts mid-descent into the launch valley
    launchT1: 0.85, // ends at this part of the ramp
    blueChance: 0.15,
    blueSkipHills: 4,
    blueLift: 30,
    blueMul: 1.12,
    blueMinAdd: 120,
    pickupRadius: 34,
    size: 30, // visual diameter (world px)
    blueSize: 36,
    spinRate: 3,
    capacity: 512,
  },

  sky: {
    cloudY: 1100, // cloud ceiling height (world)
    cloudSpacing: 150,
    cloudSize: 210,
    cloudJitter: 40,
    starsFrom: 0.28, // daylight below which stars fade in
  },

  // Background (§7.4). Silhouette layers: parallax px on X (half on Y), zoom-out compensation k
  // (layer scale 1 - (1 - z) k: the background doesn't shrink with the world), ridge base + amplitude
  // in layer px; colour = mix(horizon, tint * grade, strength).
  parallax: {
    layers: [
      { px: 0.1, k: 0.15, base: -10, amp: 170, tint: '#8C98DC', strength: 0.34 },
      { px: 0.25, k: 0.35, base: -70, amp: 130, tint: '#6C83C6', strength: 0.52 },
      { px: 0.5, k: 0.6, base: -130, amp: 100, tint: '#4C78A4', strength: 0.7 },
    ],
    mistDepth: 170, // layer px below a ridge where the mist is full
    mist: 0.5,
    ridgeLight: 0.07,
    // drifting cloud layers: parallax, zoom compensation, y range (layer px), size range, spacing, drift px/s, fog
    clouds: [
      { px: 0.04, k: 0.1, y0: 420, y1: 760, s0: 170, s1: 280, spacing: 380, drift: 9, fog: 0.5 },
      { px: 0.15, k: 0.3, y0: 330, y1: 880, s0: 220, s1: 380, spacing: 560, drift: 22, fog: 0.2 },
    ],
    cloudShade: '#DCE6F7', // underside of a cloud by day (multiplied by the light colour)
  },

  night: {
    startGap: 2500, // xNight(t) = -startGap + v0 t + accel t^2 / 2
    v0: 300,
    accel: 8,
    daylightGap: 2500, // daylight = clamp(gap / this)
    islandPushback: 1200,
    frontWidth: 600,
    frontAlpha: 0.88,
    caughtTime: 1.2,
  },

  score: {
    distPerPt: 10,
    flightMin: 1,
    flightPerSec: 50,
    greatBase: 100,
    greatStep: 20,
    greatMax: 200,
    skyTouch: 300,
    coin: 20,
    blueCoin: 50,
    islandPer: 500,
    feverMul: 2,
    feverStreak: 3,
  },

  speed: {
    tiers: [700, 1300, 1900, 2500], // CRUISE, FAST, BLAZING, SONIC (px/s)
    tierHysteresis: 60,
    kmhPerPx: 0.12,
    pxPerMeter: 30,
  },

  camera: {
    anchorSlow: 0.27, // bird X anchor (share of width) at v <= anchorVSlow
    anchorFast: 0.2,
    anchorVSlow: 600,
    anchorVFast: 2000,
    anchorRate: 4,
    lookAhead: 0.7, // s of path visible ahead
    minLookPx: 520,
    zMin: 0.36,
    zMax: 1,
    zFloor: 0.2, // safety floor for the altitude zoom
    refBack: 100,
    refAhead: 0.6, // share of view width
    refStep: 40,
    refFromBottom: 0.3,
    altFrac: 0.62,
    altMargin: 160,
    // critically damped springs (rad/s): continuous velocity, no camera jerks
    wZoomOut: 5,
    wZoomIn: 2.5,
    wY: 5,
    wRef: 4, // ground reference
    wX: 5, // horizontal follow with velocity feed-forward (0 = locked to the bird)
    topMargin: 70, // hard guard: bird center never closer to the top (logical px)
    birdScaleMax: 1.55,
    shakeBad: 10,
    shakeSonic: 14,
    shakeDecay: 0.25,
  },

  view: {
    logW: 720,
    logH: 1280,
    maxW: 960, // desktop: logical width cap, side bars beyond
    dprMax: 2,
  },

  render: {
    meshStep: 8, // terrain vertex every 8 px
    chunkWidth: 1024,
    chunkPool: 8,
    meshBottom: -5000, // terrain/water bottom (world y)
    rimWidth: 4,
    rimMinPx: 2.5, // device px: the rim never gets thinner when zoomed out
    innerShadow: 12,
    sheen: 0.07, // brightness boost right under the rim (light from above)
    sheenDist: 70,
    grain: 0.025, // +-2.5% screen-space grain on the hills
    shadeDist: 900,
    shadeMin: 0.72,
    bandWobbleA: 18,
    bandWobbleB: 10,
    bandFreqA: 0.004,
    bandFreqB: 0.011,
    diagDepth: 0.7,
    diagX: 0.35,
    bandShade: 0.12,
    bandEdge: 1.5,
    birdSprite: 1.5, // sprite size relative to 2R
    birdTex: 256,
    rotTau: 0.06,
    diveTilt: 10, // deg nose-down while diving in air
    diveStretchX: 1.12, // dive: body stretched along velocity
    diveStretchY: 0.9,
    squash: 0.75,
    squashTime: 0.12,
    sunX: 0.74,
    sunSize: 0.045,
    waterDeep: 320,
    seaDepth: 380, // visual seabed bowl under the water (the physical contact stays flat)
    seaDepthPerWidth: 0.8,
    seaBowl: 0.6,
    wetFade: 40,
    seaBlend: 0.85, // share of the gap (lip -> landing peak) over which the island looks blend
    wetTint: 0.55,
    wetTintDepth: 260,
    foam: 3,
    waveA: 3.5, // visual water surface waves (the physical surface stays flat)
    waveB: 2,
    waveFreqA: 0.021,
    waveFreqB: 0.053,
  },

  // sky keyframes, top -> horizon (daylight 1 -> 0). grade = multiply for hills.
  skyKeys: [
    { daylight: 1.0, top: '#49B8F5', horizon: '#BDEBFF', sun: '#FFF4C9', sunY: 0.8, grade: '#FFFFFF' },
    { daylight: 0.6, top: '#6FA8E8', horizon: '#FFD39A', sun: '#FFE7A8', sunY: 0.58, grade: '#FFF1DC' },
    { daylight: 0.3, top: '#3B3F8F', horizon: '#FF8A73', sun: '#FF6F4E', sunY: 0.45, grade: '#E2C2E0' },
    { daylight: 0.0, top: '#0E1233', horizon: '#2B2C66', sun: '#F4F1D0', sunY: 0.78, grade: '#6F78A6' },
  ],

  palettes: [
    { name: 'Meadow Pop', bands: ['#9BE15D', '#4CC06B', '#2A9D8F', '#F6C85F', '#F28F5C'], rim: '#E9FFB0' },
    { name: 'Candy Coast', bands: ['#FF8FB1', '#FFC46B', '#FF6B6B', '#B388EB', '#6BCBFF'], rim: '#FFF1D6' },
    { name: 'Lagoon', bands: ['#3DDCC5', '#1FA6B8', '#F7E07B', '#F49D6E', '#2D6A9F'], rim: '#D8FFF6' },
    { name: 'Ember Mesa', bands: ['#FFB547', '#FF7A45', '#E84A5F', '#8E3B76', '#FFD27A'], rim: '#FFF0C2' },
    { name: 'Mint Berry', bands: ['#B8F2A0', '#6DD3A8', '#A06CD5', '#F7A1C4', '#4E9F6E'], rim: '#F3FFE4' },
    // Glacier reordered: the surface band must contrast with the pale horizon
    { name: 'Glacier', bands: ['#8C9EF0', '#BDE8FF', '#7FB8F0', '#E0F7F4', '#5A6FD6'], rim: '#FFFFFF' },
  ],

  colors: {
    outline: '#241B3A',
    water: '#3FA9E0',
    waterDeep: '#1B4F8F',
    foam: '#E8FBFF',
    night: '#0B0E2A',
    gold: '#FFC93C',
    blue: '#3FD5FF',
    cloud: '#FFFFFF',
    tiers: ['#FFFFFF', '#9BE7FF', '#7CFF8A', '#FFD23F', '#FF5FA2'], // speed tier label colors
  },

  bot: {
    decideEvery: 4, // decisions every 4 steps (60 Hz)
    plans: [0, 12, 24, 48, 72, 96, 144, 192, 288, 1e9], // release N steps, then dive
    maxPredict: 2400,
    groundSlope: -0.03, // planner on ground: hold if h' < this
    naiveSlope: -0.05,
    greatScore: 1e6,
    angPenalty: 50,
    speedWeight: 0.2,
    failAngle: 99,
    sampleEvery: 24, // npm run sim: speed sample every 0.1 s
    autoStart: 1.0, // s on title before the bot taps
    autoRetry: 4.0, // s on results before the bot retries
  },

  ui: {
    retryLock: 0.6,
    popupMax: 4,
    popupLife: 0.7,
    popupRise: 40,
    popupAhead: 190, // popups sit ahead of the bird (logical px)
    popupEdge: 150, // and stay this far from the screen edges
    bannerTime: 1.6,
    dial: 88,
  },

  // Character rig (§7.5). Angles in rad (wing: + = tip down), lengths in R (birdRadius) unless noted.
  bird: {
    squashKick: 8, // landing: velocity kick of the body-height spring (min ~0.75)
    squashK: 900,
    squashDamp: 20,
    dizzyTime: 0.9, // BAD landing: spiral eyes
    happyTime: 1.2, // sky touch: happy face
    blinkEvery: 3, // s
    blinkTime: 0.12,
    crawlFactor: 1.3, // grounded below sMin * this = crawling (fast flapping, sweat)
    breathe: 0.04, // asleep
    wingRest: 0.15,
    wingOpen: -0.55,
    wingTucked: 0.45,
    flapHz: 2,
    flapAmp: 0.35,
    flapCrawlHz: 8,
    flapCrawlAmp: 0.8,
    gradeMix: 0.45, // how much the time-of-day grade tints the bird
    nestLift: 0.3, // nest pivot above the start peak
    // scarf: verlet chain, N nodes x scarfSeg world px (x bird scale)
    scarfSeg: 12,
    scarfAnchorX: -0.62,
    scarfAnchorY: -0.2,
    scarfDrag: 9, // 1/s: air brakes the nodes -> the scarf streams behind
    scarfGravity: 500,
    scarfFlutter: 5, // px of flutter at scarfFlutterV
    scarfFlutterV: 1500,
    scarfFlutterHz: 9, // rad/s base (+ speed * 0.008)
    scarfW0: 11, // ribbon width at the neck / tip (world px)
    scarfW1: 6,
    scarfOutline: 3,
    scarfGround: 6, // world px: scarf nodes stay this far above the ground
  },

  // PNG overrides for rig parts: '' = procedural. Image framing = one atlas cell: the part's pivot at
  // the image centre, the image spans 4R x 4R (e.g. 'parts/body.png' served from public/).
  birdParts: {
    body: '',
    belly: '',
    wing: '',
    beak: '',
    faceOpen: '',
    faceSquint: '',
    faceHappy: '',
    faceSparkle: '',
    faceSleep: '',
    faceDizzy: '',
    sweat: '',
    nest: '',
    aura: '',
  },

  fx: {
    maxParticles: 300,
    stretchK: 0.0025, // stretched particles: length x (1 + speed * k)
    splashDrops: 18,
    dust: 5, // landing dust puffs (x speed factor)
    dustBad: 8,
    greatSparks: 12,
    badFeathers: 7,
    skyPuffs: 10,
    sonicCooldown: 3, // s
    sonicRing: 560, // world px
    lineRate: [10, 22, 40], // speed lines per second at FAST / BLAZING / SONIC
    lineAlpha: 0.7,
    trailStep: 14, // world px between trail points (x bird scale)
    trailWidth: 22,
    trailAlpha: 0.85,
    vignette: 0.22,
  },

  // Touch Teacher (§9): until 3 GREATs (localStorage flag) or the end of island 1.
  teacher: {
    holdColor: '#5CFF7A',
    letGoColor: '#FFB020',
    greats: 3,
    fade: 1.2, // s
    lookAhead: 0.18, // s of path ahead used for the advice
    slope: 0.08, // |h'| above which the advice is shown
    fingerAhead: 0.45, // s: the ghost finger pulses this long before a downslope
  },

  // Juice (M4)
  juice: {
    hitStop: 0.04, // s, render-only freeze on GREAT x3+ (the sim never stops)
    hitStopStreak: 3,
    scoreRoll: 12, // 1/s: the score counter rolls up to the real score
    scoreBump: 100, // a jump of at least this many points bumps the counter
    feverTint: 0.09, // screen tint amount in Fever (pulsing +-feverPulse)
    feverPulse: 0.05,
  },

  // Audio (§8): gains 0..1, frequencies in Hz.
  audio: {
    master: 0.8,
    sfx: 0.9,
    wind: 0.32, // wind loop at full speed
    windDive: 1.45, // louder while diving
    windFullSpeed: 2600, // px/s
    windCut0: 350, // wind band centre at rest / at full speed
    windCut1: 2600,
    bellBase: 783.99, // GREAT bell (G5), +1 pentatonic step per streak step
    coinBase: 1046.5, // coin blip (C6), rising within a chain
    shimmer: 0.045, // Fever loop level
    music: 0.45, // optional src/audio/music.mp3
    musicCut: [700, 1200, 2400, 6000, 18000], // music lowpass per speed tier
  },

  debug: {
    fpsSmooth: 0.1,
    normalLen: 40,
    velScale: 0.05,
  },
};

export type Config = typeof CONFIG;

/** Copy a preset into CONFIG.physics (live: the next step uses it). */
export function applyPreset(name: PresetName): void {
  CONFIG.physicsPreset = name;
  Object.assign(CONFIG.physics, PHYSICS_PRESETS[name]);
}
applyPreset(CONFIG.physicsPreset);
export type PhysicsConfig = Config['physics'];
