attribute vec3 aColor;
attribute float aSide; // -1 / +1 across the ribbon

varying vec3 vCol;
varying float vSide;

void main() {
  vCol = aColor;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
