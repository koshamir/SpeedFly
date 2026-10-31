// Premultiplied output (blend ONE, ONE_MINUS_SRC_ALPHA): alpha 0 = additive, so normal and
// glowing particles share one draw call.
uniform sampler2D uMap;

varying vec2 vUv;
varying vec4 vCol;
varying float vAdd;

void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vCol.a;
  gl_FragColor = vec4(t.rgb * vCol.rgb * a, a * (1.0 - vAdd));
}
