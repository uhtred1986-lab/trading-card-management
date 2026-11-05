/** R474: stored single-pile alternative Awaken, with actual native payment. */
import assert from "node:assert/strict";
import { validateRule, parseRule, printRule, deepEqual, type Rule } from "../../src/lib/arena/lang";
import { blocksOf, ruleFromBlocks } from "../../src/lib/arena/lang/blocks";
import { costRecordProblem } from "../../src/lib/arena/vm/skill-payment";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import type { Action, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const defs={
 L:card("L",{type:"LEADER"}),F:card("F",{}),
 "BT17-002":card("BT17-002",{type:"LEADER",name:"Dr. Myuu & General Rilldo",colors:["Red"],power:10000,characters:["Dr. Myuu","General Rilldo"],traits:["Machine Mutant"],skill:"[Auto] When this card attacks, play up to 1 red ≪Machine Mutant≫ card with an energy cost of 1 from your hand.\n[Awaken] When your life is at 4 or less or you choose 3 cards from under a &lt;Super Sigma&gt; card in your Battle Area and place them under this card: You may draw 1 card, switch up to 1 of your energy to Active Mode, add cards from your life to your hand until you have 6 life left, then flip this card over.",back:{name:"Dr. Myuu & Hyper Meta-Rilldo, Rulers of Planet M-2",power:15000,skill:"[Auto][Once per turn] When you activate [Evolve] or [Union Absorb], draw 1 card.\n[Auto] When this card attacks, play up to 1 red ≪Machine Mutant≫ card with an energy cost of 1 from your hand.\n[Activate: Battle][Once per turn] Place 1 card from under this card in its owner's Drop Area: This card gets +5000 power for the battle."}}),
 SIGMA:card("SIGMA",{characters:["Super Sigma"]}),WRONG:card("WRONG",{characters:["Son Goku"]}),
};
const rows=Object.values(defs).flatMap(skillRecords),row=rows.find(r=>r.cardId==="BT17-002"&&r.side==="front"&&r.skillIndex===10)!;
assert.equal(row.cost?.readable,true);assert.ok(row.cost?.awakenAlternative);assert.equal(row.cost?.condition,null);assert.equal(row.cost?.program,null);assert.deepEqual(runtimeSupportOfRow(row).unsupported,[]);
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(rows.map((r,id)=>({...r,id,status:"draft",source:"compiler"})as unknown as RuleRow)),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>RULES.apply(ctx,copy(s),a).state as VmState;
function fresh(owner:PlayerId,n=5){let s=RULES.createGame(ctx,{seed:474,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first:owner},{type:"mulligan",player:owner,redraw:false},{type:"mulligan",player:other(owner),redraw:false},{type:"charge",player:owner,card:null}]as Action[])s=take(s,a);
 const leader=s.sides[owner].zones.leader[0];s.cards[leader].cardId="BT17-002";for(const id of s.sides[owner].zones.life.slice(n))assert.ok(moveCard(s,game,id,"deck",{owner}).ok);return{s,leader};}
