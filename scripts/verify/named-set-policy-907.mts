/** Coupled Fusion choices expose one fresh legal offer, preserving ordinary counted picks. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeReplayBundle } from "../../src/lib/arena/replay-core";
import { createPinnedMatch, applyMove } from "../../src/lib/arena/browser";
import { policyTurn, localStep, applyDecision } from "../../src/lib/arena/policy/boundary";
import { answerFor } from "../../src/lib/arena/policy/contract";
import { localPolicy } from "../../src/lib/arena/policy/combat";
import { localMemory } from "../../src/lib/arena/policy/main";
import { policyRng } from "../../src/lib/arena/policy/rng";
import { cardDefFrom } from "../../src/lib/arena/load";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { DBS_FILES } from "../../src/lib/arena/rulesets/dbs";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { card, DEFS, fifty } from "./harness";
import type { Action, CardDef } from "../../src/lib/arena/types";
const runtime = "a907000000000000000000000000000000000907";
const catalog = JSON.parse(readFileSync("docs/arena-backlog/evidence/897/selected-pair-inputs-2026-10-19/catalog.json", "utf8")).cards;
const defs: Record<string, CardDef> = { "L-RED": DEFS["L-RED"], V1: DEFS.V1,
  "BT6-012": cardDefFrom(catalog.find((c: CardDef) => c.id === "BT6-012")),
  G1N907: card("G1N907", { characters: ["Son Goku: Br"], energyCost: 1 }),
  G2N907: card("G2N907", { characters: ["Son Goku: Br"], energyCost: 1 }),
  VN907: card("VN907", { characters: ["Vegeta: Br"], energyCost: 7 }),
};
const baseBundle = await makeReplayBundle({ defs: JSON.parse(JSON.stringify(defs)), scripts: Object.fromEntries(Object.keys(defs).map(id => [id, rulesFromCompiler(defs)[id]])), art: {}, rulesetFiles: DBS_FILES, runtime });
const bundle = { ...baseBundle, decks: { p1: { name: "One", leader: "L-RED", main: fifty("V1") }, p2: { name: "Two", leader: "L-RED", main: fifty("V1") } } };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
for (const owner of ["p1", "p2"] as const) {
  let { match } = await createPinnedMatch({ bundle, seed: 907, interpreterRevision: runtime });
  const other = owner === "p1" ? "p2" : "p1";
  for (const a of [{ type: "chooseFirst", player: match.state.chooser, first: owner }, { type: "mulligan", player: owner, redraw: false }, { type: "mulligan", player: other, redraw: false }, { type: "charge", player: owner, card: null }] as Action[]) match = applyMove(match, a).match;
  for (const id of match.state.sides[owner].zones.hand.slice()) assert.ok(moveCard(match.state, game, id, "deck", { owner }).ok);
  const stage = (cardId: string) => { const id = match.state.sides[owner].zones.deck.find(i => match.state.cards[i].cardId === "V1")!; match.state.cards[id].cardId = cardId; assert.ok(moveCard(match.state, game, id, "hand", { owner }).ok); return id; };
  const source = stage("BT6-012"), a = stage("G1N907"), b = stage("G2N907"), veg = stage("VN907");
  match = applyMove(match, { type: "activate", player: owner, card: source, skill: 0 }).match;
  assert.equal(match.state.prompt.kind, "chooseCards");
  const initial = copy(match), turn = policyTurn(match, owner, 0), pick = turn.input.decisions.decisions.find(d => d.kind === "pick")!;
  assert.equal(pick.kind, "pick"); if (pick.kind !== "pick") throw Error("expected pick");
  assert.equal(pick.remaining, null, "named-set count is coupled, not a plain count of independent candidates");
  const plain = copy(match), op = plain.state.programs[0].ops[0]; assert.equal(op.op, "choose"); if (op.op === "choose") op.namedSet = undefined;
  assert.equal(policyTurn(plain, owner, 0).input.decisions.decisions.find(d => d.kind === "pick")?.remaining, 2, "ordinary counted choices remain compound");
  const forged = applyDecision(match, turn.key, answerFor(turn.input.decisions, pick.id, [a, b]));
  assert.equal(forged.ok, false); if (!forged.ok) assert.match(forged.detail, /card 2 of the pick is no longer offered/);
  assert.deepEqual(copy(match), initial, "stale coupled compound answer stays refused atomically");
  let memory = localMemory(policyRng(907)); const policy = localPolicy();
  const first = localStep(copy(match), owner, 0, memory, policy); if (!first.ok) throw Error(first.detail);
  const replay = localStep(copy(match), owner, 0, copy(memory), policy); assert.deepEqual(replay, first, "saved boundary step replays exactly");
  match = first.match; memory = first.memory;
  assert.equal(match.state.prompt.kind, "chooseCards"); if (match.state.prompt.kind !== "chooseCards") throw Error("expected second named-slot choice");
  const firstWasVegeta = match.state.programs[0].vars.pair.includes(veg);
  assert.deepEqual(match.state.prompt.choice.candidates.slice().sort(), (firstWasVegeta ? [a, b] : [veg]).sort(), "first material pick leaves only the matching opposite character slot");
  const second = localStep(copy(match), owner, 1, memory, policy); if (!second.ok) throw Error(second.detail); match = second.match;
  assert.ok(match.state.sides[owner].zones.battle.includes(source));
  assert.ok(match.state.sides[owner].zones.drop.includes(veg)); assert.equal([a, b].filter(i => match.state.sides[owner].zones.drop.includes(i)).length, 1);
}
console.log("named-set-policy-907: both seats use fresh coupled Fusion choices; saved replay, ordinary counts and stale-answer refusal preserved");
