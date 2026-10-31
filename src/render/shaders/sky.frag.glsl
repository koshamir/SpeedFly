// Sky + 3 parallax silhouette layers in one fullscreen pass (one draw call).
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSun;
uniform vec2 uSunPos;  // screen uv
uniform float uSunR;   // share of screen height
uniform float uAspect; // width / height
uniform float uNight;  // 0 sun, 1 moon + stars
uniform float uStars;  // stars amount (fades in at dusk)
uniform float uTime;
uniform vec2 uCam;     // camera center (world)
uniform vec2 uLog;     // logical view size at zoom 1
uniform float uZoom;
// per layer: x = parallax X (Y is half), y = zoom-out compensation k, z = base height, w = amplitude
uniform vec4 uL0;
uniform vec4 uL1;
uniform vec4 uL2;
uniform vec3 uC0;      // layer colours (already fogged toward the horizon)
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uFog;     // valley mist colour (= horizon)
uniform vec3 uMist;    // x: mist depth (layer px), y: mist strength, z: ridge light

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// layer coordinates of this pixel; the layer shrinks less than the world when zooming out
vec2 layerPos(vec4 L) {
  float s = 1.0 - (1.0 - uZoom) * L.y;
  return vec2(uCam.x * L.x, uCam.y * L.x * 0.5) + (vUv - 0.5) * uLog / s;
}

float ridgeFar(float x) {
  float a = 1.0 - abs(sin(x * 0.0037 + 1.3));
  float b = 1.0 - abs(sin(x * 0.0083 + 4.1));
  return 0.62 * a * a + 0.28 * b + 0.1 * sin(x * 0.013);
}
float ridgeMid(float x) {
  return 0.5 + 0.3 * sin(x * 0.0031 + 0.7) + 0.15 * sin(x * 0.0077 + 2.9) + 0.05 * sin(x * 0.019);
}
float ridgeNear(float x) {
  return 0.5 + 0.28 * sin(x * 0.0042 + 5.1) + 0.14 * sin(x * 0.0093 + 1.7) + 0.08 * abs(sin(x * 0.031));
}

vec3 layer(vec3 col, vec4 L, vec3 c, float h, float y) {
  float top = L.z + L.w * h;
  float e = y - top;
  float aa = fwidth(e) * 0.75;
  float inside = 1.0 - smoothstep(-aa, aa, e);
  // ridge light on the top edge, mist rising from below
  vec3 lc = c * (1.0 + uMist.z * (1.0 - smoothstep(0.0, 14.0, -e)));
  lc = mix(lc, uFog, uMist.y * smoothstep(0.0, uMist.x, -e));
  return mix(col, lc, inside);
}

void main() {
  vec3 col = mix(uHorizon, uTop, pow(vUv.y, 0.8));
  vec2 q = vec2((vUv.x - uSunPos.x) * uAspect, vUv.y - uSunPos.y);
  float r = length(q);
  float px = fwidth(r);
  if (uStars > 0.0) {
    vec2 g = vUv * vec2(uAspect, 1.0) * 60.0 + vec2(uCam.x * 0.00002, 0.0);
    vec2 cell = floor(g);
    float h = hash(cell);
    vec2 c = vec2(hash(cell + 7.1), hash(cell + 3.7)) * 0.6 + 0.2;
    float star = step(0.88, h) * (1.0 - smoothstep(0.03, 0.09, length(fract(g) - c)));
    star *= 0.65 + 0.35 * sin(uTime * 2.0 + h * 60.0);
    col += star * uStars * smoothstep(0.25, 0.7, vUv.y) * smoothstep(uSunR, uSunR * 1.6, r);
  }
  float halo = 1.0 - smoothstep(uSunR, uSunR * 5.0, r);
  col = mix(col, uSun, 0.4 * halo * halo);
  float disk = 1.0 - smoothstep(uSunR - px, uSunR, r);
  vec3 body = uSun;
  if (uNight > 0.5) {
    // crescent: the shadowed part keeps a faint earthshine
    float shadow = 1.0 - smoothstep(uSunR * 0.86 - px, uSunR * 0.86, length(q - vec2(-uSunR * 0.42, uSunR * 0.18)));
    body = mix(uSun, mix(uTop, uSun, 0.18), shadow);
  }
  col = mix(col, body, disk);

  vec2 p0 = layerPos(uL0);
  col = layer(col, uL0, uC0, ridgeFar(p0.x), p0.y);
  vec2 p1 = layerPos(uL1);
  col = layer(col, uL1, uC1, ridgeMid(p1.x), p1.y);
  vec2 p2 = layerPos(uL2);
  col = layer(col, uL2, uC2, ridgeNear(p2.x), p2.y);
  // the sun's glow spills over the silhouettes (atmosphere)
  col += uSun * 0.12 * halo * (1.0 - uNight);
  gl_FragColor = vec4(col, 1.0);
}
