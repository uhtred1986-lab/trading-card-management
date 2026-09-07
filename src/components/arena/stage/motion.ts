"use client";

import type { Beat, NumberedBeat } from "@/lib/arena/beats";
import type { Feel } from "@/lib/arena/feel";
import type { Pace } from "@/lib/arena/pace";
import type { PlayerId } from "@/lib/arena/engine";

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

/**
 * How long a beat is given before the next one starts, at the chosen pace.
 * `slow` stretches every beat and gives even the quickest a floor long enough
 * for its sentence to be read; `step` waits for a tap instead, so the number
 * only sizes the flight of a ghost.
 *
 * `chain` is how many cards have been added to the open battle so far. Past
 * four, every beat drops to 55 % — a long combo chain accelerates itself
 * rather than growing a skip button, which would be an admission that the
 * default pace is wrong (`docs/arena-battle-staging-spec.md` decision 7).
 */
export function msFor(beat: Beat, pace: Pace = "normal", chain = 0): number {
  const base = Math.round(baseMs(beat) * (chain > CHAIN_ACCEL_AFTER ? 0.55 : 1));
  if (pace === "slow") return Math.max(Math.round(base * 2.4), 800);
  return base;
}

/** Additions to one battle before it starts playing itself back faster. */
export const CHAIN_ACCEL_AFTER = 4;

function baseMs(beat: Beat): number {
  switch (beat.t) {
    case "draw":
      return 220;
    case "move":
      // A charge turns the card over on the way; a play lands and settles. A
      // card going from hand to Drop is a counter or the discard that paid for
      // one, and either way it slides in from the side of a fight (§3.2).
      return beat.to === "energy" ? 260 : beat.to === "combo" ? 280 : beat.from === "hand" && beat.to === "drop" ? 320 : 280;
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
      return 340;
    case "damage":
      return 340;
    case "ko":
      return 300;
    case "negated":
      return 260;
    case "skill":
      // Long enough to read the card's name and tag off the spotlight. One
      // fired inside a battle is drawn on the card itself rather than under a
      // banner to be read, so it needs less (§3.2).
      return beat.inBattle ? 520 : 900;
    case "say":
      return 900;
    case "effect":
      // A rule coming into force: the number ticks and the sentence is read.
      return 650;
    case "effectEnded":
      return 450;
    case "phase":
      return 700;
    case "over":
      return 600;
  }
}

/**
 * Where a beat sits in an open battle: the declaration, a card added to a
 * chain, or the comparison that ends the additions.
 *
 * Walked from the beat stream, and used only for *timing* — how long a beat
 * is given, and when the chain starts accelerating. What is actually in a
 * battle comes from `view.battle` and never from here: a client that worked
 * out its own answer to that would be two answers that drift (contract §1).
 *
 * `open` is the caller's running flag: true from an `attack` beat until the
 * `clash`, which is the last moment a card can still be added.
 */
export function battleLink(beat: Beat, open: boolean): "declare" | "combo" | "counter" | "trigger" | "clash" | null {
  if (beat.t === "attack") return "declare";
  if (beat.t === "clash") return "clash";
  if (beat.t === "skill") return beat.inBattle ? "trigger" : null;
  if (beat.t === "move" && beat.to === "combo") return "combo";
  if (open && beat.t === "move" && beat.from === "hand" && beat.to === "drop") return "counter";
  return null;
}

/** Does this beat add a card to the fight? The three the accelerator counts. */
export function addsToChain(link: ReturnType<typeof battleLink>): boolean {
  return link === "combo" || link === "counter" || link === "trigger";
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

/**
 * A card is on its way *in*: hold it back until its beat plays.
 *
 * `drawn` is the cards a surface keeps on screen after they have left a
 * visible zone — the counters a battle staging holds in the guard's chain.
 * They arrive like any other card, and they never leave, so they are held
 * back here and skipped by `departs` rather than flown to the Drop twice.
 */
export function arrives(beat: NumberedBeat, drawn: ReadonlySet<string> = EMPTY): string | null {
  if (beat.t === "token") return beat.card;
  if (beat.t === "move" && (VISIBLE.has(beat.to) || drawn.has(beat.card))) return beat.card;
  return null;
}

const EMPTY: ReadonlySet<string> = new Set<string>();

/**
 * A card is arriving from somewhere it could not be seen — the deck, or the
 * opponent's hand — so there is no element to fly. Draw a ghost from that
 * pile to where it lands, and the real card appears as the ghost arrives.
 * Without this a card Claude plays simply pops into the Battle Area, and a
 * turn watched on a phone is a series of appearances rather than moves.
 */
export function arrivesFrom(beat: NumberedBeat, viewer: PlayerId): { card: string; from: string; to: string; owner: string } | null {
  if (beat.t !== "move" || !VISIBLE.has(beat.to)) return null;
  const hiddenHand = beat.from === "hand" && beat.owner !== viewer;
  if (!hiddenHand && VISIBLE.has(beat.from)) return null;
  return { card: beat.card, from: beat.from, to: beat.to, owner: beat.owner };
}

/** A card has *gone*: it is already absent from the board, so draw a ghost. */
export function departs(beat: NumberedBeat, drawn: ReadonlySet<string> = EMPTY): { card: string; from: string; owner: string } | null {
  if (beat.t === "ko") return beat.owner ? { card: beat.card, from: "battle", owner: beat.owner } : null;
  if (beat.t === "move" && VISIBLE.has(beat.from) && !VISIBLE.has(beat.to) && !drawn.has(beat.card)) return { card: beat.card, from: beat.from, owner: beat.owner };
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
