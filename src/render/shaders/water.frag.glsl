uniform float uSurface;
uniform float uPxPerWorld;
uniform float uTime;
uniform float uDeepDist;
uniform float uFoamW;
uniform vec3 uTop;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uGrade;
uniform vec3 uSky;     // horizon colour, reflected near the surface
uniform vec4 uWave;    // amp A, amp B, freq A, freq B

varying vec2 vW;

float hash(float n) {
  return fract(sin(n * 91.345) * 47453.5453);
}

void main() {
  float aa = 1.0 / uPxPerWorld;
  float x = vW.x;
  float surf = uSurface + uWave.x * sin(x * uWave.z - uTime * 2.4) + uWave.y * sin(x * uWave.w + uTime * 3.3);
  float d = surf - vW.y;
  vec3 col = mix(uTop, uDeep, smoothstep(0.0, uDeepDist, d));
  col = mix(col, uSky, 0.28 * (1.0 - smoothstep(0.0, 70.0, d)));
  // drifting highlight dashes in rows under the surface
  float row = floor(d / 16.0);
  float rh = hash(row + 3.0);
  float dash = sin(x * (0.012 + 0.01 * rh) + uTime * (0.6 + rh) + rh * 40.0);
  float inRow = smoothstep(0.0, 2.0, fract(d / 16.0) * 16.0) * (1.0 - smoothstep(3.0, 5.0, fract(d / 16.0) * 16.0));
  col += 0.16 * smoothstep(0.82, 0.97, dash) * inRow * (1.0 - smoothstep(10.0, 140.0, d));
  // foam band with a wavy lower edge
  float fw = uFoamW + 1.6 * (1.0 + sin(x * 0.07 + uTime * 4.0));
  col = mix(uFoam, col, smoothstep(fw, fw + aa, d));
  gl_FragColor = vec4(col * uGrade, smoothstep(0.0, aa, d));
}
