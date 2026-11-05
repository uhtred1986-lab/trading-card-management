/** R-447: refuse card-energy coupons whose activation timing would be lost. */
import assert from "node:assert/strict";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { card, compileSkill, parseSkills } from "./harness";
const printed: Record<string, string> = {"EX25-13": "[Deflect]\n[Auto] Place this card into its owner's Drop: When this card is played, play up to 1 {Final Strike Bardock} from your hand or Drop in Rest Mode.\n[Activate: Main][Limit 1]{b}, if your Leader is a blue ≪Bardock's Crew≫ card and you have 3 or more energy: Play this card from your hand, and during this turn, the next time you activate the [Activate: Main] skill on {Tora's Red Armband} from your hand, reduce the energy cost by 2.", "P-524": "[auto] When this card is played, look at up to 7 cards from the top of your deck, add up to 1 blue Extra with an energy cost of 1 to your hand, then shuffle your deck.<br>[activate: main][limit 1][spirit boost 1] Blue Unison with 15000 power or more: During that turn, the next time you activate the [activate: main] skill on a blue Extra with an energy cost of 1 from your hand, reduce the energy cost by {u}."};
for (const [id,text] of Object.entries(printed)) {
  const line = parseSkills(text).find(skill => /reduce the energy cost/i.test(skill.effect));
  assert.ok(line, id);
  const script = compileSkill(line);
  assert.ok(script.unsupported.some(part => /reduce the energy cost/i.test(part)), id);
  assert.ok(!JSON.stringify(script.ops).includes('"op":"costReduction"'), id);
}
for (const timing of ["Main", "Battle", "Main/Battle"]) {
  const script = compileSkill(parseSkills(`[Activate: Main] During this turn, the next time you activate the [Activate: ${timing}] skill on a blue Extra with an energy cost of 1 from your hand, reduce the energy cost by {u}.`)[0]);
  assert.ok(script.unsupported.length, timing);
  assert.ok(!JSON.stringify(script.ops).includes('"op":"costReduction"'), timing);
}
{
  const script = compileSkill(parseSkills("[Activate: Main] During this turn, the next time you activate the [Activate] skill on a blue Extra from your hand, reduce the energy cost by 1.")[0]);
  assert.ok(script.unsupported.length, "bare Activate also excludes Counter");
}
for (const text of [
  "[Activate: Main] During this turn, the next time you play a blue Battle Card from your hand, reduce its energy cost by 1.",
  "[Activate: Main] During this turn, the next time you activate an [Activate: Main] skill on a blue Battle Card in your hand, reduce the skill cost by {u}.",
]) {
  const script = compileSkill(parseSkills(text)[0]);
  assert.deepEqual(script.unsupported, [], text);
  assert.ok(JSON.stringify(script.ops).includes('"op":"costReduction"'), text);
}
console.log("coupon-timing-gap-5: two printed refusals, three timing controls and two retained coupon forms passed");

const oldOps = {"P-524#10": [{"op": "costReduction", "target": {"sel": {"side": "you", "area": "hand", "filter": {"colors": ["Blue"], "notColors": [], "monoColor": false, "multiColor": false, "characters": [], "notCharacters": [], "charactersIncluding": [], "notCharactersIncluding": [], "charactersAll": [], "namesAll": [], "traits": [], "notTraits": [], "characterOrTrait": false, "onlyCharacters": false, "names": [], "notNames": [], "namesIncluding": [], "notNamesIncluding": [], "notKeywords": [], "keywords": [], "skillKind": null, "unreadable": false, "noKeywords": false, "type": "EXTRA", "notType": null, "faceUp": false, "token": false, "notToken": false, "costMin": 1, "costMax": 1, "powerMin": null, "powerMax": null, "originalPowerMin": null, "originalPowerMax": null, "comboPowerMin": null, "comboPowerMax": null, "markersMin": null, "markersMax": null, "specifiedCostMin": null, "specifiedCostMax": null, "specifiedCostNone": false, "costAtMostEnergy": false, "costBelowEnergy": false, "costAtLeastEnergy": false, "costAboveEnergy": false, "energyOfOpponent": false, "originallySkillLess": false, "skillLess": false, "powerRel": null, "nameInSkillTextOf": null, "z": null}, "count": 99}}, "amount": 1, "colors": ["Blue"], "until": "turn", "uses": 1}], "EX25-13#20": [{"op": "choose", "sel": {"special": "self", "area": "hand"}, "as": "p0", "reason": "Play this card from your hand"}, {"op": "play", "target": {"var": "p0"}}, {"op": "costReduction", "target": {"sel": {"side": "you", "area": "hand", "filter": {"colors": [], "notColors": [], "monoColor": false, "multiColor": false, "characters": [], "notCharacters": [], "charactersIncluding": [], "notCharactersIncluding": [], "charactersAll": [], "namesAll": [], "traits": [], "notTraits": [], "characterOrTrait": false, "onlyCharacters": false, "names": ["Tora's Red Armband"], "notNames": [], "namesIncluding": [], "notNamesIncluding": [], "notKeywords": [], "keywords": [], "skillKind": null, "unreadable": false, "noKeywords": false, "type": null, "notType": null, "faceUp": false, "token": false, "notToken": false, "costMin": null, "costMax": null, "powerMin": null, "powerMax": null, "originalPowerMin": null, "originalPowerMax": null, "comboPowerMin": null, "comboPowerMax": null, "markersMin": null, "markersMax": null, "specifiedCostMin": null, "specifiedCostMax": null, "specifiedCostNone": false, "costAtMostEnergy": false, "costBelowEnergy": false, "costAtLeastEnergy": false, "costAboveEnergy": false, "energyOfOpponent": false, "originallySkillLess": false, "skillLess": false, "powerRel": null, "nameInSkillTextOf": null, "z": null}, "count": 99}}, "amount": 2, "until": "turn", "uses": 1}]};
for (const id of ["P-524", "EX25-13"] as const) {
  const def = card(id, { skill: printed[id] });
  const row = skillRecords(def).find(r => /reduce the energy cost/i.test(r.printed))!;
  const ops = oldOps[id === "P-524" ? "P-524#10" : "EX25-13#20"];
  for (const status of ["draft", "confirmed", "corrected"] as const) {
    const stale = { ...row, id: 1, ops, unread: [], status, source: "compiler" } as unknown as RuleRow;
    assert.ok(runtimeSupportOfRow(stale).unsupported.some(reason => /coupon/.test(reason)), `${id} ${status}`);
    assert.ok(rulesFromRows([stale], { [id]: def })[id].bySkill[row.skillIndex]?.unsupported.some(reason => /coupon/.test(reason)), `${id} ${status} executable loader refusal`);
  }
}
