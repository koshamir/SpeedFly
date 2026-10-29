uniform vec3 uOutline;
uniform vec3 uGrade;

varying vec2 vUv;
varying vec3 vCol;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float aa = fwidth(r) * 1.2;
  float alpha = 1.0 - smoothstep(1.0 - aa, 1.0, r);
  vec3 col = vCol;
  float groove = smoothstep(0.56 - aa, 0.56, r) * (1.0 - smoothstep(0.64, 0.64 + aa, r));
  col = mix(col, vCol * 0.72, groove);
  col += 0.45 * (1.0 - smoothstep(0.0, 0.32, length(p - vec2(-0.28, 0.32))));
  col = mix(col, uOutline, smoothstep(0.8 - aa, 0.8, r));
  gl_FragColor = vec4(col * mix(vec3(1.0), uGrade, 0.5), alpha);
}
