/** R-388: an implicit Union-Absorb arrival uses the activating Battle Card as its host. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import { describeScript, programProblem } from "../../src/lib/arena/vm/script-schema";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { attrsNow, hasKeyword } from "../../src/lib/arena/vm/program";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { resolvePlay } from "../../src/lib/arena/vm/play";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Op } from "../../src/lib/arena/vm/script";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const PRINTED = "[energy-exhaust]<br>[successor]{g}/{y}<br>[union absorb][limit 1]{g}/{y}, if your Leader Card is an ≪Android≫ card and you have 4 or more energy: You may place up to 1 <Cell> card from your deck or Drop Area under this card. If you do, choose up to 1 {Super 17, Cell Absorbed} or {Super 17, Hell's Storm Unleashed} in your deck or hand, play it with its keyword skills negated for the turn, then shuffle your deck if you looked through it.";
const defs:Record<string,CardDef>={
 CB4_LEADER:card("CB4_LEADER",{type:"LEADER",traits:["Android"]}), CB4_FILLER:card("CB4_FILLER",{colors:["Green"]}),
 WRONG_LEADER:card("WRONG_LEADER",{type:"LEADER",traits:["Saiyan"]}),
 "P-327":card("P-327",{name:"Super 17, Relentless Absorption",characters:["Super 17"],traits:["Android","Machine Mutant"],colors:["Green","Yellow"],power:16000,skill:PRINTED}),
 CELL:card("CELL",{characters:["Cell"]}), WRONG:card("WRONG",{characters:["Gohan"]}),
 ARRIVAL:card("ARRIVAL",{name:"Super 17, Cell Absorbed",power:20000,skill:"[Barrier]<br>[Counter: Attack] Negate the attack.<br>[Permanent] This card gets +5000 power.<br>[Auto] When this card is played, draw 1 card."}),
 STOP:card("STOP",{type:"EXTRA",energyCost:0,skill:"[Counter: Play] The Battle Card being played is placed in its owner's Drop Area instead of being played."}),
};
defs.DEFLECT = card("DEFLECT", { ...defs.ARRIVAL, id: "DEFLECT", skill: "[Deflect]<br>" + defs.ARRIVAL.skill });
defs.PROTECTED = card("PROTECTED", { ...defs.DEFLECT, id: "PROTECTED", skill: defs.DEFLECT.skill + "<br>[Permanent] This card's skills can't be negated in any area." });
defs.KO = card("KO", { type: "EXTRA", energyCost: 0, skill: "[Counter: Play] Choose up to 1 of your opponent's Battle Cards and KO it." });
const entryForms = [
 { id: "ENTRY_KEYWORD", half: "keyword", span: "for the turn", until: "turn" },
 { id: "ENTRY_NONKEYWORD", half: "non-keyword", span: "for the game", until: "game" },
 { id: "ENTRY_NEXT", half: "non-keyword", span: "until the end of your opponent's next turn", until: "nextTurn" },
 { id: "ENTRY_AUTO", half: "[Auto]", span: "for the turn", until: "turn" },
 { id: "ENTRY_STACK", half: "non-keyword", span: "for the turn", until: "turn", stacked: true },
];
for (const form of entryForms) defs[form.id] = card(form.id, { skill: `[Activate: Main] Play up to 1 {Super 17, Cell Absorbed} from your hand${form.stacked ? " on top of this card" : ""} with its ${form.half} skills negated ${form.span}.` });
defs.ENTRY_UNISON = card("ENTRY_UNISON", { skill: "[Activate: Main] Play up to 1 {Entry Unison} from your hand with a marker on it with its [Auto] skills negated for the turn." });
defs.UNISON = card("UNISON", { type: "UNISON", name: "Entry Unison", skill: "[Auto] When this card is played, draw 1 card." });
const records = Object.values(defs).flatMap(d => skillRecords(d));
assert.deepEqual(records.flatMap(r => r.unread), []);
const sourceRecord=records.find(r=>r.cardId==="P-327"&&r.skillIndex===20)!;
assert.deepEqual(sourceRecord.cost?.absorb,{version:1,variant:"Absorb",area:"battle"});
assert.deepEqual(runtimeSupportOfRow(sourceRecord).unsupported,[]);
const deep=(ops:Op[]):Op[]=>ops.flatMap(o=>[o,...(o.op==="if"?deep(o.then):o.op==="may"?deep(o.ops):[])]);
const arrival=deep(sourceRecord.ops).find(o=>o.op==="play");assert.ok(arrival?.op==="play");
assert.deepEqual(arrival.onto,{sel:{special:"self"}});assert.equal(arrival.using,"Union-Absorb");assert.equal(arrival.counterWindow,true);
assert.deepEqual(arrival.negatedKinds,["keyword","counter"]); assert.equal(arrival.negatedUntil,"turn");
const ctx: EngineContext = { defs, scripts: rulesFromRows(copy(records.map((r, id) => ({ ...r, id, source: "compiler", status: "draft" }) as unknown as RuleRow)), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const take = (s: VmState, a: Action) => RULES.apply(ctx, copy(s), a).state as VmState;
function fresh(first: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 404, p1: { name: "First", leader: "CB4_LEADER", main: fifty("CB4_FILLER") }, p2: { name: "Second", leader: "CB4_LEADER", main: fifty("CB4_FILLER") } }).state as VmState;
  for (const a of [{ type: "chooseFirst", player: s.chooser, first }, { type: "mulligan", player: first, redraw: false }, { type: "mulligan", player: other(first), redraw: false }, { type: "charge", player: first, card: null }] as Action[]) s = take(s, a);
  return s;
}
function stage(s: VmState, owner: PlayerId, def: string, area: string): string {
  const id = s.sides[owner].zones.deck.at(-1)!; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner }).ok); s.pending = []; return id;
}
let cases=0;
for(const owner of ["p1","p2"] as const)for(const variant of ["hand","deck","no-material","no-arrival","counter","leader","energy","wrong-cell","opponent-arrival"]){
 let s=fresh(owner);const foe=other(owner);
 if(variant==="leader")s.cards[s.sides[owner].zones.leader[0]].cardId="WRONG_LEADER";
 for(let n=0;n<(variant==="energy"?3:4);n++)stage(s,owner,"CB4_FILLER","energy");
 const source=stage(s,owner,"P-327","battle");s.cards[source].mode="rest";
 addEffect(s,[],{target:source,kind:"power",value:5000,until:"turn"});
 const cell=stage(s,owner,variant==="wrong-cell"?"WRONG":"CELL","drop");
 const target=stage(s,variant==="opponent-arrival"?foe:owner,"ARRIVAL",variant==="deck"?"deck":"hand");
 const counter=variant==="counter"?stage(s,foe,"STOP","hand"):null;
 const beforeHand=s.sides[owner].zones.hand.length;
 const offer=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source&&a.skill===20);
 assert.equal(!!offer,!["leader","energy"].includes(variant),`${variant} native activation gate`);
 if(offer){
  s=take(s,offer);
  for(let n=0;n<30&&s.prompt.kind!=="main";n++){
   let action:Action|undefined;
   if(s.prompt.kind==="chooseCards"){
    const cands=(s.prompt as {choice:{candidates:string[]}}).choice.candidates;
    const pick=cands.includes(cell)&&variant!=="no-material"?cell:cands.includes(target)&&variant!=="no-arrival"?target:null;
    action={type:"choose",player:owner,cards:pick?[pick]:[]};
   }else {
    const actions=RULES.legalActions(ctx,s).map(x=>x.action);
    action=actions.find(a=>a.type==="counter"&&counter!==null&&a.card===counter)??actions.find(a=>a.type==="counter"&&a.card===null)??actions.find(a=>a.type==="orderPending"&&!a.decline)??actions[0];
   }
   assert.ok(action,JSON.stringify(s.prompt));s=take(s,action);
  }
  const plays=["hand","deck"].includes(variant);
  if(plays){
   assert.ok(s.sides[owner].zones.battle.includes(target));assert.ok(!s.sides[owner].zones.battle.includes(source));
   assert.deepEqual([...s.cards[target].under].sort(),[source,cell].sort(),"arrival carries source and absorbed Cell");
   assert.equal(s.cards[target].mode,"rest");assert.equal(attrsNow(ctx,game,s,target).power,30000,"source modifier and arrival Permanent both survive");
   assert.equal(hasKeyword(ctx,game,s,target,"Barrier"),false,"only the keyword/counter kinds are negated");
   assert.equal(s.sides[owner].zones.hand.length,beforeHand+(variant==="deck"?1:0),"played Auto still draws after keyword negation");
  }else{
   assert.ok(s.sides[owner].zones.battle.includes(source));assert.ok(!s.sides[owner].zones.battle.includes(target));
   if(variant==="counter"){assert.ok(s.sides[owner].zones.drop.includes(target),"failed Absorb arrival goes to Drop");assert.ok(!s.effects.some(e=>e.target===target&&e.kind==="negateSkillKind"),"failed entry creates no negation");}
   assert.equal(s.cards[source].under.includes(cell),!["no-material","wrong-cell"].includes(variant));
  }
 }
 cases++;
}
// Native stored entry forms: the target's Auto must see its entry characteristics.
for (const owner of ["p1", "p2"] as const) for (const form of entryForms) for (const protectedCard of [false, true]) {
 let s = fresh(owner); const source = stage(s, owner, form.id, "battle");
 const target = stage(s, owner, protectedCard ? "PROTECTED" : "DEFLECT", "hand");
 const beforeHand = s.sides[owner].zones.hand.length;
 const offer = RULES.legalActions(ctx, s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source); assert.ok(offer);
 s=take(s,offer);
 for(let n=0;n<30&&s.prompt.kind!=="main";n++) {
  const actions=RULES.legalActions(ctx,s).map(x=>x.action);
  const action:Action|undefined=s.prompt.kind==="chooseCards"?{type:"choose",player:owner,cards:[target]}:actions.find(a=>a.type==="counter"&&a.card===null)??actions.find(a=>a.type==="orderPending"&&!a.decline)??actions[0];
  assert.ok(action);s=take(s,action);
 }
 assert.ok(s.sides[owner].zones.battle.includes(target),form.id);
 const autoLive=protectedCard||form.half==="keyword";
 assert.equal(s.sides[owner].zones.hand.length,beforeHand-1+(autoLive?1:0),`${owner}/${form.id}: entry-time Auto eligibility`);
 assert.equal(hasKeyword(ctx,game,s,target,"Deflect"),protectedCard||form.half!=="keyword");
 assert.equal(attrsNow(ctx,game,s,target).power,protectedCard||form.half==="keyword"||form.half==="[Auto]"?25000:20000);
 const negations=s.effects.filter(e=>e.target===target&&e.kind==="negateSkillKind");
 assert.equal(negations.length,protectedCard?0:form.half==="keyword"?2:form.half==="[Auto]"?1:3);
 for(const e of negations){assert.equal(e.until,form.until);assert.equal(e.source,source);assert.equal(e.master,owner);}
 if(form.stacked)assert.ok(s.cards[target].under.includes(source));
 cases++;
}
// Deflect stays active before entry; its keyword-only entry negation is visible to the landed counter.
for(const owner of ["p1","p2"] as const)for(const answer of [false,true]){
 let s=fresh(owner);const foe=other(owner);
 for(let n=0;n<4;n++)stage(s,owner,"CB4_FILLER","energy");
 const source=stage(s,owner,"P-327","battle"),cell=stage(s,owner,"CELL","drop"),target=stage(s,owner,"DEFLECT","hand"),counter=stage(s,foe,"KO","hand");
 const offer=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source&&a.skill===20);assert.ok(offer);
 s=take(s,offer);let landed=false;
 for(let n=0;n<40&&s.prompt.kind!=="main";n++){
  let action:Action|undefined;
  if(s.prompt.kind==="chooseCards"){
   const cands=(s.prompt as {choice:{candidates:string[]}}).choice.candidates;
   const choosingFoe=s.sides[owner].zones.battle.includes(target);
   action={type:"choose",player:choosingFoe?foe:owner,cards:[cands.includes(cell)&&!choosingFoe?cell:target]};
  }else{
   const actions=RULES.legalActions(ctx,s).map(x=>x.action);
   if(s.resolving?.landed){landed=true;assert.equal(hasKeyword(ctx,game,s,target,"Deflect"),false);assert.ok(s.pending.some(p=>p.card===target),"keyword negation preserves already triggered on-play Auto");}
   else if(s.resolving?.card===target)assert.equal(hasKeyword(ctx,game,s,target,"Deflect"),true,"preentry Deflect remains");
   action=actions.find(a=>answer&&s.resolving?.landed&&a.type==="counter"&&a.card===counter)??actions.find(a=>a.type==="counter"&&a.card===null)??actions.find(a=>a.type==="orderPending"&&!a.decline)??actions[0];
  }
  assert.ok(action,JSON.stringify(s.prompt));s=take(s,action);
 }
 assert.ok(landed,"entry negation is installed before the landed counter window");
 assert.equal(s.sides[owner].zones.drop.includes(target),answer);cases++;
}
for(const owner of ["p1","p2"] as const){
 let s=fresh(owner);const source=stage(s,owner,"ENTRY_UNISON","battle"),target=stage(s,owner,"UNISON","hand");const hand=s.sides[owner].zones.hand.length;
 const offer=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source);assert.ok(offer);s=take(s,offer);
 assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:owner,cards:[target]});
 assert.equal(s.prompt.kind,"main");assert.ok(s.sides[owner].zones.unison.includes(target));assert.equal(s.cards[target].markers,1);assert.equal(s.sides[owner].zones.hand.length,hand-1,"Unison on-play Auto suppressed at entry");cases++;
}
// Inspect the actual movement checkpoint, before the scheduler can discard negated pending Autos.
for(const owner of ["p1","p2"] as const)for(const negateAuto of [false,true]){
 const s=fresh(owner),source=stage(s,owner,"ENTRY_AUTO","battle"),target=stage(s,owner,"DEFLECT","hand");
 assert.ok(resolvePlay(ctx,game,s,[],target,owner,{negatedKinds:negateAuto?["auto"]:["keyword","counter"],negatedUntil:"turn",negatedBy:{player:owner,source}}));
 assert.equal(s.pending.some(p=>p.card===target),!negateAuto,"entry negation precedes trigger eligibility, not merely Auto resolution");cases++;
}
assert.match(describeScript([{op:"play",target:{sel:{special:"self"}},onto:{sel:{special:"self"}},using:"Evolve",negatedKinds:["auto"],negatedUntil:"battle"}]),/auto.*skills negated.*battle/i);
for(const r of records){
 const rule=copy({kind:r.kind,trigger:r.trigger,cost:r.cost,usage:r.usage,validity:r.validity,cond:r.cond,ops:r.ops}) as Rule;
 assert.equal(validateRule(rule,r.kind),null);const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);const plain=(value:unknown)=>JSON.parse(JSON.stringify(value,(key,v)=>key==="upTo"&&v===false?undefined:v&&typeof v==="object"&&Array.isArray(v.areas)?{...v,area:undefined}:v));assert.deepEqual(plain(parsed.value),plain(rule));
}
for(const text of [
 "[Union-Absorb] At the end of the turn, play up to 1 {Arrival} from your hand.",
 "[Union-Absorb] Play up to 1 {Arrival} from your hand, then play up to 1 {Second} from your deck.",
]){
 const r=skillRecords(card("ABSORB_GUARD",{skill:text}))[0];
 const walk=(value:unknown):void=>{if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==="object"){const o=value as Record<string,unknown>;if(o.op==="play"){assert.equal(o.onto,undefined);assert.equal(o.using,undefined);}Object.values(o).forEach(walk);}};
 walk(r.ops);
}
for(const until of ["battle","turn","game","nextTurn"] as const){
 const rule:Rule={kind:"activate:main",trigger:[],cost:null,cond:null,ops:[{op:"play",target:{sel:{special:"self"}},negatedKinds:["auto"],negatedUntil:until}]};
 const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);assert.deepEqual(parsed.value,rule);
}
for(const bad of [
 {negatedKinds:[],negatedUntil:"turn"},{negatedKinds:["keyword"]},{negatedUntil:"turn"},
 {negatedKinds:["bogus"],negatedUntil:"turn"},{negatedKinds:["keyword"],negatedUntil:"bogus"},
 {negatedKinds:["keyword"],negatedUntil:"turn",negated:"turn"}
]) assert.ok(programProblem([{op:"play",target:{sel:{special:"self"}},...bad}]));
console.log(`implicit Absorb 5: ${cases} stored and native both-seat scenarios passed`);
