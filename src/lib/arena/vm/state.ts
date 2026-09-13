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
 * Still missing, and on purpose: the flow (#140), the event log (#141), the
 * effect layers and prompts (#142). A state that guessed at them now would
 * have them replaced twice.
 *
 * Pure and client-safe: types and one guard, no database, no `fs`.
 */
import type { Game } from "../../catalog/games";
import type { PlayerId } from "../engine/types";
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
 */
export const VM_STATE_VERSION = 2;

/** One player, as the definition describes one: a name, a map of zones, and the attributes a *player* has (1-14). */
export interface VmSide {
  id: PlayerId;
  name: string;
  /** One list per zone the game declares as a place, in declaration order. */
  zones: Zones;
  /** The declared `of: player` attributes — `energyMarkers` in DBS. */
  attrs: Record<string, AttrValue>;
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
