/**
 * The engine interface and the one engine behind it.
 *
 * The rules engine (`./vm/`, `docs/arena-ruleset-spec.md`) is the only engine:
 * the hand-written legacy engine and the `engineFor` switch between the two
 * were deleted by #118 (owner, 13 Oct 2026). `Engine` stays as the interface
 * a second game's definition would meet — `RULES` satisfies it — and the
 * saved-game layer reads a state through `rulesState`, which refuses what the
 * rules engine did not write.
 *
 * Pure: no database, so `snapshot.ts` and the tests can use it.
 */
import { type AbilityAvailability, type Action, type EngineContext, type GameEvent, type GameOptions, type LegalAction, type PlayerId, type RejectedAction } from "./types";
import type { Beats } from "./beats";
import type { BoardView, CardArt } from "./view";
import { isVmState, type VmState } from "./vm/state";
import type { EngineId } from "./engine-ids";

export { isVmState };
export { DEFAULT_ENGINE, ENGINE_IDS, ENGINE_INFO, type EngineId, type EngineInfo } from "./engine-ids";

/** The state shape the engine writes. To the saved-game layer it is opaque JSON in `arena_games.state`. */
export type EngineState = VmState;

/** What the saved-game layer asks of an engine. */
export interface Engine {
  id: EngineId;
  createGame(ctx: EngineContext, options: GameOptions): { state: EngineState; events: GameEvent[] };
  apply(ctx: EngineContext, state: EngineState, action: Action): { state: EngineState; events: GameEvent[] };
  legalActions(ctx: EngineContext, state: EngineState): LegalAction[];
  rejectedActions(ctx: EngineContext, state: EngineState, legal: LegalAction[]): RejectedAction[];
  /** Current-window manual-skill offers and refusals, read without advancing the state. */
  abilityAvailability(ctx: EngineContext, state: EngineState, player: PlayerId, legal: LegalAction[], rejected: RejectedAction[]): AbilityAvailability[];
  /** One side's view of the board, with what that viewer may not see hidden (3-1-3). */
  boardView(ctx: EngineContext, state: EngineState, viewer: PlayerId, images: Record<string, CardArt>, availability?: AbilityAvailability[]): BoardView;
  /** One batch of events as the board plays them back, numbered from `after`. */
  toBeats(ctx: EngineContext, state: EngineState, events: GameEvent[], after?: number): Beats;
}

/**
 * A saved game the rules engine did not write — a row from the retired legacy
 * engine that the cleanup migration (`0050`) somehow missed. It fails closed
 * with this message instead of being read as something it is not.
 */
export class LegacyGameRetired extends Error {
  constructor() {
    super("this game was saved on the legacy engine, which has been retired; it can no longer be opened");
    this.name = "LegacyGameRetired";
  }
}

/** A stored state as the rules engine's `VmState`, or `LegacyGameRetired`. */
export function rulesState(value: unknown): VmState {
  if (!isVmState(value)) throw new LegacyGameRetired();
  return value;
}

/** One side's name. */
export function sideName(state: EngineState, p: PlayerId): string {
  return state.sides[p].name;
}

/**
 * How much damage this side has taken (21-3), for the game-over screen.
 *
 * A save from before the lifetime counter existed has no figure to show: its
 * absent counter is unavailable, never a fabricated zero or a partial total.
 */
export function damageTaken(state: EngineState, p: PlayerId): number | null {
  const count = state.damageTotals?.[p];
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null;
}
