/**
 * Engine events → what a client animates.
 *
 * `GameEvent` says in its own comment that the UI animates from it, but the
 * events only exist for the length of one `apply()`. This turns a batch of
 * them into *beats*: the same story, told in the few shapes a board can draw,
 * with every card named by the instance id both clients key their cards on.
 *
 * This file holds the shapes (`Beat`, `Beats`); the translation is
 * `vm/beats.ts`'s `vmToBeats`, behind the engine's `toBeats`. Several events
 * have no picture and deliberately collapse to nothing, and `powerCompare`
 * becomes one `clash`.
 *
 * Pure: no database, no images. `art` carries the name captured *at event
 * time* — a KO'd card is gone from any later view, so a client cannot look it
 * up — and `session.ts` fills in the image URLs, which is what keeps this
 * testable in `npm test`.
 */
import type { PlayerId } from "./types";
import type { Area, EffectUntil } from "./types";
import type { EffectKind } from "./effects";

// The queue helpers live in `beats-core.ts`; every existing caller keeps importing them from here.
export { BEAT_CAP, EMPTY_BEATS, SKILL_LABELS, appendBeats, maskBeats, relateBeats, revealedMove } from "./beats-core";

export type Beat =
  /** A named step of the game: a phase, or a step within a battle. */
  | { t: "phase"; phase: string; player: PlayerId; turn: number; skipped?: true }
  | { t: "draw"; player: PlayerId; card: string | null }
  /**
   * `reveal` is the engine's word that the card was shown to both players as
   * it moved (#463) — a life card revealed into a hand (BT10-031/SD18-01), an
   * Extra or a play going face up. The narration names a card that went into
   * a hidden area only on this flag, never because its face happens to be in
   * `art` (which is masked against the board as it stands *now*).
   * `onto` (the skill explainer, 13 Nov 2026): the card this one was played on
   * top of ([Evolve], [Union-Potara], a Z-Leader), which is now under it (23-2).
   */
  | { t: "move"; card: string; from: Area; to: Area; owner: PlayerId; reveal?: true; onto?: string }
  | { t: "mode"; card: string; mode: "active" | "rest" }
  | { t: "flip"; card: string }
  /** `from` is the Unison these markers were carried over from ([Empower], 22-45-3) — the count on a Unison is public, so this rides through `maskBeats` unchanged. */
  | { t: "markers"; card: string; delta: number; total: number; from?: string }
  /** A token appears in a Battle Area from outside the game. */
  | { t: "token"; card: string; owner: PlayerId }
  | { t: "attack"; attacker: string; target: string }
  | { t: "block"; guard: string; by: string }
  | { t: "clash"; attacker: string; guard: string; attackPower: number; guardPower: number; hit: boolean }
  /**
   * `cards` are the life cards taken, so they can be flown to hand or Drop.
   * `by` is the attacker whose hit dealt it, when a won clash in the same batch
   * did (#463) — so the battle's result is one sentence ("Son Goku hits —
   * Claude takes 1 damage") rather than a clash line and a damage line.
   */
  | { t: "damage"; player: PlayerId; amount: number; critical: boolean; cards: string[]; by?: string }
  /** `owner` because a KO'd card is gone: a client must know which side to draw it leaving from. */
  | { t: "ko"; card: string; owner: PlayerId | null }
  | { t: "negated" }
  /**
   * `owner` is whose skill resolved, so a narration can say whose ability it
   * was. `inBattle` is the engine's word that this skill fired as part of the
   * open battle, so a battle staging can spotlight it on the card that fired
   * rather than sliding a banner over the fight (staging spec §3.2).
   * `extra` (#463): the card is an Extra used from the hand — its own `move`
   * to the Drop came first in the same batch — so it is narrated as used, not
   * discarded. `noEffect`: nothing followed it, outside a battle, before the
   * game came back to a Main Phase prompt — the skill found nothing to act on.
   * `maskBeats` blanks `label` and `text` when the viewer may not see `card`.
   * `steps` (the skill explainer, 13 Nov 2026): how many of the beats right after this one, in the same batch, are
   * what the skill did — a card moving, a draw, a look, a power change — so a client can tell them as its steps.
   * Absent when none are.
   */
  | { t: "skill"; card: string; label: string; text: string; unread: boolean; owner: PlayerId; inBattle: boolean; extra?: true; noEffect?: true; reveal?: true; revealEpoch?: number; steps?: number }
  /** Specified secret [Auto] before its optional price is paid; this is not an activated skill. */
  | { t: "autoDeclared"; card: string; label: string; text: string; owner: PlayerId; revealEpoch?: number }
  /**
   * A rule coming into force (9-9): "+5000 power", "[Critical]", "can't
   * attack" on `card`, or on `player` when it is about a player rather than a
   * card. `owner` is whose skill made it; `source` the card that did.
   */
  | { t: "effect"; card: string | null; player: PlayerId | null; kind: EffectKind; label: string; until: EffectUntil; source: string | null; owner: PlayerId }
  /**
   * `player` looks at `count` cards in `owner`'s `area` (20-11, 20-12): the top or bottom of a deck (`from`), a hand,
   * the life, or a whole deck searched (`search`). Looking is not revealing, so it names no card — only that it
   * happened, which the other player is entitled to see.
   */
  | { t: "look"; player: PlayerId; owner: PlayerId; area: Area; count: number; from?: "top" | "bottom"; search?: true }
  /**
   * `card` (`owner`'s) is placed under `host` by a skill (23-2; BT3-031's Majin Buu), from `from`. It has left its
   * area for the pile under `host`, which is what the board's "N under" count shows. A card from an area the viewer
   * could not see is told as "a card": it has no face in `art`, and its id goes with `historicalMask`.
   */
  | { t: "under"; card: string; host: string; owner: PlayerId; from?: Area }
  /** `player`'s `area` (a deck or the life) is shuffled (5-11-2). */
  | { t: "shuffle"; player: PlayerId; area: Area }
  /**
   * A skill that stopped for a decision goes on with the answer, in a batch of its own: `steps` beats after this one
   * are more of what `card`'s skill (`label`, `owner`'s) does. It has no picture: the skill explainer tells what
   * follows as that skill's further steps. `maskBeats` blanks `label` as it blanks a `skill` beat's.
   */
  | { t: "resume"; card: string; label: string; owner: PlayerId; steps?: number }
  /** The same rule reaching the end of its duration, so the number changing back has a moment of its own. */
  | { t: "effectEnded"; card: string | null; player: PlayerId | null; kind: EffectKind; label: string; source: string | null }
  /** Claude's table talk, added by `run.ts` rather than by the engine. */
  | { t: "say"; text: string }
  | { t: "over"; winner: PlayerId | null; reason: string; kind?: "win" | "draw" | "concession" | "abandoned" | "interrupted" };

/**
 * Beats are numbered rather than counted, so a client can replay exactly what
 * it has not seen (`n > lastPlayed`) even after the queue has been capped.
 */
export type NumberedBeat = Beat & { n: number };

/** A card a beat names, as it was when the beat happened. */
export interface BeatArt {
  cardId: string;
  name: string;
  /** Filled in by `session.ts`; null everywhere the catalog is not reachable. */
  imageUrl: string | null;
}

export interface Beats {
  /** The highest `n` in `list`. Monotonic for the life of the queue. */
  seq: number;
  list: NumberedBeat[];
  /** Keyed by instance id, for cards that have left the board by now. */
  art: Record<string, BeatArt>;
}
