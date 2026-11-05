/** R-470: BT16-020's erratum requires both its life gate and five Drop payers. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { correctSkillText } from "../../src/lib/catalog/errata";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import type { Action, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const printed = "[Activate: Battle] If this card is in a battle and you choose 1 ≪Saiyan≫ card in your hand and discard it: Draw 1 card, then add up to 1 card from your life to your hand and negate this skill for the battle.\n[Awaken] When your life is at 2 or less or you place 5 ≪Saiyan≫ cards under this card from your Drop Area: You may draw 3 cards, switch up to 1 of your energy to Active Mode, and flip this card over.";
const corrected = correctSkillText("BT16-020", printed)!;
assert.match(corrected,/life is at 4 or less and you place 5/);
const defs = {
  R470_L:card("R470_L",{type:"LEADER"}), R470_F:card("R470_F",{}),
  "BT16-020":card("BT16-020",{type:"LEADER",name:"Son Goku",colors:["Blue"],power:10000,characters:["Son Goku"],traits:["Saiyan"],skill:corrected,back:{name:"SSG Son Goku, Crimson Warrior",power:15000,skill:"[Auto] When this card attacks, draw 1 card, then switch up to 1 of your mono-blue energy to Active Mode.\n[Activate: Battle][Once per turn] Place X cards from under this card in their owners' Drop Areas: This card gets +2000 power for the battle for each card placed in a Drop Area using this skill. Additionally, if you placed 3 or more cards in Drop Areas using this skill, draw 1 card, then switch up to 1 of your mono-blue energy to Active Mode."}}),
  R470_BLOCKED:card("R470_BLOCKED",{traits:["Saiyan"],characters:["Son Goku"]}),
  R470_S:card("R470_S",{traits:["Saiyan"]}), R470_WRONG:card("R470_WRONG",{traits:["Earthling"]}),
};
const rows=Object.values(defs).flatMap(skillRecords);
const row=rows.find(r=>r.cardId==="BT16-020"&&r.side==="front"&&r.skillIndex===10)!;
assert.equal(row.cost?.readable,true);assert.deepEqual(row.cost?.condition,{kind:"life",side:"you",atMost:4});
assert.deepEqual(runtimeSupportOfRow(row).unsupported,[]);assert.deepEqual(row.cost?.program?.map(o=>o.op),["choose","moveTo"]);
const copy=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(rows.map((r,id)=>({...r,id,status:"draft",source:"compiler"}) as unknown as RuleRow)),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>RULES.apply(ctx,copy(s),a).state as VmState;
function fresh(owner:PlayerId){
 let s=RULES.createGame(ctx,{seed:470,p1:{name:"One",leader:"R470_L",main:fifty("R470_F")},p2:{name:"Two",leader:"R470_L",main:fifty("R470_F")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first:owner},{type:"mulligan",player:owner,redraw:false},{type:"mulligan",player:other(owner),redraw:false},{type:"charge",player:owner,card:null}] as Action[])s=take(s,a);
 const leader=s.sides[owner].zones.leader[0];s.cards[leader].cardId="BT16-020";return {s,leader};
}
function stage(s:VmState,owner:PlayerId,def:string,area:string){const id=s.sides[owner].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner}).ok);return id;}
function life(s:VmState,owner:PlayerId,n:number){for(const id of s.sides[owner].zones.life.slice(n))assert.ok(moveCard(s,game,id,"deck",{owner}).ok);}
const offer=(s:VmState,leader:string)=>RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===leader&&a.skill===10);
let cases=1;
for(const owner of ["p1","p2"] as const)for(const mode of ["five","six","life2","life5","four","wrong-trait","hand","opponent","forbidden"] as const){
 let {s,leader}=fresh(owner);life(s,owner,mode==="life2"?2:mode==="life5"?5:4);
 const payers=Array.from({length:mode==="six"?6:mode==="four"?4:5},(_,i)=>stage(s,mode==="opponent"?other(owner):owner,mode==="wrong-trait"&&i===4?"R470_WRONG":"R470_S",mode==="hand"?"hand":"drop"));
 if(mode==="forbidden")addEffect(s,[],{target:leader,kind:"forbid",value:0,until:"game",forbid:{what:"placeUnder",player:owner}});
 const a=offer(s,leader),yes=["five","six","life2"].includes(mode);assert.equal(!!a,yes,`${owner} ${mode}`);
 if(a){const before=s.sides[owner].zones.hand.length;s=take(s,a);
  if(s.prompt.kind==="chooseCards"){
   assert.equal(s.cards[leader].flipped,false);assert.equal(s.cards[leader].under.length,0);assert.throws(()=>take(s,{type:"choose",player:owner,cards:[]}));
   for(const payer of payers.slice(0,5))s=take(s,{type:"choose",player:owner,cards:[payer]});
  }
  assert.equal(s.cards[leader].flipped,true);assert.deepEqual([...s.cards[leader].under].sort(),payers.slice(0,5).sort());assert.equal(s.sides[owner].zones.hand.length,before+3);if(mode==="six")assert.ok(s.sides[owner].zones.drop.includes(payers[5]));
 }
 cases++;
}
for(const owner of ["p1","p2"] as const)for(const fault of ["payer-left","payer-returned","host-returned","forbidden-after-choice","missing-payer-stamp"] as const){
 let {s,leader}=fresh(owner);life(s,owner,4);const payers=Array.from({length:6},()=>stage(s,owner,"R470_S","drop"));s=take(s,offer(s,leader)!);assert.equal(s.prompt.kind,"chooseCards");
 s=take(s,{type:"choose",player:owner,cards:[payers[0]]});
 assert.equal(s.cards[leader].under.length,0,"selected payer has not yet been moved");
 if(fault==="missing-payer-stamp"){const frame=s.programs.find(f=>f.awakenPayment)!;delete frame.awakenPayment!.chosenEpochs[payers[0]];assert.throws(()=>take(s,{type:"choose",player:owner,cards:[payers[1]]}),/rebuild this saved Awaken choice/);cases++;continue;}
 if(fault.startsWith("payer")){assert.ok(moveCard(s,game,payers[0],"hand",{owner}).ok);if(fault==="payer-returned")assert.ok(moveCard(s,game,payers[0],"drop",{owner}).ok);}
 else if(fault==="host-returned"){assert.ok(moveCard(s,game,leader,"drop",{owner}).ok);assert.ok(moveCard(s,game,leader,"leader",{owner}).ok);}
 else addEffect(s,[],{target:leader,kind:"forbid",value:0,until:"game",forbid:{what:"placeUnder",player:owner}});
 const before=s.sides[owner].zones.hand.length;
 for(let i=1;i<5&&s.prompt.kind==="chooseCards";i++)s=take(s,{type:"choose",player:owner,cards:[payers[i]]});
 assert.equal(s.cards[leader].flipped,false,fault);assert.equal(s.cards[leader].under.length,0,fault);assert.equal(s.sides[owner].zones.hand.length,before,fault);
 cases++;
}
// Typed same-character prohibition setup: an unpayable fifth match must not
// make a four-card payable pool look sufficient. This is not a printed grant.
for(const owner of ["p1","p2"] as const)for(const eligible of [4,5]){
 const {s,leader}=fresh(owner);life(s,owner,4);
 const existing=stage(s,owner,"R470_BLOCKED","drop");assert.ok(moveCard(s,game,existing,"leader",{owner,under:leader}).ok);
 stage(s,owner,"R470_BLOCKED","drop");for(let i=0;i<eligible;i++)stage(s,owner,"R470_S","drop");
 addEffect(s,[],{target:leader,kind:"forbid",value:0,until:"game",forbid:{what:"placeUnder",player:owner,sameCharacterUnder:true}});
 assert.equal(!!offer(s,leader),eligible===5,"count only payers admitted under the fixed Leader");cases++;
}
console.log(`awaken-drop-price-5: ${cases} stored/native cases passed`);
