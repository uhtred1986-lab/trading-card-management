"use client";

import { AnimatePresence, motion } from "motion/react";
import type { BeatArt } from "@/lib/arena/beats";
import type { Ghost } from "./useBeatPlayer";

/**
 * Cards that have already left.
 *
 * A card KO'd during Claude's turn is gone from the board the server sends, so
 * there is no element to animate it and nothing to look it up with — which is
 * exactly why a beat carries its own face. It is drawn from that face instead,
 * shuddering out of the zone it left and sliding, desaturated, to the Drop.
 *
 * Both ends were measured when the beat played (`useBeatPlayer`), so this
 * component is pure rendering and never touches the DOM.
 */
export function Ghosts({ ghosts, art }: { ghosts: Ghost[]; art: Record<string, BeatArt> }) {
  return (
    <AnimatePresence>
      {ghosts.map((g) => {
        const face = art[g.card];
        if (!face) return null;
        return (
          <motion.div
            key={g.key}
            className="pointer-events-none absolute z-30"
            // A card leaving shudders out and fades to the Drop; one arriving
            // flies in from its pile, whole, and hands over to the real card.
            initial={g.kind === "arrive" ? { left: g.from.x, top: g.from.y, opacity: 0.85, scale: 0.9 } : { left: g.from.x, top: g.from.y, opacity: 1, scale: 1, filter: "saturate(1)" }}
            animate={g.kind === "arrive" ? { left: g.to.x, top: g.to.y, opacity: 1, scale: 1 } : { left: g.to.x, top: g.to.y, opacity: 0, scale: 0.7, filter: "saturate(0.15)" }}
            exit={{ opacity: 0 }}
            transition={{ duration: Math.min(0.9, g.ms / 1000), ease: g.kind === "arrive" ? "easeOut" : "easeIn" }}
          >
            <div className={`arena-card card-aspect w-[calc(52px*var(--arena,1))] overflow-hidden rounded-[4px] border bg-space-800 ${g.kind === "arrive" ? "arena-ring-legal border-ki-400/70" : "arena-ghost border-loss/60"}`}>
              {face.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a transient overlay of art the board has already loaded.
                <img src={face.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="block px-[3px] pt-1 text-[7px] font-semibold leading-tight text-space-100">{face.name}</span>
              )}
            </div>
          </motion.div>
        );
      })}
    </AnimatePresence>
  );
}
