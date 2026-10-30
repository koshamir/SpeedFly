import GUI from 'lil-gui';
import { CONFIG } from '../config';
import type { Run } from '../sim/run';
import type { TerrainCursor } from '../world/terrain';

// ?debug=1: lil-gui over the whole config (live), FPS and a physics readout.
type Obj = Record<string, unknown>;

function addFolder(gui: GUI, name: string, obj: Obj): void {
  const f = gui.addFolder(name);
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number') f.add(obj, k);
    else if (typeof v === 'string' && v.startsWith('#')) f.addColor(obj, k);
    else if (Array.isArray(v)) {
      const arr = v as unknown[];
      if (arr.every((x) => typeof x === 'number')) arr.forEach((_, i) => f.add(arr as unknown as Obj, String(i)).name(`${k}[${i}]`));
      else arr.forEach((x, i) => typeof x === 'object' && x && addFolder(f, `${k}[${i}]`, x as Obj));
    } else if (v && typeof v === 'object') addFolder(f, k, v as Obj);
  }
  f.close();
}

export class Debug {
  private readonly el: HTMLDivElement;
  private readonly gui: GUI;
  private fps = 60;
  private cur: TerrainCursor | null = null;
  private curRun: Run | null = null;

  constructor(
    parent: HTMLElement,
    private readonly getRun: () => Run,
    actions: { restart: () => void },
  ) {
    const gui = (this.gui = new GUI({ title: 'Sunset Dash config' }));
    gui.domElement.setAttribute('data-ui', '');
    gui.domElement.style.zIndex = '50';
    for (const [k, v] of Object.entries(CONFIG)) {
      if (Array.isArray(v)) addFolder(gui, k, { [k]: v });
      else addFolder(gui, k, v as Obj);
    }
    gui.add(
      {
        copy: () => {
          const json = JSON.stringify(CONFIG, null, 2);
          void navigator.clipboard?.writeText(json).catch(() => console.log(json));
          console.log(json);
        },
      },
      'copy',
    ).name('Copy config JSON');
    gui.add(actions, 'restart').name('Restart run');
    if (matchMedia('(pointer: coarse)').matches) gui.close();

    this.el = document.createElement('div');
    this.el.className = 'debug-readout';
    parent.appendChild(this.el);
  }

  /** CONFIG changed from outside (tuning.json reload, Tune panel): show the new values. */
  refresh(): void {
    for (const c of this.gui.controllersRecursive()) c.updateDisplay();
  }

  frame(dt: number, steps: number, zoom: number, held: boolean): void {
    if (dt > 0) this.fps += (1 / dt - this.fps) * CONFIG.debug.fpsSmooth;
    const r = this.getRun(), b = r.bird;
    if (r !== this.curRun) {
      this.curRun = r;
      this.cur = r.world.terrain.cursor();
    }
    // clearance of the circle above the ground under its center (bird.x/y is the CENTER, bird.u the contact x)
    this.cur!.sample(b.u);
    const alt = b.grounded ? 0 : b.y - this.cur!.y - CONFIG.physics.birdRadius / Math.hypot(1, this.cur!.d1);
    this.el.textContent =
      `fps ${this.fps.toFixed(0)}  steps ${steps}\n` +
      `${b.grounded ? 'GROUND' : 'AIR'}  held ${held ? 1 : 0}\n` +
      `v ${r.speed.toFixed(0)} px/s  N ${b.grounded ? b.N.toFixed(0) : '-'}\n` +
      `x ${b.x.toFixed(0)}  alt ${alt.toFixed(0)}\n` +
      `land ${r.lastKind || '-'} ${r.lastAngle.toFixed(1)}°  streak ${b.streak}\n` +
      `zoom ${zoom.toFixed(2)}  day ${r.daylight.toFixed(2)}  gap ${(b.x - r.night.x).toFixed(0)}\n` +
      `t ${r.t.toFixed(1)}  seed ${r.seed}`;
  }
}
