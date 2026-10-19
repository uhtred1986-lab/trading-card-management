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

/** The field's card sizes at `--arena: 1` (`StageZones.tsx`): a leader, a Battle Card, and a card's height per width. */
const FIELD_LEADER_W = 80;
const FIELD_CARD_W = 68;
const CARD_RATIO = 88 / 63;
/** The field's card scale never drops below the phone's nor grows past a 260 px scan's worth of leader. */
export const FIELD_FIT_MIN = 1;
export const FIELD_FIT_MAX = 2.6;

/**
 * The scale at which a leader and `cards` Battle Cards fill a Battle Area of `width` x `height` px:
 * the leader as tall as the row allows (its LEADER tag overhangs the top, 24 px of padding and ring), and the
 * whole row no wider than the area. Floored to 0.05 so a pixel of resize does not restyle every card.
 */
export function fieldFitScale(width: number, height: number, cards: number): number {
  const n = Math.max(cards, 3);
  const byHeight = (height - 24) / (FIELD_LEADER_W * CARD_RATIO + FIELD_LEADER_W * 0.2);
  // A rested leader lies on its side, as wide as it is tall: budget for that, so turning it never clips the row.
  const byWidth = (width - 24 - 12 * n) / (FIELD_LEADER_W * CARD_RATIO + FIELD_CARD_W * n);
  const scale = Math.min(byHeight, byWidth, FIELD_FIT_MAX);
  return Math.max(FIELD_FIT_MIN, Math.floor(scale * 20) / 20);
}

/**
 * Desktop (xl): sizes the field's cards from the space the two Battle Areas actually have
 * (`[data-field-row]`, which split the field's height evenly), not from a viewport-height step,
 * so a wide window fills its field instead of leaving a lane of empty sky between two rows of
 * small cards. Sets `--field-fit` and `data-field-fit` on the board; the CSS gives the rows that
 * scale. The hand keeps its own `--arena` (it reads it to space its cards). Off below xl.
 */
export function useFieldFit(ref: RefObject<HTMLElement | null>, enabled: boolean, cards: number) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const clear = () => {
      delete el.dataset.fieldFit;
      el.style.removeProperty("--field-fit");
    };
    if (!enabled) {
      clear();
      return;
    }
    const fit = () => {
      const rows = [...el.querySelectorAll<HTMLElement>(".arena-stage [data-field-row]")];
      if (rows.length < 2) return clear();
      const height = Math.min(...rows.map((row) => row.clientHeight));
      const width = Math.min(...rows.map((row) => row.clientWidth));
      if (height <= 0 || width <= 0) return;
      const scale = String(fieldFitScale(width, height, cards));
      if (el.style.getPropertyValue("--field-fit") !== scale) el.style.setProperty("--field-fit", scale);
      el.dataset.fieldFit = "";
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    for (const row of el.querySelectorAll(".arena-stage [data-field-row]")) ro.observe(row);
    return () => {
      ro.disconnect();
      clear();
    };
  }, [ref, enabled, cards]);
}
