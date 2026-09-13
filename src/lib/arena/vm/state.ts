/**
 * What a game on the rules engine *is*.
 *
 * The saved-game layer treats a state as opaque JSON: it is written to
 * `arena_games.state` and handed back to the same engine, which is the whole
 * reason a second engine can exist beside the first without the row shape
 * changing. Two fields are not opaque, and they are here for one reason —
 * **a row must never be replayed on the wrong interpreter**. `engine` says
 * which one wrote it and `game` which game's definition it was written
 * against, so a legacy state handed to the rules engine (or the reverse) is
 * refused loudly rather than misread field by field.
 *
 * What #139 added is the board, and it is the shape the whole stage rests on:
 * a side is **a map of declared zones** (`Zones`, built from the `ZONE`
 * declarations) and a card is **a bag of declared attributes** (`Attrs`, built
 * from the `ATTRIBUTE` declarations) plus the few things about the copy on the
 * table that no card text can say. There is no `hand` field, no `power` field
 * and no `PlayerState` with an area per name: an interpreter that plays a
 * `GameDefinition` cannot know those names, and the moment it does, a second
 * game needs code rather than files.
 *
 * What #140 added is the **flow**: `flow` is a stack of frames, one per phase
 * in progress, and a frame is a phase name plus the index of the next step —
 * a data program counter, as the legacy engine's `state.flow` is a data step
 * list. Suspension is the frame and nothing else: a game waiting on a prompt
 * is a game whose top frame points at the step that asked, which is what makes
 * it storable mid-decision and reproducible from seed plus actions.
 *
 * What #141 added is the **pend list**: an [Auto] whose moment has happened and
 * whose program has not run yet (9-6-2). It is state rather than a local because
 * a checkpoint can be reached with a question still to put, so the queue has to
 * survive being written to `arena_games.state` like everything else. The event
 * *log* is not here and is not going to be: events are returned from each call
 * and the row keeps the action log, which is the reproducible source — a second
 * copy in the state would be a second thing to keep true.
 *
 * Still missing, and on purpose: the effect layers (#142). A state that guessed
 * at them now would have them replaced twice.
 *
 * Pure and client-safe: types and one guard, no database, no `fs`.
 */
import type { VmPending } from "./triggers";
import type { Game } from "../../catalog/games";
import type { PlayerId, Prompt } from "../engine/types";
import type { AttrValue } from "./cards";
import type { VmCard, Zones } from "./zones";

/**
 * Bumped when the shape changes in a way a stored state cannot be read
 * through. Nothing reads it yet — there are no stored states to migrate —
 * but a state that cannot say which shape it is written in is a state that
 * cannot be migrated later either.
 *
 * 2: #139's board (`sides`, `cards`, `rngState`, `phase`, the first-player
 * fields). A version-1 state was a skeleton with no board at all.
 * 3: #140's flow (`flow`, `prompt`, `turn`, `turnPlayer`, `winner`,
 * `overReason`). A version-2 state was a board nothing played on.
 * 4: #141's pend list (`pending`). A version-3 state is a game in which no
 * moment could reach a card.
 */
export const VM_STATE_VERSION = 4;

/** One player, as the definition describes one: a name, a map of zones, and the attributes a *player* has (1-14). */
export interface VmSide {
  id: PlayerId;
  name: string;
  /** One list per zone the game declares as a place, in declaration order. */
  zones: Zones;
  /** The declared `of: player` attributes — `energyMarkers` in DBS. */
  attrs: Record<string, AttrValue>;
}

/**
 * One phase in progress: which phase, and which of its steps comes next.
 *
 * The stack of these *is* the runner's memory (`vm/flow.ts`). Nothing is held
 * in a closure and nothing is recomputed from the board, so a game that is
 * written to `arena_games.state` in the middle of a decision resumes exactly
 * where it stopped — the guarantee the legacy engine's `state.flow` gives and
 * the one thing a second engine may not quietly drop.
 */
export interface VmFrame {
  /** The phase whose steps this frame is running. */
  phase: string;
  /** The index in that phase's `steps:` of the step to run next. */
  index: number;
  /** How many times a bounded step has sent this phase round again (7-4-4, `LIMIT`). */
  repeats: number;
  /**
   * The players the step at `index` still has to ask, in the order they are
   * asked; `null` for a question addressed to nobody (the game is over).
   * Absent until the step has been arrived at, which is how the runner tells
   * "not started" from "started and answered by everyone".
   */
  asking?: (PlayerId | null)[];
}

export interface VmState {
  /** Which interpreter wrote this. The one field `legacyState` reads. */
  engine: "rules";
  /** The game definition this state was dealt from (`rulesets/<game>/`). */
  game: Game;
  /** The seed the game was created from, so a replay starts where it did. */
  seed: number;
  /** `VM_STATE_VERSION` as at the moment the game was created. */
  version: number;
  /** The seeded RNG's state, advanced by every shuffle and every flip (`engine/rng.ts`). */
  rngState: number;
  /** The declared phase the game is in — `"setup"` for a game that has only been dealt. */
  phase: string;
  /**
   * 6-2-1-4: the player a random method chose, who then chooses who goes
   * first. Kept because it is the one thing the coin flip decided, and the
   * choice it leads to has not been made yet.
   */
  chooser: PlayerId;
  /**
   * Who goes first (6-2-1-5) — a *choice*, so null until there is a prompt to
   * make it with (#140). Nothing in the deal depends on it: it decides who is
   * asked about a mulligan first, who places the starting energy marker
   * (6-2-1-11) and who takes the first turn, and none of those moves a shuffle
   * or a draw.
   */
  firstPlayer: PlayerId | null;
  sides: Record<PlayerId, VmSide>;
  /** Every card in the game by instance id (`p1#17`). The zones hold these ids. */
  cards: Record<string, VmCard>;
  /**
   * Which turn it is (7-1). 0 while the pre-game procedure runs, 1 on the
   * first player's first turn, and one more each time the turn passes.
   */
  turn: number;
  /** Whose turn it is (7-1). Meaningless until `turn` is 1; `p1` until then, as the legacy engine has it. */
  turnPlayer: PlayerId;
  /** The phases in progress, innermost last. Empty only between a game ending and its over phase being entered. */
  flow: VmFrame[];
  /**
   * The [Auto] skills whose moment has happened and whose program has not run
   * (9-6-2), in the order they were pended. The *resolution* order is 9-6-6's
   * and is `nextPending`'s, so this is a set with a tie-break rather than a
   * queue — which is why a skill is taken off it by master and not by position.
   */
  pending: VmPending[];
  /**
   * The question the game is waiting on — the legacy engine's own `Prompt`
   * shape, on purpose: a prompt is answered by an `Action`, and the `Engine`
   * interface takes one union of those. A second spelling of the same
   * question would make the two engines unanswerable by one client.
   */
  prompt: Prompt;
  /** Who won, once a `DEFINE WIN` has been met or someone conceded. Null for a draw as well as for a game still being played. */
  winner: PlayerId | null;
  /** Why it ended, in words, or null while it has not. */
  overReason: string | null;
}

/**
 * Is this the rules engine's state?
 *
 * Read off `engine`, never off a field the legacy `GameState` happens to
 * lack: the legacy state has no `engine` field at all, so this is a positive
 * answer about one shape rather than a guess about the other.
 */
export function isVmState(value: unknown): value is VmState {
  return typeof value === "object" && value !== null && (value as { engine?: unknown }).engine === "rules";
}
