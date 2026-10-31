import * as THREE from 'three';
import { CONFIG } from '../config';
import { EventBus, type GameEvents } from '../core/events';
import type { RaceRun, Racer } from '../sim/race';
import type { Run } from '../sim/run';
import type { TerrainCursor } from '../world/terrain';
import { BirdView } from './birdView';
import type { RGB } from './palette';

// Race visuals: the AI birds (the same rig, own scarf colour; 2 draws each), the finish banner and the
// boost rings (rings track). Created once, reused across races.

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  return new THREE.CanvasTexture(cv);
}

/** What BirdView reads from a Run, for an AI bird. */
interface Subject {
  bird: Racer['bird'];
  speed: number;
  held: boolean;
  started: boolean;
  fever: boolean;
  flightK: number;
  world: Run['world'];
}

export class RaceView {
  readonly group = new THREE.Group();
  private readonly views: BirdView[] = [];
  private readonly subjects: Subject[] = [];
  private readonly finish: THREE.Mesh;
  private readonly rings: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private race: RaceRun | null = null;
  private cur: TerrainCursor | null = null;

  constructor() {
    const ink = CONFIG.colors.outline;
    const fin = canvasTex(128, 512, (g) => {
      // checkered banner on two poles
      const s = 32;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
        g.fillStyle = (x + y) % 2 ? '#ffffff' : ink;
        g.fillRect(x * s, y * s, s, s);
      }
      g.fillStyle = ink;
      g.fillRect(0, 256, 128, 8);
      g.fillStyle = '#ffd23f';
      g.fillRect(56, 256, 16, 256);
    });
    this.finish = new THREE.Mesh(new THREE.PlaneGeometry(1, 4), new THREE.MeshBasicMaterial({ map: fin, transparent: true, depthTest: false, depthWrite: false }));
    this.finish.frustumCulled = false;
    this.finish.renderOrder = 5.1;
    const ring = canvasTex(256, 256, (g) => {
      g.translate(128, 128);
      g.lineWidth = 26;
      g.strokeStyle = ink;
      g.beginPath();
      g.ellipse(0, 0, 70, 110, 0, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 14;
      g.strokeStyle = '#3fd5ff';
      g.stroke();
      g.lineWidth = 4;
      g.strokeStyle = '#ffffff';
      g.beginPath();
      g.ellipse(-6, -6, 66, 104, 0, Math.PI * 1.1, Math.PI * 1.6);
      g.stroke();
    });
    this.rings = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: ring, transparent: true, depthTest: false, depthWrite: false }),
      64,
    );
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 6.5;
    this.rings.count = 0;
    this.group.add(this.finish, this.rings);
    this.group.visible = false;
  }

  set(race: RaceRun | null): void {
    this.race = race;
    this.group.visible = !!race;
    for (const v of this.views) v.mesh.visible = false;
    if (!race) return;
    this.cur = race.run.world.terrain.cursor();
    const dummy = new EventBus<GameEvents>();
    race.ais.forEach((a, i) => {
      if (i >= this.views.length) {
        const v = new BirdView(dummy);
        this.views.push(v);
        this.group.add(v.mesh);
        this.subjects.push({ bird: a.bird, speed: 0, held: false, started: true, fever: false, flightK: 0, world: race.run.world });
      }
      const s = this.subjects[i];
      s.bird = a.bird;
      s.world = race.run.world;
      this.views[i].reset(s as unknown as Run);
      this.views[i].setScarf(a.scarf);
      this.views[i].mesh.visible = true;
    });
  }

  update(dt: number, alpha: number, x0: number, x1: number, scale: number, grade: RGB, asleep: boolean): void {
    const race = this.race, cur = this.cur;
    if (!race || !cur) return;
    race.ais.forEach((a, i) => {
      const v = this.views[i], s = this.subjects[i];
      const x = a.px + (a.bird.x - a.px) * alpha, y = a.py + (a.bird.y - a.py) * alpha;
      v.mesh.visible = x > x0 - 300 && x < x1 + 300;
      if (!v.mesh.visible) return;
      s.speed = a.bird.grounded ? a.bird.v : Math.hypot(a.bird.vx, a.bird.vy);
      s.held = a.held;
      cur.sample(a.bird.grounded ? a.bird.u : a.bird.x);
      v.update(dt, s as unknown as Run, x, y, cur.d1, scale, asleep || a.out, grade);
    });
    // finish banner
    const fx = race.finishX, fs = 110 * scale;
    this.finish.visible = fx > x0 - 400 && fx < x1 + 400;
    this.finish.scale.set(fs, fs, 1);
    this.finish.position.set(fx, cur.height(fx) + fs * 2, 0);
    // boost rings in view
    const T = race.run.world.track!, m = this.m, R = CONFIG.race;
    let n = 0;
    for (let i = 0; i < T.ringX.length && n < 64; i++) {
      const x = T.ringX[i];
      if (x < x0 - 300) continue;
      if (x > x1 + 300) break;
      m.makeScale(R.ringRadius * 2.2, R.ringRadius * 2.2, 1);
      m.setPosition(x, T.ringY[i], 0);
      this.rings.setMatrixAt(n++, m);
    }
    this.rings.count = n;
    this.rings.instanceMatrix.needsUpdate = true;
  }
}
