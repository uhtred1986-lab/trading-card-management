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

/** How far a phone board's field rows may shrink (`data-squeeze` 1..SQUEEZE_STEPS, see phone-board.module.css). */
export const SQUEEZE_STEPS = 4;

/**
 * A phone board must not scroll the page, whatever the prompt under the field needs: a defence brief, a
 * choice with a tall hand. The takeover staging gets this for free (its rows are 0 px high, the fight is
 * drawn over them); the compact board (settings: "Use compact phone board") and a fight staged as a band
 * show the whole field, so this steps the field's card scale down (`data-squeeze`, 1 to 4) until the board is no taller
 * than the screen, and back up when the prompt shrinks. It looks at the board's own height against the
 * window, like `useBoardFit`, and watches the board, the prompt and the hand, so a longer or shorter
 * prompt re-fits. A no-op where the board already fits (the takeover), and off (no attribute) on tablets
 * and desktop, which fit by their own rules.
 */
export function useCompactSqueeze(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const phone = window.matchMedia("(max-width: 767px)");
    if (!enabled || !phone.matches) {
      delete el.dataset.squeeze;
      return;
    }
    let fitting = false;
    const fit = () => {
      if (fitting) return;
      fitting = true;
      // The board is `min-height: 100dvh - 1rem`: taller than that means its content does not fit.
      const room = () => window.innerHeight - 16 + 1;
      let step = 0;
      delete el.dataset.squeeze;
      while (step < SQUEEZE_STEPS && el.getBoundingClientRect().height > room()) {
        step += 1;
        el.dataset.squeeze = String(step);
      }
      fitting = false;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    for (const part of el.querySelectorAll(".arena-bar, .arena-hand")) ro.observe(part);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
      delete el.dataset.squeeze;
    };
  }, [ref, enabled]);
}
