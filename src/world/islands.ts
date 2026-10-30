import { CONFIG } from '../config';
import { mulberry32, type Rng } from '../core/rng';
import { COIN_BLUE, COIN_GOLD, type Coins } from './collectibles';
import { segCross, segD1, segY, widen, type Terrain, type TerrainGen } from './terrain';

export interface Island {
  k: number;
  x0: number; // palette range [x0, x1): switches mid-water
  x1: number;
  lipX: number;
  wx0: number; // water surface span
  wx1: number;
  landingX: number; // landing-hill peak: passing it fires island{k+1}
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

/** Gap from ballistics: launch from the lip at launchAngle with vT(k) under gRelease. */
export function islandGap(k: number): { vT: number; R: number; rise: number; water: number } {
  const I = CONFIG.islands;
  const vT = Math.min(I.vTBase + I.vTStep * (k - 1), I.vTMax);
  const a = (I.launchAngle * Math.PI) / 180;
  const vx = vT * Math.cos(a), vy = vT * Math.sin(a), g = CONFIG.physics.gRelease;
  const drop = I.lipY - (I.landingPeakY + I.landingAim);
  const t = (vy + Math.sqrt(vy * vy + 2 * g * drop)) / g; // descending crossing
  const R = vx * t;
  const rise = Math.max(I.riseMin, I.riseFrac * (R - I.cliffDx));
  const water = Math.max(I.waterMin, R - I.cliffDx - rise);
  return { vT, R, rise, water };
}

/** Whole-world island for ?terrain=reference (palette only). */
export function referenceIsland(): Island {
  return {
    k: 1, x0: -Infinity, x1: Infinity, lipX: Infinity, wx0: Infinity, wx1: Infinity, landingX: Infinity,
    surfaceY: 0, palette: 0, bandMode: 0, bandWidth: CONFIG.islands.bandWidthMin, bandSeed: 0,
  };
}

// Island k = N hills, then launch valley -> ramp -> lip -> cliff -> water -> landing hill.
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
    this.hills = s.hills;
    this.sx = s.sx;
    this.sy = s.sy;
    this.hill = 0;
    this.island = {
      k: this.k, x0, x1: Infinity, lipX: Infinity, wx0: Infinity, wx1: Infinity, landingX: Infinity,
      surfaceY: I.waterY + I.waterSurface,
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

  /** One hill = a valley then the next peak (key points), cosine-interpolated by the terrain. */
  private addHill(t: Terrain): void {
    const Hc = CONFIG.hills, I = CONFIG.islands, r = this.r;
    const px = t.lastX, py = t.lastY;
    const onboard = this.k === 1 && this.hill < I.onboardHills;
    // fixed number of draws per hill: the stream stays aligned whatever the branches/mode
    const rDeep = r(), rWide = r(), rW1 = r(), rW2 = r(), rD = r(), rP = r();
    const prevSpecial = this.lastSpecial && Hc.noRepeat > 0;
    const deep = !onboard && !prevSpecial && rDeep < Hc.deepChance;
    const wide = !onboard && !prevSpecial && !deep && rWide < Hc.wideChance;
    this.lastSpecial = deep || wide;
    const prog = this.hills > 1 ? this.hill / (this.hills - 1) : 0;
    const grow = Hc.growFrom + (Hc.growTo - Hc.growFrom) * prog;
    const jit = (z: number, a: number): number => 1 + a * (2 * z - 1);
    const hw = Hc.halfW * this.sx * (wide ? Hc.wideMul : 1);
    const w1 = hw * jit(rW1, Hc.halfWJitter);
    const w2 = Hc.symmetric > 0 ? w1 : hw * jit(rW2, Hc.halfWJitter);
    let vy: number, ny: number;
    if (Hc.mode === 1) {
      // zigzag (haqu): down by dy from the previous point, then up by an independent dy; clamped
      const dyS = this.sy * grow * (onboard ? I.onboardH : 1);
      vy = Math.max(Hc.zzMinY, py - (Hc.zzMinDY + rD * Hc.zzRangeDY) * dyS);
      ny = Math.min(Hc.zzMaxY, vy + (Hc.zzMinDY + rP * Hc.zzRangeDY) * dyS);
    } else {
      // peaks: level peaks, each valley its own depth below them
      const depth = Hc.depth * this.sy * grow * (deep ? Hc.deepMul : 1) * (onboard ? I.onboardH : 1) * jit(rD, Hc.depthJitter);
      ny = Hc.peakY + Hc.peakJitter * (2 * rP - 1);
      vy = Math.min(py, ny) - depth;
    }
    const vx = px + widen(w1, py, vy);
    t.push(vx, vy);
    this.downslopeCoins(px, py, vx, vy);
    this.blueCoin(vx, vy);
    t.push(vx + widen(w2, vy, ny), ny);
    this.hill++;
    this.totalHills++;
  }

  private addEnd(t: Terrain): void {
    const I = CONFIG.islands;
    const px = t.lastX, py = t.lastY;
    const lvx = px + widen(I.launchValleyDx, py, I.launchValleyY);
    t.push(lvx, I.launchValleyY);
    const lipX = lvx + I.rampDx;
    t.push(lipX, I.lipY);
    const w0 = lipX + I.cliffDx;
    t.push(w0, I.waterY);
    const gap = islandGap(this.k);
    const w1 = w0 + gap.water;
    t.push(w1, I.waterY);
    const landX = w1 + gap.rise;
    t.push(landX, I.landingPeakY);

    const isl = this.island;
    isl.lipX = lipX;
    isl.wx0 = segCross(lipX, I.lipY, w0, I.waterY, isl.surfaceY);
    isl.wx1 = segCross(w1, I.waterY, landX, I.landingPeakY, isl.surfaceY);
    isl.landingX = landX;
    isl.x1 = (isl.wx0 + isl.wx1) / 2;
    t.addWater(isl.wx0, isl.wx1);
    this.launchCoins(px, py, lvx, lipX);
    this.begin(isl.x1);
  }

  private coinAt(x0: number, y0: number, x1: number, y1: number, x: number, lift: number, arc: number): void {
    const y = segY(x0, y0, x1, y1, x), d1 = segD1(x0, y0, x1, y1, x), L = Math.hypot(1, d1);
    this.coins.push(x - (d1 / L) * lift, y + lift / L, COIN_GOLD, arc);
  }

  /** Gold arc along a downslope (peak -> valley). */
  private downslopeCoins(px: number, py: number, vx: number, vy: number): void {
    const K = CONFIG.coins, rc = this.rc;
    if (rc() >= K.hillChance) return;
    const n = K.arcMin + Math.floor(rc() * (K.arcMax - K.arcMin + 1));
    const id = this.arcId++;
    for (let i = 0; i < n; i++) {
      const x = px + (vx - px) * (K.arcT0 + ((K.arcT1 - K.arcT0) * i) / (n - 1));
      this.coinAt(px, py, vx, vy, x, K.lift, id);
    }
  }

  /** Long arc: mid-descent into the launch valley, over the valley and up the ramp. */
  private launchCoins(px: number, py: number, lvx: number, lipX: number): void {
    const K = CONFIG.coins, I = CONFIG.islands, rc = this.rc;
    const n = K.launchMin + Math.floor(rc() * (K.launchMax - K.launchMin + 1));
    const id = this.arcId++;
    const xa = px + (lvx - px) * K.launchT0, xb = lvx + (lipX - lvx) * K.launchT1;
    for (let i = 0; i < n; i++) {
      const x = xa + ((xb - xa) * i) / (n - 1);
      if (x < lvx) this.coinAt(px, py, lvx, I.launchValleyY, x, K.lift, id);
      else this.coinAt(lvx, I.launchValleyY, lipX, I.lipY, x, K.lift, id);
    }
  }

  private blueCoin(vx: number, vy: number): void {
    const K = CONFIG.coins;
    if (this.totalHills < K.blueSkipHills || this.rc() >= K.blueChance) return;
    this.coins.push(vx, vy + K.blueLift, COIN_BLUE, this.arcId++);
  }
}
