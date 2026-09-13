/**
 * The two ways the rules engine says no.
 *
 * Both live here rather than in `./index.ts` so the runner and the board can
 * throw them without importing the module that assembles the engine — the same
 * one-way dependency the switch has on the engine (`../engines.ts`). `index.ts`
 * re-exports them, so nothing outside `vm/` learns a second import path.
 */
import { IllegalAction } from "../engine";
import type { Game } from "../../catalog/games";

/**
 * Something the rules engine cannot do yet.
 *
 * The message names the thing *and* the issue that builds it, so a stack trace
 * from a script or a fuzz run says what to go and read rather than only that
 * something was missing.
 *
 * An `IllegalAction`, because the commonest way to meet one is to send a move
 * the engine has no case for: a client that catches the refusal it already
 * catches gets the sentence, and the API answers `illegal_action` rather than
 * failing. The two claims are the same claim — the engine will not take that
 * move, and here is the issue where it learns to.
 */
export class NotYet extends IllegalAction {
  readonly step: string;
  readonly issue: string;
  constructor(step: string, issue: string) {
    super(`the rules engine cannot ${step} yet — ${issue} builds it`);
    this.name = "NotYet";
    this.step = step;
    this.issue = issue;
  }
}

/** The game's definition would not load, or does not say something the interpreter needs — a bug in the `.rules` files rather than in the game being started. */
export class RulesetBroken extends Error {
  constructor(game: Game, detail: string) {
    super(`the ${game} ruleset does not load, so no game can be played on the rules engine: ${detail}`);
    this.name = "RulesetBroken";
  }
}
