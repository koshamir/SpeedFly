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
import { hexRgb, newSky, skyAt, type RGB } from './palette';
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
  /** Draw calls of the last frame (budget <= 30). */
  drawCalls = 0;
  /** Touch Teacher rim strength (set by main). */
  teacher = 0;
  private feverK = 0;
  private prevBx = 0;
  /** A visual bump was hit (main plays the sound). */
  onBump: (() => void) | null = null;
  private dprCap = Infinity;
  private grainK = 1;
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
  // island palette mood for the sky / parallax (crossfades over the sea)
  private readonly islDark: RGB = [0, 0, 0];
  private readonly islRim: RGB = [0, 0, 0];
  private readonly pa: RGB = [0, 0, 0];
  private readonly pb: RGB = [0, 0, 0];
  private readonly pc: RGB = [0, 0, 0];

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
    this.fx.onSonic = () => this.rig.shake(CONFIG.camera.shakeSonic);
    this.scene.add(this.sky.mesh, this.clouds.mesh, this.terrain.group, this.water.mesh, this.coins.mesh, this.bird.mesh, this.fx.group, this.night.mesh);
    bus.on('land', (e) => {
      if (e.kind === 'bad') this.rig.shake(CONFIG.camera.shakeBad);
    });

  }

  setRun(run: Run): void {
    this.run = run;
    this.cur = run.world.terrain.cursor();
    this.terrain.reset(run.world);
    this.bird.reset(run);
    this.fx.reset(run);
    if (this.debug) {
      if (this.lines) this.scene.remove(this.lines.group);
      this.lines = new DebugLines(run.world.terrain.cursor());
      this.lines.group.renderOrder = 9;
      this.scene.add(this.lines.group);
    }
    this.snap = true;
  }

  /** Dark band + rim of the island palette under x; over the sea they crossfade to the next island's. */
  private islandMood(x: number): void {
    const w = this.run.world, P = CONFIG.palettes;
    let a = w.islandAt(x).palette, b = a, f = 0;
    const gap = w.waterAt(x);
    if (gap) {
      a = gap.palette;
      b = w.islands[gap.k]?.palette ?? a; // islands[k - 1] is island k
      const t = Math.min(1, Math.max(0, (x - gap.lipX) / Math.max(1, gap.landingX - gap.lipX)));
      f = t * t * (3 - 2 * t);
    }
    this.darkest(P[a].bands, this.pa);
    this.darkest(P[b].bands, this.pb);
    for (let i = 0; i < 3; i++) this.islDark[i] = this.pa[i] + (this.pb[i] - this.pa[i]) * f;
    hexRgb(P[a].rim, this.pa);
    hexRgb(P[b].rim, this.pb);
    for (let i = 0; i < 3; i++) this.islRim[i] = this.pa[i] + (this.pb[i] - this.pa[i]) * f;
  }

  private darkest(bands: string[], out: RGB): void {
    let best = Infinity;
    const c = this.pc;
    for (const h of bands) {
      hexRgb(h, c);
      const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
      if (l < best) {
        best = l;
        out[0] = c[0];
        out[1] = c[1];
        out[2] = c[2];
      }
    }
  }

  /** Visual bumps on a mountain descent: a sprite kick, dust, a camera nudge and onBump (audio). */
  private bumps(x: number, grounded: boolean): void {
    if (!grounded || x <= this.prevBx) return;
    const B = this.run.world.islandAt(x).bumps;
    for (let i = 0; i < B.length; i++)
      if (this.prevBx < B[i] && x >= B[i]) {
        this.rig.shake(CONFIG.camera.bumpShake);
        this.bird.kick();
        this.fx.bumpDust(B[i], this.cur.height(B[i]) + CONFIG.islands.bumpH);
        this.onBump?.();
      }
  }

  /** Quality level (render/quality.ts): DPR cap, particle budget, grain. */
  setQuality(dpr: number, particles: number, grain: number): void {
    this.dprCap = dpr;
    this.fx.particles.limit = particles;
    this.grainK = grain;
  }

  resize(W: number, H: number, coarse: boolean): Layout {
    this.layout = computeLayout(W, H, coarse, this.dprCap);
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

  /** live = the run is being played (not title / paused / results): FX time runs only then. */
  frame(dt: number, alpha: number, asleep: boolean, live: boolean): void {
    const run = this.run, b = run.bird, L = this.layout;
    this.time += dt;
    const cx = run.pcx + (run.cx - run.pcx) * alpha;
    const cy = run.pcy + (run.cy - run.pcy) * alpha;
    this.bx = cx;
    this.by = cy;
    this.cur.sample(b.grounded ? b.u : b.x);
    const d1 = this.cur.d1;
    const vx = b.grounded ? b.v / Math.hypot(1, d1) : b.vx;
    this.rig.update(dt, cx, cy, run.speed, vx, this.cur, L.logW, L.logH, this.snap, run.world.islands);
    this.snap = false;
    if (live) this.bumps(cx, b.grounded);
    this.prevBx = cx;
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
    this.islandMood(cx);
    this.sky.update(s, L.gw / L.gh, this.time, r.cx, r.cy, r.z, L.logW, L.logH, this.islDark, this.islRim);
    this.clouds.update(r.cx, r.cy, r.z, r.viewW, r.viewH, L.logW, this.time, s);
    this.terrain.update(x0 - margin, x1 + margin, pxPerWorld, s.grade, this.teacher, this.grainK);
    this.water.update(run.world, x0, x1, this.time, pxPerWorld, s.grade, s.horizon);
    this.coins.update(run.world, x0 - margin, x1 + margin, this.time, s.grade, run.sky);
    this.bird.update(dt, run, cx, cy, d1, r.birdScale, asleep, s.grade);
    this.fx.update(live || asleep ? dt : 0, cx, cy, r.birdScale, x0, r.cy - r.viewH / 2, r.z, L.logW, L.logH, s.grade, live, r.cine, r.descent);
    this.night.update(x0, x1, run.night.x, L.gw / L.gh, r.cine * CONFIG.fx.glare * (1 - s.night), CONFIG.render.sunX, s.sunY, s.sun, this.time);
    // Fever: pulsing hue-cycling screen tint (edges weighted)
    const J = CONFIG.juice, tint = this.night.tint;
    this.feverK += ((run.fever && live ? 1 : 0) - this.feverK) * (1 - Math.exp(-dt * 4));
    const h = this.time * 0.5 * Math.PI * 2;
    tint.set(0.75 + 0.25 * Math.cos(h), 0.6 + 0.3 * Math.cos(h - 2.1), 0.7 + 0.3 * Math.cos(h - 4.2), this.feverK * (J.feverTint + J.feverPulse * Math.sin(this.time * 9)));
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
    this.drawCalls = gl.info.render.calls;
  }
}
