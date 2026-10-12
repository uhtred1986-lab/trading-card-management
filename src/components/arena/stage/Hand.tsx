"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { CardView } from "@/lib/arena/view";
import { ZoneAnchor } from "./anchors";
import { StageCard } from "./StageCard";

/** A hand card at phone scale (`--arena` multiplies it from `sm` up): the redesign's 84 × 117. */
export const HAND_W = 84;

/**
 * Your hand: a fan across the full width of the board, with no panel, handle
 * or label (`docs/arena-redesign/` frame 01, the prototype's `.hand`).
 *
 * The cards overlap just enough to fit the width — up to eight pixels apart
 * when there is room, closer as the hand grows — and tilt and dip a little
 * from the middle, so it reads as a hand held up rather than a filmstrip.
 * The tilt is a CSS transform on a child of the animated element (see
 * `StageCard`), so the fan cannot confuse the flight of a card leaving the
 * hand for the board.
 */
export function Hand({
  cards,
  cardProps,
  dragId = null,
  dragFor,
  chargeable,
  decisionHint,
}: {
  cards: CardView[];
  cardProps: (c: CardView) => React.ComponentProps<typeof StageCard>;
  /** The card being dragged out of the hand (rd-03): it fades where it sits. */
  dragId?: string | null;
  /** The pointer handlers that make one card draggable, or null when it is not. */
  dragFor?: (id: string) => React.HTMLAttributes<HTMLDivElement> | null;
  /** In the Charge phase: this card can be charged, so it wears the dashed outline (rd-04). */
  chargeable?: (id: string) => boolean;
  /** Current engine hand decision, placed beside its existing inspection control. */
  decisionHint?: string;
}) {
  // The fan is laid out from the width it has, so it is measured: the width of
  // the hand, and the width of one card at the board's current scale.
  const fan = useRef<HTMLDivElement | null>(null);
  const [room, setRoom] = useState<{ width: number; card: number } | null>(null);
  useLayoutEffect(() => {
    const el = fan.current;
    if (!el) return;
    const measure = () => {
      const scale = parseFloat(getComputedStyle(el).getPropertyValue("--arena")) || 1;
      // Less the side padding (px-2.5): the fan lays out inside it.
      setRoom({ width: el.clientWidth - 20, card: HAND_W * scale });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = cards.length;
  const first = cards[0];
  const firstProps = first ? cardProps(first) : null;
  const card = room?.card ?? HAND_W;
  const wide = (room?.width ?? 0) >= 640;
  // The prototype's spacing: never more than 8 px apart, and as close as it takes to fit.
  const step = n > 1 && room ? Math.min(card + 8, (room.width - card) / (n - 1)) : card + 8;
  const middle = (n - 1) / 2;
  const charging = cards.some((c) => chargeable?.(c.id));

  return (
    <section className="arena-field arena-hand relative" aria-label="Your hand">
      <ZoneAnchor zone="p1:hand" />
      {firstProps?.onInspect && (
        <div className="flex items-center justify-end gap-2 px-3 pt-2">
          {decisionHint && <span className="min-w-0 flex-1 text-xs font-semibold leading-snug text-space-100">{decisionHint}</span>}
          <button
            type="button"
            onClick={firstProps.onInspect}
            aria-label={`Inspect your hand, starting with ${first?.hidden ? "face-down card" : first?.name ?? "first card"}`}
            className="tap inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-space-600 bg-space-900/90 px-3 text-xs font-semibold text-space-100 hover:border-ki-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ki-400"
          >
            <span aria-hidden="true">⌕</span>
            <span>Inspect hand</span>
          </button>
        </div>
      )}
      <div
        ref={fan}
        className={`flex items-end justify-center px-2.5 pb-3 ${charging ? "pt-4" : "pt-3"}`}
        // One card's height and its dip, so an empty hand keeps the board's shape.
        style={{ minHeight: `calc(${Math.round((HAND_W * 88) / 63)}px * var(--arena, 1) + 28px)` }}
      >
        {cards.map((c, i) => {
          const off = i - middle;
          const handlers = dragFor?.(c.id) ?? null;
          const tilt = off * (wide ? 2.4 : 3.4);
          const dip = Math.abs(off) * (wide ? 4 : 3.2);
          const props = cardProps(c);
          const up = props.state === "selected";
          return (
            <div
              key={c.id}
              {...handlers}
              className={`relative shrink-0 transition-[opacity,filter] duration-150 ${chargeable?.(c.id) ? "arena-chargeable" : ""}`}
              style={{
                marginLeft: i === 0 ? 0 : step - card,
                zIndex: up ? 60 : i + 1,
                // The fan never scrolls, so a drag may take every touch.
                touchAction: handlers ? "none" : undefined,
                ...(dragId === c.id ? { opacity: 0.22, filter: "grayscale(0.7)" } : null),
              }}
            >
              <StageCard {...props} width={HAND_W} fan={up ? 0 : tilt} lift={dip} lifts holdLock={dragId === c.id} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
