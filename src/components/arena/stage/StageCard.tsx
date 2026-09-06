"use client";

import { motion } from "motion/react";
import type { CardView } from "@/lib/arena/view";
import { ArenaCard, type CardState } from "../ArenaCard";
import { SPRING } from "./motion";

/**
 * A card that carries its position with it.
 *
 * `layoutId` is the engine's instance id, which is stable for the whole game
 * and the same id `view` and the beats use. So when a card changes *parent* —
 * hand to Battle Area to Drop — the library measures both places and flies it
 * between them. That is the whole reason this board earns a dependency: the
 * flight is the one thing that cannot be done with a keyframe, because the two
 * ends are different elements in different containers.
 *
 * The face is the classic board's `ArenaCard`, unchanged. Rest Mode, the
 * badges, the long press and the hover preview were all right already.
 */
export function StageCard({
  card,
  state = "plain",
  width = 56,
  upsideDown = false,
  suppressed = false,
  fan = 0,
  lift = 0,
  nudge = false,
  onTap,
  onInspect,
  onHover,
}: {
  card: CardView;
  state?: CardState;
  width?: number;
  upsideDown?: boolean;
  /** Its arrival has not been played yet: keep the space, hide the card. */
  suppressed?: boolean;
  /** Degrees of tilt in a fanned hand. Applied *inside* the layout element. */
  fan?: number;
  /** Pixels of arc, so a fan curves rather than shearing. */
  lift?: number;
  /** Idle, and this card can be tapped: say so quietly. */
  nudge?: boolean;
  onTap?: () => void;
  onInspect?: () => void;
  onHover?: (box: DOMRect | null) => void;
}) {
  return (
    <motion.div
      layoutId={card.id}
      layout
      transition={SPRING}
      // Hidden rather than unmounted: the layout animation needs both ends to
      // exist, and the row must not reflow when the card appears.
      style={{ visibility: suppressed ? "hidden" : "visible" }}
      className="shrink-0"
    >
      {/*
       * The tilt lives on a plain child, not on the animated element: a
       * rotation on the element being projected breaks the measurement a
       * layout animation depends on, and the card would fly to the wrong
       * place. A CSS transform inside it is invisible to that machinery.
       */}
      <div className={`transition-transform duration-200 ${nudge ? "arena-nudge" : ""}`} style={fan || lift ? { transform: `rotate(${fan}deg) translateY(${lift}px)` } : undefined}>
        <ArenaCard card={card} state={state} width={width} upsideDown={upsideDown} onTap={onTap} onInspect={onInspect} onHover={onHover} />
      </div>
    </motion.div>
  );
}
