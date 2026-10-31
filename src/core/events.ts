// Typed event bus. The sim emits, render/audio/UI only subscribe.
// Payload objects are reused by the emitter: handlers must copy what they keep.
// Positions: x, y = the bird's CENTER (= sprite center, the physics state); gx, gy = the ground
// contact point under it (dust/impact FX go there, not at x, y).
// Micro-hops (bird.ts EV_HOP) never reach the bus; 'takeoff' fires ~once per real flight.

export type LandKind = 'great' | 'ok' | 'bad' | 'splash';
export type CoinType = 'gold' | 'blue';

export interface GameEvents {
  takeoff: { x: number; y: number; gx: number; gy: number; speed: number };
  land: { kind: LandKind; angle: number; airTime: number; streak: number; x: number; y: number; gx: number; gy: number; speed: number };
  feverStart: { streak: number };
  feverEnd: { duration: number };
  skyTouch: { x: number; y: number };
  coin: { type: CoinType; x: number; y: number; chain: number };
  island: { index: number };
  // scripted island jump: fires at takeoff from the ramp; the flight is an exact parabola that lands at
  // (targetX, targetY) after `duration` s with apex (apexX, apexY). Camera/FX may choreograph on it.
  islandLaunch: { k: number; x: number; y: number; targetX: number; targetY: number; apexX: number; apexY: number; duration: number; speed: number };
  islandLand: { k: number; kind: LandKind; x: number; y: number; speed: number };
  speedTier: { tier: number; prev: number };
  caught: { x: number };
  // daylight bought by skill (endless run) / the night is close
  dayGain: { amount: number; x: number; y: number };
  nightNear: { left: number };
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
