import * as THREE from 'three';
import { CONFIG } from '../config';
import type { GameBus } from '../core/events';
import type { Run } from '../sim/run';
import type { TerrainCursor } from '../world/terrain';
import { SpriteBatch } from './fx/sprites';
import { hexRgb, type RGB } from './palette';
import ribbonFrag from './shaders/ribbon.frag.glsl?raw';
import ribbonVert from './shaders/ribbon.vert.glsl?raw';

// The character (§7.5): a cut-out rig. Parts are drawn with Canvas2D into an atlas at load (4x4
// cells, one cell = 4R x 4R around the part's pivot) and placed on instanced quads (one draw).
// Any part can be replaced by a PNG of the same framing via CONFIG.birdParts (no code changes).
// The scarf is a verlet chain drawn as an outlined ribbon. The physics circle centre is the rig origin.

const CELL = 256;
const GRID = 4;
const U = CELL / 4; // texture px per R

/** Atlas cells (also the keys of CONFIG.birdParts). */
const PART = {
  body: 0,
  belly: 1,
  wing: 2,
  beak: 3,
  faceOpen: 4,
  faceSquint: 5,
  faceHappy: 6,
  faceSparkle: 7,
  faceSleep: 8,
  faceDizzy: 9,
  sweat: 10,
  nest: 11,
  aura: 12,
} as const;
type PartName = keyof typeof PART;

const C = {
  body: '#FFF7EA',
  shade: '#CBBDF0',
  wing: '#B9A6E8',
  wingLight: '#D6CBF5',
  beak: '#FFC23D',
  beakShade: '#F29A2E',
  lens: '#FFB02E',
  lensLight: '#FFE09A',
  lid: '#E39A3B',
  strap: '#6B4A3A',
  scarf: '#E8414A',
  scarfShade: '#B92F45',
  blush: 'rgba(255,120,150,0.6)',
  sweat: '#8FE3FF',
  twig: '#C98B4A',
  twigDark: '#8A5631',
  straw: '#E7B66A',
};

