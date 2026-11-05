/** R-429: stored P129 offer, native actions, and staged fault controls. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { vmHost } from "../../src/lib/arena/vm/host";
import { stepScript, type ScriptFrame, type Op } from "../../src/lib/arena/vm/script";
import { requireMovementResults } from "../../src/lib/arena/vm/movement-result";
import { NotYet } from "../../src/lib/arena/vm/errors";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { parseRule, printOps, validateRule } from "../../src/lib/arena/lang";
import { programProblem } from "../../src/lib/arena/vm/script-schema";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const defs:Record<string,CardDef>={LEADER:card("LEADER",{type:"LEADER"}),FILLER:card("FILLER",{colors:["Yellow"]}),"P-129":card("P-129",{name:"Secret Desires Zamasu",colors:["Yellow"],energyCost:1,power:4000,characters:["Zamasu"],traits:["God"],skill:"[Auto] When you play this card, draw 1 card. [Auto] When your opponent attacks with a card, you may choose 1 yellow card in your hand and place it in your Drop Area, choose 1 of your yellow energy and switch it to Rest Mode, and place this card in its owner’s Drop Area. If you do, negate the attack."})};
const rows=Object.values(defs).flatMap(skillRecords).map((r,id)=>({...r,id,source:"compiler",status:"confirmed"}) as unknown as RuleRow);
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(rows),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>RULES.apply(ctx,copy(s),a).state as VmState;
function fresh(first:PlayerId):VmState{
 let s=RULES.createGame(ctx,{seed:426,p1:{name:"One",leader:"LEADER",main:fifty("FILLER")},p2:{name:"Two",leader:"LEADER",main:fifty("FILLER")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:other(first),redraw:false},{type:"charge",player:first,card:null},{type:"endMain",player:first},{type:"charge",player:other(first),card:null},{type:"endMain",player:other(first)},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);
 return s;
}

let cases=0;
const record=rows.find(r=>r.cardId==="P-129"&&r.skillIndex===10)!;
assert.ok(record);assert.equal(programProblem(record.ops),null);
assert.ok(JSON.stringify(record.ops).includes('"switched"'));assert.equal(ctx.scripts!["P-129"].bySkill[10].unsupported.length,0);
for(const attacker of ["p1","p2"] as const)for(const variant of ["success","decline","rested","source-returned","legacy-source","legacy-switch","self-same-drop","self-to-hand","self-prohibited","rest-prohibited","energy-returned","no-energy"] as const){
 const owner=other(attacker);let s=fresh(attacker);
 const [source,energy,material,secondEnergy]=s.sides[owner].zones.hand;
 s.cards[source].cardId="P-129";assert.ok(moveCard(s,game,source,"battle",{owner}).ok);assert.ok(moveCard(s,game,energy,"energy",{owner}).ok);assert.ok(moveCard(s,game,secondEnergy,"energy",{owner}).ok);s.cards[energy].mode=variant==="rested"?"rest":"active";
 s=take(s,{type:"attack",player:attacker,attacker:s.sides[attacker].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 for(let i=0;i<20&&s.prompt.kind!=="chooseCards";i++){
  const actions=RULES.legalActions(ctx,s).map(x=>x.action);const next=actions.find(a=>a.type==="counter"&&a.card===null)??actions.find(a=>a.type==="orderPending"&&a.index===0);assert.ok(next,JSON.stringify(s.prompt));s=take(s,next);
 }
 assert.equal(s.prompt.kind,"chooseCards");if(s.prompt.kind!=="chooseCards")throw Error("offer");assert.equal(s.prompt.choice.min,0);assert.equal(s.prompt.choice.max,1);
 s=copy(s);const waiting=s.programs.find(f=>f.card===source)!;assert.ok(waiting.completionSource);
 // Typed effects below are staged fault controls, not printed opposing-card proofs.
 if(variant.startsWith("self-")||variant==="rest-prohibited"){
  const ops:Op[]=variant==="self-prohibited"?[{op:"forbid",what:"beMovedBySkill",side:"you",until:"turn",target:{var:"affected"}}]:variant==="rest-prohibited"?[{op:"forbid",what:"beRestedBySkill",side:"you",until:"turn",target:{var:"affected"}}]:[{op:"replaceLeave",from:["battle"],requestedTo:"drop",to:variant==="self-same-drop"?"drop":"hand",until:"turn",target:{var:"affected"}}];
  assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops,ip:0,vars:{affected:[variant==="rest-prohibited"?energy:source]},card:source,master:owner}),"done");
 }
 if(variant==="no-energy"){assert.ok(moveCard(s,game,energy,"drop",{owner}).ok);assert.ok(moveCard(s,game,secondEnergy,"drop",{owner}).ok);}
 if(variant==="source-returned"){assert.ok(moveCard(s,game,source,"drop",{owner}).ok);assert.ok(moveCard(s,game,source,"battle",{owner}).ok);}
 if(variant==="legacy-source")delete waiting.completionSource;
 if(variant==="legacy-switch")for(const op of waiting.ops)if(op.op==="if")for(const child of op.then)if(child.op==="switchMode")delete child.completedAs;
 s=take(copy(s),{type:"choose",player:owner,cards:variant==="decline"?[]:[material]});
 if(variant.startsWith("legacy")){assert.ok(s.outcome,variant);assert.match(JSON.stringify(s.outcome),/rebuild.*(?:composite source|switch completion)/);assert.ok(s.sides[owner].zones.hand.includes(material));cases++;continue;}
 if(variant==="no-energy"){assert.ok(s.sides[owner].zones.drop.includes(material));assert.ok(s.sides[owner].zones.drop.includes(source));assert.ok(s.battle);cases++;continue;}
 if(variant!=="decline"){
  assert.equal(s.prompt.kind,"chooseCards",JSON.stringify({variant,outcome:s.outcome,programs:s.programs}));if(s.prompt.kind!=="chooseCards")throw Error("energy");assert.equal(s.prompt.choice.min,1);assert.equal(s.prompt.choice.max,1);
  if(variant==="energy-returned"){assert.ok(moveCard(s,game,energy,"drop",{owner}).ok);assert.ok(moveCard(s,game,energy,"energy",{owner}).ok);s.cards[energy].mode="active";}
  s=take(copy(s),{type:"choose",player:owner,cards:[energy]});assert.ok(s.sides[owner].zones.drop.includes(material));assert.equal(s.cards[energy].mode,["rest-prohibited","energy-returned"].includes(variant)?"active":"rest");
  assert.equal(s.sides[owner].zones.drop.includes(source),!["source-returned","self-to-hand","self-prohibited"].includes(variant));
 }
 assert.equal(!!s.battle,variant!=="success",variant);cases++;
}
const old=copy(record);for(const op of old.ops as Op[]){if(op.op==="moveTo")delete op.completedAs;if(op.op==="if"){if(op.cond.kind==="all")op.cond={kind:"chose",var:"c1"};for(const child of op.then)if(child.op==="moveTo"||child.op==="switchMode")delete child.completedAs;}}
for(const status of ["draft","confirmed","corrected"] as const){const stale={...old,status};assert.ok(runtimeSupportOfRow(stale).unsupported.some(reason=>reason.includes("movement completion")));assert.ok(rulesFromRows([stale],defs)["P-129"].bySkill[10].unsupported.length);cases++;}
const legacy:ScriptFrame={ops:copy(old.ops as Op[]),ip:0,vars:{},card:"source",master:"p1"};assert.throws(()=>requireMovementResults(legacy,ctx.scripts!["P-129"].bySkill[10]),e=>e instanceof NotYet&&e instanceof IllegalAction);cases++;
const parsed=parseRule(`WHEN [Activate: Main]\nTHEN\n${printOps(record.ops as Op[])}`);assert.ok(parsed.ok);assert.equal(validateRule(parsed.value,parsed.value.kind),null);assert.equal(printOps(parsed.value.ops),printOps(record.ops as Op[]));cases++;
// An old saved final tail must not use its choice-only hinge after earlier actions.
const tail:ScriptFrame={...legacy,ops:[copy((old.ops as Op[])[3])],ip:0};assert.throws(()=>requireMovementResults(tail,ctx.scripts!["P-129"].bySkill[10]),NotYet);cases++;
for(const owner of ["p1","p2"] as const){
 const state=fresh(owner),ids=state.sides[owner].zones.hand.slice(0,2);for(const id of ids)assert.ok(moveCard(state,game,id,"energy",{owner}).ok);
 const f:ScriptFrame={ops:[{op:"switchMode",target:{var:"pick"},mode:"rest",completedAs:"pick"}],ip:0,vars:{pick:ids},card:state.sides[owner].zones.leader[0],master:owner,switchCandidates:{pick:ids.map(card=>({card,epoch:state.cards[card].zoneEpoch??0}))}};
 assert.throws(()=>stepScript(vmHost(ctx,game,state,[]),f),NotYet);assert.ok(ids.every(id=>state.cards[id].mode==="active"));cases++;
 f.vars.pick=[ids[0]];f.switchCandidates={pick:{} as never};assert.throws(()=>stepScript(vmHost(ctx,game,state,[]),f),NotYet);assert.equal(state.cards[ids[0]].mode,"active");cases++;
}
console.log(`composite-completion-5: ${cases} native controls passed`);
