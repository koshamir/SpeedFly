import { CONFIG } from '../config';

export type RGB = [number, number, number];

export function hexRgb(hex: string, out: RGB = [0, 0, 0]): RGB {
  const v = parseInt(hex.slice(1), 16);
  out[0] = ((v >> 16) & 255) / 255;
  out[1] = ((v >> 8) & 255) / 255;
  out[2] = (v & 255) / 255;
  return out;
}

export interface SkyState {
  top: RGB;
  horizon: RGB;
  sun: RGB;
  grade: RGB;
  sunY: number;
  night: number; // 0 = day keys, 1 = moon/stars
}

const tmpA: RGB = [0, 0, 0];
const tmpB: RGB = [0, 0, 0];

function mixHex(a: string, b: string, f: number, out: RGB): void {
  hexRgb(a, tmpA);
  hexRgb(b, tmpB);
  for (let i = 0; i < 3; i++) out[i] = tmpA[i] + (tmpB[i] - tmpA[i]) * f;
}

/** Time of day from the sky keyframes (daylight 1 -> 0). */
export function skyAt(daylight: number, out: SkyState): SkyState {
  const K = CONFIG.skyKeys;
  let i = 0;
  while (i < K.length - 2 && daylight < K[i + 1].daylight) i++;
  const a = K[i], b = K[i + 1];
  const f = Math.min(1, Math.max(0, (a.daylight - daylight) / (a.daylight - b.daylight)));
  mixHex(a.top, b.top, f, out.top);
  mixHex(a.horizon, b.horizon, f, out.horizon);
  mixHex(a.grade, b.grade, f, out.grade);
  // sun sinks toward the horizon; the last key swaps it for the moon
  const last = i === K.length - 2;
  if (last) {
    hexRgb(f < 0.5 ? a.sun : b.sun, out.sun);
    out.sunY = f < 0.5 ? a.sunY - (a.sunY + 0.1) * f * 2 : b.sunY - (b.sunY + 0.1) * (1 - f) * 2;
    out.night = f < 0.5 ? 0 : 1;
  } else {
    mixHex(a.sun, b.sun, f, out.sun);
    out.sunY = a.sunY + (b.sunY - a.sunY) * f;
    out.night = 0;
  }
  return out;
}

export function newSky(): SkyState {
  return { top: [0, 0, 0], horizon: [0, 0, 0], sun: [0, 0, 0], grade: [1, 1, 1], sunY: 0, night: 0 };
}
