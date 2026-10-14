/** #798: real printed choices, before the action, including an optional empty choice and private-view guard. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CTX, DEFS, card, fifty } from "./harness";
import { cardDefFrom } from "../../src/lib/arena/load";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { buildSnapshot } from "../../src/lib/arena/snapshot-core";
import type { CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const catalog = JSON.parse(readFileSync("docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json", "utf8")) as { cards: { id: string }[] };
function printed(id: string): CardDef {
  const row = catalog.cards.find((item) => item.id === id);
  assert.ok(row);
  return cardDefFrom(row as Parameters<typeof cardDefFrom>[0]);
}
const defs = { ...DEFS, "BT11-011": printed("BT11-011"), "BT6-025": printed("BT6-025"),
  RUNI798: card("RUNI798", { type: "UNISON", colors: ["Red"], energyCost: 1, power: 5000, comboCost: null, comboPower: null, skill: null }),
  BIG798: card("BIG798", { colors: ["Blue"], power: 25000, skill: null }),
  EXACT798: card("EXACT798", { colors: ["Blue"], power: 20000, skill: null }),
  SMALL798: card("SMALL798", { colors: ["Blue"], power: 10000, skill: null }),
  BARRIER798: card("BARRIER798", { colors: ["Blue"], power: 10000, skill: "[Barrier]" }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;

function stage(state: VmState, player: PlayerId, cardId: string, zone: "hand" | "energy" | "unison" | "battle"): string {
  const id = state.sides[player].zones.deck[0];
  assert.ok(id);
  state.cards[id].cardId = cardId;
  assert.ok(moveCard(state, game, id, zone, { owner: player }).ok);
  if (zone === "unison") state.cards[id].markers = 1;
  state.pending = [];
  return id;
}
function main(leader = "L-RED"): VmState {
  let state = RULES.createGame(ctx, { seed: 798, p1: { name: "You", leader, main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  state = RULES.apply(ctx, state, { type: "chooseFirst", player: state.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) state = RULES.apply(ctx, state, { type: "pass", player: (state.prompt as { player: PlayerId }).player }).state as VmState;
  assert.equal(state.prompt.kind, "main");
  for (const player of ["p1", "p2"] as const) for (const zone of ["hand", "energy"] as const) {
    for (const id of state.sides[player].zones[zone].slice()) assert.ok(moveCard(state, game, id, "deck", { owner: player }).ok);
  }
  return state;
}
function snapshot(state: VmState, viewer: PlayerId) {
  return buildSnapshot({ id: 798, mode: "hotseat", status: "playing", p1Name: "You", p2Name: "Other", ctx, state,
    legal: RULES.legalActions(ctx, state), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
}
function preview(state: VmState, cardId: string, viewer: PlayerId = "p1") {
  const snap = snapshot(state, viewer);
  const index = snap.legal.findIndex(({ action }) => (action.type === "play" || action.type === "activate") && state.cards[action.card]?.cardId === cardId);
  assert.ok(index >= 0, `${cardId} has a legal action`);
  const row = snap.choicePreviews?.find((item) => item.action === index);
  assert.ok(row, `${cardId} has a first-choice preview`);
  return { row, snap };
}
function actualFirstChoice(state: VmState, action: ReturnType<typeof snapshot>["legal"][number]["action"]): string[] {
  let next = RULES.apply(ctx, structuredClone(state), action).state as VmState;
  for (let i = 0; i < 16 && next.prompt.kind !== "chooseCards"; i++) {
    const answer = RULES.legalActions(ctx, next).find((item) => item.action.type !== "concede");
    assert.ok(answer, `stopped before the first choice at ${next.prompt.kind}`);
    next = RULES.apply(ctx, next, answer.action).state as VmState;
  }
  assert.equal(next.prompt.kind, "chooseCards", "the real resolver reached its first card choice");
  return next.prompt.choice.candidates;
}
const fixtures: unknown[] = [];
function fixture(name: string, state: VmState, source: string): void {
  const snap = snapshot(state, "p1");
  const card = snap.view.you.hand?.find((item) => item.cardId === source);
  assert.ok(card);
  const actions = snap.legal.map((item, index) => ({ ...item, index }))
    .filter(({ action }) => "card" in action && action.card === card.id);
  fixtures.push({ name, card, you: { leader: snap.view.you.leader, unison: snap.view.you.unison },
    them: { leader: snap.view.them.leader, unison: snap.view.them.unison, battle: snap.view.them.battle },
    legal: actions, choicePreviews: snap.choicePreviews?.filter((item) => actions.some((action) => action.index === item.action)) ?? [],
    rejected: snap.rejected?.filter((item) => "card" in item.action && item.action.card === card.id) ?? [] });
}

{
  const state = main();
  const cardId = stage(state, "p1", "BT11-011", "hand");
  stage(state, "p1", "V1", "energy"); stage(state, "p1", "V1", "energy");
  const before = JSON.stringify(state);
  const { row, snap } = preview(state, "BT11-011");
  assert.equal(row.state, "empty");
  assert.deepEqual(row.candidates, []);
  assert.match(row.reason ?? "", /red Unison/i);
  assert.equal(JSON.stringify(state), before, "preview does not mutate the game");
  assert.ok(snap.legal.some(({ action }) => action.type === "play" && action.card === cardId), "up-to choice keeps play legal");
  fixture("BT11-011: no red Unison", state, "BT11-011");
  const red = stage(state, "p1", "RUNI798", "unison");
  const withRed = preview(state, "BT11-011").row;
  assert.equal(withRed.state, "available");
  assert.deepEqual(withRed.candidates, [red]);
  assert.deepEqual(actualFirstChoice(state, snapshot(state, "p1").legal[withRed.action].action), withRed.candidates);
  fixture("BT11-011: red Unison", state, "BT11-011");
  const opponent = snapshot(state, "p2");
  assert.deepEqual(opponent.legal, []);
  assert.equal(opponent.choicePreviews, undefined, "opponent gets no preview of a private hand play");
  assert.ok(!JSON.stringify(opponent).includes(cardId), "private hand instance id is not leaked");
}

{
  const state = main();
  stage(state, "p1", "BT6-025", "hand");
  stage(state, "p1", "V1", "energy");
  const small = stage(state, "p2", "SMALL798", "battle");
  const exact = stage(state, "p2", "EXACT798", "battle");
  const big = stage(state, "p2", "BIG798", "battle");
  const barrier = stage(state, "p2", "BARRIER798", "battle");
  const hidden = stage(state, "p2", "SMALL798", "battle");
  state.cards[hidden].hidden = true;
  const { row, snap } = preview(state, "BT6-025");
  assert.equal(snap.legal[row.action].action.type, "activate", "the Extra is a hand activation");
  assert.deepEqual(row.candidates, [small, exact]);
  assert.deepEqual(actualFirstChoice(state, snap.legal[row.action].action), row.candidates);
  const leader = state.sides.p2.zones.leader[0];
  assert.match(row.rejected?.find((item) => item.card === leader)?.reason ?? "", /Battle Card/);
  assert.match(row.rejected?.find((item) => item.card === big)?.reason ?? "", /20000/);
  assert.match(row.rejected?.find((item) => item.card === barrier)?.reason ?? "", /Barrier/);
  assert.ok(!JSON.stringify(row).includes(hidden), "hidden Battle Card id is absent from candidates and explanations");
  fixture("BT6-025: 20k allowed, 25k and Barrier refused", state, "BT6-025");
}
{
  const state = main("L-BLUE");
  const extra = stage(state, "p1", "BT6-025", "hand");
  stage(state, "p1", "V1", "energy");
  stage(state, "p2", "EXACT798", "battle");
  const snap = snapshot(state, "p1");
  assert.ok(!snap.legal.some(({ action }) => action.type === "activate" && action.card === extra), "blue Leader cannot activate Transcendent Strike");
  assert.ok(!snap.choicePreviews?.some((item) => {
    const action = snap.legal[item.action]?.action;
    return action?.type === "activate" && action.card === extra;
  }));
  fixture("BT6-025: blue Leader cannot activate", state, "BT6-025");
}
if (process.argv.includes("--emit")) {
  mkdirSync("docs/arena-backlog/evidence/798", { recursive: true });
  writeFileSync("docs/arena-backlog/evidence/798/choice-previews.json", `${JSON.stringify({ source: "scripts/verify/play-choice-preview-798.ts", scenarios: fixtures }, null, 2)}\n`);
}
console.log("#798 legal-play first-choice previews: real cards, optional empty, and privacy passed");
