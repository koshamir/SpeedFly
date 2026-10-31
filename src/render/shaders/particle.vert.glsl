// Instanced particle quad: world centre + rotation, size, colour, atlas frame + additive share.
attribute vec3 aPos;   // x, y, rotation
attribute vec2 aSize;  // world size
attribute vec4 aCol;   // rgb, alpha
attribute vec2 aFrame; // atlas cell, additive (0 = normal blend, 1 = pure additive)

uniform vec2 uGrid;    // atlas columns, rows

varying vec2 vUv;
varying vec4 vCol;
varying float vAdd;

void main() {
  float c = cos(aPos.z), s = sin(aPos.z);
  vec2 p = position.xy * aSize;
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c) + aPos.xy;
  float col = mod(aFrame.x, uGrid.x), row = floor(aFrame.x / uGrid.x);
  vUv = (vec2(col, uGrid.y - 1.0 - row) + uv) / uGrid;
  vCol = aCol;
  vAdd = aFrame.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
}
