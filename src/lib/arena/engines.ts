/**
 * The engines a game can be played on, and the one switch between them.
 *
 * `legacy` is the hand-written engine in `./engine/`, which plays the
 * original game's rule manual as TypeScript. `rules` is the
 * configuration-driven engine being built beside it (`docs/arena-ruleset-
 * spec.md`), which is not playable until its stages land — so it is listed,
 * described, and refused here rather than pretended.
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
import { apply, createGame, legalActions, rejectedActions, type Action, type EngineContext, type GameEvent, type GameOptions, type GameState, type LegalAction, type RejectedAction } from "./engine";

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
 * What the saved-game layer asks of an engine. `state` is opaque to that
 * layer: it is stored as JSON and handed back to the same engine. The legacy
 * engine's `GameState` is the shape today; the rules engine will have its own
 * behind the same four calls.
 */
export interface Engine {
  id: EngineId;
  createGame(ctx: EngineContext, options: GameOptions): { state: GameState; events: GameEvent[] };
  apply(ctx: EngineContext, state: GameState, action: Action): { state: GameState; events: GameEvent[] };
  legalActions(ctx: EngineContext, state: GameState): LegalAction[];
  rejectedActions(ctx: EngineContext, state: GameState, legal: LegalAction[]): RejectedAction[];
}

const LEGACY: Engine = { id: "legacy", createGame, apply, legalActions, rejectedActions };

export class EngineNotBuilt extends Error {
  constructor(id: EngineId) {
    super(`the ${ENGINE_INFO[id].label} cannot play a game yet`);
    this.name = "EngineNotBuilt";
  }
}

/** The one switch. Throws `EngineNotBuilt` for an engine that is listed but not playable. */
export function engineFor(id: EngineId): Engine {
  if (id === "legacy") return LEGACY;
  throw new EngineNotBuilt(id);
}
