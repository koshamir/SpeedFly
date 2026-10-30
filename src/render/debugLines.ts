import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Run } from '../sim/run';
import type { TerrainCursor } from '../world/terrain';

const MAX_PTS = 2048;
const CIRCLE = 32;

// Debug line rendering: terrain polyline, key points, bird contact circle + normal + velocity.
export class DebugLines {
  readonly group = new THREE.Group();
  private readonly line: THREE.Line;
  private readonly linePos = new Float32Array(MAX_PTS * 3);
  private readonly keys: THREE.Points;
  private readonly keyPos = new Float32Array(MAX_PTS * 3);
  private readonly circle: THREE.LineLoop;
  private readonly vec: THREE.LineSegments;
  private readonly vecPos = new Float32Array(4 * 3);

  constructor(private readonly cur: TerrainCursor) {
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3));
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x241b3a, transparent: true, depthTest: false }));
    this.line.frustumCulled = false;
    const kg = new THREE.BufferGeometry();
    kg.setAttribute('position', new THREE.BufferAttribute(this.keyPos, 3));
    this.keys = new THREE.Points(kg, new THREE.PointsMaterial({ color: 0xff3366, size: 6, sizeAttenuation: false, transparent: true, depthTest: false }));
    this.keys.frustumCulled = false;
    const cp = new Float32Array(CIRCLE * 3);
    for (let i = 0; i < CIRCLE; i++) {
      const a = (i / CIRCLE) * Math.PI * 2;
      cp[i * 3] = Math.cos(a);
      cp[i * 3 + 1] = Math.sin(a);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(cp, 3));
    this.circle = new THREE.LineLoop(cg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false }));
    const vg = new THREE.BufferGeometry();
    vg.setAttribute('position', new THREE.BufferAttribute(this.vecPos, 3));
    this.vec = new THREE.LineSegments(vg, new THREE.LineBasicMaterial({ color: 0xffe14d, transparent: true, depthTest: false }));
    this.vec.frustumCulled = false;
    this.group.add(this.line, this.keys, this.circle, this.vec);
  }

  update(run: Run, x0: number, x1: number, cx: number, cy: number): void {
    const step = Math.max(CONFIG.render.meshStep, (x1 - x0) / (MAX_PTS - 1));
    let n = 0;
    for (let x = x0; x <= x1 && n < MAX_PTS; x += step, n++) {
      this.linePos[n * 3] = x;
      this.linePos[n * 3 + 1] = this.cur.height(x);
    }
    const lg = this.line.geometry;
    lg.setDrawRange(0, n);
    (lg.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    const T = run.world.terrain;
    let k = 0;
    for (let i = 0; i < T.n && k < MAX_PTS; i++) {
      if (T.kx[i] < x0 || T.kx[i] > x1) continue;
      this.keyPos[k * 3] = T.kx[i];
      this.keyPos[k * 3 + 1] = T.ky[i];
      k++;
    }
    const kg = this.keys.geometry;
    kg.setDrawRange(0, k);
    (kg.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    const R = CONFIG.physics.birdRadius; // the physics circle (the sprite may be drawn larger)
    this.circle.position.set(cx, cy, 0);
    this.circle.scale.set(R, R, 1);
    const b = run.bird, D = CONFIG.debug, p = this.vecPos;
    // normal at the contact point (grounded) / center (air)
    this.cur.sample(b.u);
    const L = Math.hypot(1, this.cur.d1);
    p[0] = b.grounded ? b.u : cx;
    p[1] = b.grounded ? this.cur.y : cy;
    p[3] = p[0] - (this.cur.d1 / L) * D.normalLen;
    p[4] = p[1] + (1 / L) * D.normalLen;
    // velocity
    const vx = b.grounded ? b.v / Math.hypot(1, this.cur.d1) : b.vx;
    const vy = b.grounded ? vx * this.cur.d1 : b.vy;
    p[6] = cx;
    p[7] = cy;
    p[9] = cx + vx * D.velScale;
    p[10] = cy + vy * D.velScale;
    (this.vec.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
