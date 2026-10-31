import { CONFIG } from '../config';
import type { GameEvents } from '../core/events';
import type { Island } from '../world/islands';
import type { TerrainCursor } from '../world/terrain';

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
const ease = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
const smoother = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10));

/** Critically damped spring, exact step. st = [value, velocity]. */
function spring(st: number[], target: number, w: number, dt: number): number {
  const ex = Math.exp(-w * dt), ch = st[0] - target, tmp = (st[1] + w * ch) * dt;
  st[1] = (st[1] - w * tmp) * ex;
  st[0] = target + (ch + tmp) * ex;
  return st[0];
}

const FLIGHT_OFF = 0, FLIGHT_ON = 1, FLIGHT_RETURN = 2;

// Portrait camera (SPEC §6): speed-adaptive X anchor and zoom, ground reference at 30% height,
// altitude zoom so the bird never leaves the frame. v2: every channel is a critically damped
// spring (velocity stays continuous when a target jumps: v1's first-order easing jerked the view
// at every landing/takeoff); X follows with velocity feed-forward so landings don't kink the scroll.
// Island jump: a "flight shot" framing the whole arc (launch, apex, landing target) is blended in on
// islandLaunch and out on islandLand. The normal rig keeps running underneath, so the return lands on
// a camera that already tracks the bird (smootherstep blend in log zoom: no jumps, no velocity kinks).
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
  /** 0..1: how much of the flight shot is on screen (FX / glare / audio follow it). */
  cine = 0;
  private shakeAmp = 0;
  private shakeT = 0;
  // normal rig output
  private nz = 1;
  private ncx = 0;
  private ncy = 0;
  private readonly zs = [0, 0]; // log zoom
  private readonly ys = [0, 0];
  private readonly rs = [0, 0];
  private readonly xs = [0, 0];
  private lastX = 0;
  private lastVT = 0;
  private aIdx = 0;
  private lzCap = 0;
  // flight shot
  private mode = FLIGHT_OFF;
  private modeT = 0;
  private fSnap = false;
  private readonly fl = { x: 0, y: 0, tx: 0, ty: 0, ax: 0, ay: 0, D: 1, offX: 0, offY: 0, haveOff: false };
  private readonly fz = [0, 0];
  private readonly fx = [0, 0];
  private readonly fy = [0, 0];

  shake(amp: number): void {
    if (amp >= this.shakeAmp * (1 - this.shakeT / CONFIG.camera.shakeDecay)) {
      this.shakeAmp = amp;
      this.shakeT = 0;
    }
  }

  /** islandLaunch: start blending in the flight shot. */
  flightStart(e: GameEvents['islandLaunch']): void {
    const f = this.fl;
    f.x = e.x;
    f.y = e.y;
    f.tx = e.targetX;
    f.ty = e.targetY;
    f.ax = e.apexX;
    f.ay = e.apexY;
    f.D = Math.max(1, e.targetX - e.x);
    f.haveOff = false;
    if (this.mode === FLIGHT_OFF) this.fSnap = true;
    this.mode = FLIGHT_ON;
    this.modeT = 0;
  }

  /** islandLand: hand the view back to the normal rig. */
  flightEnd(): void {
    if (this.mode !== FLIGHT_ON) return;
    // keep the blend continuous if the flight shot was still fading in
    const m = smoother(this.modeT / CONFIG.camera.flightIn);
    this.mode = FLIGHT_RETURN;
    this.modeT = (1 - m) * CONFIG.camera.flightOut;
    this.fl.haveOff = false;
  }

  /** Restart / new run: no flight shot. */
  resetFlight(): void {
    this.mode = FLIGHT_OFF;
    this.cine = 0;
  }

  /** snap = no smoothing (first frame / restart). */
  update(dt: number, bx: number, by: number, speed: number, vx: number, cur: TerrainCursor, logW: number, logH: number, snap: boolean, islands?: readonly Island[]): void {
    const C = CONFIG.camera;
    if (snap) this.resetFlight();
    const aT = C.anchorSlow + (C.anchorFast - C.anchorSlow) * clamp((speed - C.anchorVSlow) / (C.anchorVFast - C.anchorVSlow), 0, 1);
    this.anchor = snap ? aT : this.anchor + (aT - this.anchor) * ease(C.anchorRate, dt);

    const zSpeed = clamp(((1 - this.anchor) * logW) / Math.max(C.minLookPx, vx * C.lookAhead), C.zMin, C.zMax);
    // reference ground: min of h over [x - back, x + 0.6 width], spring-smoothed
    const w = logW / this.nz;
    let yRef = Infinity;
    for (let x = bx - C.refBack, x1 = bx + C.refAhead * w; x <= x1; x += C.refStep) yRef = Math.min(yRef, cur.height(x));
    if (snap) {
      this.rs[0] = yRef;
      this.rs[1] = 0;
    } else yRef = spring(this.rs, yRef, C.wRef, dt);
    this.yRef = yRef;
    const zAlt = (C.altFrac * logH) / Math.max(1, by - yRef + C.altMargin);
    let zT = clamp(Math.min(zSpeed, zAlt), C.zFloor, C.zMax);
    if (islands) zT = this.approach(bx, zT, islands, logW, snap ? 1e9 : dt);
    if (snap) {
      this.zs[0] = Math.log(zT);
      this.zs[1] = 0;
    } else spring(this.zs, Math.log(zT), zT < this.nz ? C.wZoomOut : C.wZoomIn, dt);
    this.nz = Math.exp(this.zs[0]);

    const nW = logW / this.nz, nH = logH / this.nz;
    const yTarget = yRef + (0.5 - C.refFromBottom) * nH;
    if (snap) {
      this.ys[0] = yTarget;
      this.ys[1] = 0;
    } else spring(this.ys, yTarget, C.wY, dt);
    this.ncy = this.ys[0];
    // hard guard: keep the bird inside the top of the frame
    const top = this.ncy + nH / 2 - C.topMargin / this.nz;
    if (by > top) {
      this.ncy += by - top;
      this.ys[0] = this.ncy;
    }

    // X: track the anchored target with velocity feed-forward (no lag at constant speed).
    // State = error to the target (xs = [e, de/dt]). A change of the target's velocity kicks de/dt;
    // an exact critically damped spring pulls e back to 0 -> stable for any frame dt.
    const xT = bx + (0.5 - this.anchor) * nW;
    const vT = dt > 0 && !snap ? (xT - this.lastX) / dt : 0;
    if (snap || C.wX <= 0 || dt <= 0) {
      this.xs[0] = 0;
      this.xs[1] = 0;
    } else {
      this.xs[1] -= vT - this.lastVT;
      spring(this.xs, 0, C.wX, dt);
      const lim = 0.25 * nW; // safety: the bird never leaves the frame
      if (this.xs[0] > lim) this.xs[0] = lim;
      else if (this.xs[0] < -lim) this.xs[0] = -lim;
    }
    this.lastX = xT;
    this.lastVT = vT;
    this.ncx = xT + this.xs[0];

    // flight shot blended over the normal rig
    let m = 0;
    if (this.mode !== FLIGHT_OFF) {
      this.modeT += dt;
      if (this.mode === FLIGHT_ON) m = smoother(this.modeT / C.flightIn);
      else {
        m = 1 - smoother(this.modeT / C.flightOut);
        if (m <= 0) this.mode = FLIGHT_OFF;
      }
      if (this.mode !== FLIGHT_OFF) this.flightFrame(dt, bx, by, logW, logH);
    }
    this.cine = m;
    let lz = Math.log(this.nz);
    let cx = this.ncx, cy = this.ncy;
    if (m > 0) {
      lz += (this.fz[0] - lz) * m;
      cx += (this.fx[0] - cx) * m;
      cy += (this.fy[0] - cy) * m;
    }
    this.z = Math.exp(lz);
    this.viewW = logW / this.z;
    this.viewH = logH / this.z;
    if (m > 0) {
      // safety while blending: the bird stays inside the frame
      const ex = C.flightEdge * this.viewW, ey = C.flightEdge * this.viewH;
      cx = clamp(cx, bx - this.viewW / 2 + ex, bx + this.viewW / 2 - ex);
      cy = clamp(cy, by - this.viewH / 2 + ey, by + this.viewH / 2 - Math.max(ey, C.topMargin / this.z));
    }
    this.cx = cx;
    this.cy = cy;
    const cap = C.birdScaleMax + (C.flightBirdScale - C.birdScaleMax) * m;
    this.birdScale = clamp(1 / Math.sqrt(this.z), 1, cap);

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

  /**
   * Island end: from approachDx before the launch zone the normal zoom eases (by position) toward a wide
   * view, so the launch's flight shot only has a small step left (camera guards: zoom rate, jerk).
   * Released again over the jump itself (the flight shot covers it).
   */
  private approach(bx: number, zT: number, L: readonly Island[], logW: number, dt: number): number {
    const C = CONFIG.camera;
    let i = Math.min(this.aIdx, L.length - 1);
    while (i > 0 && bx < L[i - 1].landingX) i--;
    while (i < L.length - 1 && bx >= L[i].landingX) i++;
    this.aIdx = i;
    const isl = L[i];
    let lc = 0; // ln of the approach cap (0 = zoom 1 = no cap)
    const x1 = isl.launchX0; // fully wide where the flight script arms (upper ramp)
    if (Number.isFinite(isl.lipX) && bx >= x1 - C.approachDx && bx < isl.targetX) {
      const D = Math.max(1, isl.targetX - isl.lipX);
      const zA = clamp((logW / (D * (1 + C.flightMarginL + C.flightMarginR))) * C.approachK, C.flightZMin, C.zMax);
      // in over the approach, back out over the jump (hidden by the flight shot): at the touchdown the
      // normal rig is at its own zoom again and the hand-over is a pan
      const t = bx < x1 ? clamp((bx - (x1 - C.approachDx)) / C.approachDx, 0, 1) : clamp((isl.targetX - bx) / (isl.targetX - x1), 0, 1);
      lc = Math.log(zA) * t * t * (3 - 2 * t); // smoothstep
    }
    // widening is rate-limited in time (a slow bird has far more zoom to lose than a fast one)
    this.lzCap = lc < this.lzCap ? Math.max(lc, this.lzCap - C.approachRate * dt) : lc;
    return Math.min(zT, Math.exp(this.lzCap));
  }


  /**
   * Flight framing: the box from the bird to the landing target (plus the apex while climbing), the
   * sea at the bottom. It shrinks as the bird travels -> wide at the launch, closing in on the landing.
   * After the touchdown the framing rides with the bird (spring: no velocity kink) while the blend hands over.
   */
  private flightFrame(dt: number, bx: number, by: number, logW: number, logH: number): void {
    const C = CONFIG.camera, f = this.fl;
    let lzT: number, cxT: number, cyT: number;
    if (this.mode === FLIGHT_ON) {
      const xLo = Math.min(bx, f.tx) - C.flightMarginL * f.D;
      const xHi = Math.max(bx, f.tx) + C.flightMarginR * f.D;
      const sea = CONFIG.islands.waterY;
      const yLo = Math.min(f.ty, sea, by) - C.flightMarginBottom;
      const yHi = (bx < f.ax ? Math.max(f.ay, by) : Math.max(by, f.ty)) + C.flightMarginTop;
      const z = clamp(Math.min(logW / (xHi - xLo), logH / (yHi - yLo)), C.flightZMin, Math.max(C.flightZMin, this.nz));
      const vH = logH / z;
      lzT = Math.log(z);
      cxT = (xLo + xHi) / 2;
      cyT = Math.max(yLo + (0.5 - C.flightGround) * vH, yHi - vH / 2);
      // the last stretch settles into the normal gameplay framing: the touchdown hand-over is ~a no-op
      const t = clamp((bx - (f.tx - C.flightSettle * f.D)) / (C.flightSettle * f.D), 0, 1), g = t * t * (3 - 2 * t);
      lzT += (Math.log(this.nz) - lzT) * g;
      cxT += (this.ncx - cxT) * g;
      cyT += (this.ncy - cyT) * g;
    } else {
      if (!f.haveOff) {
        f.offX = this.fx[0] - bx;
        f.offY = this.fy[0] - by;
        f.haveOff = true;
      }
      // the zoom converges on the normal rig's: the hand-over is then (almost) a pure pan
      lzT = Math.log(this.nz);
      cxT = bx + f.offX;
      cyT = by + f.offY;
    }
    if (this.fSnap) {
      this.fSnap = false;
      this.fz[0] = lzT;
      this.fx[0] = cxT;
      this.fy[0] = cyT;
      this.fz[1] = this.fx[1] = this.fy[1] = 0;
    } else {
      spring(this.fz, lzT, C.flightW, dt);
      spring(this.fx, cxT, C.flightW, dt);
      spring(this.fy, cyT, C.flightW, dt);
    }
  }
}
