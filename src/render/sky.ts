import * as THREE from 'three';
import { CONFIG } from '../config';
import { hexRgb, type RGB, type SkyState } from './palette';
import cloudFrag from './shaders/cloud.frag.glsl?raw';
import cloudVert from './shaders/cloud.vert.glsl?raw';
import vert from './shaders/fullscreen.vert.glsl?raw';
import nightFrag from './shaders/night.frag.glsl?raw';
import skyFrag from './shaders/sky.frag.glsl?raw';

function fullscreen(frag: string, uniforms: Record<string, THREE.IUniform>, order: number, transparent: boolean): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, transparent, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  return mesh;
}

const fract = (x: number): number => x - Math.floor(x);

/** Fullscreen sky: gradient, sun/moon disk + halo, stars, 3 parallax silhouette layers (§7.4). */
export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly u: Record<string, THREE.IUniform>;
  private readonly tint: RGB = [0, 0, 0];
  private readonly layerU: { l: THREE.Vector4; c: THREE.Color }[] = [];

  constructor() {
    const c = (): THREE.IUniform => ({ value: new THREE.Color() });
    this.u = {
      uTop: c(),
      uHorizon: c(),
      uSun: c(),
      uSunPos: { value: new THREE.Vector2() },
      uSunR: { value: CONFIG.render.sunSize },
      uAspect: { value: 9 / 16 },
      uNight: { value: 0 },
      uStars: { value: 0 },
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector2() },
      uLog: { value: new THREE.Vector2(720, 1280) },
      uZoom: { value: 1 },
      uFog: c(),
      uMist: { value: new THREE.Vector3() },
    };
    for (let i = 0; i < 3; i++) {
      const l = new THREE.Vector4(), col = new THREE.Color();
      this.u[`uL${i}`] = { value: l };
      this.u[`uC${i}`] = { value: col };
      this.layerU.push({ l, c: col });
    }
    this.mesh = fullscreen(skyFrag, this.u, 0, false);
  }

  update(s: SkyState, aspect: number, time: number, cx: number, cy: number, z: number, logW: number, logH: number): void {
    const u = this.u, P = CONFIG.parallax;
    (u.uTop.value as THREE.Color).setRGB(s.top[0], s.top[1], s.top[2]);
    (u.uHorizon.value as THREE.Color).setRGB(s.horizon[0], s.horizon[1], s.horizon[2]);
    (u.uFog.value as THREE.Color).setRGB(s.horizon[0], s.horizon[1], s.horizon[2]);
    (u.uSun.value as THREE.Color).setRGB(s.sun[0], s.sun[1], s.sun[2]);
    (u.uSunPos.value as THREE.Vector2).set(CONFIG.render.sunX, s.sunY);
    u.uSunR.value = CONFIG.render.sunSize * (s.night ? 0.8 : 1);
    u.uAspect.value = aspect;
    u.uNight.value = s.night;
    u.uStars.value = s.stars;
    u.uTime.value = time;
    (u.uCam.value as THREE.Vector2).set(cx, cy);
    (u.uLog.value as THREE.Vector2).set(logW, logH);
    u.uZoom.value = z;
    (u.uMist.value as THREE.Vector3).set(P.mistDepth, P.mist, P.ridgeLight);
    for (let i = 0; i < 3; i++) {
      const L = P.layers[i], U = this.layerU[i], t = hexRgb(L.tint, this.tint), f = L.strength;
      U.l.set(L.px, L.k, L.base, L.amp);
      U.c.setRGB(
        s.horizon[0] + (t[0] * s.grade[0] - s.horizon[0]) * f,
        s.horizon[1] + (t[1] * s.grade[1] - s.horizon[1]) * f,
        s.horizon[2] + (t[2] * s.grade[2] - s.horizon[2]) * f,
      );
    }
  }
}

/** Screen overlay: night front (dark gradient where the night has caught up), vignette, tint. */
export class NightFront {
  readonly mesh: THREE.Mesh;
  /** Screen tint (rgb + amount), e.g. the Fever pulse; set by the renderer each frame. */
  readonly tint = new THREE.Vector4();
  private readonly u: Record<string, THREE.IUniform>;

  constructor() {
    const c: RGB = hexRgb(CONFIG.colors.night), v: RGB = hexRgb(CONFIG.colors.outline);
    this.u = {
      uLeft: { value: 0 },
      uRight: { value: 1 },
      uNightX: { value: -1e9 },
      uWidth: { value: CONFIG.night.frontWidth },
      uAlpha: { value: CONFIG.night.frontAlpha },
      uColor: { value: new THREE.Color(c[0], c[1], c[2]) },
      uAspect: { value: 9 / 16 },
      uVignette: { value: CONFIG.fx.vignette },
      uVigColor: { value: new THREE.Color(v[0], v[1], v[2]) },
      uTint: { value: this.tint },
    };
    this.mesh = fullscreen(nightFrag, this.u, 8, true);
    const m = this.mesh.material as THREE.ShaderMaterial;
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
  }

  update(x0: number, x1: number, nightX: number, aspect: number): void {
    const N = CONFIG.night;
    this.u.uLeft.value = x0;
    this.u.uRight.value = x1;
    this.u.uNightX.value = nightX;
    this.u.uWidth.value = N.frontWidth;
    this.u.uAlpha.value = N.frontAlpha;
    this.u.uAspect.value = aspect;
    this.u.uVignette.value = CONFIG.fx.vignette;
  }
}