function drawPart(g: CanvasRenderingContext2D, name: PartName): void {
  const R = U, out = CONFIG.colors.outline, lw = R * 0.16;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = out;
  const strapPath = (): void => {
    g.beginPath();
    g.moveTo(-1.28 * R, 0.14 * R);
    g.quadraticCurveTo(-0.66 * R, -0.16 * R, 0, -0.04 * R);
  };
  const strap = (): void => {
    g.lineWidth = 0.34 * R;
    g.stroke();
    g.lineWidth = 0.18 * R;
    g.strokeStyle = C.strap;
    g.stroke();
    g.strokeStyle = out;
  };
  const lens = (er: number, eye: (er: number) => void, withStrap = true): void => {
    // strap across the head, behind the lens
    if (withStrap) {
      strapPath();
      strap();
    }
    g.beginPath();
    g.arc(0, 0, er, 0, Math.PI * 2);
    g.fillStyle = C.lens;
    g.fill();
    g.beginPath();
    g.arc(-er * 0.12, -er * 0.12, er * 0.72, 0, Math.PI * 2);
    g.fillStyle = C.lensLight;
    g.fill();
    eye(er);
    g.beginPath();
    g.arc(0, 0, er, 0, Math.PI * 2);
    g.lineWidth = lw;
    g.stroke();
    // glass glint
    g.beginPath();
    g.ellipse(-er * 0.42, -er * 0.45, er * 0.2, er * 0.11, -0.7, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fill();
  };
  const er = 0.42 * R;
  switch (name) {
    case 'body': {
      const r = R - lw / 2;
      g.save();
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = C.shade;
      g.fillRect(-R, -R, 2 * R, 2 * R);
      g.beginPath();
      g.arc(-0.12 * R, -0.16 * R, 0.88 * R, 0, Math.PI * 2);
      g.fillStyle = C.body;
      g.fill();
      g.beginPath();
      g.ellipse(-0.38 * R, -0.52 * R, 0.24 * R, 0.13 * R, -0.6, 0, Math.PI * 2);
      g.fillStyle = '#FFFFFF';
      g.fill();
      // scarf wrapped around the neck
      g.beginPath();
      g.moveTo(-R, 0.06 * R);
      g.quadraticCurveTo(0, 0.36 * R, R, 0.02 * R);
      g.lineTo(R, 0.36 * R);
      g.quadraticCurveTo(0, 0.7 * R, -R, 0.4 * R);
      g.closePath();
      g.fillStyle = C.scarf;
      g.fill();
      g.beginPath();
      g.moveTo(-R, 0.3 * R);
      g.quadraticCurveTo(0, 0.6 * R, R, 0.26 * R);
      g.lineTo(R, 0.36 * R);
      g.quadraticCurveTo(0, 0.7 * R, -R, 0.4 * R);
      g.closePath();
      g.fillStyle = C.scarfShade;
      g.fill();
      g.beginPath();
      g.moveTo(-R, 0.06 * R);
      g.quadraticCurveTo(0, 0.36 * R, R, 0.02 * R);
      g.moveTo(R, 0.36 * R);
      g.quadraticCurveTo(0, 0.7 * R, -R, 0.4 * R);
      g.lineWidth = lw * 0.6;
      g.stroke();
      g.restore();
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.lineWidth = lw;
      g.stroke();
      break;
    }
    case 'belly':
      g.beginPath();
      g.ellipse(0, 0, 0.36 * R, 0.17 * R, -0.35, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,253,246,0.9)';
      g.fill();
      break;
    case 'wing': {
      // pivot = root; the wing points back (-x)
      g.beginPath();
      g.moveTo(0.12 * R, -0.12 * R);
      g.bezierCurveTo(-0.3 * R, -0.36 * R, -0.85 * R, -0.3 * R, -1.02 * R, 0.02 * R);
      g.lineTo(-0.82 * R, 0.06 * R);
      g.lineTo(-0.92 * R, 0.2 * R);
      g.lineTo(-0.7 * R, 0.2 * R);
      g.bezierCurveTo(-0.5 * R, 0.36 * R, -0.05 * R, 0.3 * R, 0.12 * R, 0.12 * R);
      g.closePath();
      g.fillStyle = C.wing;
      g.fill();
      g.save();
      g.clip();
      g.beginPath();
      g.ellipse(-0.36 * R, -0.12 * R, 0.5 * R, 0.13 * R, 0.1, 0, Math.PI * 2);
      g.fillStyle = C.wingLight;
      g.fill();
      g.restore();
      g.lineWidth = lw * 0.85;
      g.stroke();
      break;
    }
    case 'beak':
      g.beginPath();
      g.moveTo(-0.08 * R, -0.22 * R);
      g.quadraticCurveTo(0.3 * R, -0.18 * R, 0.56 * R, 0.04 * R);
      g.quadraticCurveTo(0.3 * R, 0.22 * R, -0.08 * R, 0.26 * R);
      g.closePath();
      g.fillStyle = C.beak;
      g.fill();
      g.beginPath();
      g.moveTo(-0.08 * R, 0.06 * R);
      g.lineTo(0.5 * R, 0.06 * R);
      g.quadraticCurveTo(0.3 * R, 0.22 * R, -0.08 * R, 0.26 * R);
      g.closePath();
      g.fillStyle = C.beakShade;
      g.fill();
      g.beginPath();
      g.moveTo(-0.08 * R, -0.22 * R);
      g.quadraticCurveTo(0.3 * R, -0.18 * R, 0.56 * R, 0.04 * R);
      g.quadraticCurveTo(0.3 * R, 0.22 * R, -0.08 * R, 0.26 * R);
      g.lineWidth = lw * 0.8;
      g.stroke();
      break;
    case 'faceOpen':
      lens(er, (e) => {
        g.beginPath();
        g.arc(e * 0.18, e * 0.04, e * 0.46, 0, Math.PI * 2);
        g.fillStyle = out;
        g.fill();
        g.beginPath();
        g.arc(e * 0.04, -e * 0.12, e * 0.17, 0, Math.PI * 2);
        g.fillStyle = '#fff';
        g.fill();
      });
      break;
    case 'faceSquint':
      // determined: pupil under a heavy lid
      lens(er, (e) => {
        g.beginPath();
        g.arc(e * 0.18, e * 0.12, e * 0.42, 0, Math.PI * 2);
        g.fillStyle = out;
        g.fill();
        g.beginPath();
        g.arc(0, 0, e, Math.PI * 1.06, Math.PI * 1.94);
        g.quadraticCurveTo(0, -e * 0.02, -e * 0.98, -e * 0.24);
        g.closePath();
        g.fillStyle = C.lid;
        g.fill();
        g.lineWidth = lw * 0.8;
        g.stroke();
      });
      break;
    case 'faceHappy':
      lens(er, (e) => {
        g.beginPath();
        g.arc(e * 0.05, e * 0.2, e * 0.42, Math.PI * 1.15, Math.PI * 1.85);
        g.lineWidth = lw * 0.9;
        g.stroke();
      });
      g.beginPath();
      g.arc(0.1 * R, 0.5 * R, 0.16 * R, 0, Math.PI * 2);
      g.fillStyle = C.blush;
      g.fill();
      break;
    case 'faceSparkle':
      lens(er, (e) => {
        g.beginPath();
        g.arc(e * 0.2, e * 0.04, e * 0.48, 0, Math.PI * 2);
        g.fillStyle = out;
        g.fill();
        g.fillStyle = '#fff';
        g.beginPath();
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4, r = k % 2 ? e * 0.07 : e * 0.3;
          g.lineTo(e * 0.12 + Math.cos(a) * r, -e * 0.06 + Math.sin(a) * r);
        }
        g.closePath();
        g.fill();
      });
      break;
    case 'faceSleep':
      // goggles pushed up on the forehead, eye closed, blush
      // body centre is at (-0.4R, +0.3R) from the face pivot (canvas y down)
      g.beginPath();
      g.arc(-0.4 * R, 0.3 * R, 0.9 * R, -Math.PI * 0.92, -Math.PI * 0.36);
      strap();
      g.save();
      g.translate(-0.02 * R, -0.52 * R);
      g.rotate(0.35);
      g.scale(0.8, 0.62);
      lens(er, () => undefined, false);
      g.restore();
      g.beginPath();
      g.arc(0.04 * R, 0.02 * R, 0.2 * R, 0.15 * Math.PI, 0.85 * Math.PI);
      g.lineWidth = lw * 0.85;
      g.stroke();
      g.beginPath();
      g.arc(0.14 * R, 0.36 * R, 0.15 * R, 0, Math.PI * 2);
      g.fillStyle = C.blush;
      g.fill();
      break;
    case 'faceDizzy':
      lens(er, (e) => {
        g.beginPath();
        for (let k = 0; k <= 40; k++) {
          const a = k * 0.42, r = (k / 40) * e * 0.6;
          g.lineTo(e * 0.1 + Math.cos(a) * r, Math.sin(a) * r);
        }
        g.lineWidth = lw * 0.6;
        g.stroke();
      });
      break;
    case 'sweat':
      g.beginPath();
      g.moveTo(0, -0.34 * R);
      g.quadraticCurveTo(0.24 * R, 0.02 * R, 0.2 * R, 0.14 * R);
      g.arc(0, 0.14 * R, 0.2 * R, 0, Math.PI);
      g.quadraticCurveTo(-0.24 * R, 0.02 * R, 0, -0.34 * R);
      g.fillStyle = C.sweat;
      g.fill();
      g.lineWidth = lw * 0.6;
      g.stroke();
      break;
    case 'nest': {
      const bowl = (): void => {
        g.beginPath();
        g.moveTo(-1.35 * R, -0.22 * R);
        g.bezierCurveTo(-1.3 * R, 0.55 * R, 1.3 * R, 0.55 * R, 1.35 * R, -0.22 * R);
        g.closePath();
      };
      bowl();
      g.fillStyle = C.twig;
      g.fill();
      g.save();
      bowl();
      g.clip();
      g.strokeStyle = C.twigDark;
      g.lineWidth = 0.06 * R;
      for (let k = -7; k <= 7; k++) {
        g.beginPath();
        g.moveTo(k * 0.2 * R - 0.3 * R, -0.3 * R);
        g.lineTo(k * 0.2 * R + 0.3 * R, 0.6 * R);
        g.moveTo(k * 0.2 * R + 0.3 * R, -0.3 * R);
        g.lineTo(k * 0.2 * R - 0.3 * R, 0.6 * R);
        g.stroke();
      }
      g.restore();
      bowl();
      g.lineWidth = lw;
      g.strokeStyle = out;
      g.stroke();
      // bumpy straw rim
      for (let k = 0; k < 7; k++) {
        const x = (-1.2 + k * 0.4) * R, y = -0.2 * R + Math.abs(k - 3) * 0.02 * R;
        g.beginPath();
        g.ellipse(x, y, 0.27 * R, 0.16 * R, (k - 3) * 0.12, 0, Math.PI * 2);
        g.fillStyle = k % 2 ? C.straw : C.twig;
        g.fill();
        g.lineWidth = lw * 0.7;
        g.stroke();
      }
      break;
    }
    case 'aura': {
      const gr = g.createRadialGradient(0, 0, 0.5 * R, 0, 0, 2 * R);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)');
      gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(-2 * R, -2 * R, 4 * R, 4 * R);
      break;
    }
  }
}

