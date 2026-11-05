/** R466 isolated price-query proofs; the Counter route is not wired by this suite. */
import assert from "node:assert/strict";
import { RULES } from "../../src/lib/arena/vm";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { underCounterCardPrice, underCounterOwnCostProblem, underCounterExternalCostProblem } from "../../src/lib/arena/vm/counter-under-price";
import { counterUnderPermission, counterUnderOccurrenceProblem } from "../../src/lib/arena/vm/counter-under";
import { cardPrice } from "../../src/lib/arena/vm/costs";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { stepScript } from "../../src/lib/arena/vm/script";
import { vmHost } from "../../src/lib/arena/vm/host";
import type { EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const defs = {
  L: card("L",{type:"LEADER",colors:["Blue"]}), F:card("F",{}),
  PLAN:card("PLAN",{name:"Universal Tuffleization Plan",type:"EXTRA",colors:["Blue"],skill:"[Barrier][Field]"}),
  BABY:card("BABY",{colors:["Blue"],characters:["Baby"]}), REDBABY:card("REDBABY",{colors:["Red"],characters:["Baby"]}),
  REDUCER:card("REDUCER",{skill:"[Permanent] Reduce the energy cost of blue Battle Cards in your hand by 1."}),
  TRUNKS:card("TRUNKS",{name:"Trunks, Domination Complete",colors:["Blue"],energyCost:3,specifiedCost:{Blue:1},power:5000,skill:"[Servant]<br>[Counter: Attack][Limit 1] Negate the attack and play this card in Rest Mode.<br>[Permanent] During your opponent's turn, if you have a blue <Baby> in play, reduce the energy cost of this card in all areas by 2.<br>[Permanent] If this card is under a {Universal Tuffleization Plan} in your Battle Area, you can activate this card's [Counter] skill under the same conditions as if it were in your hand."}),
};
const rows=Object.values(defs).flatMap(skillRecords).map((row,id)=>({...row,id,status:"confirmed",source:"compiler"}) as unknown as RuleRow);
const ctx:EngineContext={defs,scripts:rulesFromRows(rows,defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
function stage(s:VmState,p:PlayerId,def:string,area:string){const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);return id;}
let cases=0;
for(const master of ["p1","p2"] as const)for(const mode of ["reduced","own-turn","no-baby","red-baby","foreign-baby","negated","borrowed"] as const){
 const s=RULES.createGame(ctx,{seed:466,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 s.turnPlayer=mode==="own-turn"?master:other(master);
 const sourceOwner=mode==="borrowed"?other(master):master,host=stage(s,master,"PLAN","battle"),source=stage(s,sourceOwner,"TRUNKS","hand");
 if(mode!=="no-baby")stage(s,mode==="foreign-baby"?other(master):master,mode==="red-baby"?"REDBABY":"BABY","battle");
 assert.ok(moveCard(s,game,source,"battle",{owner:master,under:host}).ok);
 if(mode==="negated")assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"negateSkillsOfKind",kind:"permanent",target:{var:"source"},until:"turn"}],ip:0,vars:{source:[source]},card:host,master}),"done");
 const permission=counterUnderPermission(ctx,game,s,master,source);
 assert.equal(!!permission,mode!=="negated");
 if(permission){
  assert.equal(permission.source.sourceOwner,sourceOwner);assert.equal(permission.source.master,master);
  const saved={version:1 as const,cards:{[source]:permission.source}};
  assert.equal(counterUnderOccurrenceProblem(s,source,saved),null);
  assert.match(counterUnderOccurrenceProblem(s,source,undefined)??"",/rebuild/);
  const stale=structuredClone(s);stale.cards[host].zoneEpoch=(stale.cards[host].zoneEpoch??0)+1;
  assert.match(counterUnderOccurrenceProblem(stale,source,saved)??"",/no longer/);
 }
 const before=structuredClone(s),ordinary=cardPrice(ctx,game,s,source),power=attrsNow(ctx,game,s,source).power;
 const price=underCounterCardPrice(ctx,game,s,source,master);
 assert.equal(ordinary.total,3);assert.equal(price.total,mode==="reduced"||mode==="borrowed"?1:3,mode);assert.deepEqual(price.orbs,{Blue:1});
 assert.equal(power,5000,"Servant never becomes active under the host");
 if(mode === "reduced") {
  const changedDefs = {...defs, TRUNKS: {...defs.TRUNKS, skill: defs.TRUNKS.skill + "<br>[Permanent] Reduce the energy cost of this card in your hand by 1."}};
  const changedRows = Object.values(changedDefs).flatMap(skillRecords).map((row,id)=>({...row,id,status:"confirmed",source:"compiler"}) as unknown as RuleRow);
  const changedCtx: EngineContext = {defs:changedDefs,scripts:rulesFromRows(changedRows,changedDefs)};
  assert.match(underCounterOwnCostProblem(changedCtx,game,s,source) ?? "", /additional under-card/);
  assert.throws(()=>underCounterCardPrice(changedCtx,game,s,source,master), /R466/);
  cases++;
  const external=structuredClone(s), reducer=stage(external,master,"REDUCER","battle");
  assert.match(underCounterExternalCostProblem(ctx,game,external,source,master) ?? "", /external hand-target/);
  assert.throws(()=>underCounterCardPrice(ctx,game,external,source,master), /R466/);
  assert.ok(moveCard(external,game,reducer,"drop",{owner:master}).ok);
  assert.equal(underCounterExternalCostProblem(ctx,game,external,source,master),null);
  cases++;
 }
 assert.deepEqual(s,before,"pricing changes no hand count, host pile, ownership, occurrence or other board state");assert.equal(s.cards[source].owner,sourceOwner);cases++;
}
console.log(`under-counter-price-5: ${cases} isolated price queries passed`);
