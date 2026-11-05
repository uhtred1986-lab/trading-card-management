/** R469: printed rule identity, live exception, and same-number restriction. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { fieldForRule, otherFieldsToDrop } from "../../src/lib/arena/vm/field-rules";
import { forbiddenBy } from "../../src/lib/arena/vm/program";
import { programProblem } from "../../src/lib/arena/vm/script-schema";
import type { EngineContext, PlayerId } from "../../src/lib/arena/types";
const kingText = "[Barrier][Field]<br>[Permanent] If your Leader Card is a green <King Cold: Br> card, you can place any number of mono-green Extra Cards with the [Field] skill in your Battle Area, and your mono-green Extra Cards with an original energy cost of 2 and the [Field] skill don't cause any of your other Extra Cards with the [Field] skill to be placed in their owners' Drop Areas.<br>[Permanent] You can't activate Extra Cards with the [Field] skill that are copies of Extra Cards with the [Field] skill in your Battle Area.";
const defs = {
  FRL469: card("FRL469", { type: "LEADER", colors: ["Green"], characters: ["King Cold: Br"] }),
  FRF469: card("FRF469", {}),
  "BT13-084": card("BT13-084", { name: "King Cold's Dynasty", type: "EXTRA", colors: ["Green"], energyCost: 6, skill: kingText }),
  FR2469: card("FR2469", { name: "Same printed name", type: "EXTRA", colors: ["Green"], energyCost: 2, skill: "[Field]" }),
  FR1469: card("FR1469", { name: "Same printed name", type: "EXTRA", colors: ["Green"], energyCost: 1, skill: "[Field]" }),
  FRM469: card("FRM469", { type: "EXTRA", colors: ["Green", "Red"], energyCost: 2, skill: "[Field]" }),
  FRN469: card("FRN469", { type: "EXTRA", colors: ["Green"], energyCost: 2 }),
};
const records = Object.values(defs).flatMap(skillRecords);
const king = records.filter(row => row.cardId === "BT13-084");
assert.equal(king.length, 3);
assert.ok(king.every(row => row.unread.length === 0), JSON.stringify(king));
const ctx: EngineContext = { defs, scripts: rulesFromRows(records.map(row => ({ ...row, source: "compiler", status: "confirmed" })) as RuleRow[], defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
function fresh(player: PlayerId) {
  const state = RULES.createGame(ctx, { seed: 469, p1: { name: "One", leader: "FRL469", main: fifty("FRF469") }, p2: { name: "Two", leader: "FRL469", main: fifty("FRF469") } }).state;
  const put = (definition: keyof typeof defs, area = "battle", holder = player) => {
    const id = state.sides[player].zones.deck.at(-1)!;
    state.cards[id].cardId = definition;
    assert.ok(moveCard(state, game, id, area, { owner: holder }).ok);
    return id;
  };
  return { state, put };
}
let cases = 0;
for (const player of ["p1", "p2"] as const) {
  const other = player === "p1" ? "p2" : "p1";
  for (const target of ["FR2469", "FR1469", "FRM469"] as const) {
    const { state, put } = fresh(player); const source = put("BT13-084"), old = put("FR1469"), arriving = put(target);
    assert.deepEqual(otherFieldsToDrop(ctx, game, state, arriving), target === "FR2469" ? [] : [source, old]); cases++;
  }
  {
    const { state, put } = fresh(player); const source = put("BT13-084"), arriving = put("FR2469");
    addEffect(state, [], { target: source, kind: "negateSkillKind", value: "permanent", until: "game" });
    assert.deepEqual(otherFieldsToDrop(ctx, game, state, arriving), [source]); cases++;
  }
  {
    const { state, put } = fresh(player); put("BT13-084", "battle", other); const old = put("FR1469"), arriving = put("FR2469");
    assert.deepEqual(otherFieldsToDrop(ctx, game, state, arriving), [old]); cases++;
  }
  {
    const { state, put } = fresh(player); put("BT13-084"); const old = put("FR2469"), same = put("FR2469", "hand"), sameName = put("FR1469", "hand");
    const asks = (id: string) => forbiddenBy(ctx, game, state, "activateSkill", { player, card: id, skillKind: "keyword", keyword: "Field" });
    assert.ok(asks(same)); assert.equal(asks(sameName), null);
    addEffect(state, [], { target: old, kind: "negateSkillKind", value: "keyword", until: "game" });
    assert.equal(asks(same), null); assert.ok(fieldForRule(ctx, game, state, old)); cases++;
  }
  {
    const { state, put } = fresh(player); const source = put("BT13-084"), arriving = put("FR2469");
    state.cards[state.sides[player].zones.leader[0]].cardId = "FRF469";
    assert.deepEqual(otherFieldsToDrop(ctx, game, state, arriving), [source]); cases++;
  }
  {
    const { state, put } = fresh(player); const source = put("FRN469");
    assert.equal(fieldForRule(ctx, game, state, source), false);
    addEffect(state, [], { target: source, kind: "keyword", value: { name: "Field" }, until: "game" });
    assert.equal(fieldForRule(ctx, game, state, source), true);
    addEffect(state, [], { target: source, kind: "negateSkillKind", value: "keyword", until: "game" });
    assert.equal(fieldForRule(ctx, game, state, source), false); cases++;
  }
}
assert.match(programProblem([{ op: "forbid", what: "play", until: "game", copiesOf: { area: "battle", side: "you" } }]) ?? "", /copiesOf/);
console.log(`field-rules-5: ${cases} both-seat typed rule cases passed`);