function buildAtlas(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = CELL * GRID;
  const g = cv.getContext('2d')!;
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  const origin = (i: number): [number, number] => [(i % GRID) * CELL, Math.floor(i / GRID) * CELL];
  for (const name of Object.keys(PART) as PartName[]) {
    const [ox, oy] = origin(PART[name]);
    g.save();
    g.translate(ox + CELL / 2, oy + CELL / 2);
    drawPart(g, name);
    g.restore();
    // PNG override: same framing (pivot at the image centre, image = 4R x 4R)
    const url = (CONFIG.birdParts as Record<string, string>)[name];
    if (url) {
      const img = new Image();
      img.onload = () => {
        g.clearRect(ox, oy, CELL, CELL);
        g.drawImage(img, ox, oy, CELL, CELL);
        tex.needsUpdate = true;
      };
      img.src = url;
    }
  }
  return tex;
}

/** Damped spring, semi-implicit step. s = [value, velocity]. */
function spring(s: number[], target: number, k: number, damp: number, dt: number): number {
  s[1] += ((target - s[0]) * k - s[1] * damp) * dt;
  s[0] += s[1] * dt;
  return s[0];
}

const N = 8; // scarf nodes

export class BirdView {
  readonly mesh = new THREE.Group();
  private readonly batch: SpriteBatch;
  private readonly scarf: THREE.Mesh;
  private readonly sPos: Float32Array;
  private readonly sCol: Float32Array;
  private readonly nx = new Float32Array(N);
  private readonly ny = new Float32Array(N);
  private readonly px = new Float32Array(N);
  private readonly py = new Float32Array(N);
  private scarfInit = false;
  private cur: TerrainCursor | null = null;
  private angle = 0;
  private stretch = 0;
  private time = 0;
  private readonly squash = [1, 0];
  private readonly wingBase = [0, 0];
  private readonly flapAmp = [0, 0];
  private readonly auraA = [0, 0];
  private flapPhase = 0;
  private dizzyT = 0;
  private happyT = 0;
  private blinkT = 2;
  private n = 0;
  // current body transform (shared by the part() calls of one frame)
  private readonly xf = { ox: 0, oy: 0, ca: 1, sa: 0, rs: 1, sx: 1, sy: 1, size: 1, lr: 1, lg: 1, lb: 1, ang: 0 };
  private tumbleT = 0; // island-jump back-flip (cosmetic), counts down
  private readonly cScarf: RGB = hexRgb(C.scarf);
  private readonly cOut: RGB = hexRgb(CONFIG.colors.outline);

