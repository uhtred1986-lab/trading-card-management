/** #801: attack summaries from the rules engine before a real declaration. */
import assert from "node:assert/strict";
import inspector from "node:inspector";
import { CTX, DEFS, card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { buildSnapshot } from "../../src/lib/arena/snapshot-core";
import { hiddenAliases } from "../../src/lib/arena/conceal";
import type { EngineContext } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const defs = { ...DEFS,
  BONUS801: card("BONUS801", { type: "LEADER", power: 10000, energyCost: null, comboCost: null, comboPower: null,
    skill: "[Auto] When this card attacks, this card gets +5000 power for the battle." }),
  PASSIVE801: card("PASSIVE801", { type: "LEADER", power: 15000, energyCost: null, comboCost: null, comboPower: null,
    skill: "[Double Strike][Critical]" }),
  DRAW801: card("DRAW801", { type: "LEADER", power: 10000, energyCost: null, comboCost: null, comboPower: null,
    skill: "[Auto] When this card attacks, draw 1 card, then it gets +5000 power for the battle." }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
function main(leader: string): VmState {
  let state = RULES.createGame(ctx, { seed: 801, p1: { name: "You", leader, main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const moves = [
    { type: "chooseFirst", player: state.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" },
    { type: "charge", player: "p2", card: null }, { type: "endMain", player: "p2" },
    { type: "charge", player: "p1", card: null },
  ] as const;
  for (const move of moves) state = RULES.apply(ctx, state, move).state as VmState;
  assert.equal(state.prompt.kind, "main");
  return state;
}
function snapshot(state: VmState) {
  return buildSnapshot({ id: 801, mode: "hotseat", status: "playing", p1Name: "You", p2Name: "Other", ctx, state,
    legal: RULES.legalActions(ctx, state), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer: "p1", images: {} });
}
for (const leader of ["BONUS801", "PASSIVE801", "DRAW801"]) {
  const state = main(leader);
  const before = JSON.stringify(state);
  const rng = state.rngState;
  const action = RULES.legalActions(ctx, state).find((row) => row.action.type === "attack" && row.action.target === state.sides.p2.zones.leader[0])?.action;
  assert.ok(action);
  const result = RULES.apply(ctx, structuredClone(state), action);
  const snap = snapshot(state);
  const index = snap.legal.findIndex((row) => row.action.type === "attack" && row.action.target === state.sides.p2.zones.leader[0]);
  assert.ok(index >= 0);
  const preview = snap.attackPreviews?.find((row) => row.action === index);
  assert.ok(preview);
  if (leader === "DRAW801") {
    assert.equal(preview.state, "notEvaluated", "a draw cannot be predicted from hidden cards");
    assert.match(preview.reason ?? "", /hidden|variable/i);
    assert.equal(preview.battle, undefined);
  } else {
    assert.equal(preview.state, "known");
    assert.deepEqual(preview.battle, RULES.boardView(ctx, result.state, "p1", {}).battle,
      "the preview is the actual engine BattleView after declaration");
    assert.equal(preview.battle?.attackPower, 15000);
    if (leader === "PASSIVE801") {
      assert.equal(preview.battle.stakes?.lifeDamage, 2);
      assert.equal(preview.battle.stakes?.critical, true);
      assert.equal(preview.battle.stakes?.strikeDamage, 2);
    }
    const permuted = structuredClone(state);
    for (const id of [...permuted.sides.p2.zones.hand, ...permuted.sides.p1.zones.life]) permuted.cards[id].cardId = "V-BLUE";
    const twin = snapshot(permuted);
    assert.deepEqual(twin.attackPreviews, snap.attackPreviews, "hidden identity changes cannot alter a public attack preview");
  }
  assert.equal(JSON.stringify(state), before, "preview must not mutate its source state");
  assert.equal(state.rngState, rng);
  const hidden = Object.keys(hiddenAliases(state, "p1"));
  for (const id of hidden) assert.ok(!JSON.stringify(snap.attackPreviews).includes(id), `hidden id ${id} cannot be named by a preview`);
}
void (async () => {
  const probe = new inspector.Session();
  probe.connect();
  const post = <T,>(method: string, params?: object) => new Promise<T>((resolve, reject) => probe.post(method, params ?? {}, (error, result) => error ? reject(error) : resolve(result as T)));
  await post("Profiler.enable");
  await post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
  snapshot(main("BONUS801"));
  const coverage = await post<{ result: Array<{ url: string; functions: Array<{ functionName: string; ranges: Array<{ count: number }> }> }> }>("Profiler.takePreciseCoverage");
  await post("Profiler.stopPreciseCoverage");
  probe.disconnect();
  const counts = coverage.result.flatMap((script) => script.functions.filter((fn) => fn.functionName === "readStatics" && script.url.includes("program")).map((fn) => fn.ranges[0]?.count ?? 0));
  assert.ok(counts.length > 0);
  assert.ok(counts[0] <= 128, `one engine-exact attack preview should read statics at most 128 times (got ${counts[0]})`);
  console.log("#801 attack previews: engine Auto, passive stakes, hidden/variable guard, purity and concealment passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
