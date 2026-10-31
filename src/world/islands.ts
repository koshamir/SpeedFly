import { CONFIG } from '../config';
import { mulberry32, type Rng } from '../core/rng';
import { COIN_BLUE, COIN_GOLD, type Coins } from './collectibles';
import { segCross, segEval, segMaxSlope, type Terrain, type TerrainGen } from './terrain';

export interface Island {
  k: number;
  x0: number; // palette range [x0, x1): switches mid-water
  x1: number;
  lipX: number;
  wx0: number; // water surface span
  wx1: number;
  landingX: number; // landing-hill peak: passing it fires island{k+1}
  mtnX0: number; // mountain: foot of the climb, summit, bottom of the descent (launch valley)
  summitX: number;
  summitY: number;
  valleyX: number;
  bumps: number[]; // x of the visual bumps on the descent (render only)
  launchX0: number; // takeoffs in [launchX0, wx0] start the scripted island flight
  targetX: number; // where the island flight lands (on the landing slope)
  targetY: number;
  style: number; // index into CONFIG.islands.styles
  sharp: number; // segment sharpness of this island's hills
  hillK0: number; // global key-point index range [hillK0, hillK1) of the island's hills (valley, peak, ...)
  hillK1: number;
  surfaceY: number;
  palette: number;
  bandMode: number; // 0 strata, 1 diagonal
  bandWidth: number;
  bandSeed: number;
}

export function islandShape(k: number): { hills: number; sx: number; sy: number } {
  const I = CONFIG.islands;
  return {
    hills: Math.min(I.hillsBase + I.hillsStep * (k - 1), I.hillsMax),
    sx: Math.min(1 + I.sxStep * (k - 1), I.sxMax),
    sy: Math.min(1 + I.syStep * (k - 1), I.syMax),
  };
}

export function islandStyle(k: number): (typeof CONFIG.islands.styles)[number] {
  const S = CONFIG.islands.styles;
  return S[(k - 1) % S.length];
}

/** Horizontal flight distance of island k's scripted jump. */
export function flightDx(k: number): number {
  const I = CONFIG.islands;
  return Math.min(I.flightDx + I.flightDxStep * (k - 1), I.flightDxMax);
}

/** Whole-world island for ?terrain=reference (palette only). */
export function referenceIsland(): Island {
  return {
    k: 1, x0: -Infinity, x1: Infinity, lipX: Infinity, wx0: Infinity, wx1: Infinity, landingX: Infinity,
    mtnX0: Infinity, summitX: Infinity, summitY: 0, valleyX: Infinity, bumps: [],
    launchX0: Infinity, targetX: Infinity, targetY: 0, style: 0, sharp: 1,
    hillK0: Infinity, hillK1: Infinity, surfaceY: 0, palette: 0, bandMode: 0, bandWidth: CONFIG.islands.bandWidthMin, bandSeed: 0,
  };
}

// Island k = N hills, then a big descent with bumps -> launch valley -> ramp -> lip -> cliff -> sea -> landing hill.
// Separate RNG streams: r = terrain shape, rc = coins and looks.
export class IslandGen implements TerrainGen {
  private readonly r: Rng;
  private readonly rc: Rng;
  private readonly basePalette: number;
  private k = 0;
  private hill = 0;
  private hills = 0;
  private sx = 1;
  private sy = 1;
  private sharp = 1;
  private totalHills = 0;
  private arcId = 0;
  private lastSpecial = false;
  private island!: Island;

  constructor(
    seed: number,
    private readonly islands: Island[],
    private readonly coins: Coins,
  ) {
    this.r = mulberry32(seed);
    this.rc = mulberry32(seed ^ 0x2545f491);
    const P = CONFIG.islands.paletteCount;
    this.basePalette = ((seed % P) + P) % P;
    this.begin(-Infinity);
  }

