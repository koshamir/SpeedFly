import type { PhysicsConfig } from '../config';
import type { LandKind } from '../core/events';
import type { Terrain, TerrainCursor } from '../world/terrain';

// 1:1 port of step() from reference/physics-sim.mjs (+ water from SPEC §3).
// The bird is a CONTACT POINT on y = h(x); the sprite is drawn at contact + normal * R.
// Do not "fix" anything here: tune CONFIG.physics instead.

export const EV_NONE = 0;
export const EV_TAKEOFF = 1;
export const EV_LAND = 2; // classified landing (event-worthy)
export const EV_HOP = 3; // micro-hop: no events

export class Bird {
  x = 0;
  y = 0;
  v = 0; // tangential ground speed
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
  // stats (reference runBot table)
  landings = 0;
  great = 0;
  bad = 0;
  angSum = 0;
  maxAlt = 0;
  airTime = 0;

  reset(cur: TerrainCursor, x: number, v: number): void {
    this.x = x;
    this.y = cur.height(x);
    this.v = v;
    this.vx = 0;
    this.vy = 0;
    this.grounded = true;
    this.airT = 0;
    this.airAlt = 0;
    this.streak = 0;
    this.fx = 0;
    this.N = 0;
    this.ev = EV_NONE;
    this.landings = this.great = this.bad = this.angSum = this.maxAlt = this.airTime = 0;
  }

  /** Physics state copy (planner scratch birds). */
  copyFrom(o: Bird): void {
    this.x = o.x;
    this.y = o.y;
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

/** One fixed step. `held` = finger down. Result event in b.ev. */
export function step(b: Bird, held: boolean, H: TerrainCursor, T: Terrain, C: PhysicsConfig): void {
  b.ev = EV_NONE;
  const g = held ? C.gDive : C.gRelease, dt = C.dt;
  if (b.grounded) {
    H.sample(b.x);
    const d1 = H.d1, d2 = H.d2;
    const L = Math.hypot(1, d1), tx = 1 / L, ty = d1 / L; // unit tangent (tx = cos theta)
    const kappa = d2 / (L * L * L); // signed curvature (+ = valley)
    let v = b.v;
    const N = g * tx + v * v * kappa; // normal accel the ground must supply
    b.N = N;
    if (N < 0) {
      // ground falls away faster than gravity bends us
      b.grounded = false;
      b.vx = v * tx;
      b.vy = v * ty;
      b.airT = 0;
      b.airAlt = 0;
      b.fx = b.x;
      b.ev = EV_TAKEOFF;
      return;
    }
    const water = T.isWater(b.x);
    v += (-g * ty - C.drag * v * Math.abs(v) - (water ? C.muWater : C.muGround) * N) * dt;
    const sMin = water ? C.sMinWater : C.sMin;
    if (v < sMin) v = sMin;
    b.x += v * tx * dt;
    b.y = H.height(b.x);
    b.v = v;
  } else {
    const sp = Math.hypot(b.vx, b.vy);
    b.vx -= C.drag * b.vx * sp * dt;
    b.vy -= (g + C.drag * b.vy * sp) * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    H.sample(b.x);
    const hy = H.y, d1 = H.d1;
    b.airT += dt;
    b.airAlt = Math.max(b.airAlt, b.y - hy);
    b.airTime += dt;
    b.maxAlt = Math.max(b.maxAlt, b.y - hy);
    if (b.y <= hy) {
      // touchdown: drop the normal component (inelastic)
      const L = Math.hypot(1, d1), tx = 1 / L, ty = d1 / L;
      let vt = b.vx * tx + b.vy * ty;
      const vn = -b.vx * ty + b.vy * tx;
      const ang = (Math.atan2(Math.abs(vn), vt) * 180) / Math.PI;
      b.y = hy;
      b.grounded = true;
      const water = T.isWater(b.x);
      if (b.airT < C.hopMinAir && b.airAlt < C.hopMinAlt) {
        b.v = Math.max(water ? C.sMinWater : C.sMin, vt); // micro-hop
        b.ev = EV_HOP;
        return;
      }
      let kind: LandKind = 'ok';
      if (water) {
        kind = 'splash';
        b.streak = 0;
        b.v = Math.max(C.sMinWater, vt);
      } else {
        const downhill = d1 <= C.greatSlope;
        if (downhill && ang <= 2 * C.greatAngle)
          vt = Math.max(vt, sp * Math.cos((ang * (1 - C.landingAssist) * Math.PI) / 180));
        if (downhill && ang <= C.greatAngle) {
          kind = 'great';
          vt *= C.greatBoost;
          b.streak++;
        } else {
          b.streak = 0;
          if (ang > C.okAngle || (!downhill && ang > C.greatAngle)) kind = 'bad';
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
  }
}
