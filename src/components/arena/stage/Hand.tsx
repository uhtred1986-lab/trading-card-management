"use client";

import { motion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import type { CardView } from "@/lib/arena/view";
import { ZoneAnchor } from "./anchors";
import { StageCard } from "./StageCard";

/**
 * Your hand, at two sizes.
 *
 * Closed it is the strip the classic board has: enough to see what you hold,
 * not enough to read it. Open, the cards are half again as big, fanned and
 * arced so they read as cards rather than as a filmstrip — which is the point,
 * because a card's text was previously unreachable without a long press.
 *
 * Drag the handle up or down, or tap it. The tilt is a CSS transform on a
 * child of the animated element (see `StageCard`), so the fan cannot confuse
 * the flight of a card leaving the hand for the board.
 */
export function Hand({
  cards,
  count,
  name,
  cardProps,
  controls,
  children,
  dragId = null,
  dragFor,
}: {
  cards: CardView[];
  count: number;
  name: string;
  cardProps: (c: CardView) => React.ComponentProps<typeof StageCard>;
  /** The inline controls row above the hand. */
  controls: React.ReactNode;
  /** The log, when it is open — above the cards, never instead of them. */
  children?: React.ReactNode;
  /** The card being dragged out of the hand (rd-03): it fades where it sits. */
  dragId?: string | null;
  /** The pointer handlers that make one card draggable, or null when it is not. */
  dragFor?: (id: string) => React.HTMLAttributes<HTMLDivElement> | null;
}) {
  const [open, setOpen] = useState(false);
  // A hand wider than the screen scrolls sideways, and a card that took every
  // touch (`touch-action: none`) would make the far cards unreachable. So a
  // scrolling hand lets a sideways swipe through and keeps the vertical one.
  const strip = useRef<HTMLDivElement | null>(null);
  const [scrolls, setScrolls] = useState(false);
  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return;
    const measure = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cards.length, open]);
  const width = open ? 92 : 62;
  const middle = (cards.length - 1) / 2;

  return (
    <section className="relative rounded-t-2xl border-t border-space-700 bg-space-900/95 p-2 pb-3 sm:rounded-2xl sm:border sm:border-space-700/70 sm:p-3" aria-label="Your hand">
      <ZoneAnchor zone="p1:hand" />

      {/* The handle: a drag target that is also a button, because both are
          reasonable things to try and neither should fail. */}
      <motion.div
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.25}
        dragMomentum={false}
        onDragEnd={(_, info) => {
          if (info.offset.y < -18) setOpen(true);
          else if (info.offset.y > 18) setOpen(false);
        }}
        className="mx-auto mb-1 flex w-full cursor-grab touch-none justify-center active:cursor-grabbing"
      >
        <button
          type="button"
          onClick={() => setOpen((x) => !x)}
          aria-expanded={open}
          aria-label={open ? "Make the hand smaller" : "Make the hand bigger"}
          className="tap flex w-full flex-col items-center gap-1 py-1"
        >
          <span className={`h-1 rounded-full transition-all duration-200 ${open ? "w-16 bg-ki-500/70" : "w-10 bg-space-600"}`} />
        </button>
      </motion.div>

      {/* The label keeps its own line when the inline controls need the width. */}
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] uppercase tracking-widest text-space-400 sm:mb-2 sm:text-xs">
        <span className="whitespace-nowrap">
          {name} · hand {count}
        </span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 normal-case tracking-normal">{controls}</div>
      </div>

      {children}

      <div ref={strip} className={`flex overflow-x-auto pb-1 transition-all duration-200 ${open ? "gap-2 pt-3 sm:gap-3" : "gap-1 sm:gap-2 lg:gap-3"} sm:[justify-content:safe_center]`}>
        {cards.map((c, i) => {
          const off = i - middle;
          const handlers = dragFor?.(c.id) ?? null;
          return (
            <div
              key={c.id}
              {...handlers}
              className="shrink-0 transition-[opacity,filter] duration-150"
              style={{ touchAction: handlers ? (scrolls ? "pan-x" : "none") : undefined, ...(dragId === c.id ? { opacity: 0.22, filter: "grayscale(0.7)" } : null) }}
            >
              <StageCard
                {...cardProps(c)}
                width={width}
                // A small tilt and a shallow arc: a hand, not a shear.
                fan={open ? off * 2.5 : 0}
                lift={open ? Math.abs(off) * 2.5 : 0}
                lifts
                holdLock={dragId === c.id}
              />
            </div>
          );
        })}
        {cards.length === 0 && <span className="py-4 text-xs text-space-500 sm:text-sm">no cards in hand</span>}
      </div>
    </section>
  );
}
