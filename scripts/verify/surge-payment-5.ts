/** R-387: native Awaken:Surge pays distinct hand cards before effects and flipping. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const PRINTS = {
  "P-181": "[Awaken: Surge] Choose 1 red card and 1 green card in your hand and place them under this card: You may draw 2 cards, then choose up to 2 of your energy, switch them to Active Mode, and flip this card over.",
  "BT9-100": "[Awaken: Surge] Choose 1 red card and 1 blue card in your hand and place them under this card: You may draw 3 cards, then choose up to 1 of your energy, switch it to Active Mode, and flip this card over.",
  "P-184": "[Awaken: Surge] Choose 1 blue card and 1 yellow card in your hand and place them under this card: You may draw 4 cards and flip this card over.",
  "EX10-03": "[Awaken: Surge] Choose 1 blue card and 1 green card in your hand and place them under this card: You may draw 3 cards, then choose up to 1 of your energy, switch it to Active Mode, and flip this card over.",
  "EX09-03": "[Awaken: Surge] Choose 1 red card and 1 yellow card in your hand and place them under this card: You may draw 3 cards, then choose up to 1 of your energy, switch it to Active Mode, and flip this card over.",
  "BT9-112": "[Awaken: Surge] Choose 1 green card and 1 yellow card from your hand and place them under this card: You may draw 2 cards, then choose up to 2 of your energy, switch them to Active Mode, and flip this card over."
};
const colors:Record<string,["Red"|"Blue"|"Green"|"Yellow","Red"|"Blue"|"Green"|"Yellow"]>={"P-181":["Red","Green"],"BT9-100":["Red","Blue"],"P-184":["Blue","Yellow"],"EX10-03":["Blue","Green"],"EX09-03":["Red","Yellow"],"BT9-112":["Green","Yellow"]};
const defs:Record<string,CardDef>={CB4_LEADER:card("CB4_LEADER",{type:"LEADER"}),CB4_FILLER:card("CB4_FILLER",{}),
 ...Object.fromEntries(Object.entries(PRINTS).flatMap(([id,skill])=>[
 [id,card(id,{type:"LEADER",skill,back:{name:id+" awakened",power:15000,skill:id==="BT9-112"?skill:null}})],
 [id+"A",card(id+"A",{colors:[colors[id][0]]})],[id+"B",card(id+"B",{colors:[colors[id][1]]})],[id+"M",card(id+"M",{colors:colors[id]})],
 ]))};
const records = Object.values(defs).flatMap(d => skillRecords(d));
assert.deepEqual(records.flatMap(r => r.unread), []);
for(const r of records){
 assert.equal(r.cost?.readable,true,r.cardId);assert.deepEqual(runtimeSupportOfRow(r).unsupported,[],r.cardId);
 const rule=copy({kind:r.kind,trigger:r.trigger,cost:r.cost,usage:r.usage,validity:r.validity,cond:r.cond,ops:r.ops}) as Rule;
 assert.equal(validateRule(rule,r.kind),null);const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);
 const plain=(value:unknown)=>JSON.parse(JSON.stringify(value,(key,v)=>key==="upTo"&&v===false?undefined:v));
 assert.deepEqual(plain(parsed.value),plain(rule));
}
for(const cost of ["Choose up to 1 red card and 1 green card in your hand and place them under this card","Choose 1 red card and 1 green card in your opponent's hand and place them under this card","Choose 1 red card and 1 green card in your hand and place them under your opponent's Leader"]){
 assert.equal(skillRecords(card("UNSUPPORTED",{type:"LEADER",skill:`[Awaken: Surge] ${cost}: Draw 2 cards.`}))[0].cost?.readable,false,"bounded price grammar never drops an unsupported qualifier");
}
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
function prepare(owner:PlayerId,id:string){const s=fresh(owner),leader=s.sides[owner].zones.leader[0];s.cards[leader].cardId=id;for(const c of [...s.sides[owner].zones.hand])assert.ok(moveCard(s,game,c,"deck",{owner}).ok);return {s,leader};}
let cases=0;
for(const owner of ["p1","p2"] as const)for(const id of Object.keys(PRINTS))for(const variant of ["pair","two_multi","non_greedy","one_multi","wrong_area","wrong_side","missing","back"]){
 const prepared=prepare(owner,id);let s=prepared.s;const leader=prepared.leader;const foe=other(owner);
 const one=stage(s,owner,id+(variant==="two_multi"||variant==="one_multi"?"M":"A"),"hand");
 const two=variant==="missing"||variant==="one_multi"?null:stage(s,variant==="wrong_side"?foe:owner,id+(variant==="two_multi"||variant==="non_greedy"?"M":"B"),variant==="wrong_area"?"drop":"hand");
 if(variant==="back")s.cards[leader].flipped=true;
 const offered=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===leader);
 const yes=["pair","two_multi","non_greedy"].includes(variant);assert.equal(!!offered,yes,`${id} ${variant}`);
 if(offered){
  const handBefore=s.sides[owner].zones.hand.length;
  s=take(s,offered);
  if(s.prompt.kind!=="main")assert.equal(s.prompt.kind,"chooseCards");
  if(s.prompt.kind==="chooseCards"){assert.equal(s.cards[leader].flipped,false);assert.equal(s.cards[leader].under.length,0);assert.equal(s.sides[owner].zones.hand.length,handBefore,"nothing paid or drawn before both choices");}
  if(variant==="non_greedy"&&s.prompt.kind==="chooseCards")assert.deepEqual((s.prompt as {choice:{candidates:string[]}}).choice.candidates,[one],"first slot preserves sole second-colour payer");
  for(let n=0;n<15&&s.prompt.kind!=="main";n++){
   const actions=RULES.legalActions(ctx,s).map(x=>x.action);const pick=actions.find(a=>a.type==="counter"&&a.card===null)??actions.find(a=>a.type==="choose")??actions[0];assert.ok(pick,JSON.stringify(s.prompt));s=take(s,pick);
  }
  assert.equal(s.cards[leader].flipped,true);assert.deepEqual([...s.cards[leader].under].sort(),[one,two!].sort());
  const draw=id==="P-184"?4:["P-181","BT9-112"].includes(id)?2:3;
  assert.equal(s.sides[owner].zones.hand.length,handBefore-2+draw);
 }
 cases++;
}
for(const owner of ["p1","p2"] as const)for(const failure of ["stale-candidate","host-left","host-returned","chosen-left","forbidden-host"]){
 const prepared=prepare(owner,"P-181");let s=prepared.s;const leader=prepared.leader;
 const red=stage(s,owner,"P-181A","hand"), red2=stage(s,owner,"P-181A","hand");
 const green=stage(s,owner,"P-181B","hand"), green2=stage(s,owner,"P-181B","hand");
 const offer=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===leader)!;assert.ok(offer);s=take(s,offer);assert.equal(s.prompt.kind,"chooseCards");
 if(failure==="stale-candidate"){
  assert.ok(moveCard(s,game,red,"drop",{owner}).ok);
  assert.throws(()=>take(s,{type:"choose",player:owner,cards:[red]}));
 }else{
  s=take(s,{type:"choose",player:owner,cards:[red]});assert.equal(s.prompt.kind,"chooseCards");
  assert.equal(s.cards[leader].under.length,0,"first choice is not yet a payment");
  if(failure==="forbidden-host")addEffect(s,[],{target:leader,kind:"forbid",value:0,until:"game",forbid:{what:"placeUnder",player:owner}});
  else if(failure==="chosen-left")assert.ok(moveCard(s,game,red,"drop",{owner}).ok);
  else {assert.ok(moveCard(s,game,leader,"drop",{owner}).ok);if(failure==="host-returned")assert.ok(moveCard(s,game,leader,"leader",{owner}).ok);}
  const handBefore=s.sides[owner].zones.hand.length;
  s=take(s,{type:"choose",player:owner,cards:[green]});
  assert.equal(s.sides[owner].zones.hand.length,handBefore,"failed payment draws and pays nothing");
 }
 assert.equal(s.cards[leader].flipped,false,`${failure}: unpaid Awaken never flips`);
 assert.equal(s.cards[leader].under.length,0,`${failure}: invalid price takes no cards`);
 assert.ok(s.sides[owner].zones.hand.includes(red2)&&s.sides[owner].zones.hand.includes(green2));cases++;
}
for(const owner of ["p1","p2"] as const){
 const prepared=prepare(owner,"P-181");let s=prepared.s;const leader=prepared.leader;
 const materials=Array.from({length:3},()=>stage(s,owner,"P-181M","hand"));
 const offer=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===leader)!;s=take(s,offer);
 assert.throws(()=>take(s,{type:"choose",player:owner,cards:[]}));
 s=take(s,{type:"choose",player:owner,cards:[materials[0]]});assert.equal(s.prompt.kind,"chooseCards");
 assert.throws(()=>take(s,{type:"choose",player:owner,cards:[materials[0]]}),"the first multicolor card cannot fill the second slot");
 s=take(s,{type:"choose",player:owner,cards:[materials[1]]});
 assert.equal(s.cards[leader].flipped,true);assert.deepEqual([...s.cards[leader].under].sort(),materials.slice(0,2).sort());cases++;
}
for(const owner of ["p1","p2"] as const){
 const foe=other(owner);let s=fresh(foe);s=take(s,{type:"endMain",player:foe});s=take(s,{type:"charge",player:owner,card:null});
 const leader=s.sides[owner].zones.leader[0];s.cards[leader].cardId="P-181";
 for(const c of [...s.sides[owner].zones.hand])assert.ok(moveCard(s,game,c,"deck",{owner}).ok);
 const materials=[stage(s,owner,"P-181A","hand"),stage(s,owner,"P-181B","hand")];
 const attack=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="attack"&&a.attacker===leader);assert.ok(attack);s=take(s,attack);
 for(let n=0;n<4&&s.prompt.kind!=="combo";n++){
  const pass=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="counter"&&a.card===null);assert.ok(pass);s=take(s,pass);
 }
 const offer=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===leader);assert.ok(offer,"Surge is a native Battle activation too");s=take(s,offer);
 assert.equal(s.cards[leader].flipped,true);assert.deepEqual([...s.cards[leader].under].sort(),materials.sort());assert.equal(s.sides[owner].zones.hand.length,2);cases++;
}
console.log(`surge payment 5: ${cases} both-seat native scenarios passed`);
