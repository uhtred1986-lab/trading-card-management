/**
 * The zoom of the card swipe viewer as a pure reducer (`src/components/CardSwipeViewer.tsx`): double tap
 * toggles 2.2x, a pinch moves between 1x and 4x, a drag pans while zoomed. No DOM in here, so a script
 * can check it (`scripts/verify/pokemon-polish.mts`).
 *
 * The picture is drawn with `transform: translate(x px, y px) scale(s)` around its own centre. Points are
 * measured from that centre. `box` is the picture's size at 1x; the pan is clamped so an edge of the
 * picture never leaves its edge of the box (at 1x nothing can move).
 */

export const ZOOM_MIN = 1;
export const ZOOM_DOUBLE = 2.2;
export const ZOOM_MAX = 4;
/** One `+` or `-` key press multiplies or divides the scale by this. */
export const ZOOM_STEP = 1.5;

export interface ZoomState {
  scale: number;
  x: number;
  y: number;
  /** True when the last change was a jump (double tap, key, reset): the view may animate it. A gesture never animates. */
  jump: boolean;
}

export interface ZoomBox {
  w: number;
  h: number;
}

export const ZOOM_REST: ZoomState = { scale: ZOOM_MIN, x: 0, y: 0, jump: false };

export type ZoomAction =
  /** Double tap or click at (px, py) from the picture's centre: zoom in on that point, or back out when already zoomed. */
  | { type: "toggle"; px: number; py: number; box: ZoomBox }
  /** A pinch or drag step: scale by `factor` around (px, py), then move by (dx, dy). */
  | { type: "gesture"; factor: number; px: number; py: number; dx: number; dy: number; box: ZoomBox }
  /** `+` (dir 1) or `-` (dir -1), around the centre. */
  | { type: "step"; dir: 1 | -1; box: ZoomBox }
  /** The fingers are up: a scale that ended just above 1x settles at 1x. */
  | { type: "settle" }
  | { type: "reset" };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The largest pan from the centre at this scale: half of what the picture grew by, never negative. */
export function panLimit(size: number, scale: number): number {
  return Math.max(0, (size * scale - size) / 2);
}

function place(scale: number, x: number, y: number, box: ZoomBox, jump: boolean): ZoomState {
  const s = clamp(scale, ZOOM_MIN, ZOOM_MAX);
  if (s <= ZOOM_MIN) return { ...ZOOM_REST, jump };
  const lx = panLimit(box.w, s);
  const ly = panLimit(box.h, s);
  return { scale: s, x: clamp(x, -lx, lx), y: clamp(y, -ly, ly), jump };
}

/** Scale to `next` keeping the point (px, py) of the screen where it is: x' = p - (p - x) * next / scale. */
function zoomAround(z: ZoomState, next: number, px: number, py: number) {
  const k = next / z.scale;
  return { x: px - (px - z.x) * k, y: py - (py - z.y) * k };
}

export function zoomReducer(z: ZoomState, a: ZoomAction): ZoomState {
  switch (a.type) {
    case "toggle": {
      if (z.scale > ZOOM_MIN) return { ...ZOOM_REST, jump: true };
      const t = zoomAround(z, ZOOM_DOUBLE, a.px, a.py);
      return place(ZOOM_DOUBLE, t.x, t.y, a.box, true);
    }
    case "gesture": {
      const next = clamp(z.scale * a.factor, ZOOM_MIN, ZOOM_MAX);
      const t = zoomAround(z, next, a.px, a.py);
      return place(next, t.x + a.dx, t.y + a.dy, a.box, false);
    }
    case "step": {
      const next = clamp(a.dir > 0 ? z.scale * ZOOM_STEP : z.scale / ZOOM_STEP, ZOOM_MIN, ZOOM_MAX);
      // Zooming out to the last step lands on 1x instead of a hair above it.
      const s = next < ZOOM_MIN * 1.1 ? ZOOM_MIN : next;
      const t = zoomAround(z, s, 0, 0);
      return place(s, t.x, t.y, a.box, true);
    }
    case "settle":
      return z.scale > ZOOM_MIN && z.scale < 1.08 ? { ...ZOOM_REST, jump: true } : z;
    case "reset":
      return z.scale === ZOOM_MIN && z.x === 0 && z.y === 0 ? z : { ...ZOOM_REST, jump: true };
  }
}

export const isZoomed = (z: ZoomState) => z.scale > ZOOM_MIN;

/** The CSS transform of a state. */
export function zoomTransform(z: ZoomState): string | undefined {
  return isZoomed(z) ? `translate(${z.x.toFixed(1)}px, ${z.y.toFixed(1)}px) scale(${z.scale.toFixed(3)})` : undefined;
}
