import * as THREE from 'three';
import { CONFIG } from '../config';
import { COIN_BLUE } from '../world/collectibles';
import type { Run } from '../sim/run';
import type { World } from '../world/world';
import { hexRgb, type RGB } from './palette';
import frag from './shaders/coin.frag.glsl?raw';
import vert from './shaders/coin.vert.glsl?raw';

const MAX = 160;

// Coins: one InstancedMesh, spinning discs (scale X by |cos|).
export class CoinsView {
  readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly gold = new THREE.Color();
  private readonly blue = new THREE.Color();
  private readonly mat: THREE.ShaderMaterial;

  constructor() {
    const o: RGB = hexRgb(CONFIG.colors.outline);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: { uOutline: { value: new THREE.Color(o[0], o[1], o[2]) }, uGrade: { value: new THREE.Color(1, 1, 1) } },
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    const c: RGB = [0, 0, 0];
    hexRgb(CONFIG.colors.gold, c);
    this.gold.setRGB(c[0], c[1], c[2]);
    hexRgb(CONFIG.colors.blue, c);
    this.blue.setRGB(c[0], c[1], c[2]);
    this.mesh.setColorAt(0, this.gold); // allocates instanceColor
    this.mesh.count = 0;
  }

  /** sky = the island jump's coins (drawn bigger: the flight shot is zoomed far out). */
  update(world: World, x0: number, x1: number, time: number, grade: RGB, sky: Run['sky']): void {
    const c = world.coins, K = CONFIG.coins, m = this.m;
    let n = 0;
    for (let i = 0; i < c.n && n < MAX; i++) {
      const x = c.x[i];
      if (x < x0 || !c.alive[i]) continue;
      if (x > x1) break;
      const blue = c.type[i] === COIN_BLUE;
      const size = blue ? K.blueSize : K.size;
      const spin = 0.25 + 0.75 * Math.abs(Math.cos(time * K.spinRate + x * 0.01));
      m.makeScale(size * spin, size, 1);
      m.setPosition(x, c.y[i], 0);
      this.mesh.setMatrixAt(n, m);
      this.mesh.setColorAt(n, blue ? this.blue : this.gold);
      n++;
    }
    for (let i = 0; i < sky.n && n < MAX; i++) {
      if (!sky.alive[i]) continue;
      const spin = 0.25 + 0.75 * Math.abs(Math.cos(time * K.spinRate + i * 0.7));
      m.makeScale(K.skySize * spin, K.skySize, 1);
      m.setPosition(sky.x[i], sky.y[i], 0);
      this.mesh.setMatrixAt(n, m);
      this.mesh.setColorAt(n, this.gold);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    (this.mat.uniforms.uGrade.value as THREE.Color).setRGB(grade[0], grade[1], grade[2]);
  }
}
