"use client";

import type { Beat, NumberedBeat } from "@/lib/arena/beats";
import type { Feel } from "@/lib/arena/feel";
import type { Pace } from "@/lib/arena/pace";
import type { PlayerId } from "@/lib/arena/types";

/**
 * Every duration on the board, in one table.
 *
 * One place, because reduced motion is then a single multiplier rather than a
 * branch in each component — and a branch in each component is how one of them
 * quietly stops honouring it. Skip works the same way: it is not a second code
 * path, it is this table at zero.
 *
 * The effects (`FX`) are §7 of `docs/arena-ui-motion-spec.md` and each stays
 * under 700 ms. How long a *beat* is given before the next one starts is a
 * separate question, answered by three tiers so the fight keeps one rhythm
 * instead of some things flying past and others crawling (owner's report,
 * 17 Oct 2026: "some things go fast some slow, it's not clear what's happening").
 */

/**
 * The three dwell tiers, in milliseconds at the "normal" pace.
 *
 *  - `bookkeeping`: a card is drawn, charged, rested, a counter ticks. Short,
 *    but long enough to be seen; the same kind twice in a row is grouped.
 *  - `key`: something the player has to read — a card played from hand, an
 *    attack, a block, a skill, a rule coming into force. Long enough to see the
 *    card and read its name.
 *  - `decisive`: how something turned out — the clash verdict, damage, a KO, a
 *    negated attack, the end. Never rushed, never accelerated.
 */
export const TIER = { bookkeeping: 400, key: 1200, decisive: 1700 } as const;

/** Slow pace is a gentle stretch of the same rhythm, not a second one. */
export const SLOW_FACTOR = 1.3;

/** Repeated bookkeeping of one kind (five energy charges) runs at this share of its dwell. */
const GROUPED = 0.6;

/** The compact phase chip ("MAIN PHASE"): how long it stays up. It overlaps the beats after it. */
export const STEP_BANNER_MS = 1000;
/** A phase change is a marker, not a scene: its beat is short while the chip lingers a little longer. */
export const PHASE_BEAT_MS = 350;
/** A beat that has nothing of its own to show (a draw marker after the card flew, a battle step). */
export const NOTHING_TO_SHOW = 150;
/** The "YOUR TURN" banner. In step pace the walk waits for a tap instead. */
export const TURN_BANNER_MS = 1000;

const stretch = (ms: number, pace: Pace): number => (pace === "slow" ? Math.round(ms * SLOW_FACTOR) : ms);

/**
 * How long a beat is given before the next one starts, at the chosen pace.
 * `slow` stretches every beat by the same gentle factor; `step` waits for a tap
 * instead, so the number only sizes the flight of a ghost.
 *
 * `chain` is how many cards have been added to the open battle so far. Past
 * four, the *additions* start playing back faster — a long combo chain
 * accelerates itself rather than growing a skip button
 * (`docs/arena-battle-staging-spec.md` decision 7).
 *
 * What is decided is never hurried, though. The comparison, the damage, a KO
 * and a negated attack keep their full length however long the chain that led
 * to them was: the whole point of the chain is the moment it resolves, and
 * rushing that is rushing the only part the player is waiting for (owner's
 * decision, 7 Sep 2026).
 *
 * `next` is the beat that follows, so a run of the same bookkeeping (draw,
 * draw; charge, charge) is grouped into a quicker stream instead of N equal pauses.
 */
export function msFor(beat: Beat, pace: Pace = "normal", chain = 0, next: Beat | null = null): number {
  const hurried = chain > CHAIN_ACCEL_AFTER && !DECISIVE.has(beat.t);
  let base = baseMs(beat) * (hurried ? 0.7 : 1);
  const kind = bookkeepingKind(beat);
  if (next && kind !== null && kind === bookkeepingKind(next)) base *= GROUPED;
  return stretch(Math.round(base), pace);
}

/** The kind of bookkeeping a beat is, or null when it is not bookkeeping. */
export function bookkeepingKind(beat: Beat): string | null {
  switch (beat.t) {
    case "draw":
      return `draw:${beat.player}`;
    case "move":
      return beat.to === "energy" ? `energy:${beat.owner}` : beat.from === "deck" && beat.to === "hand" ? `draw:${beat.owner}` : null;
    case "mode":
      return `mode:${beat.mode}`;
    case "markers":
      return beat.from ? null : "markers";
    case "effectEnded":
      return "effectEnded";
    default:
      return null;
  }
}

/**
 * The "YOUR TURN" banner, stretched like every other beat in slow pace. In step
 * pace the walk waits for a tap instead, so this is only how long the bar's own
 * sweep takes.
 */
export function turnBannerMs(pace: Pace = "normal"): number {
  return stretch(TURN_BANNER_MS, pace);
}

/** The phase banner's dwell, the same number its phase beat is given. */
export function stepBannerMs(pace: Pace = "normal"): number {
  return stretch(STEP_BANNER_MS, pace === "step" ? "normal" : pace);
}

/**
 * The effects that make a play land (rd-07), at 1x, in milliseconds.
 *
 * The same table the CSS reads: `fxVars` publishes each row as a custom
 * property on the board, scaled by the pace, so a keyframe's length and a
 * beat's dwell cannot drift apart. Reduced motion never queues a beat, so none
 * of these play; the keyframes are also zeroed in `globals.css`.
 */
