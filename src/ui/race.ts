import { load, save } from '../core/storage';
import type { RaceRun } from '../sim/race';
import { TRACKS } from '../world/tracks';
import { el } from './hud';

// Race UI (SPEC §14): track menu, countdown, live HUD (place, time, progress bar with every bird,
// off-screen markers), results (places, times, medal, best time per track).

const ORD = (n: number): string => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
export const fmtTime = (s: number): string => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const MEDALS = ['🥇 GOLD', '🥈 SILVER', '🥉 BRONZE'];

export function bestTime(track: number): number {
  return Number(load(`raceBest.${track}`)) || 0;
}

export function medalOf(track: number, t: number): number {
  const m = TRACKS[track].medals;
  return t <= 0 ? -1 : t <= m[0] ? 0 : t <= m[1] ? 1 : t <= m[2] ? 2 : -1;
}

export class RaceUI {
  readonly menu: HTMLDivElement;
  readonly results: HTMLDivElement;
  readonly back: HTMLButtonElement;
  readonly again: HTMLButtonElement;
  readonly toMenu: HTMLButtonElement;
  onPick: ((track: number) => void) | null = null;
  private readonly cards: HTMLDivElement[] = [];
  private readonly count: HTMLDivElement;
  private readonly hud: HTMLDivElement;
  private readonly place: HTMLDivElement;
  private readonly time: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly dots: HTMLDivElement[] = [];
  private readonly marks: HTMLDivElement[] = [];
  private readonly slip: HTMLDivElement;
  private readonly rTitle: HTMLDivElement;
  private readonly rRows: HTMLDivElement;
  private readonly rMedal: HTMLDivElement;
  private shownPlace = '';

  constructor(parent: HTMLElement) {
    this.menu = el('div', 'screen race-menu', parent);
    this.menu.setAttribute('data-ui', '');
    el('div', 'tut-title', this.menu, 'RACE');
    el('div', 'tut-goal', this.menu, 'Beat 4 rival birds to the finish line');
    TRACKS.forEach((_t, i) => {
      const c = el('div', 'race-card', this.menu);
      c.addEventListener('click', () => this.onPick?.(i));
      this.cards.push(c);
    });
    this.back = el('button', 'btn btn-alt', this.menu, 'Back');

    this.count = el('div', 'race-count', parent);
    this.hud = el('div', 'race-hud', parent);
    this.place = el('div', 'race-place', this.hud);
    this.time = el('div', 'race-time', this.hud);
    this.bar = el('div', 'race-bar', this.hud);
    el('div', 'race-flag', this.bar, '🏁');
    for (let i = 0; i < 5; i++) {
      this.dots.push(el('div', 'race-dot', this.bar));
      this.marks.push(el('div', 'race-mark', parent));
    }
    this.slip = el('div', 'race-slip', this.hud, 'SLIPSTREAM!');

    this.results = el('div', 'screen race-results', parent);
    this.results.setAttribute('data-ui', '');
    const p = el('div', 'panel', this.results);
    this.rTitle = el('div', 'r-title', p);
    this.rMedal = el('div', 'r-best', p);
    this.rRows = el('div', 'r-rows', p);
    this.again = el('button', 'btn btn-main', p, 'RACE AGAIN');
    this.toMenu = el('button', 'btn btn-alt', p, 'Tracks');
    this.showHud(false);
  }

  fillMenu(): void {
    TRACKS.forEach((t, i) => {
      const b = bestTime(i), m = medalOf(i, b);
      this.cards[i].innerHTML = `<b>${t.name}</b><span>${t.blurb}</span><i>${b ? `Best ${fmtTime(b)} ${m >= 0 ? MEDALS[m] : ''}` : `Gold ${fmtTime(t.medals[0])}`}</i>`;
    });
  }

  /** n > 0: "3", "2", "1"; 0: "GO!"; < 0: hidden. */
  countdown(n: number): void {
    const txt = n > 0 ? String(n) : n === 0 ? 'GO!' : '';
    if (this.count.textContent === txt) return;
    this.count.textContent = txt;
    this.count.className = 'race-count';
    void this.count.offsetWidth;
    if (txt) this.count.className = 'race-count show';
  }

  showHud(on: boolean): void {
    this.hud.style.display = on ? '' : 'none';
    if (!on) for (const m of this.marks) m.style.display = 'none';
  }

  /** toScreen: world -> CSS px; w: game width (CSS px). */
  update(race: RaceRun, toScreen: (x: number, y: number, out: { x: number; y: number }) => void, w: number, h: number): void {
    const order = race.order(), n = order.length, me = order.indexOf(race.player) + 1;
    const pl = `${ORD(me)} / ${n}`;
    if (pl !== this.shownPlace) {
      this.shownPlace = pl;
      this.place.textContent = pl;
    }
    this.time.textContent = fmtTime(race.player.finish >= 0 ? race.player.finish : race.t);
    this.slip.style.visibility = race.player.drafting ? 'visible' : 'hidden';
    const p = { x: 0, y: 0 };
    race.racers.forEach((r, i) => {
      const d = this.dots[i];
      d.style.left = `${Math.min(100, Math.max(0, (r.bird.x / race.finishX) * 100))}%`;
      d.style.background = r.scarf;
      d.classList.toggle('me', r.player);
      d.classList.toggle('out', r.out);
      const m = this.marks[i];
      if (r.player || r.out) {
        m.style.display = 'none';
        return;
      }
      toScreen(r.bird.x, r.bird.y, p);
      const off = p.x < 0 ? -1 : p.x > w ? 1 : 0;
      if (!off) {
        m.style.display = 'none';
        return;
      }
      m.style.display = '';
      m.style.background = r.scarf;
      m.style.left = off < 0 ? '4px' : `${w - 4}px`;
      m.style.top = `${Math.min(h * 0.7, Math.max(h * 0.2, p.y))}px`;
      m.className = `race-mark ${off < 0 ? 'left' : 'right'}`;
      const gap = Math.abs(r.bird.x - race.run.bird.x) / 30;
      m.textContent = `${off < 0 ? '◀' : ''} ${r.name} ${gap.toFixed(0)}m ${off > 0 ? '▶' : ''}`;
    });
  }

  /** Fill and remember results; returns the medal (-1 none). */
  fillResults(race: RaceRun): number {
    const p = race.player, t = p.finish;
    const prev = bestTime(race.track);
    const newBest = t > 0 && (!prev || t < prev);
    if (newBest) save(`raceBest.${race.track}`, t.toFixed(2));
    const medal = medalOf(race.track, t);
    this.rTitle.textContent = p.out ? 'Fell asleep…' : `${ORD(race.place)} place!`;
    this.rMedal.textContent = `${medal >= 0 ? MEDALS[medal] : 'No medal'}${newBest ? ' · NEW BEST TIME' : prev ? ` · best ${fmtTime(prev)}` : ''}`;
    this.rMedal.classList.toggle('new', newBest);
    this.rRows.innerHTML = race
      .order()
      .map((r, i) => `<div class="r-row${r.player ? ' me' : ''}"><span>${i + 1}. ${r.name}</span><b>${r.out ? 'asleep' : r.finish >= 0 ? fmtTime(r.finish) : `${Math.round((race.finishX - r.bird.x) / 30)} m to go`}</b></div>`)
      .join('');
    return medal;
  }
}
