/**
 * The rules engine, as far as it is built.
 *
 * `legacy` (`../engine/`) plays the manual as TypeScript; this one plays a
 * `GameDefinition` — the `.rules` files in `../rulesets/` — and is being built
 * behind the same `Engine` interface so the two can be compared move for move
 * (`arena:diff`). Today it can do exactly one thing: make a game. That is not
 * a placeholder for the sake of one — it is what settles the two questions
 * every later issue needs answered, namely *what an engine is to the app*
 * (the interface in `../engines.ts`) and *what a rules game's state is*
 * (`VmState`).
 *
 * Every other call throws `NotYet`, naming both the call and the issue that
 * builds it, because a silent no-op would look like a game that simply had
 * nothing to do. `ENGINE_INFO.rules.available` stays false, so the `/arena`
 * form still greys the engine out and no row can be created on it.
 *
 * Pure and client-safe, like the legacy engine: no database, no network. The
 * definition arrives as a generated constant (`rulesets/dbs/files.ts`), so
 * nothing here reads a file at request time either.
 */
import type { EngineContext, GameEvent, GameOptions, LegalAction, RejectedAction } from "../engine";
import type { Beats } from "../beats";
import type { BoardView } from "../view";
import { rulesetFor } from "../rulesets";
import { VM_STATE_VERSION, type VmState } from "./state";
import type { Game } from "../../catalog/games";

export { VM_STATE_VERSION, isVmState, type VmState } from "./state";

/**
 * The arena plays the original game only — the engine reads the Masters rule
 * manual and `deckInputFor` returns null for a Fusion World deck (owner's
 * decision, 4 Sep 2026). A second game is a second directory under
 * `rulesets/` and a second value here, not a second engine.
 */
const ARENA_GAME: Game = "dbs";

/**
 * A call the rules engine cannot answer yet.
 *
 * The message names the call *and* the issue that builds it, so a stack trace
 * from a script or a fuzz run says what to go and read rather than only that
 * something was missing.
 */
export class NotYet extends Error {
  readonly step: string;
  readonly issue: string;
  constructor(step: string, issue: string) {
    super(`the rules engine cannot ${step} yet — ${issue} builds it`);
    this.name = "NotYet";
    this.step = step;
    this.issue = issue;
  }
}

/** The game's definition would not load, which is a bug in the `.rules` files rather than in the game being started. */
export class RulesetBroken extends Error {
  constructor(game: Game, detail: string) {
    super(`the ${game} ruleset does not load, so no game can be played on the rules engine: ${detail}`);
    this.name = "RulesetBroken";
  }
}

/**
 * Make a game.
 *
 * The definition is loaded and its id carried onto the state, so the row can
 * never be replayed against another game's rules. Dealing the board — decks,
 * hands, life, the mulligan — is #139; until then a new game is the four
 * fields `VmState` documents and an empty event log.
 */
function createGame(_ctx: EngineContext, options: GameOptions): { state: VmState; events: GameEvent[] } {
  const loaded = rulesetFor(ARENA_GAME);
  if (!loaded.ok) {
    const first = loaded.errors[0];
    throw new RulesetBroken(ARENA_GAME, first ? `${first.file}:${first.line}:${first.col} ${first.message}` : "no reason given");
  }
  return { state: { engine: "rules", game: loaded.definition.id, seed: options.seed, version: VM_STATE_VERSION }, events: [] };
}

/**
 * The engine itself.
 *
 * Declared here without the `Engine` annotation and given it in
 * `../engines.ts`, which is what keeps the dependency one-way: the switch
 * knows about the engine, the engine does not know about the switch.
 */
export const RULES = {
  id: "rules" as const,
  createGame,
  /**
   * Each of these takes no argument on purpose: it reads nothing, because
   * there is nothing yet to read it with. A narrower function is still
   * assignable to the `Engine` member it stands in for, so the interface says
   * what each one *will* be handed and this file says only that it cannot use
   * it yet.
   */
  apply(): { state: VmState; events: GameEvent[] } {
    throw new NotYet("apply an action", "#140");
  },
  legalActions(): LegalAction[] {
    throw new NotYet("list the legal actions", "#140");
  },
  rejectedActions(): RejectedAction[] {
    throw new NotYet("say why a move is refused", "#140");
  },
  boardView(): BoardView {
    throw new NotYet("draw the board", "#140");
  },
  toBeats(): Beats {
    throw new NotYet("turn its events into beats", "#140");
  },
};
