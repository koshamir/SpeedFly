import { CONFIG } from '../config';
import type { Island } from '../world/islands';
import type { TerrainCursor } from '../world/terrain';

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
const ease = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
const sstep = (t: number): number => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};

/** Critically damped spring, exact step. st = [value, velocity]. */
function spring(st: number[], target: number, w: number, dt: number): number {
  const ex = Math.exp(-w * dt), ch = st[0] - target, tmp = (st[1] + w * ch) * dt;
  st[1] = (st[1] - w * tmp) * ex;
  st[0] = target + (ch + tmp) * ex;
  return st[0];
}

// Portrait camera (SPEC §6): speed-adaptive X anchor and zoom, ground reference at 30% height,
// altitude zoom so the bird never leaves the frame. v2: every channel is a critically damped
// spring (velocity stays continuous when a target jumps: v1's first-order easing jerked the view
// at every landing/takeoff); X follows with velocity feed-forward so landings don't kink the scroll.
// Island end (by the bird's position, so it is smooth and deterministic): the view zooms IN on the
// mountain descent, follows the bird (zoom flightZoom, bird near the centre) from the ramp through the
// flight, and blends back to the normal framing after the landing. Targets only — the springs smooth them.
export class CameraRig {
  z = 1;
  cx = 0;
  cy = 0;
  viewW = 720;
  viewH = 1280;
  anchor = CONFIG.camera.anchorSlow;
  yRef = 0;
  birdScale = 1;
  shakeX = 0;
  shakeY = 0;
  /** 0..1: bird-focus share (ramp + island flight); FX / glare / audio follow it. */
  cine = 0;
  /** 0..1: mountain-descent zoom-in share (speed FX follow it). */
  descent = 0;
  private shakeAmp = 0;
  private shakeT = 0;
  private yTarget = 0;
  private readonly zs = [0, 0]; // log zoom
  private readonly ys = [0, 0];
  private readonly rs = [0, 0];
  private readonly xs = [0, 0];
  private lastX = 0;
  private lastVT = 0;
  private sIdx = 0;

  shake(amp: number): void {
    if (amp >= this.shakeAmp * (1 - this.shakeT / CONFIG.camera.shakeDecay)) {
      this.shakeAmp = amp;
      this.shakeT = 0;
    }
  }

  /** Island-end weights at the bird's x: descent zoom-in and bird focus. */
  private sequence(bx: number, L: readonly Island[]): void {
    const C = CONFIG.camera;
    let i = Math.min(this.sIdx, L.length - 1);
    while (i > 0 && bx < L[i - 1].targetX + C.focusOutDx) i--;
    while (i < L.length - 1 && bx >= L[i].targetX + C.focusOutDx) i++;
    this.sIdx = i;
    const isl = L[i];
    this.descent = this.cine = 0;
    if (!Number.isFinite(isl.valleyX) || bx < isl.summitX) return;
    if (bx < isl.lipX) this.descent = sstep((bx - isl.summitX) / ((isl.valleyX - isl.summitX) * C.descentZoomIn));
    const rampDx = isl.lipX - isl.valleyX;
    this.cine = bx < isl.targetX ? sstep((bx - isl.valleyX) / (rampDx * C.focusIn)) : 1 - sstep((bx - isl.targetX) / C.focusOutDx);
  }

