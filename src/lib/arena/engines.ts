/**
 * The engines a game can be played on, and the one switch between them.
 *
 * `legacy` is the hand-written engine in `./engine/`, which plays the
 * original game's rule manual as TypeScript. `rules` is the
 * configuration-driven engine being built beside it (`./vm/`,
 * `docs/arena-ruleset-spec.md`), which is not playable until its stages land.
 * It is listed, described and resolvable here — a call it cannot answer says
 * which issue builds it — but `ENGINE_INFO.rules.available` is false, so no
 * new game may be made on it.
 *
 * A game picks its engine when it is made (`arena_games.engine`) and keeps it:
 * `state` is the shape that engine writes, and `actions` replay only on it.
 * Everything that plays a saved game goes through `engineFor(row.engine)` and
 * never imports `./engine` for the purpose — that is what lets the old engine
 * keep working untouched while the new one is proven against it.
 *
 * Pure: no database (the default-engine setting is `engine-setting.ts`), so
 * `snapshot.ts` and the tests can use it.
 */
import { apply, createGame, legalActions, rejectedActions, type Action, type EngineContext, type GameEvent, type GameOptions, type GameState, type LegalAction, type PlayerId, type RejectedAction } from "./engine";
import { toBeats, type Beats } from "./beats";
import { boardView, type BoardView, type CardArt } from "./view";
import { RULES } from "./vm";
import { isVmState, type VmState } from "./vm/state";

export const ENGINE_IDS = ["legacy", "rules"] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export const DEFAULT_ENGINE: EngineId = "legacy";

export interface EngineInfo {
  id: EngineId;
  /** Two or three words, for the form and the badge. */
  label: string;
  /** One sentence under the label. */
  note: string;
  /** False while the engine cannot play a game yet; the form shows it greyed. */
  available: boolean;
}

export const ENGINE_INFO: Record<EngineId, EngineInfo> = {
  legacy: {
    id: "legacy",
    label: "Legacy engine",
    note: "The engine the arena has always played on. Rules are code; card text is read by the compiler and the rules workbench.",
    available: true,
  },
  rules: {
    id: "rules",
    label: "Rules engine (beta)",
    note: "The configuration-driven engine: the game and every card written in one rules language. Not playable until it is built — pick it once it says so here.",
    available: false,
  },
};

export function isEngineId(v: unknown): v is EngineId {
  return typeof v === "string" && (ENGINE_IDS as readonly string[]).includes(v);
}

/** An engine id from anywhere (a column, a form field), never undefined. */
export function engineOr(v: unknown, fallback: EngineId = DEFAULT_ENGINE): EngineId {
  return isEngineId(v) ? v : fallback;
}

/** The engines a new game may be created on right now. */
export const AVAILABLE_ENGINES: EngineId[] = ENGINE_IDS.filter((id) => ENGINE_INFO[id].available);

/**
 * The state shapes an engine may write.
 *
 * To the saved-game layer a state is opaque: it is stored as JSON in
 * `arena_games.state` and handed back to the engine that wrote it. Naming the
 * two shapes in one union is what lets the switch below be typed at all — and
 * what lets `legacyState` refuse a state the caller was about to read with
 * the wrong engine's eyes.
 */
export type EngineState = GameState | VmState;

/**
 * What the saved-game layer asks of an engine.
 *
 * Six calls, and the last two are the ones Stage 0 left out: `snapshot.ts`
 * needs a board drawn from a state it cannot read, and `games.ts` needs that
 * state's events turned into beats. Both were legacy imports until now, which
 * is the thing that gave a second engine nowhere to stand.
 *
 * Every parameter is `EngineState` rather than one engine's shape, because an
 * engine is chosen at runtime from a column; each implementation narrows to
 * its own. That narrowing is safe for the same reason the column exists: a
 * game keeps the engine it was made on.
 */
export interface Engine {
  id: EngineId;
  createGame(ctx: EngineContext, options: GameOptions): { state: EngineState; events: GameEvent[] };
  apply(ctx: EngineContext, state: EngineState, action: Action): { state: EngineState; events: GameEvent[] };
  legalActions(ctx: EngineContext, state: EngineState): LegalAction[];
  rejectedActions(ctx: EngineContext, state: EngineState, legal: LegalAction[]): RejectedAction[];
  /** One side's view of the board, with what that viewer may not see hidden (3-1-3). */
  boardView(ctx: EngineContext, state: EngineState, viewer: PlayerId, images: Record<string, CardArt>): BoardView;
  /** One batch of events as the board plays them back, numbered from `after`. */
  toBeats(ctx: EngineContext, state: EngineState, events: GameEvent[], after?: number): Beats;
}

/**
 * The legacy engine is an **adapter and nothing else**: every call is the
 * function the old engine already exported, reached through the interface
 * instead of by import. Nothing about how a legacy game plays changes here,
 * which is what makes `arena:diff` and the contract fixtures the proof that
 * this commit moved no behaviour.
 */
const LEGACY: Engine = { id: "legacy", createGame, apply, legalActions, rejectedActions, boardView, toBeats };

export class EngineNotBuilt extends Error {
  constructor(id: EngineId) {
    super(`the ${ENGINE_INFO[id].label} cannot play a game yet`);
    this.name = "EngineNotBuilt";
  }
}

/**
 * The one switch: the engine that wrote a state is the engine that reads it.
 *
 * Every id resolves — an engine that cannot play a game yet still answers for
 * the rows and the tests that name it, and refuses per call (`NotYet`) rather
 * than as a whole. Whether a *new* game may be made on it is a different
 * question, and `playableEngine` is where it is asked.
 */
export function engineFor(id: EngineId): Engine {
  return id === "rules" ? RULES : LEGACY;
}

/**
 * The engine a new game may be created on, or `EngineNotBuilt`.
 *
 * `engineFor` used to throw this, which conflated two things: resolving the
 * interpreter for a row that already exists, and letting someone start a game
 * on an engine that cannot finish one. The availability flag is the honest
 * test of the second, and it is the same one `engine-setting.ts` already
 * applies to the default-engine setting.
 */
export function playableEngine(id: EngineId): Engine {
  if (!ENGINE_INFO[id].available) throw new EngineNotBuilt(id);
  return engineFor(id);
}

/**
 * A state written by one engine, about to be read by another. Only reachable
 * through a hand-edited row or a bug in the switch — which is exactly why it
 * says both names.
 */
export class EngineMismatch extends Error {
  constructor(wrote: EngineId, reading: EngineId) {
    super(`this game was made on the ${ENGINE_INFO[wrote].label} and cannot be read by the ${ENGINE_INFO[reading].label}`);
    this.name = "EngineMismatch";
  }
}

/**
 * A state the app layer around the switch may read as the legacy `GameState`.
 *
 * `games.ts` reads `state.turn`, `snapshot.ts` reads `state.prompt`: the app
 * outside these six calls is still legacy-shaped, and will be until the rules
 * engine can answer them (#139–#142). Until then this is the seam, and it is
 * a *check* rather than a cast — a `rules` state reaching legacy-shaped code
 * throws by name instead of reading every field as `undefined`.
 */
export function legacyState(value: unknown): GameState {
  if (isVmState(value)) throw new EngineMismatch("rules", "legacy");
  return value as GameState;
}
