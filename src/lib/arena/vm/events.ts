/**
 * The log, and the moment.
 *
 * Two things happen when something happens in a game, and they are not the same
 * thing. A **client event** is what the board animates and what `arena:diff`
 * compares: the closed `GameEvent` union both engines are read in, so a beat
 * drawn from one engine's log is the beat drawn from the other's. A **moment**
 * is what the cards answer to (9-6): the same happening, written in the words
 * the definition's `DEFINE TRIGGER … ON` patterns are written in, so a game can
 * declare its own moments without any code knowing their names.
 *
 * The legacy engine has only the first. Its moments are trigger *names*, fired
 * from forty hand-placed `pendTriggers(ctx, s, "played", card)` calls inside the
 * engine, and the name is what a record's WHEN has to match. That works, and it
 * is the reason `triggers.rules` could be written at all — but a second game
 * cannot add a moment to it, and nothing holds the calls to the manual. Here the
 * happening is fired as data and `triggers.rules` decides what it *is*: one
 * declaration per moment, matched against the pattern, with the same name coming
 * out the other end. The record's WHEN means the same thing on both engines
 * because the name it names is the same name (`skillAnswersTo`, `./triggers.ts`).
 *
 * **The log is append-only**, which is the property the oracle rests on: an
 * index into it never moves, so a beat queue can be continued from a number and
 * a replay can be compared position by position. `log` is the one writer.
 *
 * The two are kept apart in the *caller* rather than translated here, and on
 * purpose. A client event is typed by the legacy engine's closed `Area` and
 * `Phase` unions; a moment's words are the game's own. Translating one into the
 * other generically would mean this module deciding that the declared zone
 * `battle` is the `Area` word `battle` — which is a claim about one game, in the
 * one module that must not make any. So `emit` takes both: the picture the
 * client sees (or `null`, for a moment with no picture) and the moment the cards
 * answer to.
 *
 * Pure and client-safe: no database, no network, no `fs`.
 */
import type { EngineContext, GameEvent } from "../engine";
import type { PlayerId } from "../engine/types";
import type { PatternValue } from "../lang";
import type { GameDefinition } from "../rulesets";
import { pendAutos, type VmPending } from "./triggers";
import type { VmState } from "./state";

/**
 * Something that happened, in the words a `DEFINE TRIGGER` pattern can name.
 *
 * `event` is the pattern's own event word (`moved`, `ko`, `phaseStart`,
 * `attackDeclared`, …) and `args` are the fields a pattern may match on, by the
 * argument name the declaration uses. Two fields are not arguments and are
 * about *who is asked* rather than about what happened:
 *
 *   `card`        the card the moment happened to — the one a `BIND "self"`
 *                 declaration asks, and the `subject` a watcher binds. Absent
 *                 for a moment that is about the board rather than about a card
 *                 (a phase beginning), which every card in play then answers.
 *   `controller`  the side the moment is about (the moved card's master, the
 *                 damaged player), which is what `watcher: controller` means and
 *                 what `opponent` is the other of.
 *
 * A pattern argument the moment does not carry never matches, which is what
 * keeps `moved(asPlay: true, …)` from firing on a card that was simply placed:
 * every `moved` moment says whether it was a play, rather than leaving the field
 * out and being read as either.
 */
export interface Moment {
  event: string;
  card?: string;
  controller?: PlayerId;
  args: Record<string, PatternValue>;
}

/**
 * Append one event to the log, and say where it landed.
 *
 * The one writer. An event is never inserted, replaced or removed: a client
 * continues its beat queue from a number (`toBeats(…, after)`) and the oracle
 * compares two logs position by position, and both stop being true the moment
 * something is written anywhere but the end.
 */
export function log(ev: GameEvent[], event: GameEvent): number {
  return ev.push(event) - 1;
}

/**
 * The moment alone, for a happening neither engine writes into the log.
 *
 * Dealing a game is the one there is: 102 cards go into zones and no `move`
 * event is logged for any of them on either engine, and yet the Leader arriving
 * in the Leader Area is 6-2-4's moment and a card that answers to it must. A
 * caller reaching for this rather than `emit` is claiming the log is right to
 * be silent — so the two are separate names and not a flag.
 */
export function fire(ctx: EngineContext, game: GameDefinition, state: VmState, moment: Moment): VmPending[] {
  return pendAutos(ctx, game, state, moment);
}

/**
 * One happening: the picture the client sees, and the moment the cards answer to.
 *
 * Returns the index the event landed at, or −1 for a moment with no picture —
 * a phase *ending*, which no client draws and the legacy engine does not log,
 * but which is nonetheless the moment "at the end of your Main Phase" names.
 *
 * The order is deliberate: the event is logged **before** the [Auto]s are
 * pended, so that a skill pending off a move is behind the move in the log
 * rather than in front of it. The legacy engine logs in the same order
 * (`koCard` pushes its `ko` event and then pends), and a log the two engines
 * disagree about the order of is a log the oracle cannot compare.
 */
export function emit(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], moment: Moment, shown: GameEvent | null = null): number {
  const at = shown ? log(ev, shown) : -1;
  pendAutos(ctx, game, state, moment);
  return at;
}

export type { VmPending };
