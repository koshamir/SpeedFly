attribute float aDepth; // 0 at the surface, grows downward (world px)
attribute vec4 aIsl;    // palette, band width, band mode (0 strata / 1 diagonal), band seed
attribute float aWet;   // 1 = seabed under water

varying float vDepth;
varying float vX;
varying vec4 vIsl;
varying float vWet;

void main() {
  vDepth = aDepth;
  vX = position.x;
  vIsl = aIsl;
  vWet = aWet;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
