import { CONFIG, type PhysicsConfig } from '../config';
import type { LandKind } from '../core/events';
import type { Terrain, TerrainCursor } from '../world/terrain';

// Physics v2. The bird is a CIRCLE of radius R: state (x, y) is its CENTER = the sprite center.
// On the ground the center rides the offset curve C(u) = P(u) + R n(u) of the surface point u.
// Why (v1 bugs this fixes):
//  - v1 simulated the contact point and drew the sprite at contact + normal*R (blended in the air):
//    the sprite lurched forward ~R*sin(theta) after every takeoff and snapped back on every landing.
//  - v1's takeoff step did not move the bird and the air step was semi-implicit Euler (fell g*dt^2
//    instead of g*dt^2/2): on every convex upslope it chattered ground/air each step (9-16 takeoffs/s)
//    and moved at HALF speed until it finally launched -> the jerk "after the ramp".
// Tune CONFIG.physics / PHYSICS_PRESETS, not this code.

export const EV_NONE = 0;
export const EV_TAKEOFF = 1;
export const EV_LAND = 2; // classified landing (event-worthy)
export const EV_HOP = 3; // micro-hop: no events

export class Bird {
  x = 0; // circle center
  y = 0;
  u = 0; // contact x on the surface (valid while grounded; the last contact guess in the air)
  dive = 0; // 0 = released ... 1 = diving (eases with diveRamp); gravities interpolate on it
  flyG = 0; // > 0: scripted island flight (pure ballistic with this gravity, input ignored) until touchdown
  safe = false; // island-end sequence (set by Run): a landing there is never worse than GOOD
  v = 0; // speed along the center path (grounded)
  vx = 0;
  vy = 0;
  grounded = true;
  airT = 0;
  airAlt = 0;
  streak = 0;
  fx = 0; // takeoff x
  N = 0; // last ground normal accel (debug)
  // event slot of the last step (no allocations)
  ev = EV_NONE;
  evKind: LandKind = 'ok';
  evAngle = 0;
  evAirTime = 0;
  evFlight = 0;
  // stats (sim tables)
  landings = 0;
  great = 0;
  bad = 0;
  angSum = 0;
  maxAlt = 0;
  airTime = 0;

  /** Place the circle on the surface at contact x. */
  reset(cur: TerrainCursor, x: number, v: number, R: number, g: number): void {
    this.u = x;
    cur.sample(x);
    const L = Math.hypot(1, cur.d1);
    this.x = x - (R * cur.d1) / L;
    this.y = cur.y + R / L;
    this.v = v;
    this.dive = g > 0 ? 0 : 0;
    this.flyG = 0;
    this.vx = 0;
    this.vy = 0;
    this.grounded = true;
    this.airT = 0;
    this.airAlt = 0;
    this.streak = 0;
    this.fx = this.x;
    this.N = 0;
    this.ev = EV_NONE;
    this.landings = this.great = this.bad = this.angSum = this.maxAlt = this.airTime = 0;
  }

  /** Physics state copy (planner scratch birds). */
  copyFrom(o: Bird): void {
    this.x = o.x;
    this.y = o.y;
    this.u = o.u;
    this.dive = o.dive;
    this.flyG = o.flyG;
    this.v = o.v;
    this.vx = o.vx;
    this.vy = o.vy;
    this.grounded = o.grounded;
    this.airT = o.airT;
    this.airAlt = o.airAlt;
    this.streak = o.streak;
    this.fx = o.fx;
  }
}

export function speedOf(b: Bird): number {
  return b.grounded ? b.v : Math.hypot(b.vx, b.vy);
}

/** Contact u whose offset-curve point has x = cx (Newton). Leaves H sampled at the returned u. */
function contactFor(cx: number, guess: number, H: TerrainCursor, R: number): number {
  let u = guess;
  for (let i = 0; i < 4; i++) {
    H.sample(u);
    const L = Math.hypot(1, H.d1);
    const f = u - (R * H.d1) / L - cx;
    if (Math.abs(f) < 1e-3) return u;
    u -= f / Math.max(0.2, 1 - (R * H.d2) / (L * L * L));
  }
  H.sample(u);
  return u;
}

