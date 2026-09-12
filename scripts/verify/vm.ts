/**
 * The engine interface, and the rules engine's skeleton behind it.
 *
 * Two claims, and neither is about playing a game:
 *
 *  1. **An engine is six calls.** `snapshot.ts` needs a board drawn and
 *     `games.ts` needs beats made from a state neither can read, so those two
 *     belong to the interface beside the four that were always there. Both
 *     engines implement all six, and the legacy engine's are the very
 *     functions the old imports named — asserted by identity below, because
 *     "an adapter and nothing else" is a claim a test can actually check.
 *  2. **A rules game can be made, stored and read back.** `createGame` loads
 *     the DBS definition and returns a `VmState` that carries which engine
 *     wrote it and which game it was dealt from; it survives a round trip
 *     through JSON, which is what `arena_games.state` is. Every other call
 *     throws `NotYet` naming the issue that builds it, because a skeleton that
 *     answered 0 or `[]` would be indistinguishable from a game with nothing
 *     to do.
 *
 * What is deliberately *not* here: anything about how a rules game plays.
 * #139 deals the board, #140 runs the turn, #141 logs the events — and each
 * brings its own suite.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { toBeats } from "../../src/lib/arena/beats";
import { apply, createGame, legalActions, rejectedActions } from "../../src/lib/arena/engine";
import {
  AVAILABLE_ENGINES,
  ENGINE_IDS,
  ENGINE_INFO,
  EngineMismatch,
  EngineNotBuilt,
  engineFor,
  legacyState,
  playableEngine,
  type Engine,
} from "../../src/lib/arena/engines";
import { boardView } from "../../src/lib/arena/view";
import { NotYet, VM_STATE_VERSION, isVmState, type VmState } from "../../src/lib/arena/vm";
import { CTX, fifty, game } from "./harness";

const DECKS = { seed: 11, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } };

// ── 1. an engine is six calls ──────────────────────────────────────────────

/** Every call the app makes through the switch. Typed off `Engine`, so widening the interface fails here until both engines implement it. */
const CALLS: (keyof Engine & string)[] = ["createGame", "apply", "legalActions", "rejectedActions", "boardView", "toBeats"];

for (const id of ENGINE_IDS) {
  const engine = engineFor(id);
  assert.equal(engine.id, id, `engineFor(${id}) handed back the ${engine.id} engine`);
  for (const call of CALLS) assert.equal(typeof engine[call], "function", `the ${id} engine has no ${call}`);
}

// The legacy engine is an adapter: each call *is* the function the old imports
// named, not a wrapper that could drift from it. This is what makes the
// contract fixtures and `arena:diff` a proof that widening the interface moved
// no behaviour.
{
  const legacy = engineFor("legacy");
  assert.equal(legacy.createGame, createGame, "the legacy adapter's createGame is not the engine's own");
  assert.equal(legacy.apply, apply, "the legacy adapter's apply is not the engine's own");
  assert.equal(legacy.legalActions, legalActions, "the legacy adapter's legalActions is not the engine's own");
  assert.equal(legacy.rejectedActions, rejectedActions, "the legacy adapter's rejectedActions is not the engine's own");
  assert.equal(legacy.boardView, boardView, "the legacy adapter's boardView is not view.ts's own");
  assert.equal(legacy.toBeats, toBeats, "the legacy adapter's toBeats is not beats.ts's own");
}

// ── 2. which engine may a new game be made on ──────────────────────────────

// Resolving the interpreter for a row and being allowed to start a game are
// two questions: `engineFor` answers the first for every id, `playableEngine`
// the second from the availability flag the `/arena` form greys the option by.
assert.equal(ENGINE_INFO.rules.available, false, "the rules engine says it is playable, and nothing plays on it yet");
assert.deepEqual(AVAILABLE_ENGINES, ["legacy"], "the engines a new game may be made on have changed");
assert.equal(playableEngine("legacy").id, "legacy", "the legacy engine is refused for a new game");
assert.throws(() => playableEngine("rules"), EngineNotBuilt, "a new game may be started on the rules engine");
assert.doesNotThrow(() => engineFor("rules"), "engineFor refuses the rules engine, so no row on it could ever be read");

// ── 3. a rules game can be made ────────────────────────────────────────────

const made = engineFor("rules").createGame(CTX, DECKS);
const state = made.state as VmState;

assert.ok(isVmState(state), "a rules game's state does not say which engine wrote it");
assert.equal(state.engine, "rules", "a rules game's state names the wrong engine");
// The definition's own id, read from `rulesets/dbs/`, not a literal repeated
// here: the arena plays the original game only (owner's decision, 4 Sep 2026).
assert.equal(state.game, "dbs", "a rules game was not dealt from the DBS definition");
assert.equal(state.seed, DECKS.seed, "a rules game did not keep the seed it was made from");
assert.equal(state.version, VM_STATE_VERSION, "a rules game's state does not say which shape it is written in");
assert.deepEqual(made.events, [], "a rules game logged an event, and nothing has happened in it yet");

// `arena_games.state` is JSON, so a state that does not survive the round trip
// is a game that cannot be stored — the one property the skeleton must have.
assert.deepEqual(JSON.parse(JSON.stringify(state)), state, "a rules game's state does not round-trip through JSON");

// A legacy state carries no `engine` field, so the guard answers about one
// shape rather than guessing about the other.
assert.equal(isVmState(game()), false, "a legacy state was read as the rules engine's");
assert.equal(isVmState(null), false, "null was read as a rules state");
assert.equal(isVmState("rules"), false, "a string was read as a rules state");

// ── 4. every other call says which issue builds it ─────────────────────────

// Called through the interface, with the arguments the app would really pass,
// so this is the refusal a caller gets and not a shortcut past it.
const rules = engineFor("rules");
const asks: { call: string; run: () => unknown }[] = [
  { call: "apply", run: () => rules.apply(CTX, state, { type: "endMain", player: "p1" }) },
  { call: "legalActions", run: () => rules.legalActions(CTX, state) },
  { call: "rejectedActions", run: () => rules.rejectedActions(CTX, state, []) },
  { call: "boardView", run: () => rules.boardView(CTX, state, "p1", {}) },
  { call: "toBeats", run: () => rules.toBeats(CTX, state, [], 0) },
];
for (const { call, run } of asks) {
  assert.throws(
    run,
    (err: unknown) => {
      assert.ok(err instanceof NotYet, `${call} on the rules engine threw ${err instanceof Error ? err.name : typeof err}, not NotYet`);
      assert.match(err.issue, /^#\d+$/, `${call} does not name the issue that builds it`);
      assert.ok(err.message.includes(err.issue), `${call}'s NotYet does not say which issue builds it in its own message`);
      return true;
    },
    `${call} on the rules engine answered instead of refusing`,
  );
}

// ── 5. a row is never replayed on the wrong interpreter ────────────────────

// The app around the six calls is still legacy-shaped (`games.ts` reads
// `state.turn`), so the seam is a check and not a cast: a rules state reaching
// it is named, not read field by field as `undefined`.
assert.throws(() => legacyState(state), EngineMismatch, "a rules state was read as the legacy engine's");
const legacy = game();
assert.equal(legacyState(legacy), legacy, "a legacy state did not pass the seam untouched");

console.log("verify/vm: ok");
