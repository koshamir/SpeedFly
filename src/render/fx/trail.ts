import * as THREE from 'three';
import { CONFIG } from '../../config';
import frag from '../shaders/trail.frag.glsl?raw';
import vert from '../shaders/trail.vert.glsl?raw';

const N = 24;

/** Ribbon trail behind the bird (§7.6): 24 points, tapered. Ring buffer of positions, no allocations. */
export class Trail {
  readonly mesh: THREE.Mesh;
  private readonly hx = new Float32Array(N);
  private readonly hy = new Float32Array(N);
  private head = 0;
  private count = 0;
  private readonly pos: Float32Array;
  private readonly u: Record<string, THREE.IUniform>;
  private alpha = 0;
  private rainbow = 0;
  private wide = 1;

  constructor() {
    this.pos = new Float32Array(N * 2 * 3);
    const t = new Float32Array(N * 2), side = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      t[i * 2] = t[i * 2 + 1] = i / (N - 1);
      side[i * 2] = 1;
      side[i * 2 + 1] = -1;
    }
    const idx: number[] = [];
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    this.u = { uAlpha: { value: 0 }, uRainbow: { value: 0 }, uTime: { value: 0 } };
    this.mesh = new THREE.Mesh(
      g,
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms: this.u,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5.5;
    this.mesh.visible = false;
  }

  reset(): void {
    this.count = 0;
    this.alpha = 0;
    this.mesh.visible = false;
  }

  /** on: trail wanted (BLAZING+ or Fever); rainbow: Fever look; scale: bird visual scale; long: island jump (wide spacing). */
  update(dt: number, x: number, y: number, on: boolean, rainbow: boolean, scale: number, time: number, long = false): void {
    const F = CONFIG.fx, step = F.trailStep * scale * (long ? F.flightTrailStep : 1);
    this.wide += ((long ? F.flightTrailWidth : 1) - this.wide) * (1 - Math.exp(-dt * 3));
    // record: a new point every trailStep px, else the head follows the bird
    if (this.count === 0 || Math.hypot(x - this.hx[this.head], y - this.hy[this.head]) > step) {
      if (this.count > 0 && Math.hypot(x - this.hx[this.head], y - this.hy[this.head]) > Math.max(600, step * 3)) this.count = 0;
      this.head = (this.head + 1) % N;
      this.count = Math.min(N, this.count + 1);
    }
    this.hx[this.head] = x;
    this.hy[this.head] = y;
    this.alpha += ((on ? 1 : 0) - this.alpha) * (1 - Math.exp(-dt * 6));
    this.rainbow += ((rainbow ? 1 : 0) - this.rainbow) * (1 - Math.exp(-dt * 5));
    this.mesh.visible = this.alpha > 0.01 && this.count > 2;
    if (!this.mesh.visible) return;
    const P = this.pos, w0 = F.trailWidth * scale * 0.5 * this.wide;
    for (let i = 0; i < N; i++) {
      const k = Math.min(i, this.count - 1);
      const a = (this.head - k + N) % N, b = (this.head - Math.min(k + 1, this.count - 1) + N) % N, c = (this.head - Math.max(k - 1, 0) + N) % N;
      let tx = this.hx[c] - this.hx[b], ty = this.hy[c] - this.hy[b];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const w = w0 * (1 - (i / (N - 1)) * 0.85);
      P[i * 6] = this.hx[a] - ty * w;
      P[i * 6 + 1] = this.hy[a] + tx * w;
      P[i * 6 + 3] = this.hx[a] + ty * w;
      P[i * 6 + 4] = this.hy[a] - tx * w;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.u.uAlpha.value = this.alpha * F.trailAlpha;
    this.u.uRainbow.value = this.rainbow;
    this.u.uTime.value = time;
  }
}
