// REFERENCE PHYSICS — validated headless model. Port this logic 1:1 into src/sim/ (TypeScript).
// Run: node reference/physics-sim.mjs   (prints bot table: the acceptance baseline)
// Units: world px, seconds, Y UP. The bird is simulated as a CONTACT POINT on the surface;
// the sprite is drawn at contact + normal * BIRD_RADIUS.

export const CFG = {
  dt: 1 / 240,            // fixed physics step
  gRelease: 1000,         // gravity, finger up (ground + air)
  gDive: 3000,            // gravity, finger down (ground + air)  -> energy pump ratio 3x
  drag: 0.00004,          // quadratic air/ground drag coef (1/px): a = drag * v^2
  muGround: 0.03,         // ground friction: a = mu * N (N = normal accel). Punishes "hold forever"
  sMin: 150,              // min tangential ground speed (bird flaps to crawl, never stops/rolls back)
  hopMinAir: 0.12,        // flights shorter than this (s) AND lower than hopMinAlt are micro-hops:
  hopMinAlt: 10,          //   no landing classification, no events
  greatAngle: 15,         // deg between velocity and surface tangent at touchdown
  greatSlope: -0.12,      // surface slope h'(x) must be <= this (downhill, ~ -7 deg)
  okAngle: 28,            // > okAngle = BAD landing (thud FX, streak reset)
  greatBoost: 1.05,       // tangential speed multiplier on GREAT landing
  landingAssist: 0.35,    // downhill landings within 2*greatAngle lose less speed: keep |v|*cos(a*(1-assist))
  // terrain (half-wavelength = distance between a valley and the next peak)
  dxMin: 260, dxMax: 420,
  hFracMin: 0.35, hFracMax: 0.6, // peak height above surrounding valleys, as fraction of dx
  valleyJitter: 60,               // valleys at y in [-60, +60]
  maxSlope: 1.0,                  // max |h'| (45 deg); dx is widened to respect it
  // night chase: xNight(t) = -startGap + v0*t + 0.5*accel*t^2 ; caught when xNight >= bird.x
  night: { startGap: 2500, v0: 300, accel: 8 },
};

