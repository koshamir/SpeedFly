import { CONFIG } from '../config';
import { mulberry32, type Rng } from '../core/rng';

// Height function y = h(x): key points with cosine interpolation between them
// (y = y0 + A(1 - cos(pi t)), slope 0 at key points). Streams key points ahead, drops them behind.

export interface TerrainGen {
  /** Append at least one key point. */
  extend(t: Terrain): void;
}

export class Terrain {
  kx = new Float64Array(1024);
  ky = new Float64Array(1024);
  n = 0;
  /** Global index of kx[0] (points dropped so far). */
  base = 0;
  // water spans [wx0, wx1]: contact below the water surface (sorted, disjoint)
  readonly wx0: number[] = [];
  readonly wx1: number[] = [];
  private wFirst = 0;
  private gen: TerrainGen | null = null;

  setGen(gen: TerrainGen): void {
    this.gen = gen;
  }

  push(x: number, y: number): void {
    if (this.n === this.kx.length) {
      const kx = new Float64Array(this.n * 2);
      const ky = new Float64Array(this.n * 2);
      kx.set(this.kx);
      ky.set(this.ky);
      this.kx = kx;
      this.ky = ky;
    }
    this.kx[this.n] = x;
    this.ky[this.n] = y;
    this.n++;
  }

  get lastX(): number {
    return this.kx[this.n - 1];
  }

  get lastY(): number {
    return this.ky[this.n - 1];
  }

  /** Generate until the last key point is beyond x. */
  ensure(x: number): void {
    while (this.n < 2 || this.kx[this.n - 1] <= x) this.gen!.extend(this);
  }

  /** Drop key points entirely behind x (batched compaction, cursors re-sync via base). */
  trim(x: number): void {
    let k = 0;
    while (k < this.n - 3 && this.kx[k + 1] < x) k++;
    if (k >= CONFIG.terrain.trimBatch) {
      this.kx.copyWithin(0, k, this.n);
      this.ky.copyWithin(0, k, this.n);
      this.n -= k;
      this.base += k;
    }
    while (this.wFirst < this.wx1.length && this.wx1[this.wFirst] < x) this.wFirst++;
  }

  addWater(x0: number, x1: number): void {
    this.wx0.push(x0);
    this.wx1.push(x1);
  }

  isWater(x: number): boolean {
    const wx0 = this.wx0;
    for (let i = this.wFirst; i < wx0.length; i++) {
      if (x < wx0[i]) return false;
      if (x <= this.wx1[i]) return true;
    }
    return false;
  }

  cursor(): TerrainCursor {
    return new TerrainCursor(this);
  }
}

/** Sampler with its own cached segment index (monotonic queries are O(1)). */
export class TerrainCursor {
  y = 0;
  d1 = 0;
  d2 = 0;
  private gi = 0;

  constructor(private readonly t: Terrain) {}

  sample(x: number): void {
    const T = this.t;
    if (x >= T.kx[T.n - 1]) T.ensure(x);
    const kx = T.kx;
    const ky = T.ky;
    let i = this.gi - T.base;
    if (i < 0) i = 0;
    while (i > 0 && kx[i] > x) i--;
    while (i < T.n - 2 && kx[i + 1] <= x) i++;
    this.gi = i + T.base;
    const x0 = kx[i], w = kx[i + 1] - x0, y0 = ky[i], A = (ky[i + 1] - y0) / 2, k = Math.PI / w, t = (x - x0) * k;
    this.y = y0 + A * (1 - Math.cos(t));
    this.d1 = A * k * Math.sin(t);
    this.d2 = A * k * k * Math.cos(t);
  }

  height(x: number): number {
    this.sample(x);
    return this.y;
  }
}

/** Height on one cosine segment (generators place things before the cursor sees them). */
export function segY(x0: number, y0: number, x1: number, y1: number, x: number): number {
  const A = (y1 - y0) / 2;
  return y0 + A * (1 - Math.cos(((x - x0) * Math.PI) / (x1 - x0)));
}

export function segD1(x0: number, y0: number, x1: number, y1: number, x: number): number {
  const A = (y1 - y0) / 2;
  const k = Math.PI / (x1 - x0);
  return A * k * Math.sin((x - x0) * k);
}

/** x where a monotonic cosine segment crosses height ys. */
export function segCross(x0: number, y0: number, x1: number, y1: number, ys: number): number {
  const A = (y1 - y0) / 2;
  const c = Math.min(1, Math.max(-1, 1 - (ys - y0) / A));
  return x0 + (Math.acos(c) / Math.PI) * (x1 - x0);
}

/** dx widened so that |h'| <= maxSlope on a segment from y0 to y1 (max slope of a cosine seg = A*pi/w). */
export function widen(dx: number, y0: number, y1: number): number {
  const need = (Math.abs(y1 - y0) * Math.PI) / (2 * CONFIG.terrain.maxSlope);
  return dx < need ? need : dx;
}

export function addPreroll(t: Terrain): void {
  const C = CONFIG.terrain;
  t.push(-3 * C.prerollDx, C.nestY);
  t.push(-2 * C.prerollDx, C.prerollY);
  t.push(-C.prerollDx, C.prerollY);
  t.push(0, C.nestY); // the nest
}

/** Plain reference generator: genKeyPoints() of reference/physics-sim.mjs, streamed lazily. */
export class ReferenceGen implements TerrainGen {
  private readonly r: Rng;
  private i = 0;
  private x = 0;
  private valley = true;
  private lastValley = 0;

  constructor(seed: number) {
    this.r = mulberry32(seed);
  }

  extend(t: Terrain): void {
    const C = CONFIG.terrain;
    const r = this.r;
    const prog = Math.min(1, this.i / C.refRampPoints);
    const sx = 1 + C.refRampSx * prog, sy = 1 + C.refRampSy * prog;
    let dx = (C.dxMin + r() * (C.dxMax - C.dxMin)) * sx, y: number;
    if (this.valley) {
      y = -C.valleyJitter + r() * 2 * C.valleyJitter;
      this.lastValley = y;
    } else y = this.lastValley + dx * (C.hFracMin + r() * (C.hFracMax - C.hFracMin)) * sy;
    const need = (Math.abs(y - t.ky[t.n - 1]) * Math.PI) / (2 * C.maxSlope);
    if (dx < need) dx = need;
    this.x += dx;
    t.push(this.x, y);
    this.valley = !this.valley;
    this.i++;
  }
}
