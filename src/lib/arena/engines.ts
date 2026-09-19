/**
 * The engines a game can be played on, and the one switch between them.
 *
 * `legacy` is the hand-written engine in `./engine/`, which plays the
 * original game's rule manual as TypeScript. `rules` is the
 * configuration-driven engine being built beside it (`./vm/`,
 * `docs/arena-ruleset-spec.md`). It is listed, described and resolvable here
 * — a call it cannot answer says which issue builds it — and since #149
 * `ENGINE_INFO.rules.available` is true: the actions of Stage 5 (charging,
 * playing, activating) play the same on both engines, so a new **hot-seat**
 * game may be made on it. Sparring, Tournament and a 1 v 1 still refuse it at
 * `startGame`/`openMatch` — Claude's side and a 1 v 1's hidden-hand masking
 * both still read the legacy `GameState` shape directly and have not been
 * widened. A game that reaches what Stage 5 does not build (battle, most
 * keywords) ends rather than continuing (`vm/flow.ts`'s `stepProgram`).
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

export { isVmState };

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
    // Battle (Stage 6) and everything past it is still `NotYet`, and a game
    // that reaches one ends rather than continuing on the legacy engine
    // (`vm/flow.ts`'s `stepProgram`, #149) — the note says so up front rather
    // than a player learning it mid-game. Hot-seat only for the same reason
    // `startGame` refuses the others: Claude's side of Sparring and Tournament
    // and a 1 v 1's hidden-hand masking are both still legacy-only.
    note: "The configuration-driven engine: the game and every card written in one rules language. Hot-seat only for now, and a game that reaches something not yet built (battle, most keywords) ends there — no continuing on the legacy engine.",
    available: true,
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
 * Most of the app outside the six engine calls reads only the fields the two
 * state shapes already share by name — `turn`, `phase`, `winner`,
 * `overReason`, `prompt`, `cards` — and is engine-generic for that reason
 * (`games.ts`, `snapshot.ts`). What still is not is the half of `ai/run.ts`
 * that plays Claude's side: it reads a hand, a life pile and a deck off
 * `state.players[p]`, which the rules engine keeps as zones under
 * `state.sides[p]` instead (#149 leaves that unwidened — Sparring and
 * Tournament against Claude are legacy-only until it is). This is the seam
 * for exactly that code, and it is a *check* rather than a cast — a `rules`
 * state reaching it throws by name instead of reading every field as
 * `undefined`.
 */
export function legacyState(value: unknown): GameState {
  if (isVmState(value)) throw new EngineMismatch("rules", "legacy");
  return value as GameState;
}

/**
 * One side's name, off whichever shape wrote this state (`.players[p].name`
 * on the legacy engine, `.sides[p].name` on the rules engine) — the one field
 * the two keep under a different top-level key but the same name, and so the
 * one reading generic enough to be worth a function rather than a
 * `legacyState` narrowing at every call site that only ever wants this.
 * `games.ts`'s log narration and the board's game-over screen are both this
 * reading and nothing more.
 */
export function sideName(state: EngineState, p: PlayerId): string {
  return isVmState(state) ? state.sides[p].name : state.players[p].name;
}

/**
 * How much damage this side has taken (21-3), for the game-over screen.
 *
 * The legacy engine keeps a running count on the player (`damageTaken`,
 * incremented as life cards are taken); the rules engine's own `damage`
 * events carry the figure but nothing accumulates it onto a player attribute
 * — `vm/host.ts`'s `addDamageTaken` is a no-op, by its own comment, because
 * "a player attribute is the only place this engine keeps a number about a
 * player [and] nothing declares one". `0` is the honest placeholder rather
 * than a derived guess: summing the events would need the whole log, which a
 * board reading one saved `state` does not carry.
 */
export function damageTaken(state: EngineState, p: PlayerId): number {
  return isVmState(state) ? 0 : state.players[p].damageTaken;
}
