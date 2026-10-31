import { CONFIG, type TrackDef } from '../config';
import { Coins } from './collectibles';
import { IslandGen, referenceIsland, type Island } from './islands';
import { addPreroll, ReferenceGen, Terrain } from './terrain';

export type TerrainMode = 'islands' | 'reference';

/** Everything generated from the seed: terrain, islands, collectibles. */
export class World {
  readonly terrain = new Terrain();
  readonly coins = new Coins();
  readonly islands: Island[] = [];
  private islCursor = 0;
  private gen: IslandGen | null = null;

  constructor(
    readonly seed: number,
    readonly mode: TerrainMode,
    readonly track: TrackDef | null = null,
  ) {
    addPreroll(this.terrain);
    if (mode === 'reference') {
      this.islands.push(referenceIsland());
      this.terrain.setGen(new ReferenceGen(seed));
    } else this.terrain.setGen((this.gen = new IslandGen(seed, this.islands, this.coins, track)));
    this.update(0);
    // a race track is generated up to its finish at once (and never trimmed: rivals ride behind the camera)
    if (track) while (this.gen!.finishX === Infinity) this.terrain.ensure(this.terrain.lastX + 1);
  }

  /** Finish line x (race track), Infinity otherwise. */
  get finishX(): number {
    return this.gen ? this.gen.finishX : Infinity;
  }

  /** Streaming: keep key points ahead, drop them (and coins) far behind. */
  update(x: number): void {
    const C = CONFIG.terrain;
    this.terrain.ensure(x + C.aheadScreens * C.screenWorld);
    if (this.track) return;
    const behind = x - C.behindScreens * C.screenWorld;
    this.terrain.trim(behind);
    this.coins.trim(behind);
  }

  /** Island whose water gap [lipX, landingX] contains x, or null. */
  waterAt(x: number): Island | null {
    const L = this.islands;
    for (let i = L.length - 1; i >= 0; i--) {
      if (x > L[i].landingX) return null;
      if (x >= L[i].lipX) return L[i];
    }
    return null;
  }

  /** Visual bump height at x (mountain descents; render only — the physics surface stays smooth). */
  visualBump(x: number): number {
    const isl = this.islandAt(x), B = isl.bumps;
    if (!B.length || x < isl.summitX || x > isl.valleyX) return 0;
    const w = CONFIG.islands.bumpW;
    for (let i = 0; i < B.length; i++) {
      const t = (x - B[i]) / w + 0.5;
      if (t > 0 && t < 1) return CONFIG.islands.bumpH * 0.5 * (1 - Math.cos(2 * Math.PI * t));
    }
    return 0;
  }

  /** Island whose palette covers x (cached cursor; any query order works). */
  islandAt(x: number): Island {
    const L = this.islands;
    let i = Math.min(this.islCursor, L.length - 1);
    while (i > 0 && x < L[i].x0) i--;
    while (i < L.length - 1 && x >= L[i].x1) i++;
    this.islCursor = i;
    return L[i];
  }
}
