attribute float aT;    // 0 at the head, 1 at the tail
attribute float aSide; // -1 / +1 across the ribbon

varying float vT;
varying float vSide;

void main() {
  vT = aT;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
