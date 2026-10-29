import { CONFIG } from '../config';
import { addPreroll, ReferenceGen, Terrain } from './terrain';

export type TerrainMode = 'islands' | 'reference';

/** Everything generated from the seed: terrain (+ islands and collectibles in islands mode). */
export class World {
  readonly terrain = new Terrain();

  constructor(
    readonly seed: number,
    readonly mode: TerrainMode,
  ) {
    addPreroll(this.terrain);
    this.terrain.setGen(new ReferenceGen(seed));
    this.update(0);
  }

  /** Streaming: keep key points ahead, drop them far behind. */
  update(x: number): void {
    const C = CONFIG.terrain;
    this.terrain.ensure(x + C.aheadScreens * C.screenWorld);
    this.terrain.trim(x - C.behindScreens * C.screenWorld);
  }
}
