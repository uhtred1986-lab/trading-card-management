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
 * four, the *additions* start playing back faster — a long combo chain
 * accelerates itself rather than growing a skip button, which would be an
 * admission that the default pace is wrong
 * (`docs/arena-battle-staging-spec.md` decision 7).
 *
 * What is decided is never hurried, though. The comparison, the damage, a KO
 * and a negated attack keep their full length however long the chain that led
 * to them was: the whole point of the chain is the moment it resolves, and
 * rushing that is rushing the only part the player is waiting for (owner's
 * decision, 7 Sep 2026).
 */
export function msFor(beat: Beat, pace: Pace = "normal", chain = 0): number {
  const hurried = chain > CHAIN_ACCEL_AFTER && !DECISIVE.has(beat.t);
  const base = Math.round(baseMs(beat) * (hurried ? 0.7 : 1));
  if (pace === "slow") return Math.max(Math.round(base * 2.4), 800);
  return base;
}

/** Additions to one battle before they start playing themselves back faster. */
export const CHAIN_ACCEL_AFTER = 4;

/** The beats that say how something turned out. Never accelerated. */
const DECISIVE: ReadonlySet<Beat["t"]> = new Set<Beat["t"]>(["clash", "damage", "ko", "negated", "over"]);

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
      // The declaration: two cards leave their rows and square up. It is the
      // opening of the fight and was over before it registered.
      return 460;
    case "block":
      // A blocker stepping in front changes who the fight is with, which is a
      // moment of its own and not a piece of bookkeeping.
      return 460;
    case "clash":
      // The verdict: the winner is named on screen and has to be read, not
      // glimpsed. This is the longest beat on the board on purpose.
      return 1100;
    case "damage":
      return 560;
    case "ko":
      return 560;
    case "negated":
      // An attack that never happened is still an outcome, and the sentence
      // explaining why the battle ended here is a long one.
      return 700;
    case "skill":
      // Long enough to read the card's name and tag off the spotlight. A skill
      // fired inside a battle is drawn on the card rather than under a banner,
      // but it is the same sentence to read and the spec's shorter 520 ms read
      // as rushed in play — so it gets the same time wherever it is drawn.
      return 900;
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

/**
 * The spring the board moves with: physical rather than floaty, and no longer
 * quite so fast.
 *
 * At 520 a card crossed the board in about a fifth of a second — technically a
 * flight, but over before the eye had followed it, so cards read as *appearing*
 * in their new place rather than travelling there. Softened so the journey is
 * visible (owner's decision, 7 Sep 2026); still well inside every beat's dwell,
 * so nothing overlaps the beat that follows it.
 */
export const SPRING = { type: "spring", stiffness: 380, damping: 36, mass: 0.8 } as const;
