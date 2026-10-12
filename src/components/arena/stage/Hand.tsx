"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { CardView } from "@/lib/arena/view";
import { ZoneAnchor } from "./anchors";
import { StageCard } from "./StageCard";
import styles from "./phone-board.module.css";

/** A hand card at phone scale (`--arena` multiplies it from `sm` up): the redesign's 84 × 117. */
export const HAND_W = 84;

/** A horizontal hand: crowded cards keep a 44px exposed target and can scroll. */
export function Hand({
  cards,
  cardProps,
  dragId = null,
  dragFor,
  chargeable,
  decisionHint,
  onZones,
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
  onZones?: () => void;
}) {
  // Measure the hand and card at the current board scale for overlap spacing.
  const fan = useRef<HTMLDivElement | null>(null);
  const [room, setRoom] = useState<{ width: number; card: number; desktop: boolean } | null>(null);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    const el = fan.current;
    if (!el) return;
    const measure = () => {
      const scale = parseFloat(getComputedStyle(el).getPropertyValue("--arena")) || 1;
      // Less the side padding (px-2.5): the fan lays out inside it.
      setRoom({ width: el.clientWidth - 20, card: HAND_W * scale, desktop: window.matchMedia("(min-width: 1024px)").matches });
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
  const wide = room?.desktop ?? false;
  // Every exposed card has a full finger target; excess cards scroll instead
  // of becoming ever narrower slivers. Expand separates all the artwork.
  // Leave room for the card's rounded corners around a 44px touch square.
  const step = expanded ? card + 8 : n > 1 && room ? Math.max(wide ? 44 : 52, Math.min(card + 8, (room.width - card) / (n - 1))) : card + 8;
  const middle = (n - 1) / 2;
  const charging = cards.some((c) => chargeable?.(c.id));

  return (
    <section className="arena-field arena-hand relative" aria-label="Your hand" data-hand-expanded={expanded}>
      <ZoneAnchor zone="p1:hand" />
      {(firstProps?.onInspect || onZones) && (
        <div data-hand-toolbar className="flex flex-wrap items-center justify-end gap-2 px-3">
          <span className="mr-auto text-xs font-semibold text-space-100">Hand · {n}<span className="ml-2 hidden font-normal sm:inline">Swipe to browse</span></span>
          {decisionHint && <span className="min-w-0 flex-1 text-xs font-semibold leading-snug text-space-100">{decisionHint}</span>}
          {firstProps?.onInspect && <button
            type="button"
            onClick={firstProps.onInspect}
            aria-label={`Inspect your hand, starting with ${first?.hidden ? "face-down card" : first?.name ?? "first card"}`}
            className="tap inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-space-600 bg-space-900/90 px-3 text-xs font-semibold text-space-100 hover:border-ki-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ki-400"
          >
            <span aria-hidden="true">⌕</span>
            <span>Inspect hand</span>
          </button>}
          {n > 0 && <button type="button" className={`${styles.handControl} tap rounded-lg border border-space-600 px-2 text-xs font-semibold text-space-100`} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Compact" : "Expand"}</button>}
          {onZones && <button type="button" className={`${styles.handControl} tap rounded-lg border border-space-600 px-2 text-xs font-semibold text-space-100`} onClick={onZones} aria-label="Inspect public zones">Zones</button>}
        </div>
      )}
      <div ref={fan} className={styles.handViewport} tabIndex={0} aria-label="Scrollable hand cards">
      <div
        className={`${styles.handCards} flex items-end justify-center px-2.5 pb-3 ${charging ? "pt-4" : "pt-3"}`}
        // One card's height and its dip, so an empty hand keeps the board's shape.
        style={{ minHeight: n ? `calc(${Math.round((HAND_W * 88) / 63)}px * var(--arena, 1) + 28px)` : 0 }}
      >
        {cards.map((c, i) => {
          const off = i - middle;
          const handlers = dragFor?.(c.id) ?? null;
          const tilt = wide && n <= 8 && !expanded ? off * 2.4 : 0;
          const dip = wide && n <= 8 && !expanded ? Math.abs(off) * 4 : 0;
          const props = cardProps(c);
          const up = props.state === "selected";
          return (
            <div
              key={c.id}
              {...handlers}
              className={`${styles.handCard} relative shrink-0 transition-[opacity,filter] duration-150 ${chargeable?.(c.id) ? "arena-chargeable" : ""}`}
              style={{
                marginLeft: i === 0 ? 0 : step - card,
                zIndex: up ? 60 : i + 1,
                // Keep horizontal swipes for browsing while retaining vertical drags.
                touchAction: handlers ? (wide ? "none" : "pan-x") : undefined,
                ...(dragId === c.id ? { opacity: 0.22, filter: "grayscale(0.7)" } : null),
              }}
            >
              <StageCard {...props} width={HAND_W} fan={up ? 0 : tilt} lift={dip} lifts holdLock={dragId === c.id} />
            </div>
          );
        })}
      </div>
      </div>
    </section>
  );
}
