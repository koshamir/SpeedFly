attribute float aDepth; // 0 at the surface, grows downward (world px)
attribute vec4 aIsl;    // palette, band width, band mode (0 strata / 1 diagonal), band seed
attribute float aWet;   // 1 = seabed under water
attribute vec4 aIsl2;   // looks of the next island (water gaps)
attribute float aMix;   // 0 = aIsl, 1 = aIsl2

varying float vDepth;
varying float vX;
varying vec4 vIsl;
varying float vWet;
varying vec4 vIsl2;
varying float vMix;

void main() {
  vDepth = aDepth;
  vX = position.x;
  vIsl = aIsl;
  vWet = aWet;
  vIsl2 = aIsl2;
  vMix = aMix;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
