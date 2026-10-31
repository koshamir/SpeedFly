import { CONFIG, PHYSICS_PRESETS, type PresetName } from '../config';
import { load, save } from '../core/storage';
import type { Run } from '../sim/run';
import {
  applyTuning, currentTuning, mergePhysics, physicsDiff, resetPhysics, tuningJson, type TuneSection, type Tuning,
} from '../tuning';
import { HillPreview } from './hillPreview';
import { el } from './hud';

// ?tune=1: the curated feel panel (dev AND production build). A drawer at the TOP of the screen
// (the bottom 25% is the thumb zone); everything is [data-ui] so it never counts as a press.
// Physics/camera sliders are live; hills/islands controls redraw the Hills tab profile preview while
// dragging and restart the run with the same seed on release (unless "Preview only").

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
  path: string[]; // inside the section
  label: string;
  min: number;
  max: number;
  step: number;
  toggle?: boolean; // 0/1 on/off switch instead of a range
  input?: HTMLInputElement;
  value?: HTMLSpanElement;
  sw?: HTMLButtonElement;
  row?: HTMLDivElement;
}

/** A labelled block of the Hills tab; `mode` = shown only in that hills.mode. */
interface Group {
  title: string;
  hint: string;
  mode?: number;
  keys: string[]; // 'hills.halfW', 'islands.sxStep'
  el?: HTMLDivElement;
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
const SW = (section: TuneSection, key: string): Slider => ({ section, path: [key], label: key, min: 0, max: 1, step: 1, toggle: true });

const HILL_GROUPS: Group[] = [
  { title: 'Ритм', hint: 'расстояние вершина–вершина и насколько холмы одинаковые', keys: ['hills.width', 'hills.widthJitter'] },
  { title: 'Вершины', hint: 'уровень гребней; разброс = непредсказуемые взлёты', mode: 0, keys: ['hills.peakY', 'hills.peakJitter'] },
  {
    title: 'Впадины', hint: 'height = перепад вершина→впадина; ширину НЕ меняет', mode: 0,
    keys: ['hills.height', 'hills.heightJitter', 'hills.deepChance', 'hills.deepMul', 'hills.wideChance', 'hills.wideMul', 'hills.noRepeat'],
  },
  {
    title: 'Рост', hint: 'по острову (grow) и от острова к острову (isl.*)',
    keys: ['hills.growFrom', 'hills.growTo', 'islands.sxStep', 'islands.sxMax', 'islands.syStep', 'islands.syMax', 'hills.slopeLimit'],
  },
  { title: 'Zigzag', hint: 'случайное блуждание вверх-вниз, вершины на разной высоте', mode: 1, keys: ['hills.zzMinDY', 'hills.zzRangeDY', 'hills.zzMinY', 'hills.zzMaxY'] },
  { title: 'Остров', hint: 'длина острова и финальный спуск/трамплин', keys: ['islands.hillsBase', 'islands.hillsStep', 'islands.summitRise', 'islands.descentDrop', 'islands.bumps', 'islands.bumpRise', 'islands.rampDx', 'islands.lipRise'] },
  { title: 'Прыжок', hint: 'скриптовый перелёт на следующий остров', keys: ['islands.launchAngle', 'islands.vLaunchMin', 'islands.vLaunchMax', 'islands.flightDx', 'islands.landAt'] },
];
const isWorld = (s: Slider): boolean => s.section === 'hills' || s.section === 'islands';

function sliders(): Slider[] {
  const out: Slider[] = [
    S('physics', 'gRelease', 600, 1600, 10, 'gGround up'),
    S('physics', 'gDive', 1800, 5000, 25, 'gGround dive'),
    S('physics', 'gAirRelease', 400, 1600, 10, 'gAir up'),
    S('physics', 'gAirDive', 1500, 5000, 25, 'gAir dive'),
    S('physics', 'diveRamp', 0, 0.15, 0.005),
    S('physics', 'airLift', 0, 0.4, 0.01),
    S('physics', 'fallCap', 400, 3000, 10),
    S('physics', 'fallCapDive', 800, 4000, 10),
    S('physics', 'vSoft', 1000, 4000, 10),
    S('physics', 'vSoftK', 0, 0.02, 0.0005),
    S('physics', 'ceilAlt', 300, 2500, 10),
    S('physics', 'ceilK', 0, 8, 0.1),
    S('physics', 'muGround', 0, 0.06, 0.001),
    S('physics', 'drag', 0, 0.00008, 0.000001),
    S('physics', 'greatAngle', 8, 30, 0.5),
    S('physics', 'okAngle', 15, 45, 0.5),
    S('physics', 'greatBoost', 1, 1.2, 0.005),
    S('physics', 'landingAssist', 0, 0.8, 0.01),
    S('physics', 'takeoffMargin', 0, 0.3, 0.01),
  ];
  out.push(
    S('hills', 'width', 400, 1600, 10),
    S('hills', 'widthJitter', 0, 0.3, 0.005),
    S('hills', 'peakY', 0, 400, 5),
    S('hills', 'peakJitter', 0, 80, 1),
    S('hills', 'height', 60, 450, 5),
    S('hills', 'heightJitter', 0, 0.5, 0.01),
    S('hills', 'deepChance', 0, 0.6, 0.01),
    S('hills', 'deepMul', 1, 2.2, 0.01),
    S('hills', 'wideChance', 0, 0.6, 0.01),
    S('hills', 'wideMul', 1, 2, 0.01),
    SW('hills', 'noRepeat'),
    S('hills', 'growFrom', 0.5, 1.5, 0.01),
    S('hills', 'growTo', 0.5, 1.5, 0.01),
    S('hills', 'slopeLimit', 0.5, 2, 0.01),
    S('hills', 'zzMinDY', 20, 300, 5),
    S('hills', 'zzRangeDY', 0, 300, 5),
    S('hills', 'zzMinY', -300, 200, 5),
    S('hills', 'zzMaxY', 100, 600, 5),
    S('islands', 'sxStep', 0, 0.15, 0.005, 'isl.sxStep'),
    S('islands', 'sxMax', 1, 2, 0.01, 'isl.sxMax'),
    S('islands', 'syStep', 0, 0.15, 0.005, 'isl.syStep'),
    S('islands', 'syMax', 1, 2.2, 0.01, 'isl.syMax'),
    S('islands', 'hillsBase', 6, 60, 1, 'isl.hills'),
    S('islands', 'hillsStep', 0, 12, 1, 'isl.hillsStep'),
    S('islands', 'summitRise', 0, 500, 5, 'isl.summit'),
    S('islands', 'descentDrop', 300, 1400, 10, 'isl.descent'),
    S('islands', 'bumps', 0, 5, 1, 'isl.bumps'),
    S('islands', 'bumpRise', 0, 150, 1, 'isl.bumpRise'),
    S('islands', 'rampDx', 600, 2000, 10, 'isl.rampDx'),
    S('islands', 'lipRise', 0, 500, 5, 'isl.lipRise'),
    S('islands', 'launchAngle', 30, 65, 0.5, 'jump.angle'),
    S('islands', 'vLaunchMin', 800, 2500, 10, 'jump.vMin'),
    S('islands', 'vLaunchMax', 1200, 3500, 10, 'jump.vMax'),
    S('islands', 'flightDx', 1500, 6000, 10, 'jump.dx'),
    S('islands', 'landAt', 0.2, 0.8, 0.01, 'jump.landAt'),
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
  private readonly groups = HILL_GROUPS.map((g) => ({ ...g }));
  private readonly modeChips: HTMLButtonElement[] = [];
  private previewBtn!: HTMLButtonElement;
  private preview!: HillPreview;
  private previewOnly = load('tunePreviewOnly') === '1';
  private pendingRestart = false;
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
    act('New seed', () => {
      this.host.restart(this.host.randomSeed());
      this.preview.request();
    });
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
    for (const [name, secs] of TABS) {
      const list = el('div', 'tune-list', body);
      this.lists.push(list);
      if (name === 'Hills') this.buildHills(list);
      else for (const s of this.sliders) if (secs.includes(s.section)) this.addSlider(list, s);
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

  /** Hills tab: sticky profile preview + stats, mode chips, labelled blocks. */
  private buildHills(list: HTMLDivElement): void {
    const pv = el('div', 'tune-preview', list);
    const canvas = el('canvas', 'tune-canvas', pv);
    this.preview = new HillPreview(canvas, el('div', 'tune-hstats', pv), () => this.host.run().seed);
    const row = el('div', 'tune-row', list);
    (['Peaks', 'Zigzag'] as const).forEach((m, i) => {
      const b = el('button', 'tune-chip', row, m);
      b.addEventListener('click', () => this.setMode(i));
      this.modeChips.push(b);
    });
    this.previewBtn = el('button', 'tune-chip tune-pvonly', row, 'Preview only');
    this.previewBtn.addEventListener('click', () => this.setPreviewOnly(!this.previewOnly));
    el('button', 'tune-chip', row, 'Reset Hills').addEventListener('click', () => this.resetHills());
    for (const g of this.groups) {
      const box = (g.el = el('div', 'tune-group', list));
      const head = el('div', 'tune-ghead', box);
      el('b', '', head, g.title);
      el('span', '', head, g.hint);
      for (const key of g.keys) {
        const [sec, k] = key.split('.');
        const s = this.sliders.find((x) => x.section === sec && x.path[0] === k);
        if (s) this.addSlider(box, s);
      }
    }
  }

  private addSlider(list: HTMLDivElement, s: Slider): void {
    const row = (s.row = el('div', 'tune-slider', list));
    const label = el('button', 'tune-label', row, s.label);
    label.title = 'tap: reset to preset/default';
    label.addEventListener('click', () => this.resetOne(s));
    if (s.toggle) {
      const sw = (s.sw = el('button', 'tune-switch', row));
      sw.addEventListener('click', () => {
        const [o, k] = target(s);
        o[k] = (o[k] as number) > 0 ? 0 : 1;
        this.syncOne(s);
        this.worldEdited();
      });
      return;
    }
    const input = (s.input = el('input', '', row));
    input.type = 'range';
    input.min = String(s.min);
    input.max = String(s.max);
    input.step = String(s.step);
    s.value = el('span', 'tune-value', row);
    const world = isWorld(s);
    input.addEventListener('input', () => {
      const [o, k] = target(s);
      o[k] = Number(input.value);
      s.value!.textContent = fmt(o[k] as number, s.step);
      if (world) this.preview.request(); // live profile while dragging, no game restart
      else this.changed();
    });
    input.addEventListener('change', () => {
      if (world) this.worldEdited();
      input.blur();
    });
  }

  /** A hills/islands value was committed: regenerate the game world (same seed) unless "Preview only". */
  private worldEdited(): void {
    if (this.previewOnly) this.pendingRestart = true;
    else this.host.restart(this.host.run().seed);
    this.preview.request();
    this.changed();
  }

  private setMode(m: number): void {
    if (CONFIG.hills.mode === m) return;
    CONFIG.hills.mode = m;
    this.syncHills();
    this.worldEdited();
    this.say(m ? 'Zigzag: случайное блуждание' : 'Peaks: ровные вершины, разные впадины');
  }

  private setPreviewOnly(on: boolean): void {
    this.previewOnly = on;
    save('tunePreviewOnly', on ? '1' : '0');
    this.previewBtn.classList.toggle('on', on);
    if (!on && this.pendingRestart) {
      this.pendingRestart = false;
      this.host.restart(this.host.run().seed);
      this.say('применено: рестарт тем же seed');
    } else this.say(on ? 'Preview only: игра не перезапускается' : 'изменения холмов сразу идут в игру');
  }

  private resetHills(): void {
    const t = currentTuning();
    t.hills = {};
    t.islands = {};
    applyTuning(t);
    this.sync();
    this.worldEdited();
    this.say('Hills: значения по умолчанию');
  }

  /** Refresh every control from CONFIG (after tuning.json reload, preset, A/B...). */
  sync(): void {
    for (const s of this.sliders) this.syncOne(s);
    this.syncHills();
    this.marks();
  }

  private syncOne(s: Slider): void {
    const [o, k] = target(s);
    const v = o[k] as number;
    if (s.sw) {
      s.sw.textContent = v > 0 ? 'вкл' : 'выкл';
      s.sw.classList.toggle('on', v > 0);
      return;
    }
    s.input!.value = String(v);
    s.value!.textContent = fmt(v, s.step);
  }

  /** Mode chips, mode-only blocks, Preview-only state, profile. */
  private syncHills(): void {
    const m = CONFIG.hills.mode;
    this.modeChips.forEach((b, i) => b.classList.toggle('on', i === m));
    for (const g of this.groups) g.el!.classList.toggle('hidden', g.mode !== undefined && g.mode !== m);
    this.previewBtn.classList.toggle('on', this.previewOnly);
    this.preview.request();
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
    this.showPreview();
  }

  private showPreview(): void {
    const hills = TABS[this.tabIdx][0] === 'Hills';
    this.root.classList.toggle('hills', hills);
    this.preview.show(this.open && hills);
  }

  toggle(open = !this.open): void {
    this.open = open;
    this.root.classList.toggle('open', open);
    this.tab.blur();
    this.showPreview();
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
    this.sync();
    if (isWorld(s)) this.worldEdited();
    else this.changed();
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
