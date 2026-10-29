import * as THREE from 'three';
import { CONFIG } from '../config';
import { hexRgb, type RGB, type SkyState } from './palette';
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

/** Fullscreen sky: gradient, sun/moon disk + halo, stars at night. */
export class Sky {
  readonly mesh: THREE.Mesh;
  private readonly u: Record<string, THREE.IUniform>;

  constructor() {
    this.u = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSun: { value: new THREE.Color() },
      uSunPos: { value: new THREE.Vector2() },
      uSunR: { value: CONFIG.render.sunSize },
      uAspect: { value: 9 / 16 },
      uNight: { value: 0 },
      uTime: { value: 0 },
    };
    this.mesh = fullscreen(skyFrag, this.u, 0, false);
  }

  update(s: SkyState, aspect: number, time: number): void {
    const u = this.u;
    (u.uTop.value as THREE.Color).setRGB(s.top[0], s.top[1], s.top[2]);
    (u.uHorizon.value as THREE.Color).setRGB(s.horizon[0], s.horizon[1], s.horizon[2]);
    (u.uSun.value as THREE.Color).setRGB(s.sun[0], s.sun[1], s.sun[2]);
    (u.uSunPos.value as THREE.Vector2).set(CONFIG.render.sunX, s.sunY);
    u.uSunR.value = CONFIG.render.sunSize * (s.night ? 0.8 : 1);
    u.uAspect.value = aspect;
    u.uNight.value = s.night;
    u.uTime.value = time;
  }
}

/** Dark gradient from the left edge where the night has caught up. */
export class NightFront {
  readonly mesh: THREE.Mesh;
  private readonly u: Record<string, THREE.IUniform>;

  constructor() {
    const c: RGB = hexRgb(CONFIG.colors.night);
    this.u = {
      uLeft: { value: 0 },
      uRight: { value: 1 },
      uNightX: { value: -1e9 },
      uWidth: { value: CONFIG.night.frontWidth },
      uAlpha: { value: CONFIG.night.frontAlpha },
      uColor: { value: new THREE.Color(c[0], c[1], c[2]) },
    };
    this.mesh = fullscreen(nightFrag, this.u, 8, true);
  }

  update(x0: number, x1: number, nightX: number): void {
    const N = CONFIG.night;
    this.mesh.visible = nightX + N.frontWidth > x0;
    this.u.uLeft.value = x0;
    this.u.uRight.value = x1;
    this.u.uNightX.value = nightX;
    this.u.uWidth.value = N.frontWidth;
    this.u.uAlpha.value = N.frontAlpha;
  }
}

const MAX_CLOUDS = 96;

/** Cloud ceiling at cloudY (§4.4): soft blobs (Canvas2D radial gradient) in two rows. */
export class CloudCeiling {
  readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly mat: THREE.MeshBasicMaterial;

  constructor() {
    const N = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d')!;
    const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.55, 'rgba(255,255,255,0.92)');
    gr.addColorStop(0.8, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, N, N);
    const tex = new THREE.CanvasTexture(cv);
    this.mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.mat, MAX_CLOUDS);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
  }

  update(x0: number, x1: number, y0: number, y1: number, grade: RGB): void {
    const S = CONFIG.sky, m = this.m;
    let n = 0;
    if (y1 > S.cloudY - S.cloudSize && y0 < S.cloudY + S.cloudSize) {
      const i0 = Math.floor(x0 / S.cloudSpacing) - 1, i1 = Math.ceil(x1 / S.cloudSpacing) + 1;
      for (let i = i0; i <= i1 && n < MAX_CLOUDS - 1; i++) {
        for (let row = 0; row < 2; row++) {
          const h = Math.sin(i * 12.9898 + row * 78.233) * 43758.5453;
          const r = h - Math.floor(h);
          const size = S.cloudSize * (0.7 + 0.6 * r) * (row ? 0.8 : 1);
          m.makeScale(size, size * 0.8, 1);
          m.setPosition((i + row * 0.5) * S.cloudSpacing, S.cloudY + (row ? S.cloudJitter : 0) + (r - 0.5) * S.cloudJitter, 0);
          this.mesh.setMatrixAt(n++, m);
        }
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mat.color.setRGB(0.5 + 0.5 * grade[0], 0.5 + 0.5 * grade[1], 0.5 + 0.5 * grade[2]);
  }
}
