import { applyPreset, CONFIG, PHYSICS_PRESETS, type PresetName } from './config';

// tuning.json = the shipped tuning: a physics preset + overrides on top of the CONFIG defaults.
//   { "preset": "smooth", "physics": {}, "hills": {}, "camera": {}, "islands": {} }
// Each section object overrides numbers of CONFIG[section]; hills.types is keyed by type name:
//   "hills": { "jitter": 0.05, "types": { "deep": { "h": 260 } } }
// No DOM: used by main.ts (boot + HMR), the Tune panel, the vite /__tuning middleware and npm run feel.

export const TUNE_SECTIONS = ['physics', 'hills', 'camera', 'islands'] as const;
export type TuneSection = (typeof TUNE_SECTIONS)[number];
type Obj = Record<string, unknown>;
export type Tuning = { preset: PresetName } & Record<TuneSection, Obj>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const sec = (s: TuneSection): Obj => CONFIG[s] as unknown as Obj;

// CONFIG as written in config.ts (taken before any tuning / lil-gui edit)
const DEFAULTS = JSON.parse(JSON.stringify(Object.fromEntries(TUNE_SECTIONS.map((s) => [s, CONFIG[s]])))) as Record<TuneSection, Obj>;

export function emptyTuning(preset: PresetName = 'smooth'): Tuning {
  return { preset, physics: {}, hills: {}, camera: {}, islands: {} };
}

/** Validate anything JSON-ish into a Tuning (bad parts are dropped with a warning). */
export function parseTuning(raw: unknown): Tuning {
  const t = emptyTuning();
  if (!isObj(raw)) {
    console.warn('tuning: not an object, using defaults');
    return t;
  }
  if (typeof raw.preset === 'string' && raw.preset in PHYSICS_PRESETS) t.preset = raw.preset as PresetName;
  else if (raw.preset !== undefined) console.warn(`tuning: unknown preset "${String(raw.preset)}", using smooth`);
  for (const s of TUNE_SECTIONS) if (isObj(raw[s])) t[s] = raw[s] as Obj;
  for (const k of Object.keys(raw)) if (k !== 'preset' && !(TUNE_SECTIONS as readonly string[]).includes(k)) console.warn(`tuning: unknown key "${k}"`);
  return t;
}

/** Copy defaults into a live CONFIG object in place (lil-gui keeps its bindings). */
function reset(dst: Obj, src: Obj): void {
  for (const k of Object.keys(src)) {
    const s = src[k], d = dst[k];
    if (Array.isArray(s) && Array.isArray(d)) {
      for (let i = 0; i < s.length; i++) {
        if (isObj(s[i]) && isObj(d[i])) reset(d[i] as Obj, s[i] as Obj);
        else d[i] = s[i];
      }
    } else if (isObj(s) && isObj(d)) reset(d, s);
    else dst[k] = s;
  }
}

function merge(dst: Obj, patch: Obj, path: string): void {
  for (const k of Object.keys(patch)) {
    const p = patch[k], d = dst[k], at = `${path}.${k}`;
    if (typeof d === 'number' && typeof p === 'number' && Number.isFinite(p)) dst[k] = p;
    else if (k === 'types' && Array.isArray(d) && isObj(p)) {
      for (const name of Object.keys(p)) {
        const ty = (d as Obj[]).find((x) => x.name === name);
        if (ty && isObj(p[name])) merge(ty, p[name] as Obj, `${at}.${name}`);
        else console.warn(`tuning: unknown hill type ${at}.${name}`);
      }
    } else if (isObj(d) && isObj(p)) merge(d, p, at);
    else console.warn(`tuning: ignored ${at} (unknown key or not a number)`);
  }
}

/** CONFIG = defaults -> preset -> overrides. Physics/camera are live on the next step/frame. */
export function applyTuning(t: Tuning): void {
  for (const s of TUNE_SECTIONS) reset(sec(s), DEFAULTS[s]);
  applyPreset(t.preset);
  for (const s of TUNE_SECTIONS) merge(sec(s), t[s], s);
}

/** Apply a preset to physics only: other sections keep their current values. */
export function resetPhysics(preset: PresetName): void {
  reset(sec('physics'), DEFAULTS.physics);
  applyPreset(preset);
}

const round = (v: number): number => +v.toPrecision(6);
const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

function diff(cur: Obj, ref: Obj): Obj {
  const out: Obj = {};
  for (const k of Object.keys(ref)) {
    const c = cur[k], r = ref[k];
    if (typeof c === 'number' && typeof r === 'number') {
      if (!same(c, r)) out[k] = round(c);
    } else if (k === 'types' && Array.isArray(c) && Array.isArray(r)) {
      const types: Obj = {};
      (c as Obj[]).forEach((ty, i) => {
        const d = diff(ty, r[i] as Obj);
        if (Object.keys(d).length) types[String(ty.name)] = d;
      });
      if (Object.keys(types).length) out[k] = types;
    } else if (isObj(c) && isObj(r)) {
      const d = diff(c, r);
      if (Object.keys(d).length) out[k] = d;
    }
  }
  return out;
}

/** Current CONFIG as a Tuning: everything that differs from defaults + the active preset. */
export function currentTuning(): Tuning {
  const preset = CONFIG.physicsPreset;
  const t = emptyTuning(preset);
  const physRef = { ...DEFAULTS.physics, ...PHYSICS_PRESETS[preset] } as Obj;
  for (const s of TUNE_SECTIONS) t[s] = diff(sec(s), s === 'physics' ? physRef : DEFAULTS[s]);
  return t;
}

/** Physics overrides only (A/B slots remember preset + these). */
export function physicsDiff(): Obj {
  return currentTuning().physics;
}

export function mergePhysics(patch: Obj): void {
  merge(sec('physics'), patch, 'physics');
}

export function tuningJson(t: Tuning): string {
  return `${JSON.stringify({ preset: t.preset, physics: t.physics, hills: t.hills, camera: t.camera, islands: t.islands }, null, 2)}\n`;
}

/** Everything the generated world depends on: a change needs a restart with the same seed. */
export function worldKey(): string {
  return JSON.stringify([CONFIG.hills, CONFIG.islands, CONFIG.physics.gRelease]);
}
