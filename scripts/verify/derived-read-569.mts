/** DB-free #569 proof: one read window shares statics, never a view or a later state. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import inspector from "node:inspector";
import { arenaG, CTX, IMPL } from "./harness";
import { buildSnapshot, withSnapshotReading, type SnapshotInput } from "../../src/lib/arena/snapshot";
import { snapshotOfGame } from "../../src/lib/arena/session";
import { withTokens } from "../../src/lib/arena/vm/cards";
import { rulesetFor, type GameDefinition } from "../../src/lib/arena/rulesets";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { EngineContext, LegalAction } from "../../src/lib/arena/types";
import type { LoadedGame } from "../../src/lib/arena/games";
import type { Db } from "../../src/db";

assert.equal(process.env.DATABASE_URL ?? "", "", "do not connect this proof to a database");
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const state = arenaG({ hand: ["V1", "V1"], energy: ["V1", "V1"], battle: ["AURA", "AURA", "V1"], oppHand: ["V-BLUE"], oppBattle: ["V-BLUE"] }) as VmState;
const beforeState = digest(state);
const input = (ctx: EngineContext, board: VmState, revision: number, viewer: "p1" | "p2", legal: LegalAction[]): SnapshotInput => ({
  id: 569, revision, mode: "versus", status: "playing", p1Name: "One", p2Name: "Two",
  ctx, state: board, legal, log: [], beats: null, spotlight: null,
  spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {},
});
const read = (ctx: EngineContext, board: VmState, revision: number, viewer: "p1" | "p2") => withSnapshotReading(
  { ctx, state: board },
  () => buildSnapshot(input(ctx, board, revision, viewer, IMPL.legalActions(ctx, board))),
);

// The outer scope's exact wrapper identity is the one each EngineAPI call uses.
assert.equal(withTokens(CTX), withTokens(CTX));
assert.equal(withTokens(withTokens(CTX)), withTokens(CTX));
const one = read(CTX, state, 7, "p1");
const attackActions = one.legal.filter((entry) => entry.action.type === "attack");
assert.ok(attackActions.length > 2, "the fixture includes multiple attack targets and attackers");
assert.equal(one.attackPreviews?.filter((entry) => entry.state === "known").length, attackActions.length,
  "every ordinary legal attack gets an engine preview even with standing power rules");
for (const preview of one.attackPreviews ?? []) {
  const offered = one.legal[preview.action]?.action;
  assert.ok(offered?.type === "attack");
  assert.equal(preview.state, "known");
  const applied = IMPL.apply(CTX, state, offered);
  assert.deepEqual(preview.battle, IMPL.boardView(CTX, applied.state, "p1", {}).battle,
    "each reused attack projection equals that target's independent engine transition");
}
const crowded = arenaG({ hand: ["V1"], energy: ["V1"], battle: Array(12).fill("AURA"), oppBattle: Array(6).fill("V-BLUE") }) as VmState;
for (const id of crowded.sides.p2.zones.battle) crowded.cards[id].mode = "rest";
const crowdedSnapshot = read(CTX, crowded, 7, "p1");
assert.ok((crowdedSnapshot.attackPreviews?.length ?? 0) > 64, "the stress board exposes more than the bounded projection budget");
assert.equal(crowdedSnapshot.attackPreviews?.filter((entry) => entry.state === "known").length, 64);
assert.ok(crowdedSnapshot.attackPreviews?.slice(64).every((entry) => entry.state === "notEvaluated"));
for (const preview of [crowdedSnapshot.attackPreviews![0], crowdedSnapshot.attackPreviews![7], crowdedSnapshot.attackPreviews![63]]) {
  const offered = crowdedSnapshot.legal[preview.action]?.action;
  assert.ok(offered?.type === "attack");
  const applied = IMPL.apply(CTX, crowded, offered);
  assert.deepEqual(preview.battle, IMPL.boardView(CTX, applied.state, "p1", {}).battle,
    "a batched crowded-board preview is identical to the independent engine result");
}
const two = read(CTX, state, 7, "p2");
const together = withSnapshotReading({ ctx: CTX, state }, () => {
  const legal = IMPL.legalActions(CTX, state);
  return [buildSnapshot(input(CTX, state, 7, "p1", legal)), buildSnapshot(input(CTX, state, 7, "p2", legal))];
});
assert.deepEqual(together, [one, two], "sharing static reads across both viewers cannot share their serialized views");
assert.equal(digest(state), beforeState, "reading both viewers does not mutate state or RNG");
assert.notEqual(digest(one), digest(two), "serialized views remain personal");
assert.equal(one.view.them.hand, null);
assert.equal(two.view.them.hand, null);
for (const id of state.sides.p2.zones.hand) assert.equal(JSON.stringify(one).includes(`"${id}"`), false, "opponent hand id escaped p1 view");
for (const id of state.sides.p1.zones.hand) assert.equal(JSON.stringify(two).includes(`"${id}"`), false, "opponent hand id escaped p2 view");
assert.equal(digest(read(CTX, state, 7, "p1")), digest(one), "a fresh session reproduces the same revision");

// `snapshotOfGame` must enter the scope before its spread reads the lazy legal getter.
let legalReads = 0;
const loaded = { ...input(CTX, state, 7, "p1", []), version: 7, art: {}, game: "dbs" } as unknown as LoadedGame;
Object.defineProperty(loaded, "legal", { enumerable: true, get: () => { legalReads++; return IMPL.legalActions(CTX, state); } });
const actual = await snapshotOfGame({} as Db, loaded, "p1");
assert.equal(legalReads, 1);
assert.equal(digest(actual), digest(one), "the actual lazy getter path matches the pure projection");

const play = one.legal.find((move) => move.action.type === "play" && move.action.player === "p1");
assert.ok(play, "fixture has an affordable positive action");
assert.equal(play.cost?.energy, 1, "the real legal offer costs one energy");
assert.throws(() => IMPL.apply(CTX, state, { type: "endMain", player: "p2" }), "wrong-seat action is refused");
assert.equal(digest(state), beforeState, "a refused action leaves the old revision intact");
const applied = IMPL.apply(CTX, state, play.action);
assert.notEqual(digest(applied.state), beforeState, "legal move changes the cloned revision");
assert.equal(digest(state), beforeState, "legal move leaves the previous revision intact");
assert.ok(applied.events.some((event) => event.type === "action" && event.action.type === "play"));
assert.equal(applied.events.filter((event) => event.type === "mode" && event.mode === "rest" && state.sides.p1.zones.energy.includes(event.card)).length, 1, "one energy payment was recorded");
const paidState = applied.state as VmState;
assert.equal(paidState.sides.p1.zones.energy.filter((id) => paidState.cards[id].mode === "rest").length, 1, "the new revision carries that exact payment");
const later = read(CTX, applied.state as VmState, 8, "p1");
assert.notEqual(digest(later), digest(one), "a later revision cannot reuse earlier derived values");
assert.equal(digest(read(CTX, structuredClone(state), 7, "p1")), digest(one), "reloaded state recomputes the same board");

// A context may pin an older runtime ruleset. A different definition with the
// same game id must never borrow its predecessor's standing-attribute result.
const loadedRules = rulesetFor("dbs");
assert.ok(loadedRules.ok);
const changedRules = structuredClone(loadedRules.definition) as GameDefinition;
changedRules.attributes.power.layers = ["printed"];
const pinnedCtx = { ...CTX, rulesetDefinition: changedRules } as EngineContext;
assert.notEqual(withTokens(pinnedCtx), withTokens(CTX), "different pinned contexts use different wrappers");
const current = read(CTX, state, 7, "p1");
const pinned = read(pinnedCtx, state, 7, "p1");
const auraTarget = current.view.you.battle.find((card) => card.cardId === "V1");
assert.ok(auraTarget);
const changedTarget = pinned.view.you.battle.find((card) => card.id === auraTarget.id);
assert.ok(changedTarget);
assert.notEqual(changedTarget.power, auraTarget.power, "pinned attribute layers alter the actual board reading");
assert.equal(digest(read(CTX, state, 7, "p1")), digest(current), "the pinned definition did not contaminate the live context");

// Exact V8 function-call counts, separate from timing: the ordinary legal+
// snapshot projection shares one read across all four consumers. Attack
// previews (#801) intentionally run bounded cloned engine transitions, so
// this baseline isolates those optional future-state readings.
const session = new inspector.Session();
session.connect();
const post = <T,>(method: string, params?: object) => new Promise<T>((resolve, reject) => session.post(method, params ?? {}, (error, result) => error ? reject(error) : resolve(result as T)));
await post("Profiler.enable");
await post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
withSnapshotReading({ ctx: CTX, state }, () => {
  const legal = IMPL.legalActions(CTX, state).filter((entry) => entry.action.type !== "attack");
  buildSnapshot(input(CTX, state, 7, "p1", legal));
});
const coverage = await post<{ result: Array<{ url: string; functions: Array<{ functionName: string; ranges: Array<{ count: number }> }> }> }>("Profiler.takePreciseCoverage");
await post("Profiler.stopPreciseCoverage");
session.disconnect();
const counts = coverage.result.flatMap((script) => script.functions.filter((fn) => fn.functionName === "readStatics" && script.url.includes("program")).map((fn) => fn.ranges[0]?.count ?? 0));
assert.ok(counts.length > 0, "V8 profiler identified readStatics by function and source");
assert.deepEqual(counts, [1], "legal, rejected, abilities and view share one static read");
const attackSession = new inspector.Session();
attackSession.connect();
const attackPost = <T,>(method: string, params?: object) => new Promise<T>((resolve, reject) => attackSession.post(method, params ?? {}, (error, result) => error ? reject(error) : resolve(result as T)));
await attackPost("Profiler.enable");
await attackPost("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
read(CTX, state, 7, "p1");
const attackCoverage = await attackPost<typeof coverage>("Profiler.takePreciseCoverage");
await attackPost("Profiler.stopPreciseCoverage");
attackSession.disconnect();
const attackCounts = attackCoverage.result.flatMap((script) => script.functions.filter((fn) => fn.functionName === "readStatics" && script.url.includes("program")).map((fn) => fn.ranges[0]?.count ?? 0));
assert.ok(attackCounts.length > 0);
assert.ok(attackCounts[0] <= 64, `the crowded fixture's four engine attack futures read statics at most 64 times (got ${attackCounts[0]})`);
assert.equal(digest(state), beforeState);
console.log(`#569 immutable read session: one shared static read, ${attackCounts[0]} with bounded attack futures`);
