/** R455: stored Z-Stack gate counts both Energy Areas at resolution. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { correctSkillText } from "../../src/lib/catalog/errata";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { condHolds } from "../../src/lib/arena/vm/program";
import { parseConditionClause } from "../../src/lib/arena/compile/conditions";
import { validateRule, parseRule, printRule, deepEqual, type Rule } from "../../src/lib/arena/lang";
import type { CostRecord, ScriptFrame } from "../../src/lib/arena/vm/script";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const PRINT="[Deflect][Blocker]<br>[Z-Stack 1] You and your opponent have a total of 4 or more energy: Green &lt;Son Gohan: Childhood&gt; Leader.<br>[Permanent] If your Leader is a &lt;Son Gohan: Childhood&gt; card, this card's skills won't negate.<br>[Permanent] If your Leader is a {SS Son Gohan, The Results of Fatherly Training} and this card would leave your Battle Area, place up to 1 {SS2 Son Gohan, Trigger to Fierce Rage} from under this card on top of your Leader, add cards from your life to your hand until you have 4 life left, and remove this card from the game instead.<br>[Auto] When your opponent plays a card or at the end of your opponent's turn, you may KO this card.";
const defs:Record<string,CardDef>={
 L:card("L",{type:"LEADER"}), F:card("F",{colors:["Green"]}),
 "BT21-074":card("BT21-074",{name:"Android 16, Final Wish",type:"Z-BATTLE",colors:["Green"],energyCost:1,zEnergyCost:1,power:4000,characters:["Android 16"],traits:["Android"],skill:correctSkillText("BT21-074",PRINT)}),
 GOOD:card("GOOD",{type:"Z-LEADER",colors:["Green"],characters:["Son Gohan: Childhood"]}),
 COLOR:card("COLOR",{type:"Z-LEADER",colors:["Blue"],characters:["Son Gohan: Childhood"]}),
 NAME:card("NAME",{type:"Z-LEADER",colors:["Green"],characters:["Son Goku"]}),
 TYPE:card("TYPE",{type:"Z-BATTLE",colors:["Green"],characters:["Son Gohan: Childhood"]}),
};
const rows=Object.values(defs).flatMap(skillRecords).map(r=>({...r,source:"compiler",status:"confirmed"}) as RuleRow);
const line=rows.find(r=>r.cardId==="BT21-074"&&r.skillIndex===10)!;
assert.equal((line.cost as {readable:boolean}).readable,true);
assert.deepEqual((line.cost as {condition:unknown}).condition,{kind:"count",sel:{side:"both",area:"energy"},atLeast:4});
assert.ok(rows.find(r=>r.cardId==="BT21-074"&&r.skillIndex===30)!.unread!.length,"unrelated replacement remains unread");
const ctx:EngineContext={defs,scripts:rulesFromRows(rows,defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>RULES.apply(clone(ctx),clone(s),clone(a)).state as VmState;
function fresh(p:PlayerId){let s=RULES.createGame(ctx,{seed:455,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first:p},{type:"mulligan",player:p,redraw:false},{type:"mulligan",player:other(p),redraw:false},{type:"charge",player:p,card:null}] as Action[])s=take(s,a);
 s.sides.p1.attrs.energyMarkers=0;s.sides.p2.attrs.energyMarkers=0;return s;}
function stage(s:VmState,p:PlayerId,id:string,area:string){const cid=s.sides[p].zones.deck.at(-1)!;s.cards[cid].cardId=id;assert.ok(moveCard(s,game,cid,area,{owner:p}).ok);return cid;}
const rule:Rule={kind:line.kind,trigger:line.trigger as Rule["trigger"],usage:line.usage as Rule["usage"],validity:line.validity as Rule["validity"],cost:line.cost as CostRecord,cond:line.cond as Rule["cond"],ops:line.ops as Rule["ops"]};
assert.equal(validateRule(rule,"keyword"),null);const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);assert.ok(deepEqual(parsed.value,rule));
let checks=0;
for(const p of ["p1","p2"] as const) {
 const s=fresh(p),source=stage(s,p,"BT21-074","zDeck");
 const frame:ScriptFrame={card:source,master:p,ops:[],ip:0,vars:{}};
 const cond=(line.cost as CostRecord).condition!;
 assert.equal(condHolds(ctx,game,s,frame,cond),false);
 for(let i=0;i<3;i++)stage(s,p,"F","energy");
 s.sides[p].attrs.energyMarkers=3;s.sides[other(p)].attrs.energyMarkers=3;
 assert.equal(condHolds(ctx,game,s,frame,cond),false,"energy markers do not count as cards in Energy Areas");
 const final=stage(s,other(p),"F","energy");
 addEffect(s,[],{target:final,kind:"forbid",value:0,until:"game",forbid:{what:"beChosen",player:p}});
 assert.equal(condHolds(ctx,game,s,frame,cond),true,"protected energy still contributes to observation");
 assert.ok(moveCard(s,game,final,"zEnergy",{owner:other(p)}).ok);
 assert.equal(condHolds(ctx,game,clone(s),clone(frame),cond),false,"saved condition reads current Energy Areas");checks++;
}
for(const bound of ["more","less","fewer"]){const a=parseConditionClause(`you and your opponent have a total of 4 or ${bound} energy`,true);const b=parseConditionClause(`there is a total of 4 or ${bound} energy between you and your opponent`,true);assert.ok(a);assert.deepEqual(a,b);}

for(const p of ["p1","p2"] as const)for(const [own,theirs] of [[1,0],[1,2],[1,3],[2,2],[3,1],[4,0],[1,4]])for(const decline of [false,true]) {
 let s=fresh(p);const source=stage(s,p,"BT21-074","zDeck"),good=stage(s,p,"GOOD","zDeck");
 for(const id of ["COLOR","NAME","TYPE"])stage(s,p,id,"zDeck");
 stage(s,other(p),"GOOD","zDeck");stage(s,p,"GOOD","hand");stage(s,p,"GOOD","drop");
 for(let i=0;i<own;i++)stage(s,p,"F","energy");for(let i=0;i<theirs;i++)stage(s,other(p),"F","energy");
 // Wrong-area cards and energy markers do not contribute to this condition.
 for(const area of ["battle","drop","hand","zEnergy"])for(let i=0;i<3;i++)stage(s,other(p),"F",area);
 stage(s,p,"F","zEnergy");
 const act=RULES.legalActions(ctx,s).find(l=>l.action.type==="playZ"&&l.action.card===source);assert.ok(act);
 s=take(s,act.action);let offered=false;
 for(let i=0;i<20&&s.prompt.kind!=="main"&&!s.outcome;i++) {
  const q=s.prompt;
  if(q.kind==="chooseCards") { assert.deepEqual(q.choice.candidates,[good]);offered=true;s=take(s,{type:"choose",player:q.player,cards:decline?[]:[good]}); }
  else if(q.kind==="payCost")s=take(s,{type:"payCost",player:q.player,option:0});
  else if(q.kind==="counter")s=take(s,{type:"counter",player:q.player,card:null});
  else if(q.kind==="orderPending")s=take(s,{type:"orderPending",player:q.player,index:q.candidates[0]});
  else throw Error(JSON.stringify(q));
 }
 assert.equal(s.outcome,undefined);assert.ok(s.sides[p].zones.battle.includes(source));
 assert.equal(offered,own+theirs>=4);assert.deepEqual(s.cards[source].under,own+theirs>=4&&!decline?[good]:[]);checks++;
}
console.log(`Z-Stack combined energy: ${checks} both-seat stored native boundary/filter/decline/reload cases passed`);
