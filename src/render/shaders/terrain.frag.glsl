uniform sampler2D uPal;    // 6 columns (5 bands + rim) x palettes
uniform float uPxPerWorld; // screen px per world px (AA width)
uniform vec3 uGrade;       // time-of-day multiply
uniform float uRimW;
uniform float uRimMinPx;   // rim never thinner than this on screen (zoomed out)
uniform float uInner;
uniform float uSheen;      // light from above: brightness boost right under the rim
uniform float uSheenDist;
uniform float uShadeDist;
uniform float uShadeMin;
uniform vec4 uWobble;      // strata: amp A, amp B, freq A, freq B
uniform vec2 uDiag;        // diagonal: depth k, x k
uniform float uBandShade;
uniform float uBandEdge;
uniform float uGrain;
uniform vec3 uWater;       // seabed tint
uniform float uWetTint;
uniform float uWetDepth;
uniform float uTeacher;    // Touch Teacher (§9): green rim downhill, amber uphill
uniform vec3 uHoldCol;
uniform vec3 uLetCol;

varying float vDepth;
varying float vX;
varying vec4 vIsl;
varying float vWet;
varying vec4 vIsl2;
varying float vMix;
varying float vSlope;

vec3 pal(float i, int p) {
  return texelFetch(uPal, ivec2(min(int(i + 0.5), 4), p), 0).rgb;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec3 bands(vec4 isl, float d, float aa) {
  int p = int(isl.x + 0.5);
  float w = isl.y;
  float s = isl.w;
  float u = isl.z < 0.5
    ? d + uWobble.x * sin(vX * uWobble.z + s) + uWobble.y * sin(vX * uWobble.w + 2.0 * s)
    : d * uDiag.x + vX * uDiag.y;
  float q = u / w;
  float bi = floor(q);
  float f = q - bi;
  vec3 c0 = pal(mod(bi, 5.0), p) * (1.06 - uBandShade * f);
  vec3 c1 = pal(mod(bi + 1.0, 5.0), p) * 1.06;
  // band edge AA: never sharper than one screen pixel (bands stay clean when zoomed out)
  float edge = max(uBandEdge, 1.0) * aa / w;
  return mix(c0, c1, smoothstep(1.0 - edge, 1.0, f));
}

void main() {
  float aa = 1.0 / uPxPerWorld;
  float d = vDepth;
  int p = int(vIsl.x + 0.5);
  vec3 col = bands(vIsl, d, aa);
  vec3 rim = texelFetch(uPal, ivec2(5, p), 0).rgb;
  // across a water gap the two islands' looks blend (no hard seam under the sea)
  if (vMix > 0.001) {
    col = mix(col, bands(vIsl2, d, aa), vMix);
    rim = mix(rim, texelFetch(uPal, ivec2(5, int(vIsl2.x + 0.5)), 0).rgb, vMix);
  }
  float rimW = max(uRimW, uRimMinPx * aa);
  if (uTeacher > 0.001) {
    float down = smoothstep(-0.06, -0.2, vSlope), up = smoothstep(0.06, 0.2, vSlope);
    float k = uTeacher * max(down, up);
    vec3 tc = down > up ? uHoldCol : uLetCol;
    rim = mix(rim, tc, k);
    rimW *= 1.0 + 1.6 * k;
    // a soft glow of the advice colour under the rim
    col = mix(col, tc, 0.35 * k * (1.0 - smoothstep(rimW, rimW + 40.0, d)));
  }
  // sheen just under the surface, then the thin inner shadow line below the rim
  col *= 1.0 + uSheen * (1.0 - smoothstep(rimW, rimW + uSheenDist, d));
  col *= 0.85 + 0.15 * smoothstep(rimW, rimW + uInner, d);
  col = mix(mix(rim, col, vWet), col, smoothstep(rimW - 0.5 * aa, rimW + 0.5 * aa, d));
  col = mix(col, uWater, vWet * uWetTint * (1.0 - smoothstep(0.0, uWetDepth, d)));
  col *= mix(1.0, uShadeMin, smoothstep(0.0, uShadeDist, d));
  col *= uGrade;
  col *= 1.0 + uGrain * (hash(floor(gl_FragCoord.xy)) * 2.0 - 1.0);
  gl_FragColor = vec4(col, smoothstep(0.0, aa, d));
}
