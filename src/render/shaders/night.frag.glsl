// Screen overlay in one pass: night front (dark gradient from the left, uWidth world px wide),
// light vignette, and a screen tint (Fever pulse / flashes).
uniform float uLeft;  // world x at the screen edges
uniform float uRight;
uniform float uNightX;
uniform float uWidth;
uniform float uAlpha;
uniform vec3 uColor;
uniform float uAspect;
uniform float uVignette;
uniform vec3 uVigColor;
uniform vec4 uTint;   // rgb, amount (edges weighted)

varying vec2 vUv;

void main() {
  float x = mix(uLeft, uRight, vUv.x);
  float n = 1.0 - smoothstep(uNightX, uNightX + uWidth, x);
  n = n * n * uAlpha;
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = length(q) / length(vec2(uAspect, 1.0) * 0.5);
  float v = uVignette * smoothstep(0.45, 1.05, r);
  // premultiplied: dark layers (night, vignette) + additive tint
  float a = 1.0 - (1.0 - n) * (1.0 - v);
  vec3 dark = (uColor * n + uVigColor * v * (1.0 - n));
  vec3 tint = uTint.rgb * uTint.a * (0.35 + 0.65 * smoothstep(0.2, 1.0, r));
  gl_FragColor = vec4(dark + tint * (1.0 - a), a);
}