export function mulberry32(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Key points alternate valley/peak. Between key points: cosine interpolation (C1, slope 0 at key points).
export function genKeyPoints(seed, n = 2000, C = CFG) {
  const r = mulberry32(seed); const kx = [0], ky = [200]; // start on a peak (the nest)
  let x = 0, valley = true, lastValley = 0;
  for (let i = 0; i < n; i++) {
    const prog = Math.min(1, i / 600);             // slow difficulty ramp (islands override this in-game)
    const sx = 1 + 0.35 * prog, sy = 1 + 0.25 * prog;
    let dx = (C.dxMin + r() * (C.dxMax - C.dxMin)) * sx, y;
    if (valley) { y = -C.valleyJitter + r() * 2 * C.valleyJitter; lastValley = y; }
    else y = lastValley + dx * (C.hFracMin + r() * (C.hFracMax - C.hFracMin)) * sy;
    const need = Math.abs(y - ky[ky.length - 1]) * Math.PI / (2 * C.maxSlope); // max slope of cosine seg = A*pi/w
    if (dx < need) dx = need;
    x += dx; kx.push(x); ky.push(y); valley = !valley;
  }
  return { kx, ky };
}

// Returns h(x) -> [y, y', y''] analytically. Cached segment index (monotonic queries are O(1)).
export function makeHeight(T) {
  let i = 0;
  return (x) => {
    while (i > 0 && T.kx[i] > x) i--;
    while (i < T.kx.length - 2 && T.kx[i + 1] <= x) i++;
    const x0 = T.kx[i], w = T.kx[i + 1] - x0, y0 = T.ky[i], A = (T.ky[i + 1] - y0) / 2, k = Math.PI / w, t = (x - x0) * k;
    return [y0 + A * (1 - Math.cos(t)), A * k * Math.sin(t), A * k * k * Math.cos(t)];
  };
}

export function newBird(H, x = 40) {
  return { x, y: H(x)[0], v: 300, vx: 0, vy: 0, grounded: true, airT: 0, airAlt: 0, streak: 0,
    stats: { landings: 0, great: 0, bad: 0, fever: 0, angSum: 0, maxAlt: 0, airTime: 0, flightLen: [] }, fx: 0, events: [] };
}

// One fixed step. `held` = finger down. Pushes gameplay events into b.events.
export function step(b, held, H, C = CFG) {
  const g = held ? C.gDive : C.gRelease, dt = C.dt;
  if (b.grounded) {
    const [, d1, d2] = H(b.x);
    const L = Math.hypot(1, d1), tx = 1 / L, ty = d1 / L;      // unit tangent (tx = cos theta)
    const kappa = d2 / (L * L * L);                              // signed curvature (+ = valley)
    let v = b.v;
    const N = g * tx + v * v * kappa;                            // normal accel the ground must supply
    if (N < 0) {                                                 // ground falls away faster than gravity bends us
      b.grounded = false; b.vx = v * tx; b.vy = v * ty; b.airT = 0; b.airAlt = 0; b.fx = b.x;
      b.events.push({ type: 'takeoff' }); return;
    }
    v += (-g * ty - C.drag * v * Math.abs(v) - C.muGround * N) * dt;
    if (v < C.sMin) v = C.sMin;
    b.x += v * tx * dt; b.y = H(b.x)[0]; b.v = v;
  } else {
    const sp = Math.hypot(b.vx, b.vy);
    b.vx -= C.drag * b.vx * sp * dt; b.vy -= (g + C.drag * b.vy * sp) * dt;
    b.x += b.vx * dt; b.y += b.vy * dt;
    const [hy, d1] = H(b.x);
    b.airT += dt; b.airAlt = Math.max(b.airAlt, b.y - hy); b.stats.airTime += dt; b.stats.maxAlt = Math.max(b.stats.maxAlt, b.y - hy);
    if (b.y <= hy) {                                             // touchdown: drop normal component (inelastic)
      const L = Math.hypot(1, d1), tx = 1 / L, ty = d1 / L;
      let vt = b.vx * tx + b.vy * ty; const vn = -b.vx * ty + b.vy * tx;
      const ang = Math.atan2(Math.abs(vn), vt) * 180 / Math.PI;
      b.y = hy; b.grounded = true;
      if (b.airT < C.hopMinAir && b.airAlt < C.hopMinAlt) { b.v = Math.max(C.sMin, vt); return; } // micro-hop
      const downhill = d1 <= C.greatSlope;
      if (downhill && ang <= 2 * C.greatAngle) vt = Math.max(vt, sp * Math.cos(ang * (1 - C.landingAssist) * Math.PI / 180));
      let kind = 'ok';
      if (downhill && ang <= C.greatAngle) { kind = 'great'; vt *= C.greatBoost; b.streak++; }
      else { b.streak = 0; if (ang > C.okAngle || !downhill && ang > C.greatAngle) kind = 'bad'; }
      b.v = Math.max(C.sMin, vt);
      const s = b.stats; s.landings++; s.angSum += ang; s.flightLen.push(b.x - b.fx);
      if (kind === 'great') s.great++; if (kind === 'bad') s.bad++; if (kind === 'great' && b.streak >= 3) s.fever++;
      b.events.push({ type: 'land', kind, angle: ang, airTime: b.airT, streak: b.streak });
    }
  }
}

export const speedOf = (b) => (b.grounded ? b.v : Math.hypot(b.vx, b.vy));

// ---------- bots (also used in-game as ?bot=1 autopilot and for acceptance tests) ----------
function cloneBird(b) { return { ...b, stats: { ...b.stats, flightLen: [] }, events: [] }; }
function predictLanding(b, releaseSteps, H) {             // release for N steps, then dive until touchdown
  const c = cloneBird(b); let n = 0;
  while (!c.grounded && n < 2400) { step(c, n >= releaseSteps, H); n++; }
  const e = c.events.find((e) => e.type === 'land');
  return c.grounded ? { kind: e ? e.kind : 'ok', ang: e ? e.angle : 0, v: c.v } : { kind: 'bad', ang: 99, v: 0 };
}
const PLANS = [0, 12, 24, 48, 72, 96, 144, 192, 288, 1e9];
export function plannerHeld(b, H) {
  const [, d1] = H(b.x);
  if (b.grounded) return d1 < -0.03;                       // ground: hold on downhill, release on uphill
  let best = 1e9, bestScore = -1e18;
  for (const r of PLANS) {
    const p = predictLanding(b, r, H);
    const score = p.kind === 'great' ? 1e6 + p.v : -p.ang * 50 + p.v * 0.2;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best === 0;
}

export function runBot(policy, seed = 7, T = 240, delaySteps = 0, C = CFG) {
  const H = makeHeight(genKeyPoints(seed, 2000, C)); const b = newBird(H);
  const q = []; let held = false, t = 0, k = 0, caught = null; const speeds = [];
  while (t < T) {
    if (k % 4 === 0) {
      const [, d1] = H(b.x); let want;
      if (policy === 'none') want = false; else if (policy === 'always') want = true;
      else if (policy === 'naive') want = b.grounded && d1 < -0.05; else want = plannerHeld(b, H);
      if (delaySteps) { q.push(want); if (q.length > delaySteps) held = q.shift(); } else held = want;
    }
    step(b, held, H, C); b.events.length = 0; t += C.dt; k++;
    if (k % 24 === 0) speeds.push(speedOf(b));
    const xn = -C.night.startGap + C.night.v0 * t + 0.5 * C.night.accel * t * t;
    if (caught === null && xn >= b.x) caught = t;
  }
  speeds.sort((a, z) => a - z); const p = (f) => Math.round(speeds[Math.floor(f * (speeds.length - 1))]);
  const s = b.stats, fl = s.flightLen.sort((a, z) => a - z);
  return { policy, nightCatches_s: caught === null ? `>${T}` : Math.round(caught), dist: Math.round(b.x), v_p50: p(0.5), v_p90: p(0.9),
    airShare: +(s.airTime / T).toFixed(2), maxAlt: Math.round(s.maxAlt), landings: s.landings, great: s.great, bad: s.bad,
    avgAngle: +(s.angSum / Math.max(1, s.landings)).toFixed(1), flight_p50: Math.round(fl[fl.length >> 1] || 0) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seed = +(process.argv[2] || 7), rows = [];
  for (const pol of ['none', 'always', 'naive', 'planner']) rows.push(runBot(pol, seed));
  rows.push({ ...runBot('planner', seed, 240, 3), policy: 'planner+50ms' });
  rows.push({ ...runBot('planner', seed, 240, 6), policy: 'planner+100ms' });
  console.table(rows);
}
