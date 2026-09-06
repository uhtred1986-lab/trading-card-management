"use client";

import type { Beat, NumberedBeat } from "@/lib/arena/beats";
import type { Feel } from "@/lib/arena/feel";

/**
 * Every duration on the board, in one table.
 *
 * One place, because reduced motion is then a single multiplier rather than a
 * branch in each component — and a branch in each component is how one of them
 * quietly stops honouring it. Skip works the same way: it is not a second code
 * path, it is this table at zero.
 *
 * The numbers are §7 of `docs/arena-ui-motion-spec.md`, which is §4 of the
 * design proposal. Nothing exceeds 350 ms and nothing blocks the next tap.
 */

/** How long a beat is given before the next one starts. */
export function msFor(beat: Beat): number {
  switch (beat.t) {
    case "draw":
      return 220;
    case "move":
      // A charge turns the card over on the way; a play lands and settles.
      return beat.to === "energy" ? 260 : beat.to === "combo" ? 250 : 280;
    case "mode":
      return 200;
    case "flip":
      return 350;
    case "markers":
      return 180;
    case "token":
      return 280;
    case "attack":
      return 300;
    case "block":
      return 280;
    case "clash":
      return 300;
    case "damage":
      return 340;
    case "ko":
      return 300;
    case "negated":
      return 260;
    case "skill":
      // Long enough to read the card's name and tag off the spotlight.
      return 900;
    case "say":
      return 900;
    case "phase":
      return 700;
    case "over":
      return 600;
  }
}

/** What a beat should feel like, for the ones that have a physical moment. */
export function feelFor(beat: Beat): Feel | null {
  switch (beat.t) {
    case "move":
      return beat.to === "battle" || beat.to === "unison" ? "land" : null;
    case "token":
      return "land";
    case "clash":
      return "impact";
    case "ko":
      return "ko";
    default:
      return null;
  }
}

/** A card is on its way *in*: hold it back until its beat plays. */
export function arrives(beat: NumberedBeat): string | null {
  if (beat.t === "token") return beat.card;
  if (beat.t === "move" && VISIBLE.has(beat.to)) return beat.card;
  return null;
}

/** A card has *gone*: it is already absent from the board, so draw a ghost. */
export function departs(beat: NumberedBeat): { card: string; from: string; owner: string } | null {
  if (beat.t === "ko") return beat.owner ? { card: beat.card, from: "battle", owner: beat.owner } : null;
  if (beat.t === "move" && VISIBLE.has(beat.from) && !VISIBLE.has(beat.to)) return { card: beat.card, from: beat.from, owner: beat.owner };
  return null;
}

/**
 * The areas a card can actually be seen in. A card moving between two of them
 * flies; one arriving from anywhere else comes in from that zone's anchor, and
 * one leaving for anywhere else is a ghost on its way out.
 */
const VISIBLE = new Set(["battle", "combo", "energy", "unison", "leader", "hand"]);

/** The spring the board moves with: fast, and physical rather than floaty. */
export const SPRING = { type: "spring", stiffness: 520, damping: 40, mass: 0.7 } as const;
