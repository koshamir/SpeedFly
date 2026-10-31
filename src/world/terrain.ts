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
  /** Shape of the segment that STARTS at key point i (1 = plain cosine; >1 = sharper peak, flatter valley). */
  kq = new Float64Array(1024);
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

  push(x: number, y: number, q = 1): void {
    if (this.n === this.kx.length) {
      const kx = new Float64Array(this.n * 2);
      const ky = new Float64Array(this.n * 2);
      const kq = new Float64Array(this.n * 2);
      kx.set(this.kx);
      ky.set(this.ky);
      kq.set(this.kq);
      this.kx = kx;
      this.ky = ky;
      this.kq = kq;
    }
    this.kx[this.n] = x;
    this.ky[this.n] = y;
    this.kq[this.n] = 1;
    if (this.n > 0) this.kq[this.n - 1] = q; // the shape belongs to the segment that ends here
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
      this.kq.copyWithin(0, k, this.n);
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
    segEval(kx[i], ky[i], kx[i + 1], ky[i + 1], T.kq[i], x, this);
  }

  height(x: number): number {
    this.sample(x);
    return this.y;
  }
}

// Segment shape. Plain cosine: y = y0 + D (1 - cos(pi u)) / 2 with u = t (t = (x - x0) / w in [0, 1]).
// Sharpness q >= 1 warps u so the PEAK end of the segment gets steeper and rounder->pointier while the
// VALLEY end flattens: rising segment u = t^q, falling segment u = 1 - (1 - t)^q. Still C1 (slope 0
// at every key point); peak curvature x q^2, max slope ~x(0.6 + 0.4 q). q = 1 is the classic hill.
const segOut = { y: 0, d1: 0, d2: 0 };
export function segEval(x0: number, y0: number, x1: number, y1: number, q: number, x: number, out: { y: number; d1: number; d2: number } = segOut): { y: number; d1: number; d2: number } {
  const w = x1 - x0, D = y1 - y0;
  let t = (x - x0) / w;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  let u = t, u1 = 1, u2 = 0;
  if (q !== 1) {
    if (D >= 0) {
      // rising: peak at t = 1
      u = Math.pow(t, q);
      u1 = t > 0 ? q * Math.pow(t, q - 1) : 0;
      u2 = t > 1e-6 ? q * (q - 1) * Math.pow(t, q - 2) : 0;
    } else {
      // falling: peak at t = 0
      const s = 1 - t;
      u = 1 - Math.pow(s, q);
      u1 = s > 0 ? q * Math.pow(s, q - 1) : 0;
      u2 = s > 1e-6 ? -q * (q - 1) * Math.pow(s, q - 2) : 0;
    }
  }
  const pu = Math.PI * u, sn = Math.sin(pu), cs = Math.cos(pu);
  out.y = y0 + (D * (1 - cs)) / 2;
  out.d1 = ((D * Math.PI) / 2) * sn * (u1 / w);
  out.d2 = (D / (w * w)) * (((Math.PI * Math.PI) / 2) * cs * u1 * u1 + (Math.PI / 2) * sn * u2);
  return out;
}

/** Height on one segment (generators place things before the cursor sees them). */
export function segY(x0: number, y0: number, x1: number, y1: number, x: number, q = 1): number {
  return segEval(x0, y0, x1, y1, q, x).y;
}

export function segD1(x0: number, y0: number, x1: number, y1: number, x: number, q = 1): number {
  return segEval(x0, y0, x1, y1, q, x).d1;
}

/** x where a monotonic segment crosses height ys (bisection: works for any shape). */
export function segCross(x0: number, y0: number, x1: number, y1: number, ys: number, q = 1): number {
  let a = x0, b = x1;
  const up = y1 > y0;
  for (let i = 0; i < 40; i++) {
    const m = (a + b) / 2, y = segEval(x0, y0, x1, y1, q, m).y;
    if (y < ys === up) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** Max |slope| of a unit segment shape (|D| = 1, w = 1) for sharpness q, cached. */
const slopeCache = new Map<number, number>();
export function shapeSlope(q: number): number {
  let m = slopeCache.get(q);
  if (m === undefined) {
    m = 0;
    for (let i = 0; i <= 256; i++) m = Math.max(m, Math.abs(segEval(0, 0, 1, 1, q, i / 256).d1));
    slopeCache.set(q, m);
  }
  return m;
}

/** Max |slope| of a segment. */
export function segMaxSlope(dx: number, dy: number, q = 1): number {
  return (shapeSlope(q) * Math.abs(dy)) / dx;
}

/** dx widened so that |h'| <= maxSlope on a segment from y0 to y1 (max slope of a cosine seg = A*pi/w). */
export function widen(dx: number, y0: number, y1: number, maxSlope = CONFIG.terrain.maxSlope): number {
  const need = (Math.abs(y1 - y0) * Math.PI) / (2 * maxSlope);
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
