import { el } from './hud';

// "How to play" card (shown before the first run, and from the title's "?" button): three illustrated
// steps of the one-button loop + the goal in one line. Closes with a tap on the button.

const INK = '#241B3A';
const BIRD = (x: number, y: number, rot = 0): string =>
  `<g transform="translate(${x} ${y}) rotate(${rot})"><path d="M-14 -2 q-14 -4 -22 4" stroke="#E8414A" stroke-width="5" fill="none" stroke-linecap="round"/><circle r="11" fill="#FFF7EA" stroke="${INK}" stroke-width="3"/><circle cx="4" cy="-3" r="2.6" fill="${INK}"/><path d="M10 0 l8 2 l-8 3z" fill="#FFC93C" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/></g>`;
const FINGER = (x: number, y: number, down: boolean): string =>
  `<g transform="translate(${x} ${y}) scale(0.55)" opacity="${down ? 1 : 0.55}"><path d="M24 6c4 0 7 3 7 7v22l14 3c5 1 8 5 7 10l-3 18c-1 6-6 10-12 10H25c-4 0-7-2-9-5L6 54c-2-3-1-7 2-9 3-2 7-1 9 2l1 2V13c0-4 3-7 6-7z" fill="#fff" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>${down ? `<circle cx="24" cy="2" r="16" fill="none" stroke="#5CFF7A" stroke-width="5"/>` : ''}</g>`;

const CARDS: { svg: string; title: string; text: string }[] = [
  {
    title: 'HOLD',
    text: 'Hold your finger while the bird goes DOWNHILL — it speeds up.',
    svg: `<svg viewBox="0 0 160 110"><path d="M0 26 C 60 26, 90 96, 160 96 L160 110 L0 110Z" fill="#4CC06B"/><path d="M0 26 C 60 26, 90 96, 160 96" fill="none" stroke="#5CFF7A" stroke-width="5"/>${BIRD(70, 44, 38)}<path d="M92 66 l14 10 M86 74 l14 10" stroke="#fff" stroke-width="3" stroke-linecap="round"/>${FINGER(118, 20, true)}</svg>`,
  },
  {
    title: 'LET GO',
    text: 'Release on the UPHILL — the bird launches into the sky.',
    svg: `<svg viewBox="0 0 160 110"><path d="M0 96 C 70 96, 90 40, 130 40 L160 50 L160 110 L0 110Z" fill="#F6C85F"/><path d="M0 96 C 70 96, 90 40, 130 40" fill="none" stroke="#FFB020" stroke-width="5"/><path d="M118 38 q20 -30 38 -32" stroke="#fff" stroke-width="3" stroke-dasharray="4 5" fill="none"/>${BIRD(132, 22, -40)}${FINGER(20, 16, false)}</svg>`,
  },
  {
    title: 'TAP TO LAND',
    text: 'In the air, hold to dive and touch down ALONG a downhill: GREAT! 3 in a row = FEVER.',
    svg: `<svg viewBox="0 0 160 110"><path d="M0 40 C 50 40, 90 104, 160 104 L160 110 L0 110Z" fill="#B388EB"/><path d="M0 40 C 50 40, 90 104, 160 104" fill="none" stroke="#FFF1D6" stroke-width="4"/><path d="M14 12 q30 -4 50 30" stroke="#fff" stroke-width="3" stroke-dasharray="4 5" fill="none"/>${BIRD(70, 52, 36)}<text x="96" y="40" font-family="Lilita One, sans-serif" font-size="20" fill="#B6FF5C" stroke="${INK}" stroke-width="5" paint-order="stroke">GREAT!</text>${FINGER(124, 54, true)}</svg>`,
  },
];

export class Tutorial {
  readonly root: HTMLDivElement;
  readonly close: HTMLButtonElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'screen tutorial');
    parent.appendChild(this.root);
    this.root.setAttribute('data-ui', '');
    el('div', 'tut-title', this.root, 'HOW TO FLY');
    const row = el('div', 'tut-cards', this.root);
    CARDS.forEach((c, i) => {
      const card = el('div', 'tut-card', row);
      card.style.animationDelay = `${0.1 + i * 0.12}s`;
      const pic = el('div', 'tut-pic', card);
      pic.innerHTML = c.svg;
      el('b', '', card, `${i + 1}. ${c.title}`);
      el('span', '', card, c.text);
    });
    el('div', 'tut-goal', this.root, 'Speed and GREAT landings buy daylight. Outrun the night!');
    this.close = el('button', 'btn btn-main', this.root, "LET'S FLY!");
    this.close.setAttribute('data-ui', '');
  }

  show(on: boolean): void {
    this.root.classList.toggle('visible', on);
  }
}
