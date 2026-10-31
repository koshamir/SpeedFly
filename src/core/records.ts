import { load, save } from './storage';

// Local records of the endless run (localStorage via storage.ts: never throws).
export interface Records {
  score: number;
  meters: number;
  island: number;
  chain: number; // longest GREAT streak
  kmh: number; // top speed
}

export const RECORD_NAMES: Record<keyof Records, string> = {
  score: 'Score',
  meters: 'Distance',
  island: 'Island',
  chain: 'GREAT chain',
  kmh: 'Top speed',
};

export function loadRecords(): Records {
  const r: Records = { score: Number(load('best')) || 0, meters: 0, island: 0, chain: 0, kmh: 0 };
  try {
    const o = JSON.parse(load('records') ?? '{}') as Partial<Records>;
    for (const k of Object.keys(r) as (keyof Records)[]) if (typeof o[k] === 'number' && Number.isFinite(o[k])) r[k] = Math.max(r[k], o[k] as number);
  } catch {
    // corrupt: keep defaults
  }
  return r;
}

/** Merge a finished run; returns the keys that were broken. */
export function submitRecords(r: Records, run: Records): (keyof Records)[] {
  const broken: (keyof Records)[] = [];
  for (const k of Object.keys(r) as (keyof Records)[])
    if (run[k] > r[k]) {
      if (r[k] > 0 || k === 'score') broken.push(k);
      r[k] = run[k];
    }
  save('records', JSON.stringify(r));
  save('best', String(Math.floor(r.score)));
  return broken;
}
