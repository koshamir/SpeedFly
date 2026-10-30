import { CONFIG, PHYSICS_PRESETS, type PresetName } from '../config';
import { load, save } from '../core/storage';
import type { Run } from '../sim/run';
import {
  applyTuning, currentTuning, mergePhysics, physicsDiff, resetPhysics, tuningJson, type TuneSection, type Tuning,
} from '../tuning';
import { el } from './hud';

// ?tune=1: the curated feel panel (dev AND production build). A drawer at the TOP of the screen
// (the bottom 25% is the thumb zone); everything is [data-ui] so it never counts as a press.
// Physics/camera sliders are live; hills/islands sliders restart the run with the same seed on release.

export interface TuneHost {
  run(): Run;
  zoom(): number;
  /** Rebuild the run with this seed (keeps the title screen, otherwise plays at once). */
  restart(seed: number): void;
  randomSeed(): number;
  /** CONFIG changed from outside the lil-gui (?debug=1 refresh). */
  changed(): void;
}

interface Slider {
  section: TuneSection;
  path: string[]; // inside the section; ['types', name, key] for hill types
  label: string;
  min: number;
  max: number;
  step: number;
  input?: HTMLInputElement;
  value?: HTMLSpanElement;
  row?: HTMLDivElement;
}

type Obj = Record<string, unknown>;
const PRESETS = Object.keys(PHYSICS_PRESETS) as PresetName[];
const TABS: [string, TuneSection[]][] = [
  ['Physics', ['physics']],
  ['Hills', ['hills', 'islands']],
  ['Camera', ['camera']],
];

const S = (section: TuneSection, key: string, min: number, max: number, step: number, label = key): Slider => ({
  section, path: [key], label, min, max, step,
});

function sliders(): Slider[] {
  const out: Slider[] = [
    S('physics', 'gRelease', 600, 1600, 10),
    S('physics', 'gDive', 1800, 5000, 25),
    S('physics', 'diveRamp', 0, 0.15, 0.005),
    S('physics', 'airLift', 0, 0.4, 0.01),
    S('physics', 'muGround', 0, 0.06, 0.001),
    S('physics', 'drag', 0, 0.00008, 0.000001),
    S('physics', 'greatAngle', 8, 25, 0.5),
    S('physics', 'greatBoost', 1, 1.2, 0.005),
    S('physics', 'landingAssist', 0, 0.8, 0.01),
    S('physics', 'takeoffMargin', 0, 0.3, 0.01),
  ];
  for (const ty of CONFIG.hills.types) {
    out.push(
      { section: 'hills', path: ['types', ty.name, 'w'], label: `${ty.name}.w`, min: 400, max: 1600, step: 10 },
      { section: 'hills', path: ['types', ty.name, 'h'], label: `${ty.name}.h`, min: 60, max: 400, step: 5 },
      { section: 'hills', path: ['types', ty.name, 'weight'], label: `${ty.name}.wt`, min: 0, max: 1, step: 0.01 },
    );
  }
  out.push(
    S('hills', 'jitter', 0, 0.15, 0.005),
    S('hills', 'growFrom', 0.5, 1.5, 0.01),
    S('hills', 'growTo', 0.5, 1.5, 0.01),
    S('islands', 'sxStep', 0, 0.15, 0.005, 'isl.sxStep'),
    S('islands', 'sxMax', 1, 2, 0.01, 'isl.sxMax'),
    S('islands', 'syStep', 0, 0.15, 0.005, 'isl.syStep'),
    S('islands', 'syMax', 1, 2.2, 0.01, 'isl.syMax'),
    S('camera', 'wX', 0, 12, 0.1),
    S('camera', 'wY', 0.5, 12, 0.1),
    S('camera', 'wZoomOut', 0.5, 12, 0.1),
    S('camera', 'wZoomIn', 0.3, 8, 0.1),
    S('camera', 'lookAhead', 0.3, 1.2, 0.01),
    S('camera', 'zMin', 0.2, 0.8, 0.01),
  );
  return out;
}

/** The live CONFIG object that holds a slider's number, and its key. */
function target(s: Slider): [Obj, string] {
  let o = CONFIG[s.section] as unknown as Obj;
  const p = s.path;
  if (p[0] === 'types') return [(o.types as Obj[]).find((t) => t.name === p[1])!, p[2]];
  for (let i = 0; i < p.length - 1; i++) o = o[p[i]] as Obj;
  return [o, p[p.length - 1]];
}

/** Is this slider's value in the tuning diff (i.e. changed vs preset/defaults)? */
function inDiff(t: Tuning, s: Slider): boolean {
  let o: unknown = t[s.section];
  for (const k of s.path) o = (o as Obj | undefined)?.[k];
  return o !== undefined;
}

function dropFromDiff(t: Tuning, s: Slider): void {
  const stack: Obj[] = [t[s.section]];
  for (const k of s.path.slice(0, -1)) stack.push(stack[stack.length - 1][k] as Obj);
  delete stack[stack.length - 1][s.path[s.path.length - 1]];
}

