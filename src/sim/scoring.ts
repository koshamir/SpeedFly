import { CONFIG } from '../config';

// Score and run stats (Results breakdown). All points pass through add() with the Fever multiplier and
// are booked under one category; the Fever extra is booked separately so the breakdown sums to total.
export type ScoreCat = 'dist' | 'flight' | 'great' | 'sky' | 'coins' | 'island';
export const SCORE_CATS: ScoreCat[] = ['dist', 'flight', 'great', 'sky', 'coins', 'island'];

export class Scoring {
  total = 0;
  /** Points per category (before the Fever extra) + the Fever extra itself. */
  readonly by: Record<ScoreCat, number> = { dist: 0, flight: 0, great: 0, sky: 0, coins: 0, island: 0 };
  feverBonus = 0;
  distPx = 0;
  greats = 0;
  bestStreak = 0;
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
  add(points: number, fever: boolean, cat: ScoreCat): number {
    const p = fever ? points * CONFIG.score.feverMul : points;
    this.by[cat] += points;
    this.feverBonus += p - points;
    this.total += p;
    return p;
  }

  get meters(): number {
    return this.distPx / CONFIG.speed.pxPerMeter;
  }
}
