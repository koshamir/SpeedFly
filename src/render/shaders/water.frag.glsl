uniform float uSurface;
uniform float uPxPerWorld;
uniform float uTime;
uniform float uDeepDist;
uniform float uFoamW;
uniform vec3 uTop;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uGrade;

varying vec2 vW;

void main() {
  float aa = 1.0 / uPxPerWorld;
  float d = uSurface - vW.y;
  vec3 col = mix(uTop, uDeep, smoothstep(0.0, uDeepDist, d));
  // drifting highlights near the surface
  float h = sin(vW.x * 0.03 + uTime * 2.0) * sin(vW.x * 0.011 - uTime * 1.3 + d * 0.05);
  col += smoothstep(0.8, 1.0, h) * 0.14 * (1.0 - smoothstep(0.0, 90.0, d));
  col = mix(uFoam, col, smoothstep(uFoamW, uFoamW + aa, d));
  gl_FragColor = vec4(col * uGrade, smoothstep(0.0, aa, d));
}
