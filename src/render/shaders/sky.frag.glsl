uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSun;
uniform vec2 uSunPos;  // screen uv
uniform float uSunR;   // share of screen height
uniform float uAspect; // width / height
uniform float uNight;  // stars amount
uniform float uTime;

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec3 col = mix(uHorizon, uTop, pow(vUv.y, 0.8));
  vec2 q = vec2((vUv.x - uSunPos.x) * uAspect, vUv.y - uSunPos.y);
  float r = length(q);
  float px = fwidth(r);
  col = mix(col, uSun, 0.4 * (1.0 - smoothstep(uSunR, uSunR * 4.0, r)));
  col = mix(col, uSun, 1.0 - smoothstep(uSunR - px, uSunR, r));
  if (uNight > 0.0) {
    vec2 g = vUv * vec2(uAspect, 1.0) * 60.0;
    vec2 cell = floor(g);
    float h = hash(cell);
    vec2 c = vec2(hash(cell + 7.1), hash(cell + 3.7)) * 0.6 + 0.2;
    float star = step(0.88, h) * (1.0 - smoothstep(0.03, 0.09, length(fract(g) - c)));
    star *= 0.65 + 0.35 * sin(uTime * 2.0 + h * 60.0);
    col += star * uNight * smoothstep(0.25, 0.7, vUv.y) * smoothstep(uSunR, uSunR * 1.6, r);
  }
  gl_FragColor = vec4(col, 1.0);
}
