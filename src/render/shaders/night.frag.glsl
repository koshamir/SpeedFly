// Night front: dark gradient from the left edge, uWidth world px wide.
uniform float uLeft;  // world x at the screen edges
uniform float uRight;
uniform float uNightX;
uniform float uWidth;
uniform float uAlpha;
uniform vec3 uColor;

varying vec2 vUv;

void main() {
  float x = mix(uLeft, uRight, vUv.x);
  float a = 1.0 - smoothstep(uNightX, uNightX + uWidth, x);
  gl_FragColor = vec4(uColor, a * a * uAlpha);
}
