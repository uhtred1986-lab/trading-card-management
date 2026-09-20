"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Beat, BeatArt } from "@/lib/arena/beats";
import { anchorPoint, cardPoint, type Point } from "./anchors";

type MarkersBeat = Extract<Beat, { t: "markers" }> & { from: string };

/**
 * [Empower]'s carry, drawn as it happens (issue #109): the markers leave the
 * outgoing Unison and land on the one replacing it, rather than simply
 * appearing on the new card's counter.
 *
 * `from`/`to` are measured by card id (`data-arena-card`, `anchors.tsx`) when
 * both cards are still on the board — the outgoing Unison usually still is,
 * since it is now the top of the Drop pile. When something has since buried
 * or removed it there is no element left to fly from, so the flight starts
 * at the Drop pile itself instead: a ghost of the same kind the rest of the
 * board already draws a card leaving from (`Ghosts.tsx`), just without a
 * live element under it.
 */
export function MarkerFlight({
  beat,
  hostRef,
  art,
  ownerOfTo,
  ms,
}: {
  beat: MarkersBeat;
  hostRef: React.RefObject<HTMLDivElement | null>;
  art: Record<string, BeatArt>;
  ownerOfTo: string;
  ms: number;
}) {
  const [line, setLine] = useState<{ from: Point; to: Point } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const to = cardPoint(host, beat.card);
    const from = cardPoint(host, beat.from) ?? anchorPoint(host, `${ownerOfTo}:drop`);
    setLine(from && to ? { from, to } : null);
  }, [beat.card, beat.from, hostRef, ownerOfTo]);

  if (!line) return null;
  const face = art[beat.from];

  return (
    <motion.div
      className="pointer-events-none absolute z-30 flex h-7 w-7 items-center justify-center rounded-full border border-ki-300/70 bg-space-900/90 text-[11px] font-bold text-ki-200 shadow-lg"
      initial={{ left: line.from.x, top: line.from.y, opacity: 0.9, scale: 0.85 }}
      animate={{ left: line.to.x, top: line.to.y, opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: Math.min(0.9, ms / 1000), ease: "easeOut" }}
      aria-hidden
      title={face ? `${beat.delta} marker${beat.delta === 1 ? "" : "s"} from ${face.name}` : undefined}
    >
      +{beat.delta}
    </motion.div>
  );
}
