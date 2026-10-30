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
    maxSlope: 1.0, // max |h'|; dx is widened to respect it
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
    sxStep: 0.05, // per-island width scale of the hill types
    sxMax: 1.4,
    syStep: 0.07, // per-island height scale
    syMax: 1.5,
    onboardHills: 3, // first hills of island 1 are 'normal' and lower
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

  // Hill rhythm (island mode): a hill = one symmetric cosine wave (valley -> peak -> valley) of a TYPE.
  // Few types, small jitter, slow growth along the island = predictable, learnable rhythm.
  hills: {
    types: [
      { name: 'normal', w: 760, h: 170, weight: 0.6 }, // w = valley-to-valley width, h = peak height
      { name: 'deep', w: 760, h: 240, weight: 0.25 }, // bigger pump
      { name: 'wide', w: 1100, h: 230, weight: 0.15 }, // long launch
    ],
    noRepeat: ['deep', 'wide'], // never twice in a row
    jitter: 0.04, // +-4% on w and h
    growFrom: 0.85, // h multiplier along the island: first hill -> last hill
    growTo: 1.12,
    baseY: 0, // valley height
    baseJitter: 10,
    maxSlope: 1.1, // max |h'| of a wave = pi h / w (w is widened to respect it)
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
    innerShadow: 12,
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
    wetTint: 0.55,
    wetTintDepth: 260,
    foam: 3,
  },

  // sky keyframes, top -> horizon (daylight 1 -> 0). grade = multiply for hills.
  skyKeys: [
    { daylight: 1.0, top: '#49B8F5', horizon: '#BDEBFF', sun: '#FFF4C9', sunY: 0.8, grade: '#FFFFFF' },
    { daylight: 0.6, top: '#6FA8E8', horizon: '#FFD39A', sun: '#FFE7A8', sunY: 0.58, grade: '#FFF1DC' },
    { daylight: 0.3, top: '#3B3F8F', horizon: '#FF8A73', sun: '#FF6F4E', sunY: 0.36, grade: '#E2C2E0' },
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
