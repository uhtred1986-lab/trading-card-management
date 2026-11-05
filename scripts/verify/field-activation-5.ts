/** R457/R469: native stored Field activation, rule staging and cleanup. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { vmHost } from "../../src/lib/arena/vm/host";
import { run } from "../../src/lib/arena/vm/flow";
import { emptyFilter } from "../../src/lib/arena/text/filters";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const defs: Record<string, CardDef> = {
 L: card("L", { type: "LEADER", colors: ["Green"], characters: ["King Cold: Br"] }),
 TAX: card("TAX", { skill: "[Permanent] Your opponent can’t activate skills unless they choose 1 card in their hand and send it to their Warp." }),
 PROTECTOR: card("PROTECTOR", { type: "EXTRA", skill: "[Field]<br>[Permanent] If this card would leave the Battle Area, you may send it to your Warp instead." }),
 PROTECTED: card("PROTECTED", { type: "EXTRA", name: "Protected Field", skill: "[Field]" }),
 WATCHER: card("WATCHER", { type: "EXTRA", skill: "[Field]<br>[Auto] When a player places a [Field] Extra Card in a Battle Area, draw 1 card." }),
 COUNTER: card("COUNTER", { type: "EXTRA", energyCost: 0, skill: "[Counter: Play] Draw 1 card." }),
 COUPON: card("COUPON", { skill: "[Activate: Main] During this turn, the next time you activate the [Activate: Main] skill on a blue Extra with an energy cost of 2 from your hand, reduce the energy cost by {u}." }),
 F: card("F", { colors: ["Green"] }),
 M: card("M", { colors: ["Green", "Red"] }), N: card("N", { colors: ["Green", "Blue"] }),
 R: card("R", { colors: ["Red"] }), B: card("B", { colors: ["Blue"] }),
};
defs["BT13-084"] = card("BT13-084", {"type": "EXTRA", "colors": ["Green"], "name": "King Cold's Dynasty", "characters": [], "traits": [], "skill": "[Barrier][Field]<br>[Permanent] If your Leader Card is a green &lt;King Cold: Br&gt; card, you can place any number of mono-green Extra Cards with the [Field] skill in your Battle Area, and your mono-green Extra Cards with an original energy cost of 2 and the [Field] skill don't cause any of your other Extra Cards with the [Field] skill to be placed in their owners' Drop Areas.<br>[Permanent] You can't activate Extra Cards with the [Field] skill that are copies of Extra Cards with the [Field] skill in your Battle Area.", "energyCost": 6});
defs["BT29-041"] = card("BT29-041", {"type": "EXTRA", "colors": ["Blue"], "name": "Fearsome Conquest", "characters": [], "traits": [], "skill": "[Field] If your Leader is a blue <Cooler> card :\n[Permanent] The [Field] skill on this card in your hand can also be activated at [Activate: Battle] timings.\n[Auto] When this card is placed in a Battle Area, choose up to 1 of your opponent's Battle Cards and it can't activate skills while this card is in a Battle Area.", "energyCost": 0});
defs["BT29-042"] = card("BT29-042", {"type": "EXTRA", "colors": ["Blue"], "name": "Loyalty to Cooler", "characters": [], "traits": [], "skill": "[Field] If your Leader is a blue <Cooler> card :\n[Permanent] The [Field] skill on this card in your hand can also be activated at [Activate: Battle] timings.\n[Auto] When this card is placed in a Battle Area, choose up to 1 of your blue <Cooler> or \u226aCooler's Armored Squadron\u226b Battle Cards and it gains [Barrier] while this card is in a Battle Area.", "energyCost": 0});
defs["BT13-086"] = card("BT13-086", {"type": "EXTRA", "colors": ["Green"], "name": "Anticipated Onslaught", "characters": [], "traits": [], "skill": "[Field]<br>[Auto] If your Leader Card is a green &lt;King Cold: Br&gt; card: When this card is placed in a Battle Area, draw 1 card, then choose up to 1 mono-green \u226aFrieza Clan\u226b or \u226aFrieza's Army\u226b card with an energy cost of 2 or less in your hand and play it.<br>[Auto][Once per turn] When a green Extra Card with the [Field] skill in your Battle Area other than this card is placed in its owner's Drop Area by one of your skills, choose up to 1 of your opponent's Battle Cards with an energy cost of 2 or less and KO it.", "energyCost": 2});
defs["BT27-119"] = card("BT27-119", {"type": "EXTRA", "colors": ["Red", "Blue"], "name": "Universe", "characters": [], "traits": [], "skill": "[Energy-Exhaust]\n[br]\n[Field][Limit 1] Draw 1 card:\n[br]\n[Permanent] Your \u226aGod\u226b Battle Cards with an [Invoker] skill get +5000 power.", "energyCost": 2, "specifiedCost": {"Red": 1, "Blue": 1}});
defs["BT1-081"] = card("BT1-081", {"type": "EXTRA", "colors": ["Green"], "name": "Broly's Ring", "characters": [], "traits": [], "skill": "[Field] (Place and activate this card in the Battle Area. It remains in the Battle Area until you activate another [Field]. When you do, place this card in the Drop Area)[Permanent] Your hand is not affected by your  Leader Card Broly's skill.", "energyCost": 1});
defs["BT27-120"] = card("BT27-120", {"type": "EXTRA", "colors": ["Red", "Blue"], "name": "Future", "characters": [], "traits": [], "skill": "[Energy-Exhaust]\n[br]\n[Field][Limit 1] Draw 1 card: \n[br]\n[Activate: Main][Once per turn] If you have a blue \u226aGod\u226b card in play: Choose up to 1 of your opponent's Battle Cards with an energy cost of 7 or less and return it to its owner's hand.", "energyCost": 2, "specifiedCost": {"Red": 1, "Blue": 1}});
for (const id of ["BT27-119", "BT29-041"]) for (const origin of ["hand", "drop", "deck"]) {
 defs[`INVOKE_${id}_${origin}`] = card(`INVOKE_${id}_${origin}`, { skill: `[Activate: Main] Choose up to 1 {${defs[id].name}} from your ${origin}, activate it.` });
}
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const rows = Object.values(defs).flatMap(skillRecords);
// Typed replacement protocol: the old protector's live Permanent disappears
// when it leaves, so mandatory cleanup order changes the other Field's route.
const replacementRow = rows.find(row => row.cardId === "PROTECTOR" && row.kind === "permanent")!;
assert.ok(replacementRow);
replacementRow.ops = [{ op: "replaceLeave", to: "hand", requestedTo: "drop", optional: true, target: { sel: { side: "you", area: "battle", filter: { ...emptyFilter(), names: ["Protected Field"] } } } }];

const ctx: EngineContext = { defs, scripts: rulesFromRows(copy(rows.map(row => ({ ...row, source: "compiler", status: "confirmed" }))) as RuleRow[], defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
function fresh(p: PlayerId) {
 let state = RULES.createGame(ctx, { seed: 457, p1: { name: "One", leader: "L", main: fifty("F") }, p2: { name: "Two", leader: "L", main: fifty("F") } }).state as VmState;
 const events: GameEvent[] = [];
 const take = (action: Action) => { const result = RULES.apply(ctx, copy(state), action); state = result.state as VmState; events.push(...result.events); };
 for (const action of [{type:"chooseFirst",player:state.chooser,first:p},{type:"mulligan",player:p,redraw:false},{type:"mulligan",player:other(p),redraw:false},{type:"charge",player:p,card:null}] as Action[]) take(action);
 state.sides.p1.attrs.energyMarkers = 0; state.sides.p2.attrs.energyMarkers = 0;
 const put = (definition: string, area: string, holder = p) => { const id = state.sides[holder].zones.deck.at(-1)!; state.cards[id].cardId = definition; assert.ok(moveCard(state, game, id, area, {owner:holder}).ok); return id; };
 const offer = (id: string) => RULES.legalActions(ctx, state).find(row => row.action.type === "activate" && row.action.card === id)?.action;
 return { get state() { return state; }, set state(value: VmState) { state = value; }, take, put, offer, events };
}
let cases = 0;
for (const p of ["p1", "p2"] as const) {
 for (const id of ["BT27-119", "BT27-120"]) {
  const h = fresh(p), source = h.put(id, "hand"); h.put("R", "energy"); h.put("B", "energy"); h.put("COUNTER","hand",other(p));
  const before = h.state.sides[p].zones.hand.length, deck = h.state.sides[p].zones.deck.length;
  const action = h.offer(source); assert.ok(action, `${id} offered`); h.events.length = 0; h.take(action);
  assert.ok(h.state.sides[p].zones.battle.includes(source));
  assert.equal(h.state.sides[p].zones.hand.length, before); assert.equal(h.state.sides[p].zones.deck.length, deck - 1);
  assert.deepEqual(h.events.filter(event => event.type === "move" && event.card === source).map(event => event.type === "move" && event.to), ["drop", "battle"]);
  assert.equal(h.state.prompt?.kind, "main");
  const second = h.put(id, "hand"); assert.equal(h.offer(second), undefined, "Limit1 consumed only on activation"); cases++;
 }
 {
  const h = fresh(p), source = h.put("BT27-119", "hand"); const energy = [h.put("R", "energy"), h.put("B", "energy")];
  for (const id of [...h.state.sides[p].zones.deck]) moveCard(h.state, game, id, "warp", {owner:p});
  assert.equal(h.offer(source), undefined, "empty deck cannot pay draw");
  assert.ok(energy.every(id => h.state.cards[id].mode === "active")); assert.ok(h.state.sides[p].zones.hand.includes(source)); cases++;
 }
 {
  const h = fresh(p), old = [h.put("BT1-081", "battle"), h.put("BT1-081", "battle")], source = h.put("BT1-081", "hand"); h.put("F", "energy");
  const action = h.offer(source); assert.ok(action); h.events.length = 0; h.take(action);
  assert.equal(h.state.prompt?.kind, "chooseMode");
  assert.ok(old.every(id => h.state.sides[p].zones.battle.includes(id)), "order chosen before any cleanup move");
  h.state = copy(h.state); h.take({type:"chooseMode",player:p,index:1});
  assert.deepEqual(h.events.filter(event => event.type === "move" && old.includes(event.card)).map(event => event.type === "move" && event.card), [old[1],old[0]]);
  assert.ok(old.every(id => h.state.sides[p].zones.drop.includes(id))); assert.ok(h.state.sides[p].zones.battle.includes(source)); cases++;
 }
 for (const accepted of [false, true]) {
  const h = fresh(p), old = h.put("BT1-081", "battle"), source = h.put("BT1-081", "hand"); h.put("F", "energy");
  addEffect(h.state, [], { target: old, kind: "replaceLeave", value: { to: "hand", optional: true, target: { special: "self" } }, until: "turn", source: old, master: p });
  const action = h.offer(source); assert.ok(action); h.take(action); assert.equal(h.state.prompt?.kind, "replaceMove");
  h.state = copy(h.state); h.take({type:"chooseMode",player:p,index:accepted ? 0 : 1});
  assert.ok(h.state.sides[p].zones[accepted ? "hand" : "drop"].includes(old)); assert.ok(h.state.sides[p].zones.battle.includes(source)); cases++;
 }
 for (const damage of ["line", "skill", "ops", "choices", "requestedEnergy"] as const) {
  const h = fresh(p), source = h.put("BT1-081", "hand"), energy = [h.put("M", "energy"), h.put("N", "energy")];
  const action = h.offer(source); assert.ok(action); h.take(action); assert.equal(h.state.prompt?.kind,"chooseMode");
  h.state = copy(h.state); const frame = h.state.programs.find(item => item.fieldCost)!; assert.ok(frame);
  if (damage === "line") delete (frame.fieldCost as unknown as Record<string, unknown>).line;
  else if(damage === "skill") delete (frame.fieldCost!.line as unknown as Record<string, unknown>).skill;
  else if(damage === "ops") delete (frame as unknown as Record<string, unknown>).ops;
  else (frame.fieldCost as unknown as Record<string, unknown>)[damage] = {};
  h.take({type:"chooseMode",player:p,index:0});
  assert.equal(h.state.outcome?.kind,"interrupted"); assert.ok(h.state.sides[p].zones.hand.includes(source)); assert.ok(energy.every(id=>h.state.cards[id].mode==="active")); cases++;
 }
 {
  const h = fresh(p), old = [h.put("BT1-081","battle"),h.put("BT1-081","battle")], source = h.put("BT1-081","hand"); h.put("F","energy");
  const action=h.offer(source);assert.ok(action);h.take(action);
  h.state=copy(h.state);const frame=h.state.programs.find(item=>item.fieldCleanup)!;assert.ok(frame);
  frame.fieldCleanup!.order=[...old];delete frame.fieldCleanup!.ordering;delete frame.awaiting;frame.ops=[];frame.ip=1;
  h.take({type:"chooseMode",player:p,index:0});assert.equal(h.state.outcome?.kind,"interrupted");assert.ok(old.every(id=>h.state.sides[p].zones.battle.includes(id)));cases++;
 }
 for (const id of ["BT13-086", "BT1-081"]) {
  const h=fresh(p), dynasty=h.put("BT13-084","battle"), source=h.put(id,"hand");h.put("F","energy");h.put("F","energy");
  const action=h.offer(source);assert.ok(action);h.take(action);
  assert.ok(h.state.sides[p].zones.battle.includes(source));assert.equal(h.state.sides[p].zones.battle.includes(dynasty),id==="BT13-086");cases++;
 }
 for (const pay of [false,true]) {
  const h=fresh(p), source=h.put("BT27-119","hand");h.put("R","energy");h.put("B","energy");
  const issuer=h.put("COUPON","battle");h.take({type:"activate",player:p,card:issuer,skill:0});assert.ok(h.state.effects.some(effect=>effect.energyActivation));
  h.put("TAX","battle",other(p));
  for(const id of [...h.state.sides[p].zones.hand])if(id!==source)moveCard(h.state,game,id,"warp",{owner:p});
  addEffect(h.state,[],{target:"",kind:"forbid",value:0,until:"turn",forbid:{what:"activateSkill",player:p,filter:{...emptyFilter(),type:"EXTRA"},uses:1}});
  const deck=h.state.sides[p].zones.deck.length, action=h.offer(source);assert.ok(action,"draw supplies the otherwise unavailable tax payer");h.take(action);
  assert.equal(h.state.sides[p].zones.deck.length,deck-1);assert.ok(h.state.sides[p].zones.drop.includes(source));assert.equal(h.state.prompt?.kind,"chooseMode");
  h.state=copy(h.state);h.take({type:"chooseMode",player:p,index:pay?0:1});
  if(pay && h.state.prompt?.kind === "chooseCards") h.take({type:"choose",player:p,cards:[h.state.sides[p].zones.hand[0]]});
  assert.equal(h.state.effects.find(effect=>effect.forbid?.uses!==undefined)?.forbid?.uses,pay?0:1,"failed/declined tax preserves activation budget");
  assert.equal(h.state.sides[p].zones.battle.includes(source),pay);assert.equal(h.state.sides[p].zones.hand.length,pay?0:1);
  assert.equal(h.state.sides[p].zones.energy.filter(id=>h.state.cards[id].mode==="rest").length,1,"scoped blue coupon discounts original card-energy payment");
  assert.equal(h.state.effects.some(effect=>effect.energyActivation),!pay,"failed tax preserves captured coupon; successful activation consumes it after leaving hand");
  for(const id of h.state.sides[p].zones.energy)h.state.cards[id].mode="active";
  const second=h.put("BT27-119","hand");assert.equal(!!h.offer(second),!pay,"only successful activation spends Limit1");cases++;
 }
 for (const id of ["BT27-119", "BT29-041"]) for (const origin of ["hand", "drop", "deck"]) {
  const h=fresh(p), invoker=h.put(`INVOKE_${id}_${origin}`,"battle"), source=h.put(id,origin);
  const survivor=h.state.sides[p].zones.deck.find(card=>card!==source)!;
  for(const card of [...h.state.sides[p].zones.deck])if(card!==source && card!==survivor)moveCard(h.state,game,card,"warp",{owner:p});
  h.take({type:"activate",player:p,card:invoker,skill:0});
  for(let i=0;i<10 && h.state.prompt?.kind!=="main";i++) {
   const answers=RULES.legalActions(ctx,h.state).map(row=>row.action);
   const answer=answers.find(a=>a.type==="choose" && a.cards.includes(source))??answers.find(a=>a.type==="choose" && a.cards.length===0)??answers.find(a=>a.type==="chooseMode" && a.index===0);
   assert.ok(answer,JSON.stringify(h.state.prompt));h.take(answer);
  }
  assert.notEqual(h.state.outcome?.kind,"interrupted",JSON.stringify(h.state.outcome));
  assert.equal(h.state.sides[p].zones.battle.includes(source),id==="BT27-119","waiver retains Leader condition but waives Draw1");
  assert.ok(h.state.sides[p].zones.deck.includes(survivor),"waived printed Draw1 is not performed");
  if(id==="BT29-041")assert.ok(h.state.sides[p].zones[origin].includes(source));cases++;
 }
 for(const protectedFirst of [false,true]) {
  const h=fresh(p), protector=h.put("PROTECTOR","battle"), protectedCard=h.put("PROTECTED","battle"), source=h.put("BT1-081","hand");h.put("F","energy");
  const action=h.offer(source);assert.ok(action);h.take(action);assert.equal(h.state.prompt?.kind,"chooseMode");
  h.state=copy(h.state);h.take({type:"chooseMode",player:p,index:protectedFirst?1:0});
  if(protectedFirst){assert.equal(h.state.prompt?.kind,"replaceMove");h.state=copy(h.state);h.take({type:"chooseMode",player:p,index:0});}
  assert.ok(h.state.sides[p].zones.drop.includes(protector));assert.ok(h.state.sides[p].zones[protectedFirst?"hand":"drop"].includes(protectedCard));cases++;
 }
 {
  const h=fresh(p), watcher=h.put("WATCHER","battle"), source=h.put("BT1-081","hand");h.put("F","energy");
  const before=h.state.sides[p].zones.hand.length, action=h.offer(source);assert.ok(action);h.take(action);
  assert.ok(h.state.sides[p].zones.drop.includes(watcher));assert.equal(h.state.sides[p].zones.hand.length,before,"arrival Auto pends before its old Field source leaves");cases++;
 }
 for(const route of ["sameBattle","underToBattle","battleToUnder","controllerChange"] as const) {
  const h=fresh(p), old=h.put("BT1-081","battle"), source=h.put("BT1-081",route==="controllerChange"?"battle":"hand",route==="controllerChange"?other(p):p), holder=h.put("F","battle");
  if(route==="sameBattle"||route==="battleToUnder")moveCard(h.state,game,source,"battle",{owner:p});
  if(route==="underToBattle")moveCard(h.state,game,source,"battle",{owner:p,under:holder});
  const host=vmHost(ctx,game,h.state,h.events);
  if(route==="battleToUnder")assert.ok(host.placeUnder(source,holder));
  else host.move(source,"battle",p,{reason:"rule"});
  run(ctx,game,h.state,h.events);
  assert.equal(h.state.sides[p].zones.drop.includes(old),route==="underToBattle"||route==="controllerChange",route);cases++;
 }
 for(const result of ["decline","accept","sourceABA"] as const) {
  const h=fresh(p), source=h.put("BT27-119","hand"), energy=[h.put("R","energy"),h.put("B","energy")], before=h.state.sides[p].zones.deck.length;
  addEffect(h.state,[],{target:source,kind:"replaceLeave",value:{to:"warp",optional:true,target:{special:"self"}},until:"turn",source,master:p});
  const action=h.offer(source);assert.ok(action);h.take(action);assert.equal(h.state.prompt?.kind,"replaceMove");
  if(result==="sourceABA"){moveCard(h.state,game,source,"drop",{owner:p});moveCard(h.state,game,source,"hand",{owner:p});}
  h.state=copy(h.state);h.take({type:"chooseMode",player:p,index:result==="accept"?0:1});
  assert.ok(h.state.sides[p].zones[result==="accept"?"warp":result==="sourceABA"?"hand":"battle"].includes(source));
  assert.equal(h.state.sides[p].zones.deck.length,before-(result==="decline"?1:0));assert.ok(energy.every(id=>h.state.cards[id].mode==="rest"));cases++;
 }
 {
  const h=fresh(p), old=[h.put("BT1-081","battle"),h.put("BT1-081","battle")], source=h.put("BT1-081","hand");h.put("F","energy");
  const action=h.offer(source);assert.ok(action);h.take(action);assert.equal(h.state.prompt?.kind,"chooseMode");
  moveCard(h.state,game,old[0],"drop",{owner:p});moveCard(h.state,game,old[0],"battle",{owner:p});
  h.state=copy(h.state);h.take({type:"chooseMode",player:p,index:0});
  assert.ok(h.state.sides[p].zones.battle.includes(old[0]),"fresh occurrence is not substituted for captured old Field");assert.ok(h.state.sides[p].zones.drop.includes(old[1]));cases++;
 }
 for(const negated of [false,true]) {
  const h=fresh(p), dynasty=h.put("BT13-084","battle"), old=h.put("BT1-081","battle"), source=h.put("BT1-081","hand");h.put("F","energy");
  if(negated)addEffect(h.state,[],{target:old,kind:"negateSkillKind",value:"keyword",until:"game"});
  const action=h.offer(source);assert.equal(!!action,negated,"live duplicate restriction references effective Field");
  if(action){h.take(action);assert.equal(h.state.prompt?.kind,"chooseMode");h.take({type:"chooseMode",player:p,index:0});assert.ok([old,dynasty].every(id=>h.state.sides[p].zones.drop.includes(id)),"negated printed Field still participates in rule cleanup");}cases++;
 }
 {
  const h=fresh(p), old=h.put("BT1-081","battle"), source=h.put("BT1-081","hand");h.put("F","energy");
  addEffect(h.state,[],{target:old,kind:"forbid",value:0,until:"game",forbid:{what:"beMovedBySkill",player:p}});
  const action=h.offer(source);assert.ok(action);h.take(action);assert.ok(h.state.sides[p].zones.drop.includes(old),"rule cleanup is not moving by a skill");cases++;
 }
 for(const route of ["native", "hand", "deck", "drop"] as const) {
  const h=fresh(p), source=h.put("BT27-119",route==="native"?"hand":route), invoker=route!=="native"?h.put(`INVOKE_BT27-119_${route}`,"battle"):null;
  h.put("R","energy");h.put("B","energy");
  addEffect(h.state,[],{target:"",kind:"forbid",value:0,until:"turn",forbid:{what:"activateSkill",player:p,filter:{...emptyFilter(),type:"EXTRA"},fromArea:"hand",extraCardActivation:true,skillKinds:["activate:main"],keywordSkill:"Field",uses:1}});
  h.take(route!=="native"?{type:"activate",player:p,card:invoker!,skill:0}:h.offer(source)!);
  if(h.state.prompt?.kind==="chooseCards")h.take({type:"choose",player:p,cards:[source]});
  assert.ok(h.state.sides[p].zones.battle.includes(source),"last allowed Field activation completes before prohibition is spent");
  assert.equal(h.state.effects.find(effect=>effect.forbid?.uses!==undefined)?.forbid?.uses,route==="native"||route==="hand"?0:1);cases++;
 }
 for (const id of ["BT29-041", "BT29-042"]) {
  const h = fresh(p), source = h.put(id,"hand"); assert.equal(h.offer(source),undefined,"wrong Leader cannot activate Field"); cases++;
 }
}
console.log(`field-activation-5: ${cases} both-seat native cases passed`);
