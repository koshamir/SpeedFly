import * as THREE from 'three';
import { CONFIG } from '../config';
import type { World } from '../world/world';
import { hexRgb, type RGB } from './palette';
import frag from './shaders/water.frag.glsl?raw';
import vert from './shaders/water.vert.glsl?raw';

// Water between islands: one quad spanning [lip, landing peak] up to the surface, drawn BEHIND the
// terrain, so it only shows in the basin (the seabed there is drawn deep, see terrainMesh).
export class Water {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;

  constructor() {
    const C = CONFIG.colors, R = CONFIG.render;
    const c = (hex: string): THREE.Color => {
      const v: RGB = hexRgb(hex);
      return new THREE.Color(v[0], v[1], v[2]);
    };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uSurface: { value: 0 },
        uPxPerWorld: { value: 1 },
        uTime: { value: 0 },
        uDeepDist: { value: R.waterDeep },
        uFoamW: { value: R.foam },
        uTop: { value: c(C.water) },
        uDeep: { value: c(C.waterDeep) },
        uFoam: { value: c(C.foam) },
        uGrade: { value: new THREE.Color(1, 1, 1) },
        uSky: { value: new THREE.Color(1, 1, 1) },
        uWave: { value: new THREE.Vector4(R.waveA, R.waveB, R.waveFreqA, R.waveFreqB) },
      },
    });
    const g = new THREE.PlaneGeometry(1, 1);
    g.translate(0.5, 0.5, 0); // origin at bottom-left
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  update(world: World, x0: number, x1: number, time: number, pxPerWorld: number, grade: RGB, sky: RGB): void {
    this.mesh.visible = false;
    for (const isl of world.islands) {
      if (!(isl.lipX < x1 && isl.landingX > x0)) continue;
      const R = CONFIG.render, bottom = R.meshBottom;
      this.mesh.position.set(isl.lipX, bottom, 0);
      // the quad reaches above the surface by the wave height; the shader cuts the waves
      this.mesh.scale.set(isl.landingX - isl.lipX, isl.surfaceY + R.waveA + R.waveB + 2 - bottom, 1);
      this.mesh.visible = true;
      const u = this.mat.uniforms;
      u.uSurface.value = isl.surfaceY;
      u.uPxPerWorld.value = pxPerWorld;
      u.uTime.value = time;
      (u.uGrade.value as THREE.Color).setRGB(grade[0], grade[1], grade[2]);
      (u.uSky.value as THREE.Color).setRGB(sky[0], sky[1], sky[2]);
      return;
    }
  }
}