  private begin(x0: number): void {
    const I = CONFIG.islands;
    this.k++;
    const s = islandShape(this.k);
    const st = islandStyle(this.k);
    this.hills = s.hills;
    this.sx = s.sx * st.w;
    this.sy = s.sy * st.h;
    this.sharp = st.sharp;
    this.hill = 0;
    this.island = {
      k: this.k, x0, x1: Infinity, lipX: Infinity, wx0: Infinity, wx1: Infinity, landingX: Infinity,
      mtnX0: Infinity, summitX: Infinity, summitY: 0, valleyX: Infinity, bumps: [],
      launchX0: Infinity, targetX: Infinity, targetY: 0, style: (this.k - 1) % I.styles.length, sharp: st.sharp,
      hillK0: Infinity, hillK1: Infinity,
      surfaceY: 0, // set with the island end (the sea lies below the lip)
      palette: (this.basePalette + this.k - 1) % I.paletteCount,
      bandMode: (this.k - 1) % 2,
      bandWidth: I.bandWidthMin + this.rc() * (I.bandWidthMax - I.bandWidthMin),
      bandSeed: this.rc() * Math.PI * 2,
    };
    this.islands.push(this.island);
  }

  extend(t: Terrain): void {
    if (this.hill < this.hills) this.addHill(t);
    else this.addEnd(t);
  }

  /** One hill = a valley then the next peak (key points), shaped segments between them. */
  private addHill(t: Terrain): void {
    const Hc = CONFIG.hills, I = CONFIG.islands, r = this.r, q = this.sharp;
    const px = t.lastX, py = t.lastY;
    if (this.hill === 0) this.island.hillK0 = t.base + t.n;
    const onboard = this.k === 1 && this.hill < I.onboardHills;
    // fixed number of draws per hill: the stream stays aligned whatever the branches/mode
    const rDeep = r(), rWide = r(), rW = r(), rH = r(), rP = r(), rZ = r();
    const prevSpecial = this.lastSpecial && Hc.noRepeat > 0;
    const deep = !onboard && !prevSpecial && rDeep < Hc.deepChance;
    const wide = !onboard && !prevSpecial && !deep && rWide < Hc.wideChance;
    this.lastSpecial = deep || wide;
    const prog = this.hills > 1 ? this.hill / (this.hills - 1) : 0;
    const grow = Hc.growFrom + (Hc.growTo - Hc.growFrom) * prog;
    const jit = (z: number, a: number): number => 1 + a * (2 * z - 1);
    // width: peak -> peak; the valley sits in the middle (symmetric bowl)
    const half = (Hc.width * this.sx * (wide ? Hc.wideMul : 1) * jit(rW, Hc.widthJitter)) / 2;
    let vy: number, ny: number;
    if (Hc.mode === 1) {
      // zigzag (haqu): down by dy from the previous point, then up by an independent dy; clamped
      const dyS = this.sy * grow * (onboard ? I.onboardH : 1);
      vy = Math.max(Hc.zzMinY, py - (Hc.zzMinDY + rH * Hc.zzRangeDY) * dyS);
      ny = Math.min(Hc.zzMaxY, vy + (Hc.zzMinDY + rZ * Hc.zzRangeDY) * dyS);
    } else {
      // peaks: level peaks, each valley its own drop below the lower neighbour peak
      ny = Hc.peakY + Hc.peakJitter * (2 * rP - 1);
      const h = Hc.height * this.sy * grow * (deep ? Hc.deepMul : 1) * (onboard ? I.onboardH : 1) * jit(rH, Hc.heightJitter);
      vy = Math.min(py, ny) - h;
    }
    // safety: never widen (that would couple height and width) — lower the valley instead
    const lim = Hc.slopeLimit;
    const maxDrop = (lim * half) / segMaxSlope(1, 1, q);
    if (Math.max(py, ny) - vy > maxDrop) vy = Math.max(py, ny) - maxDrop;
    const vx = px + half;
    t.push(vx, vy, q);
    this.downslopeCoins(px, py, vx, vy, q);
    this.blueCoin(vx, vy);
    t.push(vx + half, ny, q);
    this.hill++;
    this.totalHills++;
  }

