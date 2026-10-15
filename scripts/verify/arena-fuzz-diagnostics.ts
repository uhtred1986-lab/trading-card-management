/** Fuzz interruptions are distinct from draws, reproducible, and executable without a DB import. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { RULES } from "../../src/lib/arena/vm";
import { nextRandom } from "../../src/lib/arena/vm/rng";
import { runFuzzGame, replayFuzzTrace, checkFuzzState } from "../lib/arena-fuzz-runner";
import type { Action, CardDef, EngineContext } from "../../src/lib/arena/types";

const leader: CardDef = { id: "FUZZ-L", name: "Fuzz leader", type: "LEADER", colors: ["Red"], energyCost: null, zEnergyCost: null, power: 10000, comboCost: null, comboPower: null, characters: [], traits: [], skill: "[Auto] When this card attacks, draw 1 card.", back: null };
const battle: CardDef = { ...leader, id: "FUZZ-B", name: "Fuzz battle", type: "BATTLE", skill: null, energyCost: 1, power: 5000, comboCost: 0, comboPower: 5000 };
const context: EngineContext = { defs: { [leader.id]: leader, [battle.id]: battle }, scripts: {
  [leader.id]: { bySkill: { 0: { ops: [], unsupported: ["synthetic unread effect"], trigger: ["attacks"] } }, complete: false, unsupported: ["synthetic unread effect"] },
  [battle.id]: { bySkill: {}, complete: true, unsupported: [] },
} };
const deck = { name: "Diagnostic fixture", leader: leader.id, main: Array(50).fill(battle.id) as string[] };
const options = { seed: 123, p1: deck, p2: deck };
function random(seed: number) {
  let state = seed;
  return () => { const next = nextRandom(state); state = next.state; return next.value; };
}

// Compare against the previous fuzz loop: diagnostics must not change the random sequence/menu bias.
const referenceRandom = random(12345);
let state = checkFuzzState(RULES.createGame(context, options).state);
const actions: Action[] = [];
while (state.phase !== "over" && actions.length < 4000) {
  const legal = RULES.legalActions(context, state);
  const pool = legal.filter((l) => l.action.type !== "endMain" && l.action.type !== "concede");
  const pick = pool.length && referenceRandom() < 0.85 ? pool[Math.floor(referenceRandom() * pool.length)] : legal[Math.floor(referenceRandom() * legal.length)];
  actions.push(pick.action);
  state = checkFuzzState(RULES.apply(context, state, pick.action).state);
}
const interrupted = runFuzzGame(context, options, { random: random(12345) });
assert.deepEqual(interrupted.trace.actions, actions, "the original random choices are unchanged");
assert.deepEqual(interrupted.outcome, state.outcome);
assert.equal(interrupted.status, "interrupted", "an unsupported Auto is an interruption, not a draw or crash");
assert.deepEqual(interrupted.interruption, { sourceCard: state.outcome!.privateContext!.sourceCard, cardId: leader.id, name: leader.name, side: "front", skillIndex: 0, printed: leader.skill, trigger: "attacks", issue: "#544", detail: "synthetic unread effect" });
assert.deepEqual(replayFuzzTrace(JSON.parse(JSON.stringify(interrupted.trace))), interrupted, "the JSON trace reproduces the exact interruption without RNG or compilation");
assert.equal(runFuzzGame(context, options, { random: random(1), maxActions: 1 }).status, "action-limit", "an unfinished game is measured separately");
const crash = runFuzzGame({ defs: {}, scripts: {} }, options, { random: random(1) });
assert.equal(crash.status, "crash");
assert.ok(crash.error);
assert.deepEqual(replayFuzzTrace(crash.trace), crash, "a creation crash also replays");
assert.throws(() => replayFuzzTrace({ ...interrupted.trace, format: "unknown" } as never), /unsupported fuzz trace/);

// Exercise both CLI paths beside an unusable DATABASE_URL: neither may import the DB entry point.
const scratch = mkdtempSync(join(tmpdir(), "arena-fuzz-diagnostics-"));
try {
  const snapshot = join(scratch, "snapshot.json"), report = join(scratch, "report.json"), trace = join(scratch, "trace.json");
  writeFileSync(snapshot, JSON.stringify({ format: "arena-fuzz-snapshot-v1", decks: [{ id: 1, name: deck.name, input: deck, cardIds: [leader.id, battle.id] }], context }));
  const run = (args: string[]) => spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/arena-fuzz.mts", ...args], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "fuzz-must-not-connect" } });
  const cli = run(["4", "--snapshot", snapshot, "--report", report]);
  assert.equal(cli.status, 0, cli.stderr);
  const recorded = JSON.parse(readFileSync(report, "utf8"));
  assert.equal(recorded.games, 4);
  assert.equal(Object.values(recorded.counts).reduce((sum: number, value) => sum + Number(value), 0), 4);
  assert.ok(recorded.failures.length, "the fixture reaches an unread skill");
  writeFileSync(trace, JSON.stringify(recorded.failures[0].trace));
  const replay = run(["--replay", trace, "--report", report]);
  assert.equal(replay.status, 0, replay.stderr);
  const replayed = JSON.parse(readFileSync(report, "utf8"));
  assert.deepEqual(replayed.interruption, recorded.failures[0].interruption);
  assert.equal(replayed.steps, recorded.failures[0].steps);
  assert.equal(replayed.seed, recorded.failures[0].seed);
} finally { rmSync(scratch, { recursive: true, force: true }); }
console.log("arena-fuzz-diagnostics: ok — random parity, typed interruption, exact replay, DB-free snapshot CLI");
