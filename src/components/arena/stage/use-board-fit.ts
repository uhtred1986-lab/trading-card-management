"use client";

import { useLayoutEffect, type RefObject } from "react";

/**
 * The board's height steps, as the viewport heights `globals.css` calls its
 * "height ladder": band 0 is 1050 px and up, the last is under 620 px. The
 * card scale is chosen per band (`--arena`, a plain number the hand reads).
 */
export const FIT_EDGES = [1050, 960, 900, 860, 820, 780, 740, 700, 660, 620, 0] as const;

/** Which band a board of this height (plus the page's 1 rem gutter) falls in. */
export function fitBand(boardHeight: number): number {
  const h = boardHeight + 16;
  const k = FIT_EDGES.findIndex((edge) => h >= edge);
  return k < 0 ? FIT_EDGES.length - 1 : k;
}

/**
 * Stamps `data-fit` (the band) on the board from the board's *own* height, so
 * a host that gives the board less than the whole window (the tutorial's coach
 * strip above it) still gets the card sizes that fit what it has. The CSS has
 * the same ladder keyed on the viewport as the first-paint fallback; this
 * attribute outranks it. Nothing re-renders: it is one attribute on the node.
 */
export function useBoardFit(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      const band = String(fitBand(el.clientHeight));
      if (el.dataset.fit !== band) el.dataset.fit = band;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
}
