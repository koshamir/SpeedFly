// Ribbon with shader AA across its width (WebGL runs without MSAA).
uniform float uAlpha;

varying vec3 vCol;
varying float vSide;

void main() {
  float e = abs(vSide);
  float aa = fwidth(vSide) * 1.2;
  gl_FragColor = vec4(vCol, uAlpha * (1.0 - smoothstep(1.0 - aa, 1.0, e)));
}
