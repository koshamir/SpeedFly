import * as THREE from 'three';
import frag from '../shaders/particle.frag.glsl?raw';
import vert from '../shaders/particle.vert.glsl?raw';

/**
 * Instanced textured quads from an atlas grid in one draw call: centre + rotation, size, rgba,
 * frame, additive share (premultiplied blending: normal and glowing quads mix in one batch).
 * Used by the particle pool and the bird rig. Fill with set() then commit(n). No allocations.
 */
export class SpriteBatch {
  readonly mesh: THREE.Mesh;
  readonly cap: number;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aSize: THREE.InstancedBufferAttribute;
  private readonly aCol: THREE.InstancedBufferAttribute;
  private readonly aFrame: THREE.InstancedBufferAttribute;
  private readonly P: Float32Array;
  private readonly S: Float32Array;
  private readonly C: Float32Array;
  private readonly F: Float32Array;

  constructor(cap: number, map: THREE.Texture, cols: number, rows: number) {
    this.cap = cap;
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    const inst = (k: number): THREE.InstancedBufferAttribute => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * k), k);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aPos = inst(3);
    this.aSize = inst(2);
    this.aCol = inst(4);
    this.aFrame = inst(2);
    this.P = this.aPos.array as Float32Array;
    this.S = this.aSize.array as Float32Array;
    this.C = this.aCol.array as Float32Array;
    this.F = this.aFrame.array as Float32Array;
    this.geo.setAttribute('aPos', this.aPos);
    this.geo.setAttribute('aSize', this.aSize);
    this.geo.setAttribute('aCol', this.aCol);
    this.geo.setAttribute('aFrame', this.aFrame);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uMap: { value: map }, uGrid: { value: new THREE.Vector2(cols, rows) } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
  }

  set(i: number, x: number, y: number, rot: number, sx: number, sy: number, r: number, g: number, b: number, a: number, frame: number, add: number): void {
    this.P[i * 3] = x;
    this.P[i * 3 + 1] = y;
    this.P[i * 3 + 2] = rot;
    this.S[i * 2] = sx;
    this.S[i * 2 + 1] = sy;
    this.C[i * 4] = r;
    this.C[i * 4 + 1] = g;
    this.C[i * 4 + 2] = b;
    this.C[i * 4 + 3] = a;
    this.F[i * 2] = frame;
    this.F[i * 2 + 1] = add;
  }

  commit(n: number): void {
    this.geo.instanceCount = n;
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aCol.needsUpdate = this.aFrame.needsUpdate = true;
  }
}