  /** snap = no smoothing (first frame / restart). islands: island-end sequence framing. */
  update(dt: number, bx: number, by: number, speed: number, vx: number, cur: TerrainCursor, logW: number, logH: number, snap: boolean, islands?: readonly Island[]): void {
    const C = CONFIG.camera;
    if (islands) this.sequence(bx, islands);
    else this.descent = this.cine = 0;
    const aT = C.anchorSlow + (C.anchorFast - C.anchorSlow) * clamp((speed - C.anchorVSlow) / (C.anchorVFast - C.anchorVSlow), 0, 1);
    this.anchor = snap ? aT : this.anchor + (aT - this.anchor) * ease(C.anchorRate, dt);

    const zSpeed = clamp(((1 - this.anchor) * logW) / Math.max(C.minLookPx, vx * C.lookAhead), C.zMin, C.zMax);
    // reference ground: min of h over [x - back, x + 0.6 width], spring-smoothed
    const w = logW / this.z;
    let yRef = Infinity;
    for (let x = bx - C.refBack, x1 = bx + C.refAhead * w; x <= x1; x += C.refStep) yRef = Math.min(yRef, cur.height(x));
    if (snap) {
      this.rs[0] = yRef;
      this.rs[1] = 0;
    } else yRef = spring(this.rs, yRef, C.wRef, dt);
    this.yRef = yRef;
    const zAlt = (C.altFrac * logH) / Math.max(1, by - yRef + C.altMargin);
    // on the descent the deep valley ahead must not pull the view out: speed zoom only, around the bird
    let lz = Math.log(clamp(Math.min(zSpeed, zAlt), C.zFloor, C.zMax));
    lz += (Math.log(zSpeed) - lz) * this.descent;
    // island end: closer on the descent, then a fixed bird-focused zoom over the ramp and the flight
    lz += Math.log(C.descentZoom) * this.descent;
    lz += (Math.log(C.flightZoom) - lz) * this.cine;
    lz = Math.min(lz, Math.log(C.zMax));
    if (snap) {
      this.zs[0] = lz;
      this.zs[1] = 0;
    } else spring(this.zs, lz, lz < this.zs[0] ? C.wZoomOut : C.wZoomIn, dt);
    this.z = Math.exp(this.zs[0]);

    this.viewW = logW / this.z;
    this.viewH = logH / this.z;
    const yGround = yRef + (0.5 - C.refFromBottom) * this.viewH;
    this.yTarget = yGround + (by - C.flightBirdY * this.viewH - yGround) * Math.max(this.cine, this.descent);
    if (snap) {
      this.ys[0] = this.yTarget;
      this.ys[1] = 0;
    } else spring(this.ys, this.yTarget, C.wY, dt);
    this.cy = this.ys[0];
    // hard guards: keep the bird inside the top (and the bottom) of the frame
    const m = C.topMargin / this.z;
    if (by > this.cy + this.viewH / 2 - m) {
      this.cy = by - this.viewH / 2 + m;
      this.ys[0] = this.cy;
    } else if (by < this.cy - this.viewH / 2 + m) {
      this.cy = by + this.viewH / 2 - m;
      this.ys[0] = this.cy;
    }

    // X: track the anchored target with velocity feed-forward (no lag at constant speed).
    // State = error to the target (xs = [e, de/dt]). A change of the target's velocity kicks de/dt;
    // an exact critically damped spring pulls e back to 0 -> stable for any frame dt.
    const xT = bx + (0.5 - this.anchor) * this.viewW;
    const vT = dt > 0 && !snap ? (xT - this.lastX) / dt : 0;
    if (snap || C.wX <= 0 || dt <= 0) {
      this.xs[0] = 0;
      this.xs[1] = 0;
    } else {
      this.xs[1] -= vT - this.lastVT;
      spring(this.xs, 0, C.wX, dt);
      const lim = 0.25 * this.viewW; // safety: the bird never leaves the frame
      if (this.xs[0] > lim) this.xs[0] = lim;
      else if (this.xs[0] < -lim) this.xs[0] = -lim;
    }
    this.lastX = xT;
    this.lastVT = vT;
    this.cx = xT + this.xs[0];
    this.birdScale = clamp(1 / Math.sqrt(this.z), 1, C.birdScaleMax);

    // shake (screen px, linear decay)
    this.shakeT += dt;
    const k = 1 - this.shakeT / C.shakeDecay;
    if (k > 0 && this.shakeAmp > 0) {
      const a = (this.shakeAmp * k) / this.z;
      this.shakeX = (Math.random() * 2 - 1) * a;
      this.shakeY = (Math.random() * 2 - 1) * a;
    } else {
      this.shakeAmp = 0;
      this.shakeX = this.shakeY = 0;
    }
  }
}