const fmt = (v: number, step: number): string => {
  if (v !== 0 && Math.abs(v) < 0.001) return v.toExponential(1);
  const d = Math.max(0, Math.min(4, Math.ceil(-Math.log10(step) - 1e-9)));
  return v.toFixed(d);
};

interface AB {
  active: number;
  slots: { preset: PresetName; physics: Obj }[];
}

export class TunePanel {
  private readonly root: HTMLDivElement;
  private readonly tab: HTMLButtonElement;
  private readonly chips = new Map<PresetName, HTMLButtonElement>();
  private readonly abBtn: HTMLButtonElement;
  private readonly readout: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly json: HTMLTextAreaElement;
  private readonly tabBtns: HTMLButtonElement[] = [];
  private readonly lists: HTMLDivElement[] = [];
  private readonly sliders = sliders();
  private open = false;
  private tabIdx = 0;
  private readT = 0;
  private ab: AB;

  constructor(
    parent: HTMLElement,
    private readonly host: TuneHost,
  ) {
    this.root = el('div', 'tune', parent);
    this.root.setAttribute('data-ui', '');
    this.tab = el('button', 'tune-tab', this.root, 'TUNE ▾');
    this.tab.addEventListener('click', () => this.toggle());

    const d = el('div', 'tune-drawer', this.root);
    const head = el('div', 'tune-row tune-head', d);
    for (const p of PRESETS) {
      const b = el('button', 'tune-chip', head, p);
      b.addEventListener('click', () => this.preset(p));
      this.chips.set(p, b);
    }
    this.abBtn = el('button', 'tune-chip tune-ab', head);
    this.abBtn.addEventListener('click', () => this.swapAB());
    el('button', 'tune-chip tune-close', head, '▴').addEventListener('click', () => this.toggle(false));

    this.readout = el('div', 'tune-readout', d);

    const acts = el('div', 'tune-row', d);
    const act = (label: string, fn: () => void): void => {
      el('button', 'tune-btn', acts, label).addEventListener('click', fn);
    };
    act('Restart', () => this.host.restart(this.host.run().seed));
    act('New seed', () => this.host.restart(this.host.randomSeed()));
    act('Copy JSON', () => void this.copy());
    act(import.meta.env.DEV ? 'Save' : 'Save (copy)', () => void this.save());

    const tabs = el('div', 'tune-row tune-tabs', d);
    TABS.forEach(([name], i) => {
      const b = el('button', 'tune-tabbtn', tabs, name);
      b.addEventListener('click', () => this.showTab(i));
      this.tabBtns.push(b);
    });

    const body = el('div', 'tune-body', d);
    body.setAttribute('data-scroll', '');
    for (const [, secs] of TABS) {
      const list = el('div', 'tune-list', body);
      this.lists.push(list);
      for (const s of this.sliders) if (secs.includes(s.section)) this.addSlider(list, s);
    }
    this.status = el('div', 'tune-status', body);
    this.json = el('textarea', 'tune-json', body);
    this.json.readOnly = true;
    this.json.rows = 8;

    // A/B: the active slot is whatever tuning.json booted with; the other one is remembered per device
    let stored: AB | null = null;
    try {
      stored = JSON.parse(load('tuneAB') ?? 'null') as AB | null;
    } catch {
      stored = null;
    }
    this.ab = stored && Array.isArray(stored.slots) && stored.slots.length === 2
      ? stored
      : { active: 0, slots: [{ preset: 'smooth', physics: {} }, { preset: 'classic', physics: {} }] };
    if (!(this.ab.slots[1 - this.ab.active].preset in PHYSICS_PRESETS)) this.ab.slots[1 - this.ab.active] = { preset: 'classic', physics: {} };
    this.ab.slots[this.ab.active] = { preset: CONFIG.physicsPreset, physics: physicsDiff() };

    let o = false;
    try {
      o = sessionStorage.getItem('sd.tuneOpen') === '1';
    } catch {
      // storage blocked
    }
    this.showTab(Number(load('tuneTab') ?? 0) || 0);
    this.toggle(o);
    this.sync();
  }

  private addSlider(list: HTMLDivElement, s: Slider): void {
    const row = (s.row = el('div', 'tune-slider', list));
    const label = el('button', 'tune-label', row, s.label);
    label.title = 'tap: reset to preset/default';
    label.addEventListener('click', () => this.resetOne(s));
    const input = (s.input = el('input', '', row));
    input.type = 'range';
    input.min = String(s.min);
    input.max = String(s.max);
    input.step = String(s.step);
    s.value = el('span', 'tune-value', row);
    const world = s.section === 'hills' || s.section === 'islands';
    input.addEventListener('input', () => {
      const [o, k] = target(s);
      o[k] = Number(input.value);
      s.value!.textContent = fmt(o[k] as number, s.step);
      if (!world) this.changed();
    });
    input.addEventListener('change', () => {
      if (world) {
        this.host.restart(this.host.run().seed); // the world must be regenerated
        this.changed();
      }
      input.blur();
    });
  }

