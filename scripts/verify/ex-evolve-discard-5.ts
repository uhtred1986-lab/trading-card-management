/** R452: a generic EX-Evolve orb followed by its complete printed discard. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { attrsNow, hasKeyword } from "../../src/lib/arena/vm/program";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import { validateRule, parseRule, printRule, deepEqual, type Rule } from "../../src/lib/arena/lang";
import { blocksOf, ruleFromBlocks } from "../../src/lib/arena/lang/blocks";
import type { CostRecord } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
import { runtimeSupportOfRow } from "../../src/lib/arena/rules-store";
import { evolutionBaseProblem } from "../../src/lib/arena/vm/evolution-base";
const printedCards = [
  {
    "id": "TB1-052",
    "type": "BATTLE",
    "colors": [
      "Green"
    ],
    "cost": "8",
    "specified": null,
    "z": null,
    "power": 35000,
    "name": "Son Goku, Hope of Universe 7",
    "characters": [
      "Son Goku"
    ],
    "traits": [
      "Saiyan",
      "Universe 7"
    ],
    "skill": "[EX-Evolve] 1, place 2 ≪Universe 7≫ from your hand in the Drop Area: ≪Universe 7≫ &lt;Son Goku&gt; with an energy cost of 5 or more.<br>[Triple Attack] (Twice per turn, when this card attacks, switch this card to Active Mode after the battle)<br>[Critical]<br>[Auto] When this card attacks, if your Leader Card is green, choose up to 1 card from your opponent's hand or up to 1 of their Battle Cards and place it in the Drop Area.",
    "backName": null,
    "backSkill": null
  },
  {
    "id": "TB1-077",
    "type": "BATTLE",
    "colors": [
      "Yellow"
    ],
    "cost": "7",
    "specified": null,
    "z": null,
    "power": 30000,
    "name": "Frieza, Emperor of Universe 7",
    "characters": [
      "Frieza"
    ],
    "traits": [
      "Frieza Clan",
      "Universe 7"
    ],
    "skill": "[ex-evolve] {1}, place 1 ≪Universe 7≫ from your hand in the Drop Area: ≪Universe 7≫ <Frieza> with an energy cost of 5 or more.<br>[triple strike]<br>[permanent] If your Leader Card is yellow, your opponent's [counter] skills and non-keyword [auto]/[activate] skills cannot be activated unless they place 1 card from their life in their Drop Area.",
    "backName": null,
    "backSkill": null
  },
  {
    "id": "TB1-097",
    "type": "BATTLE",
    "colors": [
      "Green"
    ],
    "cost": "8",
    "specified": null,
    "z": null,
    "power": 45000,
    "name": "Son Goku, The Awakened Power",
    "characters": [
      "Son Goku"
    ],
    "traits": [
      "Saiyan",
      "Universe 7"
    ],
    "skill": "[ex-evolve] {1}, place 1 ≪Universe 7≫ from your hand in the Drop Area: ≪Universe 7≫ <Son Goku> with an energy cost of 6 or more.<br>[ultimate] <br>[victory strike](When you deal life damage by attacking with this card, you win the game)<br>[permanent] This card's attack and skill cannot be negated.",
    "backName": null,
    "backSkill": null
  }
];
const defs: Record<string,CardDef> = {
 L: card("L", {type:"LEADER"}), F:card("F", {colors:["Black"]}),
 U7:card("U7", {traits:["Universe 7"]}),
 COUNTER:card("COUNTER", {type:"EXTRA",energyCost:0,skill:"[Counter: Play] Draw 1 card."}),
 EXTRA7:card("EXTRA7", {type:"EXTRA", traits:["Universe 7"]}),
};
for (const c of printedCards) defs[c.id] = card(c.id, {name:c.name,type:"BATTLE",colors:c.colors as CardDef["colors"],energyCost:Number(c.cost),power:c.power,characters:c.characters,traits:c.traits,skill:c.skill});
for (const [name,character,min] of [["G5","Son Goku",5],["F5","Frieza",5],["G6","Son Goku",6]] as const)
 for (const variant of ["equal","above","low","trait","character","extra"])
  defs[`${name}-${variant}`] = card(`${name}-${variant}`, {characters:[variant==="character"?"Vegeta":character], traits:[variant==="trait"?"Universe 6":"Universe 7"],energyCost:min+(variant==="above"?1:variant==="low"?-1:0),type:variant==="extra"?"EXTRA":"BATTLE",power:10000});
const records=Object.values(defs).flatMap(skillRecords);
for (const id of printedCards.map(c=>c.id)) {
 const r=records.find(r=>r.cardId===id&&r.skillIndex===0)!;
 assert.equal(r.printed,parseSkills(defs[id].skill!)[0].raw,"printed line retained");
 assert.equal(r.cost?.readable,true); assert.deepEqual(r.cost?.orbs,{any:1}); assert.deepEqual(r.unread,[]);
 assert.equal(evolutionBaseProblem(r.cost?.evolution),null);
 const rule:Rule={kind:r.kind,trigger:r.trigger as Rule["trigger"],usage:r.usage as Rule["usage"],validity:r.validity as Rule["validity"],cost:r.cost as CostRecord,cond:r.cond as Rule["cond"],ops:r.ops as Rule["ops"]};
 assert.equal(validateRule(rule,"keyword"),null);
 const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);assert.ok(deepEqual(parsed.value,rule));assert.ok(deepEqual(ruleFromBlocks(blocksOf(rule)),rule));
 for(const bad of [null,{...r.cost!.evolution,version:2},{...r.cost!.evolution,activation:"drop"}])assert.ok(evolutionBaseProblem(bad));
 for (const status of ["draft","confirmed","corrected"]) {
  const stale=JSON.parse(JSON.stringify({...r,source:"compiler",status})) as RuleRow;
  delete (stale.cost as CostRecord).evolution;
  assert.ok(runtimeSupportOfRow(stale).unsupported.some(s=>/EX-Evolve/.test(s)));
  const blocked=rulesFromRows([stale],defs);
  assert.equal(blocked[id].bySkill[0].price?.evolution,undefined,"stale rows never synthesize a base from printed text");
 }
}
for(const input of ["[Activate: Main] 1, draw 1 card: Draw 1 card.","[Evolve] 1, draw 1 card: <Son Goku>.","[EX-Evolve] 1 card: <Son Goku>."])
 assert.ok(!parseSkills(input)[0].cost.includes("{1}"));
const ctx:EngineContext={defs,scripts:rulesFromRows(records.map((r,id)=>({...r,id,source:"compiler",status:"confirmed"}) as unknown as RuleRow),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
// Each action crosses the same serialized context/state boundary as saved matches.
const take=(s:VmState,a:Action)=>RULES.apply(copy(ctx),copy(s),copy(a)).state as VmState;
function fresh(p:PlayerId){let s=RULES.createGame(ctx,{seed:452,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first:p},{type:"mulligan",player:p,redraw:false},{type:"mulligan",player:other(p),redraw:false},{type:"charge",player:p,card:null}] as Action[])s=take(s,a);
 s.sides.p1.attrs.energyMarkers=0;s.sides.p2.attrs.energyMarkers=0;return s;}
function stage(s:VmState,p:PlayerId,id:string,area:string){const cid=s.sides[p].zones.deck.at(-1)!;s.cards[cid].cardId=id;assert.ok(moveCard(s,game,cid,area,{owner:p}).ok);return cid;}
let cases=0;
for(const p of ["p1","p2"] as const)for(const id of printedCards.map(c=>c.id))for(const status of ["draft","confirmed","corrected"]) {
 const s=fresh(p),source=stage(s,p,id,"hand");
 stage(s,p,id==="TB1-077"?"F5-equal":id==="TB1-097"?"G6-equal":"G5-equal","battle");
 stage(s,p,"F","energy");stage(s,p,"U7","hand");stage(s,p,"U7","hand");
 const stale=copy(records).map(r=>({...r,source:"compiler",status}) as unknown as RuleRow);
 delete (stale.find(r=>r.cardId===id&&r.skillIndex===0)!.cost as CostRecord).evolution;
 const old={...ctx,scripts:rulesFromRows(stale,defs)};
 let refused=false;
 try { refused=!RULES.legalActions(old,s).some(l=>l.action.type==="activate"&&l.action.card===source&&l.action.skill===0); }
 catch(error) {assert.match(String(error),/EX-Evolve/);refused=true;}
 assert.equal(refused,true,`${id}/${status}: stale stored base cannot execute`);cases++;
}

for (const p of ["p1","p2"] as const) for (const [id,baseName,n] of [["TB1-052","G5",2],["TB1-077","F5",1],["TB1-097","G6",1]] as const)
 for (const variant of ["normal","above","rest","power","extraPayer","sourcePayer","sourceOnly","shortEnergy","low","trait","character","extra","opponentBase","handBase","dropSource","sourceReentry","baseReentry","missingIdentity","noOtherPayer","wrongPayer","opponentPayer","dropPayer","printedCost"]) {
  let s=fresh(p);
  const source=stage(s,p,id,variant==="dropSource"?"drop":"hand");
  const base=stage(s,variant==="opponentBase"?other(p):p,`${baseName}-${["above","low","trait","character","extra"].includes(variant)?variant:"equal"}`,variant==="handBase"?"hand":"battle");
  if(variant==="rest")s.cards[base].mode="rest";
  if(variant==="power") { addEffect(s,[],{target:base,kind:"power",value:5000,until:"turn",source:base,master:p}); addEffect(s,[],{target:base,kind:"keyword",value:"Barrier",until:"turn",source:base,master:p}); }
  if(variant==="printedCost")addEffect(s,[],{target:base,kind:"cost",value:3,until:"turn",source:base,master:p});
  if(variant==="baseReentry")stage(s,other(p),"COUNTER","hand");
  const energy=variant==="shortEnergy"?null:stage(s,p,"F","energy");
  const payers=Array.from({length:variant==="noOtherPayer"?0:variant==="sourceOnly"?n-1:n+1},()=>stage(s,variant==="opponentPayer"?other(p):p,variant==="wrongPayer"?"F":variant==="extraPayer"?"EXTRA7":"U7",variant==="dropPayer"?"drop":"hand"));
  const action=RULES.legalActions(ctx,s).map(r=>r.action).find(a=>a.type==="activate"&&a.card===source&&a.skill===0);
  const sourceAlone=["noOtherPayer","wrongPayer","opponentPayer","dropPayer"].includes(variant);
  const yes=!(sourceAlone&&n===2)&&!["shortEnergy","low","trait","character","extra","opponentBase","handBase","dropSource"].includes(variant);
  assert.equal(!!action,yes,`${p}/${id}/${variant}`);
  if(!action){assert.throws(()=>take(s,{type:"activate",player:p,card:source,skill:0}));cases++;continue;}
  s=take(s,action);
  const selected=variant==="sourcePayer"||variant==="sourceOnly"||sourceAlone?[source,...payers.slice(0,n-1)]:payers.slice(0,n);
  if(variant==="sourceReentry") { assert.ok(moveCard(s,game,source,"drop",{owner:p}).ok); assert.ok(moveCard(s,game,source,"hand",{owner:p}).ok); }
  if(variant==="missingIdentity") { for(const f of s.programs) if(f.evolutionIdentity)delete f.evolutionSourceEpoch; }
  let changedBase=false;
  for(let i=0;i<30&&s.prompt.kind!=="main"&&!s.outcome;i++){
   const q=s.prompt;
   if(q.kind==="chooseCards") {
    const choices=q.choice.candidates.includes(base)?[base]:selected.filter(c=>q.choice.candidates.includes(c));
    assert.ok(choices.length>=q.choice.min,`${id}/${variant}: selected payment remains offered`);
    s=take(s,{type:"choose",player:q.player,cards:choices.slice(0,q.choice.max)});
   } else if(q.kind==="counter") {
    if(variant==="baseReentry"&&!changedBase){assert.ok(moveCard(s,game,base,"drop",{owner:p}).ok);assert.ok(moveCard(s,game,base,"battle",{owner:p}).ok);changedBase=true;}
    s=take(s,{type:"counter",player:q.player,card:null});
   } else if(q.kind==="payCost")s=take(s,{type:"payCost",player:q.player,option:0});
   else throw Error(JSON.stringify(q));
  }
  if(variant==="missingIdentity"){assert.equal(s.outcome?.kind,"interrupted");cases++;continue;}
  assert.equal(s.outcome,undefined,`${id}/${variant}`);
  const played=!sourceAlone&&!["sourcePayer","sourceOnly","sourceReentry","baseReentry"].includes(variant);
  assert.equal(s.sides[p].zones.battle.includes(source),played,`${id}/${variant} source occurrence`);
  if(played){if(variant==="power")assert.equal(hasKeyword(ctx,game,s,source,"Barrier"),false,"granted Barrier does not carry");assert.deepEqual(s.cards[source].under,[base]);assert.equal(s.cards[source].mode,variant==="rest"?"rest":"active");assert.equal(attrsNow(ctx,game,s,source).power,defs[id].power!+(variant==="power"?5000:0));}
  else {assert.ok(s.sides[p].zones.battle.includes(base));assert.equal(s.cards[source].under.length,0);}
  assert.equal(s.cards[energy!].mode,"rest");
  if(!["sourceReentry","baseReentry"].includes(variant))for(const payer of selected)assert.ok(s.sides[p].zones.drop.includes(payer));
  cases++;
 }
console.log(`EX-Evolve trait discard: ${cases} both-seat stored payment/base/occurrence/reload scenarios passed`);