export const FX = {
  /** A card from the hand lands in the Battle Area: flip, scale-in, ring, flash. */
  reveal: 850,
  /** When the light ring leaves the revealed card. */
  revealRing: 330,
  revealFlash: 460,
  /** An explosion on a leader that takes damage. */
  boom: 680,
  boomRing: 720,
  boomShard: 760,
  shake: 420,
  /** The damage beat: the emptied life pip shatters and -1 LIFE rises. */
  lifeBreak: 750,
  lifeFloat: 950,
  /** A KO: burn white, crack, tilt, fall; then the ghost flies to the Drop. */
  ko: 780,
  koFly: 420,
  /** The staged fight. */
  cardIn: 460,
  vs: 520,
  vsDelay: 180,
  beam: 360,
  word: 640,
  shield: 620,
  /** Victory and defeat. */
  title: 640,
} as const;

/** The effects' multiplier: slow pace stretches them like every beat. Step plays at 1x. */
export function fxScale(pace: Pace = "normal"): number {
  return pace === "slow" ? SLOW_FACTOR : 1;
}

/** An individual visual effect/flight is capped below the 700 ms limit. */
export function fxDuration(ms: number, pace: Pace = "normal"): number {
  return Math.min(699, Math.round(ms * fxScale(pace === "step" ? "normal" : pace)));
}

/** A delayed KO flight shares one visual budget with its initial burst. */
export function flightTiming(ms: number, koDelay = 0): { duration: number; delay: number } {
  const delay = Math.min(450, Math.max(0, koDelay));
  return { duration: Math.min(699 - delay, Math.max(0, ms)) / 1000, delay: delay / 1000 };
}

/** `--fx-<name>` custom properties for the board root, from `FX` at this pace.
 * Feedback is deliberately brief even at slow pace; beat narration keeps its
 * separate dwell in `msFor`. */
export function fxVars(pace: Pace = "normal"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, ms] of Object.entries(FX)) out[`--fx-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = `${fxDuration(ms, pace)}ms`;
  return out;
}

/** Additions to one battle before they start playing themselves back faster. */
export const CHAIN_ACCEL_AFTER = 4;

/** The beats that say how something turned out. Never accelerated. */
const DECISIVE: ReadonlySet<Beat["t"]> = new Set<Beat["t"]>(["clash", "damage", "ko", "negated", "over"]);

function baseMs(beat: Beat): number {
  switch (beat.t) {
    case "draw":
      // The card back already flew in on the deck-to-hand move before it:
      // this marker has nothing of its own to show.
      return NOTHING_TO_SHOW;
    case "mode":
      // A card turns sideways: seen at a glance.
      return 250;
    case "effectEnded":
      return TIER.bookkeeping;
    case "move":
      // A card from the hand into the Battle Area is a reveal (rd-07): the card
      // is shown and its name read, so it is a key moment. A card added to a
      // combo, or a hand card going to the Drop (a counter, or the discard that
      // paid for one), is part of a fight and is read the same way. Everything
      // else - a charge, a card settling, the tail of a KO flight - is
      // bookkeeping.
      if (beat.from === "hand" && beat.to === "battle") return TIER.key;
      if (beat.to === "combo") return TIER.key;
      if (beat.from === "hand" && beat.to === "drop") return TIER.key;
      return TIER.bookkeeping;
    case "markers":
      // [Empower]'s carry names both cards (#109): the marker actually has to
      // cross the board to the new Unison, which takes longer than counting up.
      return beat.from ? TIER.bookkeeping + 180 : TIER.bookkeeping;
    case "flip":
    case "token":
    case "attack":
    case "block":
    case "skill":
    case "autoDeclared":
    case "say":
    case "effect":
      // The declaration, a blocker stepping in, a card's name and tag off the
      // spotlight, a rule coming into force: each is a sentence to read.
      return TIER.key;
    case "clash":
    case "damage":
    case "ko":
    case "negated":
    case "over":
      // How it turned out: named on screen and read, not glimpsed.
      return TIER.decisive;
    case "phase":
      // A phase worth a banner is held as long as the banner is up; a battle
      // step or a skipped phase is only a marker the fight passes through.
      return phaseBanner(beat) ? PHASE_BEAT_MS : NOTHING_TO_SHOW;
  }
}

/** The step-banner key ("phase:main") a phase beat announces, or null when it announces nothing. */
export function phaseBanner(beat: Extract<Beat, { t: "phase" }>): string | null {
  if (beat.skipped) return null;
  return beat.phase === "charge" || beat.phase === "main" || beat.phase === "mainEnd" || beat.phase === "end" ? `phase:${beat.phase}` : null;
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
 * A card from the hand into the Battle Area (rd-07): the card's own reveal,
 * so it is on screen for its whole beat rather than held back until the next
 * one, and no ghost is flown in for it.
 */
export function reveals(beat: Beat): boolean {
  return beat.t === "move" && beat.from === "hand" && beat.to === "battle";
}

/**
 * A card is arriving from somewhere it could not be seen — the deck, or the
 * opponent's hand — so there is no element to fly. Draw a ghost from that
 * pile to where it lands, and the real card appears as the ghost arrives.
 * Without this a card Claude plays simply pops into the Battle Area, and a
 * turn watched on a phone is a series of appearances rather than moves.
 */
export function arrivesFrom(beat: NumberedBeat, viewer: PlayerId): { card: string; from: string; to: string; owner: string } | null {
  if (beat.t !== "move" || !VISIBLE.has(beat.to)) return null;
  // A reveal is played by the card itself, turning over where it lands.
  if (reveals(beat)) return null;
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