  /** Refresh every control from CONFIG (after tuning.json reload, preset, A/B...). */
  sync(): void {
    for (const s of this.sliders) {
      const [o, k] = target(s);
      const v = o[k] as number;
      s.input!.value = String(v);
      s.value!.textContent = fmt(v, s.step);
    }
    this.marks();
  }

  private marks(): void {
    const t = currentTuning();
    for (const s of this.sliders) s.row!.classList.toggle('mod', inDiff(t, s));
    for (const [p, b] of this.chips) b.classList.toggle('on', p === CONFIG.physicsPreset);
    const [a, b] = this.ab.slots;
    this.abBtn.textContent = `A ${a.preset} ⇄ B ${b.preset}`;
    this.abBtn.dataset.active = this.ab.active ? 'B' : 'A';
  }

  private changed(): void {
    this.ab.slots[this.ab.active] = { preset: CONFIG.physicsPreset, physics: physicsDiff() };
    this.storeAB();
    this.marks();
    this.host.changed();
  }

  private storeAB(): void {
    save('tuneAB', JSON.stringify(this.ab));
  }

  private showTab(i: number): void {
    this.tabIdx = Math.max(0, Math.min(TABS.length - 1, i));
    this.lists.forEach((l, j) => l.classList.toggle('hidden', j !== this.tabIdx));
    this.tabBtns.forEach((b, j) => b.classList.toggle('on', j === this.tabIdx));
    save('tuneTab', String(this.tabIdx));
  }

  toggle(open = !this.open): void {
    this.open = open;
    this.root.classList.toggle('open', open);
    this.tab.blur();
    try {
      sessionStorage.setItem('sd.tuneOpen', open ? '1' : '0');
    } catch {
      // storage blocked
    }
  }

  /** One tap = physics preset (no physics overrides) + restart with the same seed. */
  preset(p: PresetName): void {
    resetPhysics(p);
    this.ab.slots[this.ab.active] = { preset: p, physics: {} };
    this.storeAB();
    this.host.restart(this.host.run().seed);
    this.sync();
    this.host.changed();
    this.say(`preset ${p}`);
  }

  private swapAB(): void {
    this.ab.slots[this.ab.active] = { preset: CONFIG.physicsPreset, physics: physicsDiff() };
    this.ab.active = 1 - this.ab.active;
    const slot = this.ab.slots[this.ab.active];
    resetPhysics(slot.preset);
    mergePhysics(slot.physics);
    this.storeAB();
    this.host.restart(this.host.run().seed);
    this.sync();
    this.host.changed();
    this.say(`${this.ab.active ? 'B' : 'A'}: ${slot.preset}${Object.keys(slot.physics).length ? ' + edits' : ''}`);
  }

  private resetOne(s: Slider): void {
    const t = currentTuning();
    if (!inDiff(t, s)) return;
    dropFromDiff(t, s);
    applyTuning(t);
    if (s.section === 'hills' || s.section === 'islands') this.host.restart(this.host.run().seed);
    this.sync();
    this.changed();
    this.say(`${s.label} reset`);
  }

  /** Desktop keys while ?tune=1: 1-4 presets, R restart (same seed), T panel. */
  key(code: string): boolean {
    const n = /^Digit([1-9])$/.exec(code);
    if (n && Number(n[1]) <= PRESETS.length) this.preset(PRESETS[Number(n[1]) - 1]);
    else if (code === 'KeyR') this.host.restart(this.host.run().seed);
    else if (code === 'KeyT') this.toggle();
    else return false;
    return true;
  }

  frame(dt: number): void {
    this.readT -= dt;
    if (!this.open || this.readT > 0) return;
    this.readT = 0.1;
    const r = this.host.run(), sp = r.speed;
    this.readout.textContent =
      `${sp.toFixed(0)} px/s · ${(sp * CONFIG.speed.kmhPerPx).toFixed(0)} km/h · ${r.bird.grounded ? 'ground' : 'air'}\n` +
      `last ${r.lastKind ? `${r.lastKind.toUpperCase()} ${r.lastAngle.toFixed(1)}°` : '—'} · streak ${r.bird.streak} · ` +
      `island ${r.island} · zoom ${this.host.zoom().toFixed(2)} · seed ${r.seed}`;
  }

  private say(msg: string): void {
    this.status.textContent = msg;
  }

  private async copy(prefix = ''): Promise<void> {
    const text = tuningJson(currentTuning());
    this.json.value = text;
    this.json.classList.add('shown');
    let ok = false;
    try {
      if (navigator.clipboard && isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      // http over LAN is not a secure context: the old path still works inside a tap
      this.json.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      this.json.blur();
    }
    this.say(prefix + (ok ? 'JSON copied — paste it into tuning.json' : 'copy blocked — select the JSON below'));
  }

  private async save(): Promise<void> {
    if (!import.meta.env.DEV) return this.copy('production build: ');
    const text = tuningJson(currentTuning());
    try {
      const res = await fetch('./__tuning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
      if (!res.ok) throw new Error(await res.text());
      this.say('saved tuning.json ✓ (every open tab reloads it)');
    } catch (e) {
      await this.copy(`save failed (${e instanceof Error ? e.message : String(e)}): `);
    }
  }
}
