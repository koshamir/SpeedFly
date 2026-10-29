import * as THREE from 'three';
import { CONFIG } from '../config';
import type { World } from '../world/world';
import type { TerrainCursor } from '../world/terrain';
import { hexRgb, type RGB } from './palette';
import frag from './shaders/terrain.frag.glsl?raw';
import vert from './shaders/terrain.vert.glsl?raw';

// Hills: strip meshes in fixed-width chunks (vertex every meshStep px), rebuilt in place when a
// chunk scrolls into view. Attributes: depth below the surface + island looks.

interface Chunk {
  mesh: THREE.Mesh;
  pos: Float32Array;
  depth: Float32Array;
  isl: Float32Array;
  wet: Float32Array;
  id: number; // chunk index (x / chunkWidth), NaN = free
}

export function paletteTexture(): THREE.DataTexture {
  const P = CONFIG.palettes;
  const data = new Uint8Array(6 * P.length * 4);
  const c: RGB = [0, 0, 0];
  P.forEach((p, j) => {
    [...p.bands, p.rim].forEach((hex, i) => {
      hexRgb(hex, c);
      const o = (j * 6 + i) * 4;
      data[o] = Math.round(c[0] * 255);
      data[o + 1] = Math.round(c[1] * 255);
      data[o + 2] = Math.round(c[2] * 255);
      data[o + 3] = 255;
    });
  });
  const t = new THREE.DataTexture(data, 6, P.length, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

export class TerrainMesh {
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  private readonly chunks: Chunk[] = [];
  private readonly cols: number;
  private world!: World;
  private cur!: TerrainCursor;

  constructor() {
    const R = CONFIG.render;
    this.cols = Math.round(R.chunkWidth / R.meshStep) + 1;
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPal: { value: paletteTexture() },
        uPxPerWorld: { value: 1 },
        uGrade: { value: new THREE.Color(1, 1, 1) },
        uRimW: { value: R.rimWidth },
        uInner: { value: R.innerShadow },
        uShadeDist: { value: R.shadeDist },
        uShadeMin: { value: R.shadeMin },
        uWobble: { value: new THREE.Vector4(R.bandWobbleA, R.bandWobbleB, R.bandFreqA, R.bandFreqB) },
        uDiag: { value: new THREE.Vector2(R.diagDepth, R.diagX) },
        uBandShade: { value: R.bandShade },
        uBandEdge: { value: R.bandEdge },
        uWater: { value: new THREE.Color(...hexRgb(CONFIG.colors.waterDeep)) },
        uWetTint: { value: R.wetTint },
        uWetDepth: { value: R.wetTintDepth },
      },
    });
    // shared index buffer: two triangles per column pair (top i, bottom i)
    const idx: number[] = [];
    for (let i = 0; i < this.cols - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, c, b, d);
    }
    const index = new THREE.BufferAttribute(new Uint16Array(idx), 1);
    for (let k = 0; k < R.chunkPool; k++) {
      const n = this.cols * 2;
      const pos = new Float32Array(n * 3);
      const depth = new Float32Array(n);
      const isl = new Float32Array(n * 4);
      const wet = new Float32Array(n);
      const g = new THREE.BufferGeometry();
      g.setIndex(index);
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
      g.setAttribute('aIsl', new THREE.BufferAttribute(isl, 4));
      g.setAttribute('aWet', new THREE.BufferAttribute(wet, 1));
      const mesh = new THREE.Mesh(g, this.material);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.chunks.push({ mesh, pos, depth, isl, wet, id: NaN });
    }
  }

  reset(world: World): void {
    this.world = world;
    this.cur = world.terrain.cursor();
    for (const c of this.chunks) {
      c.id = NaN;
      c.mesh.visible = false;
    }
  }

  update(x0: number, x1: number, pxPerWorld: number, grade: RGB): void {
    const W = CONFIG.render.chunkWidth;
    const i0 = Math.floor(x0 / W), i1 = Math.floor(x1 / W);
    for (const c of this.chunks) {
      if (!(c.id >= i0 && c.id <= i1)) {
        c.id = NaN;
        c.mesh.visible = false;
      }
    }
    for (let id = i0; id <= i1; id++) {
      let have = false;
      for (const c of this.chunks) if (c.id === id) have = true;
      if (have) continue;
      const free = this.chunks.find((c) => Number.isNaN(c.id));
      if (!free) break;
      this.build(free, id);
    }
    const u = this.material.uniforms;
    u.uPxPerWorld.value = pxPerWorld;
    (u.uGrade.value as THREE.Color).setRGB(grade[0], grade[1], grade[2]);
  }

  private build(c: Chunk, id: number): void {
    const R = CONFIG.render, W = R.chunkWidth, step = R.meshStep, bottom = R.meshBottom;
    for (let i = 0; i < this.cols; i++) {
      const x = id * W + i * step;
      let y = this.cur.height(x);
      const isl = this.world.islandAt(x);
      // water gaps: the seabed is drawn as a deep bowl below the physical (flat) water contact
      const sea = this.world.waterAt(x);
      let wet = 0;
      if (sea !== null && x > sea.wx0 && x < sea.wx1) {
        const W = sea.wx1 - sea.wx0;
        const D = Math.min(R.seaDepth, W * R.seaDepthPerWidth);
        y = Math.min(y, sea.surfaceY) - D * Math.pow(Math.sin((Math.PI * (x - sea.wx0)) / W), R.seaBowl);
        wet = Math.min(1, (sea.surfaceY - y) / R.wetFade);
      }
      const t = i * 2 * 3, b = t + 3;
      c.pos[t] = x;
      c.pos[t + 1] = y;
      c.pos[b] = x;
      c.pos[b + 1] = bottom;
      c.wet[i * 2] = c.wet[i * 2 + 1] = wet;
      c.depth[i * 2] = 0;
      c.depth[i * 2 + 1] = y - bottom;
      for (let v = 0; v < 2; v++) {
        const o = (i * 2 + v) * 4;
        c.isl[o] = isl.palette;
        c.isl[o + 1] = isl.bandWidth;
        c.isl[o + 2] = isl.bandMode;
        c.isl[o + 3] = isl.bandSeed;
      }
    }
    const g = c.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aDepth.needsUpdate = true;
    g.attributes.aIsl.needsUpdate = true;
    g.attributes.aWet.needsUpdate = true;
    c.id = id;
    c.mesh.visible = true;
  }
}
