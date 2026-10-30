import * as THREE from 'three';
import { CONFIG } from '../config';
import type { GameBus } from '../core/events';
import type { Run } from '../sim/run';

// Rough M2 bird: one Canvas2D-drawn sprite (awake / asleep frames in an atlas) on a plane.
// M3 replaces it with the cut-out rig + verlet scarf.

const OUT = CONFIG.colors.outline;

function drawChick(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, asleep: boolean): void {
  const s = size / (2 * CONFIG.physics.birdRadius * CONFIG.render.birdSprite); // tex px per world px
  const R = CONFIG.physics.birdRadius * s;
  const lw = 3 * s;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = OUT;

  // scarf tail (behind the body)
  g.beginPath();
  g.moveTo(cx - R * 0.55, cy + R * 0.12);
  g.bezierCurveTo(cx - R * 0.95, cy - R * 0.05, cx - R * 1.1, cy + R * 0.35, cx - R * 1.42, cy + R * 0.05);
  g.lineTo(cx - R * 1.38, cy + R * 0.42);
  g.bezierCurveTo(cx - R * 1.05, cy + R * 0.62, cx - R * 0.85, cy + R * 0.3, cx - R * 0.5, cy + R * 0.48);
  g.closePath();
  g.fillStyle = '#E8414A';
  g.fill();
  g.lineWidth = lw * 0.8;
  g.stroke();

  // body with cel shading
  g.save();
  g.beginPath();
  g.arc(cx, cy, R - lw / 2, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = '#CBBDF0';
  g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  g.beginPath();
  g.arc(cx - R * 0.12, cy - R * 0.16, R * 0.86, 0, Math.PI * 2);
  g.fillStyle = '#FFF7EA';
  g.fill();
  g.beginPath();
  g.ellipse(cx - R * 0.38, cy - R * 0.5, R * 0.22, R * 0.13, -0.6, 0, Math.PI * 2);
  g.fillStyle = '#FFFFFF';
  g.fill();
  // scarf band around the neck
  g.beginPath();
  g.moveTo(cx - R, cy + R * 0.18);
  g.quadraticCurveTo(cx, cy + R * 0.42, cx + R, cy + R * 0.12);
  g.lineTo(cx + R, cy + R * 0.42);
  g.quadraticCurveTo(cx, cy + R * 0.72, cx - R, cy + R * 0.48);
  g.closePath();
  g.fillStyle = '#E8414A';
  g.fill();
  g.lineWidth = lw * 0.6;
  g.stroke();
  g.restore();
  g.beginPath();
  g.arc(cx, cy, R - lw / 2, 0, Math.PI * 2);
  g.lineWidth = lw;
  g.stroke();

  // wing
  g.beginPath();
  g.ellipse(cx - R * 0.22, cy + R * 0.08, R * 0.4, R * 0.25, -0.35, 0, Math.PI * 2);
  g.fillStyle = '#B9A6E8';
  g.fill();
  g.lineWidth = lw * 0.75;
  g.stroke();

  // beak
  g.beginPath();
  g.moveTo(cx + R * 0.82, cy - R * 0.12);
  g.lineTo(cx + R * 1.3, cy + R * 0.04);
  g.lineTo(cx + R * 0.8, cy + R * 0.24);
  g.closePath();
  g.fillStyle = '#FFC23D';
  g.fill();
  g.lineWidth = lw * 0.75;
  g.stroke();

  if (!asleep) {
    // goggles: strap + amber lens with the eye inside
    g.beginPath();
    g.moveTo(cx - R * 0.75, cy - R * 0.5);
    g.quadraticCurveTo(cx, cy - R * 0.62, cx + R * 0.2, cy - R * 0.4);
    g.lineWidth = lw * 1.4;
    g.stroke();
    const ex = cx + R * 0.42, ey = cy - R * 0.32, er = R * 0.33;
    g.beginPath();
    g.arc(ex, ey, er, 0, Math.PI * 2);
    g.fillStyle = '#FFB02E';
    g.fill();
    g.beginPath();
    g.arc(ex - er * 0.1, ey - er * 0.1, er * 0.7, 0, Math.PI * 2);
    g.fillStyle = '#FFE09A';
    g.fill();
    g.beginPath();
    g.arc(ex, ey, er, 0, Math.PI * 2);
    g.lineWidth = lw;
    g.stroke();
    g.beginPath();
    g.arc(ex + er * 0.18, ey + er * 0.05, er * 0.36, 0, Math.PI * 2);
    g.fillStyle = OUT;
    g.fill();
    g.beginPath();
    g.arc(ex + er * 0.06, ey - er * 0.1, er * 0.12, 0, Math.PI * 2);
    g.fillStyle = '#FFFFFF';
    g.fill();
  } else {
    // goggles pushed up, closed eye, blush
    g.beginPath();
    g.ellipse(cx + R * 0.05, cy - R * 0.72, R * 0.3, R * 0.2, 0.2, 0, Math.PI * 2);
    g.fillStyle = '#FFB02E';
    g.fill();
    g.lineWidth = lw * 0.8;
    g.stroke();
    g.beginPath();
    g.arc(cx + R * 0.42, cy - R * 0.28, R * 0.2, 0.15 * Math.PI, 0.85 * Math.PI);
    g.lineWidth = lw * 0.8;
    g.stroke();
    g.beginPath();
    g.arc(cx + R * 0.5, cy + R * 0.02, R * 0.13, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,120,150,0.55)';
    g.fill();
  }
}

export class BirdView {
  readonly mesh: THREE.Mesh;
  private readonly tex: THREE.CanvasTexture;
  private angle = 0;
  private squashT = 1e9;
  private stretch = 0;

  constructor(bus: GameBus) {
    const N = CONFIG.render.birdTex;
    const cv = document.createElement('canvas');
    cv.width = N * 2;
    cv.height = N;
    const g = cv.getContext('2d')!;
    drawChick(g, N / 2, N / 2, N, false);
    drawChick(g, N * 1.5, N / 2, N, true);
    this.tex = new THREE.CanvasTexture(cv);
    this.tex.repeat.set(0.5, 1);
    this.tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.renderOrder = 6;
    this.mesh.frustumCulled = false;
    bus.on('land', () => (this.squashT = 0));
  }

  reset(): void {
    this.angle = 0;
    this.squashT = 1e9;
    this.stretch = 0;
  }

  update(dt: number, run: Run, x: number, y: number, d1: number, scale: number, asleep: boolean): void {
    const b = run.bird, Rr = CONFIG.render;
    this.tex.offset.x = asleep ? 0.5 : 0;
    // rotation: velocity direction (ground: tangent), smoothed; diving adds a nose-down tilt
    const diving = !b.grounded && run.held;
    let target = asleep ? 0 : b.grounded ? Math.atan(d1) : Math.atan2(b.vy, b.vx);
    if (diving) target -= (Rr.diveTilt * Math.PI) / 180;
    let da = target - this.angle;
    da -= Math.round(da / (2 * Math.PI)) * 2 * Math.PI;
    this.angle += da * (1 - Math.exp(-dt / Rr.rotTau));
    this.stretch += ((diving ? 1 : 0) - this.stretch) * (1 - Math.exp(-dt / Rr.rotTau));
    this.squashT += dt;
    const sq = this.squashT < Rr.squashTime ? Rr.squash + (1 - Rr.squash) * (this.squashT / Rr.squashTime) : 1;
    const size = 2 * CONFIG.physics.birdRadius * Rr.birdSprite * scale;
    const sx = 1 + (Rr.diveStretchX - 1) * this.stretch + (1 - sq) * 0.6;
    const sy = (1 + (Rr.diveStretchY - 1) * this.stretch) * sq;
    // (x, y) is the physics circle center. Squash compresses toward the feet (sprite-local down,
    // = -normal on the ground); the zoom-out enlargement grows upward so the bigger body still sits
    // on the ground. Both rules are the same in the air: no pop at takeoff/landing.
    const R = CONFIG.physics.birdRadius, drop = (1 - sq) * R * scale, lift = (scale - 1) * R;
    this.mesh.position.set(x + Math.sin(this.angle) * drop, y - Math.cos(this.angle) * drop + lift, 0);
    this.mesh.rotation.z = this.angle;
    this.mesh.scale.set(size * sx, size * sy, 1);
  }
}
