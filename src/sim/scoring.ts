import { CONFIG } from '../config';

// Score and run stats (Results breakdown). All points pass through add() with the Fever multiplier.
export class Scoring {
  total = 0;
  distPx = 0;
  greats = 0;
  landings = 0;
  bads = 0;
  splashes = 0;
  skyTouches = 0;
  coins = 0;
  blueCoins = 0;
  islands = 0;
  feverTime = 0;
  maxSpeed = 0;

  /** Returns the points actually awarded. */
  add(points: number, fever: boolean): number {
    const p = fever ? points * CONFIG.score.feverMul : points;
    this.total += p;
    return p;
  }

  /** Points for a landing (flight time + GREAT streak bonus), before the multiplier. */
  static landing(great: boolean, airTime: number, streak: number): number {
    const S = CONFIG.score;
    let p = 0;
    if (airTime >= S.flightMin) p += S.flightPerSec * airTime;
    if (great) p += Math.min(S.greatMax, S.greatBase + S.greatStep * (streak - 1));
    return p;
  }

  get meters(): number {
    return this.distPx / CONFIG.speed.pxPerMeter;
  }
}
