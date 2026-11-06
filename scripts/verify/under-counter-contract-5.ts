/** R466 standalone contract proof; no native under-Counter support claim yet. */
import assert from "node:assert/strict";
import {programProblem} from "../../src/lib/arena/vm/script-schema";
import {printRule,parseRule,deepEqual,type Rule} from "../../src/lib/arena/lang";
import { card } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { counterUnderPermit, counterUnderPermitProblem, underCounterOwnDiscount, isUnderCounterOwnDiscount } from "../../src/lib/arena/vm/counter-under-contract";
const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
let cases = 0;
const permit = counterUnderPermit();
assert.equal(counterUnderPermitProblem(permit), null);cases++;
assert.equal(programProblem([permit]),null);cases++;
const rule:Rule={kind:"permanent",trigger:[],cost:null,cond:null,ops:[permit]};
const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);if(!parsed.ok)throw new Error("parse");assert.ok(deepEqual(parsed.value,rule));cases++;
assert.equal(counterUnderPermitProblem(reorder(permit)), null);cases++;
for (const fault of ["host", "self", "duration", "price", "free", "policy", "version"] as const) {
  const bad = structuredClone(permit);
  if (fault === "host") bad.source!.names = ["broly"];
  if (fault === "self") bad.target = { sel: { side: "you", area: "hand" } };
  if (fault === "duration") bad.until = "turn";
  if (fault === "price") delete bad.price;
  if (fault === "free") bad.price!.ops = [{ op: "draw", n: 1 }];
  if (fault === "policy") delete (bad as Partial<typeof bad>).counterUnderPolicy;
  if (fault === "version") Object.assign(bad, { counterUnderPolicy: "asHandV0" });
  assert.ok(counterUnderPermitProblem(bad));assert.ok(programProblem([bad]));cases++;
}
assert.ok(isUnderCounterOwnDiscount(underCounterOwnDiscount()));cases++;
assert.ok(isUnderCounterOwnDiscount(reorder(underCounterOwnDiscount()) as ReturnType<typeof underCounterOwnDiscount>));cases++;
const altered = underCounterOwnDiscount();
const timing = altered[0];assert.equal(timing.op,"if");if(timing.op!=="if")throw new Error("if");
timing.cond={kind:"isTurnPlayer",who:"you"};assert.equal(isUnderCounterOwnDiscount(altered),false);cases++;
const trunks=card("BT21-048",{type:"BATTLE",name:"Trunks, Domination Complete",colors:["Blue"],energyCost:3,specifiedCost:{Blue:1},power:5000,characters:["Trunks: GT"],traits:["Saiyan","Earthling","Brainwashed"],skill:"[Servant]<br>[Counter: Attack][Limit 1] Negate the attack and play this card in Rest Mode.<br>[Permanent] During your opponent's turn, if you have a blue <Baby> in play, reduce the energy cost of this card in all areas by 2.<br>[Permanent] If this card is under a {Universal Tuffleization Plan} in your Battle Area, you can activate this card's [Counter] skill under the same conditions as if it were in your hand."});
const rows=skillRecords(trunks).map((row,id)=>({...row,id,status:"confirmed",source:"compiler"}) as unknown as RuleRow);
const scripts=rulesFromRows(rows,{[trunks.id]:trunks})[trunks.id];
assert.equal(Object.values(scripts.bySkill).filter(script=>script?.kind==="permanent"&&isUnderCounterOwnDiscount(script.ops)).length,1,"actual stored Trunks cost program matches exactly");cases++;
console.log(`under-counter-contract-5: ${cases} standalone contract cases passed`);
