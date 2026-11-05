/** R430: actual stored delayed/conditional actions and saved outcome controls. */
import assert from "node:assert/strict";
import {card,fifty} from "./harness";
import {skillRecords} from "../../src/lib/arena/draft";
import {rulesFromRows,runtimeSupportOfRow,type RuleRow} from "../../src/lib/arena/rules-store";
import {RULES} from "../../src/lib/arena/vm";
import {rulesetFor} from "../../src/lib/arena/rulesets";
import {moveCard} from "../../src/lib/arena/vm/zones";
import {requireDelayedMovementResults,requireMovementResults} from "../../src/lib/arena/vm/movement-result";
import {NotYet} from "../../src/lib/arena/vm/errors";
import type {Op,ScriptFrame} from "../../src/lib/arena/vm/script";
import {vmHost} from "../../src/lib/arena/vm/host";
import type {Action,CardDef,EngineContext,PlayerId} from "../../src/lib/arena/types";
import type {VmState} from "../../src/lib/arena/vm/state";
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const defs:Record<string,CardDef>={F:card("F",{}),L:card("L",{type:"LEADER",colors:["Red"],traits:["Saiyan"]}),BLACK:card("BLACK",{type:"LEADER",colors:["Black"]}),WRONG:card("WRONG",{type:"LEADER",colors:["Blue"]}),ENERGY:card("ENERGY",{colors:["Blue","Green","Red"]}),BE:card("BE",{colors:["Black"]}),MATERIAL:card("MATERIAL",{colors:["Black"]})};
defs["BT8-033"]=card("BT8-033",{"name": "Android 18, Speedy Substitution", "colors": ["Blue"], "power": 4000, "characters": ["Android 18"], "traits": ["Android"], "skill": "[Auto] When you play this card, look at up to 5 cards from the top of your deck, choose up to 1 blue or green \u226aAndroid\u226b card among them, add it to your hand, then shuffle your deck. <br>[Auto] When you play this card, activate this skill. At the end of the turn, you may choose 1 Blue/Green multicolor card in your energy, and return it to your hand. If you do, choose 1 card in your hand and place it in your energy in Rest Mode.", "type": "BATTLE", "energyCost": 1});
defs["TB3-033"]=card("TB3-033",{"name": "Dream the Future", "colors": ["Blue"], "power": null, "characters": [], "traits": [], "skill": "[Counter: Attack] Negate the attack, and if your Leader Card is a \u226aBardock's Crew\u226b card, you may choose 1 blue card in your hand and place it in your Drop Area. If you do, add this card to your hand.", "type": "EXTRA", "energyCost": 1});
defs["BT10-126"]=card("BT10-126",{"name": "Majin Buu, Wickedness Incarnate", "colors": ["Black"], "power": 20000, "characters": ["Majin Buu"], "traits": ["Majin"], "skill": "[activate: main]{1}, if your Leader Card is black, all of your energy is black, and you send this card from your Drop Area to your Warp: You can't activate the [activate: main] skill on copies of this card for the turn; at the end of the turn, you may choose 1 black card in your hand and discard it. If you do, draw 2 cards.", "type": "BATTLE", "energyCost": 4});
defs["TB1-013"]=card("TB1-013",{"name": "Sister Attack Saiyan Caulifla", "colors": ["Red"], "power": 15000, "characters": ["Caulifla"], "traits": ["Saiyan", "Alien", "Universe 6"], "skill": "[Auto] When you play this card, if your Leader Card is a red \u226aSaiyan\u226b, you may choose 1 card in your life and add it to your hand. If you do so, this card gains +5000 power and [Double Strike] (This card inflicts 2 damage instead of 1 when attacking) for the duration of the turn.", "type": "BATTLE", "energyCost": 3});
defs["EX06-35"]=card("EX06-35",{skill:"[triple attack]<br>[over realm 8] {4}<br>[permanent] Your opponent can’t activate skills unless they choose 1 card in their hand and send it to their Warp."});
const rows=Object.values(defs).flatMap(skillRecords).map((r,id)=>({...r,id,source:"compiler",status:"confirmed"}) as unknown as RuleRow);
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(rows),defs)};const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>RULES.apply(ctx,copy(s),a).state as VmState;
function fresh(first:PlayerId,leader="L"){
 let s=RULES.createGame(ctx,{seed:430,p1:{name:"One",leader:first==="p1"?leader:"L",main:fifty("F")},p2:{name:"Two",leader:first==="p2"?leader:"L",main:fifty("F")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:other(first),redraw:false},{type:"charge",player:first,card:null},{type:"endMain",player:first},{type:"charge",player:other(first),card:null},{type:"endMain",player:other(first)},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);return s;
}
function stage(s:VmState,p:PlayerId,def:string,area:string){const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);return id;}
function advance(s:VmState,done:(s:VmState)=>boolean):VmState{
 for(let n=0;n<60;n++){assert.notEqual(s.outcome?.kind,"interrupted",JSON.stringify(s.outcome));if(done(s))return s;
 const p=s.prompt;if(p.kind==="chooseCards")s=take(s,{type:"choose",player:p.player,cards:p.choice.candidates.slice(0,p.choice.min??0)});
 else {const actions=RULES.legalActions(ctx,s).map(x=>x.action),a=actions.find(a=>a.type==="counter"&&a.card===null)??actions.find(a=>a.type==="orderPending"&&a.index===0)??actions.find(a=>a.type==="chooseMode"&&a.index===0);assert.ok(a,JSON.stringify(p));s=take(s,a);}}
 throw Error("target prompt not reached");
}
let cases=0;
for(const owner of ["p1","p2"] as const)for(const accept of [false,true,"legacy","legacy-reordered"] as const){
 let s=fresh(owner);const energy=stage(s,owner,"ENERGY","energy"),material=stage(s,owner,"MATERIAL","hand"),source=stage(s,owner,"BT8-033","hand");
 const play=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="play"&&a.card===source);assert.ok(play);s=take(s,play);s=advance(s,s=>s.prompt.kind==="main");
 assert.ok(s.sides[owner].zones.energy.includes(energy));assert.ok(s.sides[owner].zones.hand.includes(material));
 if(typeof accept==="string"){
  s=copy(s);const delayed=s.delayed.find(d=>d.card===source)!;assert.ok(delayed);delayed.ops.pop();const move=delayed.ops.at(-1)!;assert.equal(move.op,"moveTo");if(move.op==="moveTo")delete move.completedAs;if(accept==="legacy-reordered"){
   const reorder=(value:unknown):unknown=>Array.isArray(value)?value.map(reorder):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reorder(v)])):value;delayed.ops=reorder(delayed.ops) as Op[];
  }
  s=take(s,{type:"endMain",player:owner});assert.match(JSON.stringify(s.outcome),/rebuild this saved delayed movement/);assert.ok(s.sides[owner].zones.energy.includes(energy));assert.ok(s.sides[owner].zones.hand.includes(material));cases++;continue;
 }
 s=take(s,{type:"endMain",player:owner});s=advance(s,s=>s.prompt.kind==="chooseCards"&&s.prompt.choice.candidates.includes(energy));
 s=take(copy(s),{type:"choose",player:owner,cards:accept?[energy]:[]});
 if(accept){assert.equal(s.prompt.kind,"chooseCards");s=take(copy(s),{type:"choose",player:owner,cards:[material]});assert.ok(s.sides[owner].zones.hand.includes(energy));assert.ok(s.sides[owner].zones.energy.includes(material));assert.equal(s.cards[material].mode,"rest");}
 else {assert.ok(s.sides[owner].zones.energy.includes(energy));assert.ok(s.sides[owner].zones.hand.includes(material));}cases++;
}
for(const owner of ["p1","p2"] as const)for(const leader of ["L","WRONG"])for(const accept of [false,true]){
 let s=fresh(owner,leader);for(let n=0;n<3;n++)stage(s,owner,"ENERGY","energy");const source=stage(s,owner,"TB1-013","hand");
 const play=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="play"&&a.card===source);assert.ok(play);s=take(s,play);s=advance(s,s=>s.prompt.kind==="main"||s.prompt.kind==="chooseCards");
 if(leader==="L"){assert.equal(s.prompt.kind,"chooseCards");if(s.prompt.kind!=="chooseCards")throw Error("Life choice");const life=s.prompt.choice.candidates[0];s=take(copy(s),{type:"choose",player:owner,cards:accept?[life]:[]});}
 else assert.equal(s.prompt.kind,"main");
 const power=vmHost(ctx,game,s,[]).amount({ops:[],ip:0,vars:{},card:source,master:owner},{attr:{sel:{special:"self"}},name:"power"});assert.equal(power,(defs["TB1-013"].power??0)+(leader==="L"&&accept?5000:0));cases++;
}
for(const owner of ["p1","p2"] as const)for(const accept of [false,true]){
 let s=fresh(owner,"BLACK");stage(s,owner,"BE","energy");const material=stage(s,owner,"MATERIAL","hand"),source=stage(s,owner,"BT10-126","drop");
 const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source);assert.ok(action);s=take(s,action);s=advance(s,s=>s.prompt.kind==="main");assert.ok(s.sides[owner].zones.warp.includes(source));
 const before=s.sides[owner].zones.hand.length;s=take(s,{type:"endMain",player:owner});s=advance(s,s=>s.prompt.kind==="chooseCards"&&s.prompt.choice.candidates.includes(material));
 s=take(copy(s),{type:"choose",player:owner,cards:accept?[material]:[]});assert.equal(s.sides[owner].zones.hand.length,before+(accept?1:0));assert.equal(s.sides[owner].zones.drop.includes(material),accept);cases++;
}
// A false resolution condition must not become an activation gate: the actual EX06-35 tax is still offered.
for(const owner of ["p1","p2"] as const)for(const becomeTrue of [false,true]){
 let s=fresh(owner,"WRONG");for(let n=0;n<3;n++)stage(s,owner,"ENERGY","energy");stage(s,other(owner),"EX06-35","battle");const payment=stage(s,owner,"MATERIAL","hand"),source=stage(s,owner,"TB1-013","hand");
 assert.equal(rows.find(r=>r.cardId==="TB1-013")!.cond,null);
 const play=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="play"&&a.card===source);assert.ok(play);s=take(s,play);s=advance(s,s=>s.prompt.kind==="chooseMode");
 if(becomeTrue)s.cards[s.sides[owner].zones.leader[0]].cardId="L";
 s=take(copy(s),{type:"chooseMode",player:owner,index:0});assert.equal(s.prompt.kind,"chooseCards");s=take(copy(s),{type:"choose",player:owner,cards:[payment]});assert.ok(s.sides[owner].zones.warp.includes(payment));
 assert.equal(s.prompt.kind,becomeTrue?"chooseCards":"main");if(becomeTrue)s=take(s,{type:"choose",player:owner,cards:[]});cases++;
}
for(const id of ["BT8-033","BT10-126","TB1-013","TB3-033"]){
 const row=rows.find(r=>r.cardId===id&&r.skillIndex===(id==="BT8-033"?10:0))!;const old=copy(row);
 const undo=(ops:Op[]):boolean=>{for(let i=0;i<ops.length;i++){const op=ops[i],body=op.op==="if"?op.then:op.op==="delay"?op.ops:null;if(!body)continue;const hinge=body.at(-1),move=body.at(-2);if(hinge?.op==="if"&&hinge.cond.kind==="moved"&&move?.op==="moveTo"){delete move.completedAs;hinge.cond={kind:"chose",var:hinge.cond.var};body.pop();ops.splice(i+1,0,hinge);return true;}if(undo(body))return true;}return false;};assert.ok(undo(old.ops as Op[]),id+JSON.stringify(old.ops));
 for(const status of ["draft","confirmed","corrected"] as const){const stale={...old,status};assert.ok(runtimeSupportOfRow(stale).unsupported.some(r=>r.includes("movement completion")));assert.ok(rulesFromRows([stale],defs)[id].bySkill[row.skillIndex].unsupported.length);cases++;}
 const oldTail=(old.ops as Op[]).find(op=>op.op==="if"&&op.cond.kind==="chose");if(oldTail){const frame:ScriptFrame={ops:[oldTail],ip:0,vars:{},card:"source",master:"p1"};assert.throws(()=>requireMovementResults(frame,ctx.scripts![id].bySkill[row.skillIndex]),NotYet);cases++;}
}
const unaffected:ScriptFrame={ops:[{op:"draw",n:1}],ip:0,vars:{},card:"source",master:"p1"};requireDelayedMovementResults(unaffected,Object.values(ctx.scripts!["BT8-033"].bySkill));cases++;
console.log(`cross-body-completion-5: ${cases} native cases passed`);
