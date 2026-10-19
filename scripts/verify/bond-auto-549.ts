import { zeroSkillPrice } from "../../src/lib/arena/vm/skill-payment";
/** #549: a Bond selector is a validity condition, not an Auto payment. */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { automaticHasPrice } from "../../src/lib/arena/vm/secret-auto";
import { bondIsValid } from "../../src/lib/arena/vm/bond";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { run } from "../../src/lib/arena/vm/flow";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

const defs = {
  ...DEFS,
  "XD1-05": card("XD1-05", { energyCost: 0, traits: ["Universe 6"], skill: "[Auto][Bond 2] ≪Universe 6≫: (This skill takes effect when you have 2 or more of the specified Battle Cards in play.) When you play this card, draw 1 card." }),
  U6BOND: card("U6BOND", { energyCost: 0, traits: ["Universe 6"], skill: null }),
  OTHERBOND: card("OTHERBOND", { energyCost: 0, traits: ["Saiyan"], skill: null }),
  U6FIELD: card("U6FIELD", { type: "EXTRA", energyCost: 0, traits: ["Universe 6"], skill: null }),
  BONDPERM: card("BONDPERM", { energyCost: 0, skill: "[Permanent][Bond 2] This card gets +1000 power." }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const dbs = loaded.definition;
const skill = parseSkills(defs["XD1-05"].skill)[0];
const script = ctx.scripts!["XD1-05"].bySkill[skill.index];
assert.equal(automaticHasPrice(skill, script), false, "Bond's exact specified-card selector is not a paid Auto cost");
const selectorAndOrb = parseSkills("[Auto][Bond 2] ≪Universe 6≫ {g}: draw 1 card.")[0];
assert.equal(automaticHasPrice(selectorAndOrb, script), true, "a selector plus an additional price is not waived");
assert.equal(automaticHasPrice({ ...skill, cost: "≪Universe 6≫ draw 1 card" }, script), true, "unconsumed text is not treated as a free selector");
assert.equal(automaticHasPrice({ ...skill, cost: "If your Leader is red, ≪Universe 6≫, choose 1 card from your hand and place it in your Drop Area" }, { ...script, price: { ...zeroSkillPrice(), condition: null, ops: [{ op: "draw", n: 1 }] } }), true, "a mixed condition and action price is never waived as a Bond selector");
const pricedBond = parseSkills("[Auto][Bond 2] {g}: draw 1 card.")[0];
assert.equal(automaticHasPrice(pricedBond, script), true, "an orb-only Bond remains a paid Auto");

function main(): VmState {
  let state = RULES.createGame(ctx, { seed: 549, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  state = RULES.apply(ctx, state, { type: "chooseFirst", player: state.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) {
    state = RULES.apply(ctx, state, { type: "pass", player: (state.prompt as { player: PlayerId }).player }).state as VmState;
  }
  assert.equal(state.prompt.kind, "main");
  return state;
}
function stage(state: VmState, id: string, area: "hand" | "battle"): string {
  const physical = area === "hand" ? state.sides.p1.zones.hand[0] : state.sides.p1.zones.deck[0];
  assert.ok(physical);
  state.cards[physical].cardId = id;
  if (area !== "hand") assert.ok(moveCard(state, dbs, physical, area, { owner: "p1" }).ok);
  return physical;
}
function apply(state: VmState, action: Action): { state: VmState; events: GameEvent[] } {
  return RULES.apply(ctx, state, action) as { state: VmState; events: GameEvent[] };
}
function playedWith(battle: string[]): { source: string; state: VmState; events: GameEvent[] } {
  const state = main();
  for (const id of battle) stage(state, id, "battle");
  const source = stage(state, "XD1-05", "hand");
  const result = apply(state, { type: "play", player: "p1", card: source });
  return { source, ...result };
}

// An orb cost is not a brace-wrapped card-name filter. Its parsed energy cost
// remains payable while Bond uses the ordinary any-Battle-Card count.
{
  const state = main();
  stage(state, "OTHERBOND", "battle");
  stage(state, "U6FIELD", "battle");
  assert.equal(bondIsValid(ctx, dbs, state, "p1", pricedBond), false, "an Extra in the Battle Area does not satisfy unfiltered Bond either");
  stage(state, "OTHERBOND", "battle");
  assert.equal(bondIsValid(ctx, dbs, state, "p1", pricedBond), true);
}

// XD1-05 is itself a Universe 6 Battle Card. With one unrelated Battle Card
// already present, that leaves only one matching Battle Card after the play.
{
  const result = playedWith(["OTHERBOND"]);
  assert.equal(result.state.prompt.kind, "main");
  assert.equal(result.events.some((event) => event.type === "skill" && event.card === result.source), false);
  assert.equal(result.state.outcome, undefined);
}

// One Universe 6 Battle Card already in play plus XD1-05 itself satisfies
// Bond 2. The exact same play now
// resolves as an ordinary no-cost Auto, with no price prompt or interruption.
{
  const result = playedWith(["U6BOND"]);
  assert.equal(result.state.prompt.kind, "main");
  assert.equal(result.events.filter((event) => event.type === "skill" && event.card === result.source).length, 1);
  assert.equal(result.events.some((event) => event.type === "draw"), true);
  assert.equal(result.state.outcome, undefined);
}

// A previously pending secret Auto is rechecked at its activation point. If
// its Bond has become false, it is canceled without revealing the hand card.
{
  const state = main();
  const first = stage(state, "U6BOND", "battle");
  const second = stage(state, "U6BOND", "battle");
  const source = stage(state, "XD1-05", "hand");
  state.cards[source].faceUp = false;
  assert.equal(bondIsValid(ctx, dbs, state, "p1", skill), true);
  state.pending.push({ card: source, master: "p1", skillIndex: skill.index, trigger: "played" });
  assert.ok(moveCard(state, dbs, first, "drop", { owner: "p1" }).ok);
  const events: GameEvent[] = [];
  run(ctx, dbs, state, events);
  assert.equal(events.some((event) => event.type === "skill" && event.card === source), false);
  assert.deepEqual(state.publicAutoReveals ?? [], []);
  assert.equal(state.outcome, undefined);
  assert.ok(state.cards[second]);
}

// An Extra Field with that trait is still not a Battle Card. A granted trait
// on a Battle Card does count; evaluating it beside a Bond Permanent uses the
// existing derived-attribute path without recursing through that Permanent.
{
  const state = main();
  const permanent = stage(state, "BONDPERM", "battle");
  const printed = stage(state, "U6BOND", "battle");
  const field = stage(state, "U6FIELD", "battle");
  const target = stage(state, "OTHERBOND", "battle");
  assert.equal(bondIsValid(ctx, dbs, state, "p1", skill), false, "an Extra Field does not satisfy the Battle Card selector");
  addEffect(state, [], { source: permanent, target, kind: "gains", value: { traits: ["Universe 6"], characters: [], colors: [], names: [] }, until: "turn" });
  assert.equal(bondIsValid(ctx, dbs, state, "p1", skill), true, "the trait gained by a Battle Card satisfies the selector");
  assert.ok(state.cards[printed] && state.cards[field]);
}

console.log("bond-auto-549: selector validity, price classification, and trait/type gates passed");
