// Speed ribbon: white (BLAZING+) or fire-rainbow (Fever); premultiplied, glowing (additive-ish).
uniform float uAlpha;
uniform float uRainbow; // 0 white, 1 rainbow
uniform float uTime;

varying float vT;
varying float vSide;

vec3 hue(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}

void main() {
  float aa = fwidth(vSide) * 1.2;
  float edge = 1.0 - smoothstep(1.0 - aa, 1.0, abs(vSide));
  float core = 1.0 - smoothstep(0.0, 0.9, abs(vSide));
  // fire at the head (yellow -> orange -> pink) running into the rainbow toward the tail
  vec3 rb = hue(fract(vT * 0.9 - uTime * 0.8));
  vec3 fire = mix(vec3(1.0, 0.95, 0.5), vec3(1.0, 0.45, 0.25), smoothstep(0.0, 0.25, vT));
  vec3 c = mix(vec3(1.0), mix(fire, rb, smoothstep(0.15, 0.45, vT)), uRainbow);
  c = mix(c, vec3(1.0), 0.45 * core * (1.0 - 0.8 * uRainbow));
  float a = uAlpha * edge * (1.0 - vT) * (0.55 + 0.45 * core);
  // white glows (mostly additive); the rainbow is painted (mostly normal) so it keeps its colour on a bright sky
  gl_FragColor = vec4(c * a, a * mix(0.35, 0.9, uRainbow));
}
