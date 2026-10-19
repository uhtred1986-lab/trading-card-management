/** #907: an actual engine interruption is unfinished, never an admitted draw. */
import assert from "node:assert/strict";
import { fixtureBundle, FIXTURE_REVISION } from "./arena-browser-fixture";
import { localPolicy } from "../../src/lib/arena/policy/combat";
import { playDuel } from "./arena-policy-duel";
import { classOf } from "../arena-corpus-freeze.mts";
let staged = false;
const result = await playDuel({ bundle: await fixtureBundle(), interpreterRevision: FIXTURE_REVISION,
  gameSeed: 907, policySeed: 907, testSeat: "p1", test: localPolicy(), baseline: localPolicy(), maxMoves: 20,
  observe(match) {
    if (staged || match.state.prompt.kind !== "main") return;
    staged = true;
    // A real obsolete saved continuation reaches the VM's typed metadata guard.
    // It must close with an interrupted outcome, including private referee
    // context, rather than become a scored draw in the evaluation adapter.
    const leader = match.state.sides[match.state.turnPlayer].zones.leader[0];
    match.state.programs.unshift({ card: leader, master: match.state.turnPlayer, skillIndex: 0,
      ops: [{ op: "draw", n: 1 }], ip: 0, vars: {} });
  },
});
assert.ok(staged);
assert.equal(result.over, false); assert.equal(result.winner, null); assert.equal(result.reason, null);
assert.equal(result.stopKind, "interrupted"); assert.equal(result.stopped, "This game was interrupted before a result was reached.");
assert.ok(!JSON.stringify(result).includes("privateContext") && !JSON.stringify(result).includes("skillIndex"));
const record = { pair: "synthetic", seed: 907, p1: "A", p2: "B", policySeed: 907,
  over: result.over, winnerSeat: null, reason: result.reason, moves: result.moves, turn: result.turn,
  stopKind: result.stopKind, stopped: result.stopped, trace: result.trace };
assert.equal(classOf(record), "interrupted");
assert.equal(classOf({ ...record, over: true }), "interrupted", "legacy terminal flag cannot override an explicit interruption");
assert.equal(classOf({ ...record, over: true, stopKind: null, stopped: null }), "completed", "genuine terminal games retain classification");
console.log("interrupted-duel-907: actual obsolete-frame interruption stays unfinished, private context stays local, terminal controls preserved");
