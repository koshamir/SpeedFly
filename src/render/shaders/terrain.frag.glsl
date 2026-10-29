uniform sampler2D uPal;    // 6 columns (5 bands + rim) x palettes
uniform float uPxPerWorld; // screen px per world px (AA width)
uniform vec3 uGrade;       // time-of-day multiply
uniform float uRimW;
uniform float uInner;
uniform float uShadeDist;
uniform float uShadeMin;
uniform vec4 uWobble;      // strata: amp A, amp B, freq A, freq B
uniform vec2 uDiag;        // diagonal: depth k, x k
uniform float uBandShade;
uniform float uBandEdge;
uniform vec3 uWater;       // seabed tint
uniform float uWetTint;
uniform float uWetDepth;

varying float vDepth;
varying float vX;
varying vec4 vIsl;
varying float vWet;

vec3 pal(float i, int p) {
  return texelFetch(uPal, ivec2(min(int(i + 0.5), 4), p), 0).rgb;
}

void main() {
  float aa = 1.0 / uPxPerWorld;
  float d = vDepth;
  int p = int(vIsl.x + 0.5);
  float w = vIsl.y;
  float s = vIsl.w;
  float u = vIsl.z < 0.5
    ? d + uWobble.x * sin(vX * uWobble.z + s) + uWobble.y * sin(vX * uWobble.w + 2.0 * s)
    : d * uDiag.x + vX * uDiag.y;
  float q = u / w;
  float bi = floor(q);
  float f = q - bi;
  vec3 c0 = pal(mod(bi, 5.0), p) * (1.06 - uBandShade * f);
  vec3 c1 = pal(mod(bi + 1.0, 5.0), p) * 1.06;
  vec3 col = mix(c0, c1, smoothstep(1.0 - uBandEdge * aa / w, 1.0, f));
  col *= 0.85 + 0.15 * smoothstep(uRimW, uRimW + uInner, d);
  vec3 rim = texelFetch(uPal, ivec2(5, p), 0).rgb;
  col = mix(mix(rim, col, vWet), col, smoothstep(uRimW - 0.5 * aa, uRimW + 0.5 * aa, d));
  col = mix(col, uWater, vWet * uWetTint * (1.0 - smoothstep(0.0, uWetDepth, d)));
  col *= mix(1.0, uShadeMin, smoothstep(0.0, uShadeDist, d));
  col *= uGrade;
  gl_FragColor = vec4(col, smoothstep(0.0, aa, d));
}
