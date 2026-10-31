import * as THREE from 'three';
import { CONFIG } from '../config';
import type { TerrainCursor } from '../world/terrain';

// The record marker: a flag planted on the terrain at the best distance (one textured quad, one draw).
export class FlagView {
  readonly mesh: THREE.Mesh;
  /** World x of the record (<= 0 = hidden). */
  x = 0;

  constructor() {
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 256;
    const g = cv.getContext('2d')!;
    const ink = CONFIG.colors.outline;
    // pole
    g.fillStyle = ink;
    g.fillRect(14, 10, 12, 246);
    g.fillStyle = '#fff6e0';
    g.fillRect(17, 12, 6, 240);
    // waving pennant with a star
    g.beginPath();
    g.moveTo(24, 16);
    g.quadraticCurveTo(70, 4, 118, 30);
    g.quadraticCurveTo(80, 48, 118, 84);
    g.quadraticCurveTo(70, 70, 24, 88);
    g.closePath();
    g.fillStyle = '#ff5fa2';
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = ink;
    g.stroke();
    g.fillStyle = '#ffd23f';
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? 9 : 20;
      g.lineTo(62 + Math.cos(a) * r, 50 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.lineWidth = 3;
    g.stroke();
    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5.2;
    this.mesh.visible = false;
  }

  update(cur: TerrainCursor, x0: number, x1: number, scale: number, time: number): void {
    const vis = this.x > 0 && this.x > x0 - 200 && this.x < x1 + 200;
    this.mesh.visible = vis;
    if (!vis) return;
    const s = 90 * scale;
    this.mesh.scale.set(s, s, 1);
    this.mesh.position.set(this.x + s * 0.35, cur.height(this.x) + s * 0.95, 0);
    this.mesh.rotation.z = 0.03 * Math.sin(time * 3);
  }
}