function stage(s:VmState,owner:PlayerId,def:string,area:string){const id=s.sides[owner].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner}).ok);return id;}
function pile(s:VmState,owner:PlayerId,n:number,def="SIGMA",area="battle"){const host=stage(s,owner,def,area),payers=Array.from({length:n},()=>stage(s,owner,"F","drop"));for(const id of payers)assert.ok(moveCard(s,game,id,area,{owner,under:host}).ok);return{host,payers};}
const offer=(s:VmState,leader:string)=>RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===leader&&a.skill===10);
let cases=1;
for(const owner of ["p1","p2"]as const)for(const mode of ["free","three","four","zero","two","split","wrong","opponent","area","both-free","both-paid"]as const){
 const {s:initial,leader}=fresh(owner,mode==="free"||mode.startsWith("both")?4:5);let s=initial;
 const n=mode==="free"||mode==="zero"?0:mode==="two"||mode==="split"?2:mode==="four"?4:3;
 const staged=pile(s,mode==="opponent"?other(owner):owner,n,mode==="wrong"?"WRONG":"SIGMA",mode==="area"?"unison":"battle");if(mode==="split")pile(s,owner,1);
 const yes=["free","three","four","both-free","both-paid"].includes(mode),a=offer(s,leader);assert.equal(!!a,yes,`${owner}/${mode}`);
 if(a){const before=s.sides[owner].zones.hand.length;s=take(s,a);if(mode.startsWith("both")){assert.equal(s.prompt.kind,"chooseMode");s=take(s,{type:"chooseMode",player:owner,index:mode==="both-free"?0:1});}
  for(const id of staged.payers.slice(0,3))if(s.prompt.kind==="chooseCards")s=take(s,{type:"choose",player:owner,cards:[id]});
  assert.equal(s.cards[leader].flipped,true,`${mode}: ${JSON.stringify(s.prompt)}`);assert.equal(s.sides[owner].zones.hand.length,before+1);
  assert.deepEqual(s.cards[leader].under,mode==="free"||mode==="both-free"?[]:staged.payers.slice(0,3));
 }
 cases++;
}
for(const owner of ["p1","p2"]as const){
 // Identical named hosts remain distinguishable as actual board-card choices.
 const {s:initial,leader}=fresh(owner);let s=initial;const first=pile(s,owner,3),second=pile(s,owner,3);s=take(s,offer(s,leader)!);assert.equal(s.prompt.kind,"chooseCards");if(s.prompt.kind==="chooseCards")assert.deepEqual(s.prompt.choice.candidates,[first.host,second.host]);
 s=take(s,{type:"choose",player:owner,cards:[second.host]});for(const id of second.payers.slice(0,3))if(s.prompt.kind==="chooseCards")s=take(s,{type:"choose",player:owner,cards:[id]});assert.equal(s.cards[leader].flipped,true);assert.deepEqual(s.cards[first.host].under,first.payers);assert.deepEqual(s.cards[second.host].under,[]);cases++;
}
for(const owner of ["p1","p2"]as const)for(const fault of ["payer-aba","offered-aba","host-aba","source-aba","negated","negation-restored","ban","missing-payer","missing-offered","missing-line","missing-ops"]as const){
 const {s:initial,leader}=fresh(owner);let s=initial;const {host,payers}=pile(s,owner,4);s=take(s,offer(s,leader)!);assert.equal(s.prompt.kind,"chooseCards");
 const early=fault==="offered-aba";if(!early)s=take(s,{type:"choose",player:owner,cards:[payers[0]]});
 const frame=s.programs.find(f=>f.awakenAlternativeCost)!;assert.ok(frame);
 if(fault==="missing-payer")delete frame.awakenAlternativeCost!.payers[payers[0]];
 if(fault==="missing-offered")delete frame.awakenAlternativeCost!.offered;
 if(fault==="missing-line")delete (frame.awakenAlternativeCost as unknown as {line?:unknown}).line;
 if(fault==="missing-ops")delete (frame as unknown as {ops?:unknown}).ops;
 if(fault==="payer-aba"||early){assert.ok(moveCard(s,game,payers[0],"drop",{owner}).ok);assert.ok(moveCard(s,game,payers[0],"battle",{owner,under:host}).ok);}
 if(fault==="host-aba"){assert.ok(moveCard(s,game,host,"hand",{owner}).ok);assert.ok(moveCard(s,game,host,"battle",{owner}).ok);}
 if(fault==="source-aba"){assert.ok(moveCard(s,game,leader,"drop",{owner}).ok);assert.ok(moveCard(s,game,leader,"leader",{owner}).ok);}
 if(fault.startsWith("negat")){addEffect(s,[],{target:leader,kind:"negateSkill",value:10,until:"game"});if(fault==="negation-restored")s.effects=s.effects.filter(e=>e.kind!=="negateSkill");}
 if(fault==="ban")addEffect(s,[],{target:leader,kind:"forbid",value:0,until:"game",forbid:{what:"placeUnder",player:owner}});
 const a:Action={type:"choose",player:owner,cards:[payers[early?0:1]]};
 if(fault.startsWith("missing")){const bad=take(s,a);assert.equal(bad.outcome?.kind,"interrupted",fault);assert.equal(bad.cards[leader].flipped,false);assert.equal(bad.cards[leader].under.length,0);cases++;continue;}
 const before=s.sides[owner].zones.hand.length;s=take(s,a);if(fault==="negation-restored")s=take(s,{type:"choose",player:owner,cards:[payers[2]]});
 assert.equal(s.cards[leader].flipped,fault==="negation-restored",fault);assert.equal(s.cards[leader].under.length,fault==="negation-restored"?3:0,fault);assert.equal(s.sides[owner].zones.hand.length,before+(fault==="negation-restored"?1:0),fault);cases++;
}
for(const status of ["draft","confirmed","corrected"]as const){
 const stale=copy(row);delete stale.cost!.awakenAlternative;stale.cost!.readable=true;stale.cost!.condition={kind:"life",side:"you",atMost:4};
 assert.ok(runtimeSupportOfRow(stale).unsupported.some(x=>/alternative Awaken/.test(x)));
 const scripts=rulesFromRows([{...stale,id:1,status,source:"compiler"}as unknown as RuleRow],defs);assert.ok(scripts["BT17-002"].bySkill[10].unsupported.length);cases++;
}
for(const owner of ["p1","p2"]as const)for(const mode of ["ready","decline","paid-source-aba","missing-paid"]as const){
 const {s:initial,leader}=fresh(owner,8);let s=initial;const {host,payers}=pile(s,owner,4),energy=stage(s,owner,"F","energy");s.cards[energy].mode="rest";
 const before=s.sides[owner].zones.hand.length;s=take(s,offer(s,leader)!);for(const id of [payers[2],payers[0],payers[1]])s=take(s,{type:"choose",player:owner,cards:[id]});
 assert.equal(s.prompt.kind,"chooseCards");assert.equal(s.sides[owner].zones.hand.length,before+1);assert.deepEqual(s.cards[leader].under,[payers[2],payers[0],payers[1]]);assert.deepEqual(s.cards[host].under,[payers[3]]);
 if(mode==="missing-paid"){delete s.programs.find(f=>f.awakenAlternativePaid)!.awakenAlternativePaid;const bad=take(s,{type:"choose",player:owner,cards:[]});assert.equal(bad.outcome?.kind,"interrupted");assert.equal(bad.cards[leader].flipped,false);cases++;continue;}
 if(mode==="paid-source-aba"){assert.ok(moveCard(s,game,leader,"drop",{owner}).ok);assert.ok(moveCard(s,game,leader,"leader",{owner}).ok);}
 s=take(s,{type:"choose",player:owner,cards:mode==="ready"?[energy]:[]});
 while(s.prompt.kind==="chooseCards"){const id=s.prompt.choice.candidates[0];s=take(s,{type:"choose",player:owner,cards:[id]});}
 assert.equal(s.cards[energy].mode,mode==="ready"?"active":"rest");assert.equal(s.sides[owner].zones.life.length,6);assert.equal(s.sides[owner].zones.hand.length,before+3);assert.equal(s.cards[leader].flipped,mode!=="paid-source-aba");cases++;
}
for(const owner of ["p1","p2"]as const)for(const protectedPart of ["host","payer"]as const){
 const {s:initial,leader}=fresh(owner);let s=initial;const {host,payers}=pile(s,owner,3);addEffect(s,[],{target:protectedPart==="host"?host:payers[0],kind:"immune",value:0,until:"game",immune:{from:owner}});
 const a=offer(s,leader);assert.equal(!!a,protectedPart==="host");if(a){s=take(s,a);assert.equal(s.cards[leader].flipped,true);assert.deepEqual(s.cards[leader].under,payers);}cases++;
}
const rule={kind:row.kind,trigger:row.trigger,usage:row.usage,validity:row.validity,cost:row.cost,cond:row.cond,ops:row.ops}as Rule;
assert.equal(validateRule(rule,"keyword"),null);const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);assert.ok(deepEqual(parsed.value,rule));assert.ok(deepEqual(ruleFromBlocks(blocksOf(rule)),rule));
for(const bad of [{...row.cost,condition:{kind:"life",side:"you",atMost:4}},{...row.cost,program:[{op:"draw",n:1}]},{...row.cost,awakenAlternative:{...row.cost!.awakenAlternative,count:0}}])assert.ok(costRecordProblem(bad));cases+=4;
for(const owner of ["p1","p2"]as const)for(const mode of ["success","fail"]as const){
 const {s:initial,leader}=fresh(owner);let s=initial;const {payers}=pile(s,owner,4);
 addEffect(s,[],{target:leader,kind:"forbid",value:0,until:"game",forbid:{what:"activateSkill",player:owner,uses:1,fromArea:"leader",skillKind:"activate:main/battle",keyword:"Awaken"}});
 s=take(s,offer(s,leader)!);assert.equal(s.effects.find(e=>e.forbid?.what==="activateSkill")!.forbid!.uses,1);
 if(mode==="fail")addEffect(s,[],{target:leader,kind:"forbid",value:0,until:"game",forbid:{what:"flipLeaderBack",player:owner}});
 let activationEvents=0;for(const id of payers.slice(0,3))if(s.prompt.kind==="chooseCards"){const result=RULES.apply(ctx,copy(s),{type:"choose",player:owner,cards:[id]});s=result.state as VmState;activationEvents+=result.events.filter(e=>e.type==="skill"&&e.card===leader).length;}
 assert.equal(s.cards[leader].flipped,mode==="success");assert.equal(s.effects.find(e=>e.forbid?.what==="activateSkill")!.forbid!.uses,mode==="success"?0:1);assert.equal(activationEvents,mode==="success"?1:0);cases++;
}
console.log(`awaken-alternative-5: ${cases} stored/native cases passed`);
