// Clouds: cel-shaded puff texture (rgb = lit/shade, a = shape) times the per-instance light colour.
uniform sampler2D uMap;

varying vec2 vUv;
varying vec3 vCol;

void main() {
  vec4 t = texture2D(uMap, vUv);
  gl_FragColor = vec4(t.rgb * vCol, t.a);
}
