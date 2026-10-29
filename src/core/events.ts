// Typed event bus. The sim emits, render/audio/UI only subscribe.
// Payload objects are reused by the emitter: handlers must copy what they keep.

export type LandKind = 'great' | 'ok' | 'bad' | 'splash';
export type CoinType = 'gold' | 'blue';

export interface GameEvents {
  takeoff: { x: number; y: number; speed: number };
  land: { kind: LandKind; angle: number; airTime: number; streak: number; x: number; y: number; speed: number };
  feverStart: { streak: number };
  feverEnd: { duration: number };
  skyTouch: { x: number; y: number };
  coin: { type: CoinType; x: number; y: number; chain: number };
  island: { index: number };
  speedTier: { tier: number; prev: number };
  caught: { x: number };
  points: { amount: number; x: number; y: number };
}

type Handler<T> = (e: T) => void;

export class EventBus<M> {
  private readonly handlers: { [K in keyof M]?: Handler<M[K]>[] } = {};

  on<K extends keyof M>(type: K, fn: Handler<M[K]>): () => void {
    const list = (this.handlers[type] ??= []);
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  emit<K extends keyof M>(type: K, e: M[K]): void {
    const list = this.handlers[type];
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i](e);
  }
}

export type GameBus = EventBus<GameEvents>;
