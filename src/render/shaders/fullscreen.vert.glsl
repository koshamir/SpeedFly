// Fullscreen quad from PlaneGeometry(1, 1): clip-space, ignores the camera.
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
}
