import { CONFIG } from '../config';
import { load, save } from '../core/storage';
import type { Race, Racer } from '../sim/race';
import { el } from './hud';

// Race mode UI: track menu, in-race HUD (countdown, place, progress bar, off-screen arrows, finish line),
// results (places, times, medal, best time per track).

const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
const MEDALS = ['gold', 'silver', 'bronze'] as const;
export type Medal = (typeof MEDALS)[number] | null;

export const fmtTime = (t: number): string => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
};

export function medalOf(trackIndex: number, t: number): Medal {
  const m = CONFIG.race.tracks[trackIndex].medals;
  for (let i = 0; i < 3; i++) if (t <= m[i]) return MEDALS[i];
  return null;
}

export function bestTime(i: number): number {
  const v = Number(load(`race.best.${i}`));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Saves the time if it beats the best; returns true when it did. */
export function submitTime(i: number, t: number): boolean {
  const b = bestTime(i);
  if (b > 0 && t >= b) return false;
  save(`race.best.${i}`, t.toFixed(2));
  return true;
}

export class RaceUi {
  readonly menu: HTMLDivElement;
  readonly results: HTMLDivElement;
  readonly back: HTMLButtonElement;
  readonly again: HTMLButtonElement;
  readonly toMenu: HTMLButtonElement;
  readonly cards: HTMLButtonElement[] = [];
  private readonly hud: HTMLDivElement;
  private readonly count: HTMLDivElement;
  private readonly place: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly dots: HTMLDivElement[] = [];
  private readonly arrows: HTMLDivElement[] = [];
  private readonly finish: HTMLDivElement;
  private readonly tag: HTMLDivElement;
  private readonly timer: HTMLDivElement;
  private readonly rList: HTMLDivElement;
  private readonly rHead: HTMLDivElement;
  private readonly rSub: HTMLDivElement;
  private readonly pt = { x: 0, y: 0 };
  private shownCount = '';
  private shownPlace = '';

  constructor(parent: HTMLElement) {
    // ---- menu ----
    this.menu = el('div', 'screen race-menu', parent);
    el('div', 'big-label', this.menu, 'RACE');
    el('div', 'race-sub', this.menu, 'Beat 4 birds to the finish line');
    const list = el('div', 'race-cards', this.menu);
    CONFIG.race.tracks.forEach((_, i) => {
      const c = el('button', 'race-card', list);
      c.setAttribute('data-ui', '');
      this.cards.push(c);
      this.fillCard(i);
    });
    this.back = el('button', 'btn btn-alt', this.menu, 'Back');
    // ---- in-race HUD ----
    this.hud = el('div', 'race-hud hidden', parent);
    this.place = el('div', 'race-place', this.hud);
    this.timer = el('div', 'race-timer', this.hud);
    this.bar = el('div', 'race-bar', this.hud);
    el('div', 'race-flag', this.bar);
    this.tag = el('div', 'race-tag', this.hud);
    this.count = el('div', 'race-count', parent);
    this.finish = el('div', 'finish-line', parent);
    el('span', 'finish-label', this.finish, 'FINISH');
    // ---- results ----
    this.results = el('div', 'screen results-screen race-results', parent);
    const panel = el('div', 'panel', this.results);
    this.rHead = el('div', 'r-title', panel);
    this.rSub = el('div', 'r-best', panel);
    this.rList = el('div', 'race-list', panel);
    this.again = el('button', 'btn btn-main btn-again', panel, 'Race again!');
    this.toMenu = el('button', 'btn btn-alt', panel, 'Tracks');
    for (const b of [this.back, this.again, this.toMenu]) b.setAttribute('data-ui', '');
  }

  fillCard(i: number): void {
    const T = CONFIG.race.tracks[i], best = bestTime(i), m = best ? medalOf(i, best) : null;
    const medals = T.medals.map((t, k) => `<i class="m ${MEDALS[k]}">${fmtTime(t)}</i>`).join('');
    this.cards[i].innerHTML =
      `<b>${T.name}</b><span>${T.blurb}</span>` +
      `<em>${best ? `Best ${fmtTime(best)}${m ? ` <i class="m ${m}">●</i>` : ''}` : 'Not raced yet'}</em><div class="medals">${medals}</div>`;
  }

  /** Build the dots / arrows for this race (one per racer). */
  setup(race: Race): void {
    for (const d of this.dots) d.remove();
    for (const a of this.arrows) a.remove();
    this.dots.length = this.arrows.length = 0;
    for (const r of race.racers) {
      const d = el('div', `race-dot${r.isPlayer ? ' me' : ''}`, this.bar);
      d.style.background = r.scarf;
      this.dots.push(d);
      const a = el('div', 'race-arrow', this.hud);
      a.style.setProperty('--c', r.scarf);
      this.arrows.push(a);
    }
    this.shownCount = this.shownPlace = '';
    this.tag.textContent = '';
  }

  show(on: boolean): void {
    this.hud.classList.toggle('hidden', !on);
    if (!on) {
      this.count.className = 'race-count';
      this.finish.style.display = 'none';
    }
  }

  /** Big centre text (countdown, FINISH!). */
  bigText(text: string, cls = ''): void {
    this.count.textContent = text;
    this.count.className = 'race-count';
    void this.count.offsetWidth;
    this.count.className = `race-count show ${cls}`;
  }

  /** Per frame. toScreen maps world -> UI px; gw = UI width. */
  update(race: Race, toScreen: (x: number, y: number, o: { x: number; y: number }) => void, gw: number, gh: number, finishY: number): void {
    // countdown 3-2-1-GO
    if (race.phase === 'countdown') {
      const c = String(Math.ceil(race.countdown));
      if (c !== this.shownCount) {
        this.shownCount = c;
        this.bigText(c);
      }
    } else if (this.shownCount !== 'GO' && race.t < 0.5) {
      this.shownCount = 'GO';
      this.bigText('GO!', 'go');
    }
    // place + timer
    const p = race.place(race.player), n = race.racers.length;
    const ps = race.player.out ? 'OUT' : `${ORD[p - 1]}`;
    if (ps !== this.shownPlace) {
      this.shownPlace = ps;
      this.place.innerHTML = race.player.out ? 'OUT' : `${ps}<small> / ${n}</small>`;
      this.place.classList.remove('bump');
      void this.place.offsetWidth;
      this.place.classList.add('bump');
    }
    this.timer.textContent = fmtTime(race.player.finishT ?? race.t);
    // progress bar
    race.racers.forEach((r, i) => {
      this.dots[i].style.left = `${race.progress(r) * 100}%`;
      this.dots[i].classList.toggle('out', r.out);
    });
    // off-screen arrows: birds ahead (right edge) / behind (left edge), with the gap in m
    const me = race.player.run.bird;
    race.racers.forEach((r, i) => {
      const a = this.arrows[i];
      if (r.isPlayer || r.out) {
        a.style.display = 'none';
        return;
      }
      toScreen(r.run.cx, r.run.cy, this.pt);
      const off = this.pt.x < 0 || this.pt.x > gw || this.pt.y < 0 || this.pt.y > gh;
      if (!off) {
        a.style.display = 'none';
        return;
      }
      const ahead = r.run.bird.x > me.x, m = Math.abs(r.run.bird.x - me.x) / CONFIG.speed.pxPerMeter;
      a.style.display = '';
      a.className = `race-arrow ${ahead ? 'ahead' : 'behind'}`;
      const y = Math.max(gh * 0.18, Math.min(gh * 0.7, this.pt.y));
      a.style.top = `${y}px`;
      a.textContent = `${r.name} ${Math.round(m)}m`;
    });
    // finish line in the world
    toScreen(race.finishX, finishY, this.pt);
    const vis = this.pt.x > -60 && this.pt.x < gw + 60;
    this.finish.style.display = vis ? '' : 'none';
    if (vis) this.finish.style.transform = `translate(${this.pt.x}px, ${this.pt.y}px)`;
    // feature tag
    const tag = race.player.drafting ? 'SLIPSTREAM!' : '';
    if (this.tag.textContent !== tag) this.tag.textContent = tag;
  }

  /** Results: standings with times, the player's medal and best time. */
  fillResults(race: Race, newBest: boolean): Medal {
    const st = race.standings(), p = st.indexOf(race.player) + 1, me = race.timeOf(race.player);
    const medal = race.player.out ? null : medalOf(race.trackIndex, me.t);
    this.rHead.textContent = race.player.out ? 'Caught by the night!' : p === 1 ? 'YOU WIN!' : `${ORD[p - 1]} place`;
    const best = bestTime(race.trackIndex);
    this.rSub.innerHTML = race.player.out
      ? 'Fly faster than the sunset'
      : `${fmtTime(me.t)} ${medal ? `<i class="m ${medal}">${medal.toUpperCase()}</i>` : ''} · ${newBest ? 'NEW BEST!' : `best ${fmtTime(best)}`}`;
    this.rSub.classList.toggle('new', newBest);
    this.rList.innerHTML = st
      .map((r: Racer, i) => {
        const x = race.timeOf(r);
        const t = r.out ? 'out' : `${fmtTime(x.t)}${x.est ? '*' : ''}`;
        return `<div class="race-row${r.isPlayer ? ' me' : ''}"><span class="pos">${i + 1}</span><span class="sw" style="background:${r.scarf}"></span><span class="nm">${r.name}</span><b>${t}</b></div>`;
      })
      .join('');
    return medal;
  }
}
