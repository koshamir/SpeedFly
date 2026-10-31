import { load, save } from './storage';

// Local records (localStorage via storage.ts: every access is try/catch'ed there).
export interface Records {
  score: number;
  distM: number;
  island: number;
  streak: number;
  kmh: number;
}

export type RecordKey = keyof Records;
const KEYS: RecordKey[] = ['score', 'distM', 'island', 'streak', 'kmh'];

export function loadRecords(): Records {
  const num = (k: string): number => {
    const v = Number(load(k));
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  // 'best' is the pre-records key of the best score: keep it
  return { score: num('best'), distM: num('rec.distM'), island: num('rec.island'), streak: num('rec.streak'), kmh: num('rec.kmh') };
}

/** Merge a finished run into the records; returns the keys that were broken (old value > 0 or not). */
export function submitRecords(rec: Records, run: Records): RecordKey[] {
  const broken: RecordKey[] = [];
  for (const k of KEYS) {
    if (run[k] > rec[k]) {
      if (rec[k] > 0) broken.push(k);
      rec[k] = run[k];
      save(k === 'score' ? 'best' : `rec.${k}`, String(Math.floor(run[k])));
    }
  }
  return broken;
}
