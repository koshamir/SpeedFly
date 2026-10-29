import { CONFIG } from '../config';
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

  constructor(
    readonly seed: number,
    readonly mode: TerrainMode,
  ) {
    addPreroll(this.terrain);
    if (mode === 'reference') {
      this.islands.push(referenceIsland());
      this.terrain.setGen(new ReferenceGen(seed));
    } else this.terrain.setGen(new IslandGen(seed, this.islands, this.coins));
    this.update(0);
  }

  /** Streaming: keep key points ahead, drop them (and coins) far behind. */
  update(x: number): void {
    const C = CONFIG.terrain;
    this.terrain.ensure(x + C.aheadScreens * C.screenWorld);
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