/** One fixed step. `held` = finger down. Result event in b.ev. */
export function step(b: Bird, held: boolean, H: TerrainCursor, T: Terrain, C: PhysicsConfig): void {
  b.ev = EV_NONE;
  const dt = C.dt, R = C.birdRadius;
  if (b.flyG > 0) held = false; // scripted island flight: input is ignored until touchdown
  const dT = held ? 1 : 0;
  b.dive = C.diveRamp > 0 ? b.dive + (dT - b.dive) * (1 - Math.exp(-dt / C.diveRamp)) : dT;
  const s = b.dive;
  const g = C.gRelease + (C.gDive - C.gRelease) * s; // ground gravity
  const gA = C.gAirRelease + (C.gAirDive - C.gAirRelease) * s; // air gravity

  if (b.grounded) {
    H.sample(b.u);
    const d1 = H.d1;
    const L = Math.hypot(1, d1), tx = 1 / L, ty = d1 / L; // unit tangent (tx = cos theta)
    const kS = H.d2 / (L * L * L); // surface curvature (+ = valley)
    const shrink = Math.max(0.2, 1 - R * kS); // ds_center = shrink * ds_surface
    const kappa = kS / shrink; // curvature of the center path
    let v = b.v;
    const N = g * tx + v * v * kappa; // normal accel the ground must supply
    b.N = N;
    if (N < -C.takeoffMargin * g) {
      // ground falls away faster than gravity bends us: fly, and integrate this step in the air
      b.grounded = false;
      b.vx = v * tx;
      b.vy = v * ty;
      b.airT = 0;
      b.airAlt = 0;
      b.fx = b.x;
      b.ev = EV_TAKEOFF;
    } else {
      const water = T.isWater(b.u);
      const over = v - C.vSoft;
      v += (-g * ty - C.drag * v * Math.abs(v) - (water ? C.muWater : C.muGround) * Math.max(0, N) - (over > 0 ? C.vSoftK * over * over : 0)) * dt;
      const sMin = water ? C.sMinWater : C.sMin;
      if (v < sMin) v = sMin;
      b.u += ((v * tx) / shrink) * dt;
      H.sample(b.u);
      const L2 = Math.hypot(1, H.d1);
      b.x = b.u - (R * H.d1) / L2;
      b.y = H.y + R / L2;
      b.v = v;
      return;
    }
  }

  // air: exact for constant acceleration over the step (x += v dt + a dt^2 / 2)
  const sp = Math.hypot(b.vx, b.vy);
  let ax: number, ay: number;
  if (b.flyG > 0) {
    ax = 0;
    ay = -b.flyG; // scripted: exact parabola to the landing target
  } else {
    const lift = !held && b.vy < 0 ? C.airLift * gA : 0; // wings open while falling
    ax = -C.drag * b.vx * sp;
    ay = lift - gA - C.drag * b.vy * sp;
    const over = sp - C.vSoft; // soft speed limit, along the velocity
    if (over > 0 && sp > 0) {
      const a = C.vSoftK * over * over;
      ax -= (a * b.vx) / sp;
      ay -= (a * b.vy) / sp;
    }
    const cap = C.fallCap + (C.fallCapDive - C.fallCap) * s; // parachute: terminal fall speed
    if (b.vy < -cap) ay += (-cap - b.vy) / C.fallTau;
    const above = b.y - (CONFIG.hills.peakY + C.ceilAlt); // soft ceiling while rising
    if (above > 0 && b.vy > 0) ay -= C.ceilK * above;
  }
  b.x += b.vx * dt + 0.5 * ax * dt * dt;
  b.y += b.vy * dt + 0.5 * ay * dt * dt;
  b.vx += ax * dt;
  b.vy += ay * dt;
  const u = contactFor(b.x, b.u, H, R);
  b.u = u;
  const d1 = H.d1, L = Math.hypot(1, d1);
  const yc = H.y + R / L; // offset-curve height under the center
  b.airT += dt;
  b.airAlt = Math.max(b.airAlt, b.y - yc);
  b.airTime += dt;
  b.maxAlt = Math.max(b.maxAlt, b.y - yc);
  if (b.y > yc) return;

  // touchdown: drop the normal component (inelastic)
  const tx = 1 / L, ty = d1 / L;
  let vt = b.vx * tx + b.vy * ty;
  const vn = -b.vx * ty + b.vy * tx;
  const ang = (Math.atan2(Math.abs(vn), vt) * 180) / Math.PI;
  b.x = u - (R * d1) / L;
  b.y = yc;
  b.grounded = true;
  const water = T.isWater(u);
  const scripted = b.flyG > 0;
  b.flyG = 0;
  if (!scripted && b.airT < C.hopMinAir && b.airAlt < C.hopMinAlt) {
    b.v = Math.max(water ? C.sMinWater : C.sMin, vt);
    // a graze inside the takeoff step is no event at all; a short skim is a silent hop
    b.ev = b.ev === EV_TAKEOFF ? EV_NONE : EV_HOP;
    return;
  }
  const real = scripted || b.airT >= C.judgeMinAir || b.airAlt >= C.judgeMinAlt;
  let kind: LandKind = 'ok';
  if (water) {
    kind = 'splash';
    b.streak = 0;
    b.v = Math.max(C.sMinWater, vt);
  } else {
    const downhill = d1 <= C.greatSlope;
    if (downhill && ang <= C.assistAngle)
      vt = Math.max(vt, sp * Math.cos((ang * (1 - C.landingAssist) * Math.PI) / 180));
    if (!real) {
      // a skim (short, low flight): physics as usual, but it is not judged and the streak is untouched
      b.v = Math.max(C.sMin, vt);
      b.ev = EV_HOP;
      return;
    }
    if (downhill && ang <= C.greatAngle) {
      kind = 'great';
      vt *= C.greatBoost;
      b.streak++;
    } else if ((downhill && ang <= C.okAngle) || (!downhill && ang <= C.greatAngle)) {
      kind = 'ok'; // GOOD: the streak is kept (no +1)
    } else if (b.safe) {
      kind = 'ok'; // island-end sequence: the mountain never breaks the streak
    } else {
      kind = 'bad';
      b.streak = 0;
    }
    b.v = Math.max(C.sMin, vt);
  }
  b.landings++;
  b.angSum += ang;
  if (kind === 'great') b.great++;
  if (kind === 'bad') b.bad++;
  b.ev = EV_LAND;
  b.evKind = kind;
  b.evAngle = ang;
  b.evAirTime = b.airT;
  b.evFlight = b.x - b.fx;
}
