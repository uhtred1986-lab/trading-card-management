/** R-427: strict payment reads native original-movement outcomes and forwards observers. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { AutoPaymentFailed, automaticPriceHost } from "../../src/lib/arena/vm/auto-costs";
import type { MovementOutcome } from "../../src/lib/arena/vm/movement-result";
import type { EngineContext } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const defs={L:card("L",{type:"LEADER"}),F:card("F",{})};
const ctx:EngineContext={defs,scripts:rulesFromCompiler(defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
let cases=0;
for(const owner of ["p1","p2"] as const)for(const route of ["original","same","different","modified-instruction"] as const){
 const s=RULES.createGame(ctx,{seed:427,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const id=s.sides[owner].zones.deck[0];assert.ok(moveCard(s,game,id,"battle",{owner}).ok);
 const h=automaticPriceHost(ctx,game,s,[]),outcomes:MovementOutcome[]=[];
 const to=route==="modified-instruction"?"warp":"drop";
 const run=()=>h.move(id,to,owner,{reason:"cost",onResult:result=>outcomes.push(result),replaced:route==="same"?{to:"drop"}:route==="different"?{to:"warp"}:null});
 if(route==="same"||route==="different")assert.throws(run,AutoPaymentFailed);else assert.equal(run(),to);
 assert.equal(outcomes.length,1,"wrapper forwards the native result exactly once");assert.equal(outcomes[0].completed,route==="original"||route==="modified-instruction");
 assert.equal(outcomes[0].from,"battle");assert.equal(outcomes[0].to,route==="different"?"warp":to);assert.ok(outcomes[0].toEpoch>outcomes[0].fromEpoch);cases++;
}
console.log(`cost-movement-result-5: ${cases} both-seat native-mover controls passed`);
