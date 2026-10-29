import { CONFIG } from '../config';

export const COIN_GOLD = 0;
export const COIN_BLUE = 1;

// Coins sorted by x (generated together with the terrain), streamed and trimmed like key points.
export class Coins {
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly type: Uint8Array;
  readonly alive: Uint8Array;
  readonly arc: Int32Array; // chain id (pitch rises within a chain)
  n = 0;
  base = 0; // global index of slot 0

  constructor(cap = CONFIG.coins.capacity) {
    this.x = new Float64Array(cap);
    this.y = new Float64Array(cap);
    this.type = new Uint8Array(cap);
    this.alive = new Uint8Array(cap);
    this.arc = new Int32Array(cap);
  }

  push(x: number, y: number, type: number, arc: number): void {
    if (this.n === this.x.length) return; // streaming keeps us far below capacity
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.type[i] = type;
    this.alive[i] = 1;
    this.arc[i] = arc;
  }

  trim(x: number): void {
    let k = 0;
    while (k < this.n && this.x[k] < x) k++;
    if (k === 0) return;
    this.x.copyWithin(0, k, this.n);
    this.y.copyWithin(0, k, this.n);
    this.type.copyWithin(0, k, this.n);
    this.alive.copyWithin(0, k, this.n);
    this.arc.copyWithin(0, k, this.n);
    this.n -= k;
    this.base += k;
  }
}