const MAX_CLOUDS = 128;

/** Cel-shaded cloud puff (Canvas2D): shade body, lit top, flat-ish bottom. */
function cloudTexture(): THREE.CanvasTexture {
  const W = 512, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const puffs: [number, number, number][] = [
    [0.2, 0.66, 0.2], [0.36, 0.5, 0.28], [0.56, 0.42, 0.33], [0.74, 0.56, 0.24], [0.86, 0.7, 0.15], [0.5, 0.7, 0.24],
  ];
  const draw = (dy: number, k: number, color: string): void => {
    g.fillStyle = color;
    for (const [x, y, r] of puffs) {
      g.beginPath();
      g.arc(x * W, (y + dy) * H, r * H * k, 0, Math.PI * 2);
      g.fill();
    }
  };
  g.save();
  g.beginPath();
  g.rect(0, 0, W, H * 0.86);
  g.clip();
  draw(0, 1, CONFIG.parallax.cloudShade);
  draw(-0.07, 0.9, '#FFFFFF');
  g.restore();
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = 2;
  return t;
}

/**
 * All clouds in one draw: 2 drifting parallax layers (§7.4) + the cloud ceiling at cloudY (§4.4).
 * Background clouds live in layer space and are placed into the world each frame.
 */
export class Clouds {
  readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();
  private readonly hz = new THREE.Color();

  constructor() {
    const mat = new THREE.ShaderMaterial({
      vertexShader: cloudVert,
      fragmentShader: cloudFrag,
      uniforms: { uMap: { value: cloudTexture() } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, MAX_CLOUDS);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.setColorAt(0, this.c);
    this.mesh.count = 0;
  }

  update(cx: number, cy: number, z: number, viewW: number, viewH: number, logW: number, time: number, s: SkyState): void {
    const P = CONFIG.parallax, S = CONFIG.sky, m = this.m, c = this.c;
    this.hz.setRGB(s.horizon[0], s.horizon[1], s.horizon[2]);
    let n = 0;
    for (let li = 0; li < P.clouds.length; li++) {
      const L = P.clouds[li];
      const sc = 1 - (1 - z) * L.k;
      const halfW = logW / (2 * sc) + L.s1;
      const lx = cx * L.px, ly = cy * L.px * 0.5;
      const shift = time * L.drift;
      const i0 = Math.floor((lx - halfW - shift) / L.spacing), i1 = Math.ceil((lx + halfW - shift) / L.spacing);
      // light colour: white by day, takes the horizon tint at dusk, the grade at night; far = more fog
      c.setRGB(0.7 + 0.3 * s.grade[0], 0.7 + 0.3 * s.grade[1], 0.7 + 0.3 * s.grade[2]).lerp(this.hz, Math.min(1, L.fog + 0.3 * (1 - s.grade[1])));
      for (let i = i0; i <= i1 && n < MAX_CLOUDS; i++) {
        const h1 = fract(Math.sin(i * 12.9898 + li * 4.1) * 43758.5453);
        const h2 = fract(Math.sin(i * 78.233 + li * 9.7) * 23421.631);
        const size = L.s0 + (L.s1 - L.s0) * h2;
        const X = i * L.spacing + shift + (h1 - 0.5) * L.spacing * 0.6;
        const Y = L.y0 + (L.y1 - L.y0) * h1;
        // layer -> screen -> world
        const ws = (size * sc) / z;
        const wx = cx + ((X - lx) * sc) / z, wy = cy + ((Y - ly) * sc) / z;
        if (Math.abs(wy - cy) > viewH / 2 + ws) continue;
        m.makeScale(h2 > 0.5 ? ws : -ws, ws * 0.5, 1);
        m.setPosition(wx, wy, 0);
        this.mesh.setMatrixAt(n, m);
        this.mesh.setColorAt(n, c);
        n++;
      }
    }
    // cloud ceiling (world space, two rows)
    const y0 = cy - viewH / 2, y1 = cy + viewH / 2, x0 = cx - viewW / 2, x1 = cx + viewW / 2;
    if (y1 > S.cloudY - S.cloudSize && y0 < S.cloudY + S.cloudSize) {
      c.setRGB(0.55 + 0.45 * s.grade[0], 0.55 + 0.45 * s.grade[1], 0.55 + 0.45 * s.grade[2]).lerp(this.hz, 0.15);
      const i0 = Math.floor(x0 / S.cloudSpacing) - 2, i1 = Math.ceil(x1 / S.cloudSpacing) + 2;
      for (let i = i0; i <= i1 && n < MAX_CLOUDS - 1; i++) {
        for (let row = 0; row < 2; row++) {
          const r = fract(Math.sin(i * 12.9898 + row * 78.233) * 43758.5453);
          const size = S.cloudSize * (1.1 + 0.7 * r) * (row ? 0.85 : 1);
          m.makeScale(r > 0.5 ? size : -size, size * 0.5, 1);
          m.setPosition((i + row * 0.5) * S.cloudSpacing, S.cloudY + (row ? S.cloudJitter : -S.cloudJitter * 0.5) + (r - 0.5) * S.cloudJitter, 0);
          this.mesh.setMatrixAt(n, m);
          this.mesh.setColorAt(n, c);
          n++;
        }
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
