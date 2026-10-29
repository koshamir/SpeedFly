varying vec2 vUv;
varying vec3 vCol;

void main() {
  vUv = uv;
  vCol = instanceColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
