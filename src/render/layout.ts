import { CONFIG } from '../config';

// Portrait-first layout. Logical width 720 (height follows the screen); wider than 9:16 ->
// logical height 1280 and width up to 960, side bars beyond.
export interface Layout {
  W: number; // full CSS size
  H: number;
  gx: number; // game rect (CSS px)
  gy: number;
  gw: number;
  gh: number;
  logW: number; // logical size of the game rect (world px at zoom 1)
  logH: number;
  dpr: number;
  landscapePhone: boolean;
}

export function computeLayout(W: number, H: number, coarse: boolean, dprCap = Infinity): Layout {
  const V = CONFIG.view;
  const dpr = Math.min(window.devicePixelRatio || 1, V.dprMax, dprCap);
  let logW: number, logH: number, gw: number, gh: number;
  if (H / W >= V.logH / V.logW) {
    logW = V.logW;
    logH = (V.logW * H) / W;
    gw = W;
    gh = H;
  } else {
    logH = V.logH;
    logW = Math.min(V.maxW, (V.logH * W) / H);
    gh = H;
    gw = (logW / logH) * H;
  }
  return { W, H, gx: Math.round((W - gw) / 2), gy: 0, gw: Math.round(gw), gh: Math.round(gh), logW, logH, dpr, landscapePhone: coarse && W > H };
}
