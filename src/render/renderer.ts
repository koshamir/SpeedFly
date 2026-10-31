import * as THREE from 'three';
import { CONFIG } from '../config';
import type { GameBus } from '../core/events';
import type { Run } from '../sim/run';
import type { TerrainCursor } from '../world/terrain';
import { BirdView } from './birdView';
import { CameraRig } from './camera';
import { CoinsView } from './coinsView';
import { DebugLines } from './debugLines';
import { Fx } from './fx/fx';
import { computeLayout, type Layout } from './layout';
import { newSky, skyAt } from './palette';
import { Clouds, NightFront, Sky } from './sky';
import { TerrainMesh } from './terrainMesh';
import { Water } from './water';

THREE.ColorManagement.enabled = false; // hand-picked sRGB colors pass straight through

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  readonly rig = new CameraRig();
  readonly skyState = newSky();
  layout: Layout;
  /** Interpolated sprite center of the last frame. */
  bx = 0;
  by = 0;
  private run!: Run;
  private cur!: TerrainCursor;
  private snap = true;
  private time = 0;
  private readonly sky = new Sky();
  private readonly clouds = new Clouds();
  private readonly terrain = new TerrainMesh();
  private readonly water = new Water();
  private readonly coins = new CoinsView();
  private readonly bird: BirdView;
  private readonly night = new NightFront();
  readonly fx: Fx;
  private lines: DebugLines | null = null;
  private readonly clear = new THREE.Color();

  constructor(
    canvas: HTMLCanvasElement,
    bus: GameBus,
    private readonly debug: boolean,
  ) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.autoClear = false;
    this.layout = computeLayout(innerWidth, innerHeight, false);
    this.bird = new BirdView(bus);
    this.fx = new Fx(bus);
    this.scene.add(this.sky.mesh, this.clouds.mesh, this.terrain.group, this.water.mesh, this.coins.mesh, this.bird.mesh, this.fx.group, this.night.mesh);
    bus.on('land', (e) => {
      if (e.kind === 'bad') this.rig.shake(CONFIG.camera.shakeBad);
    });
  }

  setRun(run: Run): void {
    this.run = run;
    this.cur = run.world.terrain.cursor();
    this.terrain.reset(run.world);
    this.bird.reset();
    this.fx.reset(run);
    if (this.debug) {
      if (this.lines) this.scene.remove(this.lines.group);
      this.lines = new DebugLines(run.world.terrain.cursor());
      this.lines.group.renderOrder = 9;
      this.scene.add(this.lines.group);
    }
    this.snap = true;
  }

  resize(W: number, H: number, coarse: boolean): Layout {
    this.layout = computeLayout(W, H, coarse);
    this.gl.setPixelRatio(this.layout.dpr);
    this.gl.setSize(W, H, false);
    return this.layout;
  }

  /** World -> CSS px inside the game rect. */
  toScreen(x: number, y: number, out: { x: number; y: number }): void {
    const L = this.layout, r = this.rig;
    out.x = ((x - (r.cx - r.viewW / 2)) / r.viewW) * L.gw;
    out.y = (1 - (y - (r.cy - r.viewH / 2)) / r.viewH) * L.gh;
  }

  frame(dt: number, alpha: number, asleep: boolean): void {
    const run = this.run, b = run.bird, L = this.layout;
    this.time += dt;
    const cx = run.pcx + (run.cx - run.pcx) * alpha;
    const cy = run.pcy + (run.cy - run.pcy) * alpha;
    this.bx = cx;
    this.by = cy;
    this.cur.sample(b.grounded ? b.u : b.x);
    const d1 = this.cur.d1;
    const vx = b.grounded ? b.v / Math.hypot(1, d1) : b.vx;
    this.rig.update(dt, cx, cy, run.speed, vx, this.cur, L.logW, L.logH, this.snap);
    this.snap = false;
    const r = this.rig, cam = this.camera;
    cam.left = -r.viewW / 2;
    cam.right = r.viewW / 2;
    cam.top = r.viewH / 2;
    cam.bottom = -r.viewH / 2;
    cam.position.set(r.cx + r.shakeX, r.cy + r.shakeY, 5);
    cam.updateProjectionMatrix();

    const x0 = r.cx - r.viewW / 2, x1 = r.cx + r.viewW / 2;
    const pxPerWorld = (L.gw * L.dpr) / r.viewW;
    const s = skyAt(run.daylight, this.skyState);
    const margin = CONFIG.render.meshStep * 4;
    this.sky.update(s, L.gw / L.gh, this.time, r.cx, r.cy, r.z, L.logW, L.logH);
    this.clouds.update(r.cx, r.cy, r.z, r.viewW, r.viewH, L.logW, this.time, s);
    this.terrain.update(x0 - margin, x1 + margin, pxPerWorld, s.grade);
    this.water.update(run.world, x0, x1, this.time, pxPerWorld, s.grade, s.horizon);
    this.coins.update(run.world, x0 - margin, x1 + margin, this.time, s.grade);
    this.bird.update(dt, run, cx, cy, d1, r.birdScale, asleep);
    this.fx.update(dt, x0, r.cy - r.viewH / 2, r.z);
    this.night.update(x0, x1, run.night.x);
    this.lines?.update(run, x0 - margin, x1 + margin, cx, cy);

    // side bars (desktop) take the sky color
    this.clear.setRGB((s.top[0] + s.horizon[0]) / 2, (s.top[1] + s.horizon[1]) / 2, (s.top[2] + s.horizon[2]) / 2);
    const gl = this.gl;
    gl.setScissorTest(false);
    gl.setClearColor(this.clear, 1);
    gl.clear();
    gl.setViewport(L.gx, L.H - L.gy - L.gh, L.gw, L.gh);
    gl.setScissor(L.gx, L.H - L.gy - L.gh, L.gw, L.gh);
    gl.setScissorTest(true);
    gl.render(this.scene, cam);
  }
}
