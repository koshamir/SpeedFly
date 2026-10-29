import * as THREE from 'three';
import { CONFIG } from '../config';
import type { GameBus } from '../core/events';
import type { Run } from '../sim/run';
import type { TerrainCursor } from '../world/terrain';
import { CameraRig } from './camera';
import { DebugLines } from './debugLines';
import { computeLayout, type Layout } from './layout';
import { newSky, skyAt } from './palette';

THREE.ColorManagement.enabled = false; // hand-picked sRGB colors pass straight through

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  readonly rig = new CameraRig();
  layout: Layout;
  private run!: Run;
  private cur!: TerrainCursor;
  private lines: DebugLines | null = null;
  private snap = true;
  private readonly sky = newSky();
  private readonly clear = new THREE.Color();
  // interpolated sprite center of the last frame
  bx = 0;
  by = 0;

  constructor(
    canvas: HTMLCanvasElement,
    bus: GameBus,
  ) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.autoClear = false;
    this.layout = computeLayout(innerWidth, innerHeight, false);
    bus.on('land', (e) => {
      if (e.kind === 'bad') this.rig.shake(CONFIG.camera.shakeBad);
    });
  }

  setRun(run: Run): void {
    this.run = run;
    this.cur = run.world.terrain.cursor();
    if (this.lines) this.scene.remove(this.lines.group);
    this.lines = new DebugLines(run.world.terrain.cursor());
    this.scene.add(this.lines.group);
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

  frame(dt: number, alpha: number): void {
    const run = this.run, b = run.bird, L = this.layout;
    const cx = run.pcx + (run.cx - run.pcx) * alpha;
    const cy = run.pcy + (run.cy - run.pcy) * alpha;
    this.bx = cx;
    this.by = cy;
    this.cur.sample(b.x);
    const vx = b.grounded ? b.v / Math.hypot(1, this.cur.d1) : b.vx;
    this.rig.update(dt, cx, cy, run.speed, vx, this.cur, L.logW, L.logH, this.snap);
    this.snap = false;
    const r = this.rig;
    const cam = this.camera;
    cam.left = -r.viewW / 2;
    cam.right = r.viewW / 2;
    cam.top = r.viewH / 2;
    cam.bottom = -r.viewH / 2;
    cam.position.set(r.cx + r.shakeX, r.cy + r.shakeY, 5);
    cam.updateProjectionMatrix();

    const x0 = r.cx - r.viewW / 2, x1 = r.cx + r.viewW / 2;
    this.lines?.update(run, x0 - CONFIG.render.meshStep, x1 + CONFIG.render.meshStep, cx, cy, r.birdScale);

    skyAt(run.daylight, this.sky);
    const s = this.sky;
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
