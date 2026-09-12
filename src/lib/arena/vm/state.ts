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
 * It carries nothing else yet, because nothing plays yet: #139 fills it with
 * the zones and the dealt board, #140 with the flow, #141 with the event log.
 * A skeleton that invented fields now would be inventing them twice.
 *
 * Pure and client-safe: types and one guard, no database, no `fs`.
 */
import type { Game } from "../../catalog/games";

/**
 * Bumped when the shape changes in a way a stored state cannot be read
 * through. Nothing reads it yet — there are no stored states to migrate —
 * but a state that cannot say which shape it is written in is a state that
 * cannot be migrated later either.
 */
export const VM_STATE_VERSION = 1;

export interface VmState {
  /** Which interpreter wrote this. The one field `legacyState` reads. */
  engine: "rules";
  /** The game definition this state was dealt from (`rulesets/<game>/`). */
  game: Game;
  /** The seed the game was created from, so a replay starts where it did. */
  seed: number;
  /** `VM_STATE_VERSION` as at the moment the game was created. */
  version: number;
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
