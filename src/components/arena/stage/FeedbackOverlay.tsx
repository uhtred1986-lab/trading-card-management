"use client";

import Image from "next/image";
import { useLayoutEffect, useState, type RefObject } from "react";
import type { Beats } from "@/lib/arena/beats";
import { cardImage } from "@/lib/catalog/card-image";
import { anchorPoint, cardPoint, type Point } from "./anchors";
import type { FeedbackCues } from "./useFeedbackCues";

/** A KO can remove its card before the cue is painted. Show the public beat's
 * captured art at that side's Battle Area until the short cue expires. */
export function FeedbackOverlay({ cues, art, hostRef }: {
  cues: FeedbackCues;
  art: Beats["art"];
  hostRef: RefObject<HTMLElement | null>;
}) {
  const kos = Object.entries(cues.cards).filter(([, cue]) => cue.kind === "ko");
  const signature = kos.map(([id, cue]) => `${id}:${cue.beat}`).join("|");
  const [positions, setPositions] = useState<Record<string, Point>>({});

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const next: Record<string, Point> = {};
    for (const [id, cue] of kos) {
      // When the live card still exists, StageCard owns the cue. A removed
      // card can only be represented by the public snapshot and a zone anchor.
      if (host.querySelector(`[data-arena-card="${CSS.escape(id)}"]`)) continue;
      const side = cue.player;
      const point = cardPoint(host, id) ?? (side ? anchorPoint(host, `${side}:battle`) : null);
      if (point) next[id] = point;
    }
    setPositions(next);
    // The beat signature marks a new cue. Board layout has settled by this
    // effect, and no continuous observer or game decision is involved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, hostRef]);

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden data-feedback-overlay>
      {kos.map(([id, cue]) => {
        const point = positions[id];
        const card = art[id];
        if (!point || !card) return null;
        const src = cardImage(card.imageUrl, "thumb");
        return (
          <div key={`${id}:${cue.beat}`} className="arena-feedback-ko absolute w-10 rounded border border-loss bg-space-950 p-0.5 text-center shadow-lg" style={{ left: point.x, top: point.y }} data-feedback-subject={id}>
            <div className="relative aspect-[5/7] overflow-hidden rounded-sm bg-space-800">
              {src ? <Image src={src} alt="" fill sizes="40px" className="object-cover" unoptimized /> : <span className="grid h-full place-items-center px-0.5 text-[7px] leading-tight text-space-50">{card.name}</span>}
            </div>
            <span className="block truncate text-[8px] font-black uppercase text-loss">KO</span>
          </div>
        );
      })}
    </div>
  );
}