  /**
   * Island end = a mountain: climb to the summit -> one long smooth descent (descentTime x descentSpeed;
   * gentle enough curvature that nothing throws the bird off it) -> launch valley -> tall ramp -> lip ->
   * cliff -> sea -> landing hill. The geometry after the lip is placed from the flight script's numbers.
   */
  private addEnd(t: Terrain): void {
    const I = CONFIG.islands, Hc = CONFIG.hills;
    const isl = this.island;
    isl.hillK1 = t.base + t.n;
    const x0 = t.lastX;
    isl.mtnX0 = x0;
    // climb to the summit
    const summitX = x0 + I.summitW, summitY = Hc.peakY + I.summitRise;
    t.push(summitX, summitY);
    // the long descent: one cosine segment (convex top: v^2 kappa stays far below g -> glued)
    const len = I.descentTime * I.descentSpeed;
    const lvx = summitX + len, valleyY = summitY - I.descentDrop;
    t.push(lvx, valleyY, I.descentSharp);
    const nb = Math.max(0, Math.round(I.bumps));
    isl.bumps = [];
    for (let i = 0; i < nb; i++) isl.bumps.push(summitX + len * (I.bumpFrom + ((I.bumpTo - I.bumpFrom) * (nb > 1 ? i / (nb - 1) : 0.5))));
    // ramp -> lip
    const lipY = valleyY + I.rampRise;
    const lipX = lvx + I.rampDx;
    t.push(lipX, lipY);
    // cliff -> sea (below the lip)
    isl.surfaceY = lipY - I.seaBelowLip;
    const seaY = isl.surfaceY - I.waterSurface;
    const w0 = lipX + I.cliffDx;
    t.push(w0, seaY);
    // landing slope: target at landAt of it, target = lip + flightDx
    const landPeakY = Hc.peakY + I.landPeakRise;
    const landValleyY = landPeakY - I.landDrop;
    const tx = lipX + flightDx(this.k);
    const xs = segCross(0, landPeakY, I.landW, landValleyY, landPeakY - I.landAt * (landPeakY - landValleyY));
    const landX = tx - xs;
    const w1 = Math.max(w0 + 200, landX - I.landRise);
    t.push(w1, seaY);
    t.push(landX, landPeakY);
    t.push(landX + I.landW, landValleyY);
    // a short rise back to the peak level: the next island's hills start from a peak
    t.push(landX + I.landW + Hc.width * 0.5, Hc.peakY);

    isl.summitX = summitX;
    isl.summitY = summitY;
    isl.valleyX = lvx;
    isl.lipX = lipX;
    isl.launchX0 = lvx + I.launchZone * I.rampDx;
    isl.targetX = landX + xs;
    isl.targetY = segEval(landX, landPeakY, landX + I.landW, landValleyY, 1, isl.targetX).y;
    isl.wx0 = segCross(lipX, lipY, w0, seaY, isl.surfaceY);
    isl.wx1 = segCross(w1, seaY, landX, landPeakY, isl.surfaceY);
    isl.landingX = landX;
    isl.x1 = (isl.wx0 + isl.wx1) / 2;
    t.addWater(isl.wx0, isl.wx1);
    this.launchCoins(lvx, valleyY, lipX, lipY);
    this.begin(isl.x1);
  }

  private coinAt(x0: number, y0: number, x1: number, y1: number, x: number, lift: number, arc: number, q = 1): void {
    const e = segEval(x0, y0, x1, y1, q, x), y = e.y, d1 = e.d1, L = Math.hypot(1, d1);
    this.coins.push(x - (d1 / L) * lift, y + lift / L, COIN_GOLD, arc);
  }

  /** Gold arc along a downslope (peak -> valley). */
  private downslopeCoins(px: number, py: number, vx: number, vy: number, q = 1): void {
    const K = CONFIG.coins, rc = this.rc;
    if (rc() >= K.hillChance) return;
    const n = K.arcMin + Math.floor(rc() * (K.arcMax - K.arcMin + 1));
    const id = this.arcId++;
    for (let i = 0; i < n; i++) {
      const x = px + (vx - px) * (K.arcT0 + ((K.arcT1 - K.arcT0) * i) / (n - 1));
      this.coinAt(px, py, vx, vy, x, K.lift, id, q);
    }
  }

  /** Long arc over the ramp (launch valley -> lip). */
  private launchCoins(lvx: number, lvy: number, lipX: number, lipY: number): void {
    const K = CONFIG.coins, rc = this.rc;
    const n = K.launchMin + Math.floor(rc() * (K.launchMax - K.launchMin + 1));
    const id = this.arcId++;
    const xa = lvx + (lipX - lvx) * 0.05, xb = lvx + (lipX - lvx) * K.launchT1;
    for (let i = 0; i < n; i++) this.coinAt(lvx, lvy, lipX, lipY, xa + ((xb - xa) * i) / (n - 1), K.lift, id);
  }

  private blueCoin(vx: number, vy: number): void {
    const K = CONFIG.coins;
    if (this.totalHills < K.blueSkipHills || this.rc() >= K.blueChance) return;
    this.coins.push(vx, vy + K.blueLift, COIN_BLUE, this.arcId++);
  }
}
