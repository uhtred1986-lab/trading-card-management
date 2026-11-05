import assert from "node:assert/strict";
import { card, parseSkills } from "./harness";
import { compileEnergyEntryPolicy } from "../../src/lib/arena/compile/energy-entry";
import { energyEntryPolicyProblem } from "../../src/lib/arena/vm/energy-entry-policy";
import { skillRecords } from "../../src/lib/arena/draft";
import { runtimeSupportOfRow } from "../../src/lib/arena/rules-store";

// Exact printed six-card family. No native admission is claimed by this reader.
const pairs = [
  ["DB2-166", "red", "green"], ["DB2-168", "blue", "yellow"],
  ["DB2-171", "red", "yellow"], ["DB2-173", "blue", "green"],
  ["DB2-175", "red", "blue"], ["DB2-176", "green", "yellow"],
] as const;
const printed = (first: string, second: string) => `[Permanent] When placing this card in your energy from any area, you may choose 1 ${first} card and 1 ${second} card in your Drop Area and send them to your Warp. If you do, negate this card's [Energy-Exhaust] skill.`;
let cases = 0;
for (const [id, first, second] of pairs) {
  const text = printed(first, second), skill = parseSkills(text)[0];
  const policy = compileEnergyEntryPolicy(skill);
  assert.deepEqual(policy, { version: 1, colors: [first[0].toUpperCase() + first.slice(1), second[0].toUpperCase() + second.slice(1)] });
  assert.equal(energyEntryPolicyProblem(policy), null);
  const row = skillRecords(card(id, { skill: text }))[0];
  assert.ok(runtimeSupportOfRow(row).unsupported.length, "reader-only WIP must not admit the old after-entry Permanent");
  cases++;
}
for (const text of [
  printed("red", "red"), printed("black", "blue"),
  printed("red", "blue") + " Draw 1 card.",
  printed("red", "blue").replace("you may", "you must"),
  printed("red", "blue").replace("from any area", "from your hand"),
  printed("red", "blue").replace("your Drop Area", "either player's Drop Area"),
  printed("red", "blue").replace("[Permanent]", "[Auto]"),
  printed("red", "blue").replace("1 red", "2 red"),
]) { assert.equal(compileEnergyEntryPolicy(parseSkills(text)[0]), undefined); cases++; }
for (const value of [null, [], {}, { version: 2, colors: ["Red", "Blue"] },
  { version: 1, colors: ["Red", "Red"] }, { version: 1, colors: ["Red"] },
  { version: 1, colors: ["Red", "Blue"], optional: false }]) {
  assert.ok(energyEntryPolicyProblem(value)); cases++;
}
console.log(`energy-entry-policy-5: ${cases} isolated descriptor/reader cases passed; native admission remains blocked`);