  constructor(bus: GameBus) {
    this.batch = new SpriteBatch(12, buildAtlas(), GRID, GRID);
    this.batch.mesh.renderOrder = 6;
    // scarf ribbon: outline strip then fill strip, N columns each
    const verts = N * 2 * 2;
    this.sPos = new Float32Array(verts * 3);
    this.sCol = new Float32Array(verts * 3);
    const side = new Float32Array(verts);
    for (let v = 0; v < verts; v++) side[v] = v % 2 ? -1 : 1;
    const idx: number[] = [];
    for (let s = 0; s < 2; s++)
      for (let i = 0; i < N - 1; i++) {
        const a = s * N * 2 + i * 2;
        idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    const g = new THREE.BufferGeometry();
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.sCol, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: ribbonVert,
      fragmentShader: ribbonFrag,
      uniforms: { uAlpha: { value: 1 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.scarf = new THREE.Mesh(g, mat);
    this.scarf.frustumCulled = false;
    this.scarf.renderOrder = 5.9;
    this.mesh.add(this.scarf, this.batch.mesh);
    bus.on('land', (e) => {
      const B = CONFIG.bird;
      this.squash[1] = -B.squashKick * (e.kind === 'bad' ? 1.4 : e.kind === 'great' ? 1.15 : 1);
      if (e.kind === 'bad') this.dizzyT = B.dizzyTime;
    });
    bus.on('skyTouch', () => (this.happyT = CONFIG.bird.happyTime));
    // a fast island launch earns a little back-flip (sprite only; the physics state is untouched)
    bus.on('islandLaunch', (e) => {
      if (e.speed >= CONFIG.islands.vLaunchMax * CONFIG.juice.tumbleSpeed) this.tumbleT = CONFIG.juice.tumbleTime;
    });
    bus.on('islandLand', () => (this.happyT = CONFIG.bird.happyTime));
  }

  /** Scarf colour (race rivals). */
  setScarf(hex: string): void {
    hexRgb(hex, this.cScarf);
  }

  /** A small squash kick (visual bumps on the mountain descent). */
  kick(): void {
    this.squash[1] = -CONFIG.bird.squashKick * 0.55;
  }

  reset(run?: Run): void {
    this.angle = 0;
    this.stretch = 0;
    this.squash[0] = 1;
    this.squash[1] = 0;
    this.dizzyT = this.happyT = this.tumbleT = 0;
    this.scarfInit = false;
    if (run) this.cur = run.world.terrain.cursor();
  }

  update(dt: number, run: Run, x: number, y: number, d1: number, scale: number, asleep: boolean, grade: RGB): void {
    const b = run.bird, Rr = CONFIG.render, B = CONFIG.bird, R = CONFIG.physics.birdRadius;
    dt = Math.min(dt, 1 / 30);
    this.time += dt;
    const t = this.time;
    const speed = run.speed;
    const glide = !asleep && run.flightK > 0; // scripted island jump: input is ignored
    const diving = !b.grounded && run.held && !asleep && !glide;
    const crawling = !asleep && run.started && b.grounded && speed < CONFIG.physics.sMin * B.crawlFactor;
    this.dizzyT -= dt;
    this.happyT -= dt;
    this.blinkT -= dt;
    if (this.blinkT < -B.blinkTime) this.blinkT = B.blinkEvery * (0.6 + Math.random() * 0.8);

    // rotation: velocity direction (ground: tangent), smoothed; diving adds a nose-down tilt
    let target = asleep ? 0 : b.grounded ? Math.atan(d1) : Math.atan2(b.vy, b.vx);
    if (diving) target -= (Rr.diveTilt * Math.PI) / 180;
    let da = target - this.angle;
    da -= Math.round(da / (2 * Math.PI)) * 2 * Math.PI;
    this.angle += da * (1 - Math.exp(-dt / Rr.rotTau));
    this.stretch += ((diving ? 1 : 0) - this.stretch) * (1 - Math.exp(-dt / Rr.rotTau));

    // body: landing squash spring (overshoots a little), dive stretch, sleep breathing
    const sq = spring(this.squash, 1, B.squashK, B.squashDamp, dt);
    const breathe = asleep ? 1 + B.breathe * Math.sin(t * 2.4) : 1;
    const sx = (1 + (Rr.diveStretchX - 1) * this.stretch) * (1 + (1 - sq) * 0.6) / breathe;
    const sy = (1 + (Rr.diveStretchY - 1) * this.stretch) * sq * breathe;

    // wings: base angle by state + flapping (2 Hz gliding, 8 Hz crawling); dive tucks them
    let wingT = B.wingRest, flapT = 0, flapHz = B.flapHz;
    if (asleep) wingT = B.wingTucked;
    else if (crawling) (wingT = B.wingOpen), (flapT = B.flapCrawlAmp), (flapHz = B.flapCrawlHz);
    else if (glide) (wingT = B.wingGlide), (flapT = B.glideFlap), (flapHz = B.glideFlapHz);
    else if (diving) wingT = B.wingTucked;
    else if (!b.grounded) (wingT = B.wingOpen), (flapT = B.flapAmp);
    else if (run.held) wingT = B.wingTucked * 0.6;
    const wBase = spring(this.wingBase, wingT, 260, 18, dt);
    const fAmp = spring(this.flapAmp, flapT, 200, 20, dt);
    this.flapPhase += dt * flapHz * Math.PI * 2;
    const flap = Math.sin(this.flapPhase) * fAmp;
    const wingScale = diving ? 0.85 : 1;

    // origin: the physics circle centre. Squash compresses toward the feet (sprite-local down);
    // the zoom-out enlargement grows upward so the bigger body still sits on the ground.
    // back-flip: one full turn, eased in/out
    let ang = this.angle;
    if (this.tumbleT > 0) {
      this.tumbleT -= dt;
      const u = Math.max(0, 1 - this.tumbleT / CONFIG.juice.tumbleTime);
      ang += Math.PI * 2 * u * u * (3 - 2 * u);
    }
    const drop = (1 - sq) * R * scale, lift = (scale - 1) * R;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const ox = x + sa * Math.max(0, drop), oy = y - ca * Math.max(0, drop) + lift;
    const rs = R * scale, size = 4 * rs;
    const lit = B.gradeMix;
    const lr = 1 + (grade[0] - 1) * lit, lg = 1 + (grade[1] - 1) * lit, lb = 1 + (grade[2] - 1) * lit;
    const bt = this.batch, X = this.xf;
    X.ox = ox;
    X.oy = oy;
    X.ca = ca;
    X.sa = sa;
    X.rs = rs;
    X.sx = sx;
    X.sy = sy;
    X.size = size;
    X.lr = lr;
    X.lg = lg;
    X.lb = lb;
    X.ang = ang;
    this.n = 0;

    // Fever aura (additive, pulsing, hue cycling)
    const auraA = spring(this.auraA, run.fever && !asleep ? 1 : 0, 40, 12, dt);
    if (auraA > 0.02) {
      const h = t * 0.6;
      const k = 1.45 + 0.12 * Math.sin(t * 9);
      bt.set(this.n++, ox, oy, 0, size * k, size * k, 0.75 + 0.25 * Math.sin(h * 6.28), 0.75 + 0.25 * Math.sin(h * 6.28 + 2.1), 0.75 + 0.25 * Math.sin(h * 6.28 + 4.2), 0.6 * auraA, PART.aura, 1);
    }
    this.part(PART.wing, 0.15, 0.05, wBase + flap * 0.8 + 0.25, wingScale, wingScale, 0.78);
    this.part(PART.body, 0, 0, 0, 1, 1);
    this.part(PART.belly, 0.22, -0.7, 0, 1, 1);
    this.part(PART.beak, 0.9, -0.02, crawling ? 0.08 * Math.sin(t * 30) : 0, 1, 1);
    let face: number = PART.faceOpen;
    if (asleep) face = PART.faceSleep;
    else if (this.dizzyT > 0) face = PART.faceDizzy;
    else if (this.happyT > 0) face = PART.faceHappy;
    else if (glide) face = PART.faceSparkle;
    else if (diving || crawling) face = PART.faceSquint;
    else if (run.fever) face = PART.faceSparkle;
    else if (this.blinkT < 0) face = PART.faceSquint;
    this.part(face, 0.4, 0.3, 0, 1, 1);
    this.part(PART.wing, -0.05, -0.12, wBase + flap, wingScale, wingScale);
    if (crawling) {
      const k = (t * 1.6) % 1;
      this.part(PART.sweat, 0.62 + 0.2 * k, 0.98 - 0.25 * k, 0, 0.7, 0.7, 1, 1 - k);
    }
    // the nest stays on the start peak
    if (this.cur && b.x < 3000) {
      const nx = 0, ny = this.cur.height(nx) + B.nestLift * R;
      bt.set(this.n++, nx, ny + lift * 0.5, 0, 4 * R * scale, 4 * R * scale, lr, lg, lb, 1, PART.nest, 0);
    }
    bt.commit(this.n);

    this.updateScarf(dt, ox, oy, ca, sa, sx, sy, rs, speed, scale, lr, lg, lb);
  }

  /** One rig part: (lx, ly) body-local in R, rotation relative to the body, scale factors. */
  private part(frame: number, lx: number, ly: number, rot: number, ksx: number, ksy: number, shade = 1, a = 1, add = 0): void {
    const X = this.xf, px = lx * X.rs * X.sx, py = ly * X.rs * X.sy;
    this.batch.set(this.n++, X.ox + px * X.ca - py * X.sa, X.oy + px * X.sa + py * X.ca, X.ang + rot, X.size * X.sx * ksx, X.size * X.sy * ksy, X.lr * shade, X.lg * shade, X.lb * shade, a, frame, add);
  }

  private updateScarf(dt: number, ox: number, oy: number, ca: number, sa: number, sx: number, sy: number, rs: number, speed: number, scale: number, lr: number, lg: number, lb: number): void {
    const B = CONFIG.bird, nx = this.nx, ny = this.ny, px = this.px, py = this.py;
    const L = B.scarfSeg * scale;
    // anchor: back of the neck (body-local)
    const ax = B.scarfAnchorX * rs * sx, ay = B.scarfAnchorY * rs * sy;
    const wx = ox + ax * ca - ay * sa, wy = oy + ax * sa + ay * ca;
    if (!this.scarfInit || Math.hypot(nx[0] - wx, ny[0] - wy) > 400) {
      for (let i = 0; i < N; i++) {
        nx[i] = px[i] = wx - i * L * ca;
        ny[i] = py[i] = wy - i * L * sa;
      }
      this.scarfInit = true;
    }
    // verlet: air drag pulls the nodes to rest in the world -> the scarf streams behind the bird
    const keep = Math.exp(-B.scarfDrag * dt);
    for (let i = 1; i < N; i++) {
      const vx = (nx[i] - px[i]) * keep, vy = (ny[i] - py[i]) * keep;
      px[i] = nx[i];
      py[i] = ny[i];
      nx[i] += vx;
      ny[i] += vy - B.scarfGravity * dt * dt;
    }
    nx[0] = px[0] = wx;
    ny[0] = py[0] = wy;
    const cur = this.cur, lift = B.scarfGround * scale;
    for (let it = 0; it < 4; it++)
      for (let i = 1; i < N; i++) {
        const dx = nx[i] - nx[i - 1], dy = ny[i] - ny[i - 1];
        const d = Math.hypot(dx, dy) || 1e-6;
        const k = L / d;
        nx[i] = nx[i - 1] + dx * k;
        ny[i] = ny[i - 1] + dy * k;
        // the scarf lies on the ground instead of sinking into it
        if (cur && it === 3) {
          const gy = cur.height(nx[i]) + lift;
          if (ny[i] < gy) ny[i] = py[i] = gy;
        }
      }
    // ribbon: flutter grows with speed (the scarf "draws" the speed)
    const flutAmp = Math.min(1, speed / B.scarfFlutterV) * B.scarfFlutter * scale;
    const flutW = B.scarfFlutterHz + speed * 0.008;
    const P = this.sPos, Cc = this.sCol, o = this.cOut, c = this.cScarf;
    for (let i = 0; i < N; i++) {
      const j = Math.min(i + 1, N - 1), h = Math.max(i - 1, 0);
      let tx = nx[j] - nx[h], ty = ny[j] - ny[h];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const f = i / (N - 1);
      const wob = Math.sin(this.time * flutW - i * 0.9) * flutAmp * f;
      const cxp = nx[i] - ty * wob, cyp = ny[i] + tx * wob;
      const wFill = (B.scarfW0 + (B.scarfW1 - B.scarfW0) * f) * scale * 0.5;
      const wOut = wFill + B.scarfOutline * scale;
      for (let s = 0; s < 2; s++) {
        const w = s ? wFill : wOut;
        const v = (s * N + i) * 2;
        P[v * 3] = cxp - ty * w;
        P[v * 3 + 1] = cyp + tx * w;
        P[v * 3 + 3] = cxp + ty * w;
        P[v * 3 + 4] = cyp - tx * w;
        const col = s ? c : o;
        const sh = s ? 1 - 0.18 * (Math.sin(this.time * flutW - i * 0.9) * 0.5 + 0.5) : 1;
        for (let e = 0; e < 2; e++) {
          Cc[(v + e) * 3] = col[0] * lr * sh;
          Cc[(v + e) * 3 + 1] = col[1] * lg * sh;
          Cc[(v + e) * 3 + 2] = col[2] * lb * sh;
        }
      }
    }
    const g = this.scarf.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
  }
}
