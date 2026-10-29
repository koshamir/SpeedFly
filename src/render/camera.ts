import { CONFIG } from '../config';
import type { TerrainCursor } from '../world/terrain';

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
const ease = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

// Portrait camera (SPEC §6): speed-adaptive X anchor and zoom, ground reference at 30% height,
// altitude zoom so the bird never leaves the frame.
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
  private shakeAmp = 0;
  private shakeT = 0;
  private yTarget = 0;

  shake(amp: number): void {
    if (amp >= this.shakeAmp * (1 - this.shakeT / CONFIG.camera.shakeDecay)) {
      this.shakeAmp = amp;
      this.shakeT = 0;
    }
  }

  /** snap = no smoothing (first frame / restart). */
  update(dt: number, bx: number, by: number, speed: number, vx: number, cur: TerrainCursor, logW: number, logH: number, snap: boolean): void {
    const C = CONFIG.camera;
    const aT = C.anchorSlow + (C.anchorFast - C.anchorSlow) * clamp((speed - C.anchorVSlow) / (C.anchorVFast - C.anchorVSlow), 0, 1);
    this.anchor = snap ? aT : this.anchor + (aT - this.anchor) * ease(C.anchorRate, dt);

    const zSpeed = clamp(((1 - this.anchor) * logW) / Math.max(C.minLookPx, vx * C.lookAhead), C.zMin, C.zMax);
    // reference ground: min of h over [x - back, x + 0.6 width]
    const w = logW / this.z;
    let yRef = Infinity;
    for (let x = bx - C.refBack, x1 = bx + C.refAhead * w; x <= x1; x += C.refStep) yRef = Math.min(yRef, cur.height(x));
    this.yRef = yRef;
    const zAlt = (C.altFrac * logH) / Math.max(1, by - yRef + C.altMargin);
    const zT = clamp(Math.min(zSpeed, zAlt), C.zFloor, C.zMax);
    if (snap) this.z = zT;
    else this.z += (zT - this.z) * ease(zT < this.z ? C.zoomOutRate : C.zoomInRate, dt);

    this.viewW = logW / this.z;
    this.viewH = logH / this.z;
    this.yTarget = yRef + (0.5 - C.refFromBottom) * this.viewH;
    this.cy = snap ? this.yTarget : this.cy + (this.yTarget - this.cy) * ease(C.yRate, dt);
    // hard guard: keep the bird inside the top of the frame
    const top = this.cy + this.viewH / 2 - C.topMargin / this.z;
    if (by > top) this.cy += by - top;
    this.cx = bx + (0.5 - this.anchor) * this.viewW;
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
