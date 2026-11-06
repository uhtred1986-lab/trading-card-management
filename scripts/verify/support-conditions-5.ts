/** R-384: complete condition punctuation, shared predicates, current-play subjects and host scope. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow, condHolds } from "../../src/lib/arena/vm/program";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { Op } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const PRINTS = {
  "BT18-140": "[Counter: Play] If the Battle Card being played has an energy cost of 3 or less, send it to its owner's Warp instead. Additionally, if your Leader is black, send up to 1 Battle Card from your opponent's Drop to their Warp.",
  "BT25-133": "[permanent] If you have a multicolor card in your energy reduce the combo cost of this card in your hand by 1.",
  "BT13-020": "[counter: counter] If your Leader Card and energy are all mono-red and your opponent has 3 or more energy: Negate the [counter] skill of an Extra Card with an original energy cost of 1 that was activated without paying its energy cost, then play this card.",
  "BT27-073": "[Counter: Play][Limit 1] If your opponent's Battle Card being played has 35000 power or less, it's played in Rest Mode, then you play this card.",
  "BT21-149": "[Counter: Play] Play this card, for every card in your opponent's Z-Deck, place up to 1 Battle Card from your Drop or Warp under this card, and this card can't be removed from your Battle Area by your opponent's skills for the turn. Additionally, if the Battle Card to be played has an energy cost of 7 or less, send it to its owner's Warp instead.",
  "BT20-017": "[Permanent] While this card is under an <Anilaza> or <Koichiarator> card―both red and in your Battle Area―the card above it gets +5000 power.",
  "BT20-019": "[Permanent] While this card is under an <Anilaza> or <Koichiarator> card―both red and in your Battle Area―the card above it gets +5000 power."
} as const;
const defs: Record<string, CardDef> = {
  C5_LEADER: card("C5_LEADER", { type: "LEADER", colors: ["Red"], energyCost: null, comboCost: null, comboPower: null }),
  C5_FILLER: card("C5_FILLER", {}),
  C5_MULTI: card("C5_MULTI", { colors: ["Red", "Green"] }),
  C5_THREE: card("C5_THREE", { energyCost: 3, power: 35000 }),
  C5_HIGH: card("C5_HIGH", { energyCost: 8, power: 40000 }),
  C5_EDGE: card("C5_EDGE", { energyCost: 7, power: 35000 }),
  C5_HOST: card("C5_HOST", { characters: ["Anilaza"] }),
  C5_OTHER: card("C5_OTHER", { characters: ["Koichiarator"] }),
  C5_BLUE: card("C5_BLUE", { characters: ["Anilaza"], colors: ["Blue"] }),
  ...Object.fromEntries(Object.entries(PRINTS).map(([id, skill]) => [id, card(id, { skill, energyCost: 0, comboCost: 1 })])),
};
const records = Object.values(defs).flatMap(d => skillRecords(d));
for (const rec of records) {
  if (rec.cardId === "BT13-020") assert.deepEqual(rec.unread, ["Negate the [counter] skill of an Extra Card with an original energy cost of 1 that was activated without paying its energy cost"]);
  else assert.deepEqual(rec.unread, [], rec.cardId);
  const rule = copy({ kind: rec.kind, trigger: rec.trigger, cost: rec.cost, usage: rec.usage, validity: rec.validity, cond: rec.cond, ops: rec.ops }) as Rule;
  assert.equal(validateRule(rule, rec.kind), null, rec.cardId);
  const round = parseRule(printRule(rule)); assert.ok(round.ok, rec.cardId);
  const plain = (x: unknown) => JSON.parse(JSON.stringify(x, function(k, v) { if (k === "upTo" && v === false) return undefined; if (k === "area" && Array.isArray(this.areas)) return undefined; return v; }));
  assert.deepEqual(plain(round.value), plain(rule), rec.cardId);
}
const ctx: EngineContext = { defs, scripts: rulesFromRows(copy(records.map((r, id) => ({ ...r, id, status: "draft", source: "compiler" }) as unknown as RuleRow)), defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";
const take = (s: VmState, a: Action) => copy(RULES.apply(ctx, copy(s), a).state as VmState);
function fresh(first: PlayerId): VmState {
  let s = RULES.createGame(ctx, { seed: 384, p1: { name: "First", leader: "C5_LEADER", main: fifty("C5_FILLER") }, p2: { name: "Second", leader: "C5_LEADER", main: fifty("C5_FILLER") } }).state as VmState;
  for (const a of [{ type: "chooseFirst", player: s.chooser, first }, { type: "mulligan", player: first, redraw: false }, { type: "mulligan", player: other(first), redraw: false }, { type: "charge", player: first, card: null }] as Action[]) s = take(s, a);
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck.at(-1)!; s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok); s.pending = []; return id;
}
let scenarios = 0;
for (const seat of ["p1", "p2"] as const) {
  const foe = other(seat);
  // The omitted comma cannot swallow the reduction or replace the multicolour-energy requirement.
  for (const [p, area, colour, expected] of [[seat,"energy","C5_MULTI",0],[seat,"energy","C5_FILLER",1],[foe,"energy","C5_MULTI",1],[seat,"battle","C5_MULTI",1]] as const) {
    const s = fresh(seat), source = stage(s, seat, "BT25-133", "hand"); stage(s,p,colour,area);
    assert.equal(attrsNow(ctx,game,s,source).comboCostOf,expected); scenarios++;
  }
  // The card on top must satisfy both shared names/colour and explicit area/control.
  for (const id of ["BT20-017","BT20-019"]) for (const [p, area, def, expected] of [[seat,"battle","C5_HOST",15000],[seat,"battle","C5_OTHER",15000],[seat,"battle","C5_BLUE",10000],[seat,"battle","C5_FILLER",10000],[seat,"leader","C5_HOST",10000],[foe,"battle","C5_HOST",15000]] as const) {
    const s = fresh(seat);
    const host = area === "leader" ? s.sides[p].zones.leader[0] : stage(s,p,def,area);
    s.cards[host].cardId = def;
    const source = stage(s,seat,id,"hand");
    assert.ok(moveCard(s,game,source,"under",{ under:host }).ok);
    assert.equal(attrsNow(ctx,game,s,host).power,expected,`${id} ${p} ${area} ${def}`);
    const gate = records.find(r=>r.cardId===id)!.cond!;
    assert.equal(condHolds(ctx,game,s,{card:source,master:seat,ops:[],ip:0,vars:{}},gate),p===seat && area==="battle" && (def==="C5_HOST" || def==="C5_OTHER")); scenarios++;
  }
  // Both Leader/energy predicates and the opponent's separate threshold survive the shared subject.
  for (const [leader, ownEnergy, theirEnergy, yes] of [["C5_LEADER","C5_FILLER",3,true],["C5_LEADER","C5_MULTI",3,false],["C5_MULTI","C5_FILLER",3,false],["C5_LEADER","C5_FILLER",2,false]] as const) {
    const s=fresh(seat); s.cards[s.sides[seat].zones.leader[0]].cardId=leader;
    stage(s,seat,ownEnergy,"energy"); for(let n=0;n<theirEnergy;n++)stage(s,foe,"C5_FILLER","energy");
    const rec=records.find(r=>r.cardId==="BT13-020")!;
    assert.ok(rec.cost?.readable && rec.cond);
    assert.equal(condHolds(ctx,game,s,{card:s.sides[seat].zones.leader[0],master:seat,ops:[],ip:0,vars:{}},rec.cond),yes); scenarios++;
  }
  // Actual Counter:Play windows. The leading BT27-073 condition scopes its self-play too.
  for(const counterDef of ["BT21-149","BT27-073","BT18-140"]) for(const targetDef of [counterDef === "BT18-140" ? "C5_THREE" : "C5_EDGE","C5_HIGH"]){
    let s=fresh(seat);for(let n=0;n<8;n++)stage(s,seat,"C5_FILLER","energy");
    const target=stage(s,seat,targetDef,"hand"),counter=stage(s,foe,counterDef,"hand");
    s=take(s,{type:"play",player:seat,card:target});assert.equal(s.prompt.kind,"counter");
    s=take(s,{type:"counter",player:foe,card:counter,skill:0});
    for(let n=0;n<15 && s.prompt.kind!=="main";n++){
      const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="counter"?a.card===null:a.type==="pass" || (a.type==="orderPending"&&!a.decline));
      assert.ok(action,JSON.stringify(s.prompt));s=take(s,action);
    }
    const low=targetDef!=="C5_HIGH";
    assert.equal(s.sides[foe].zones.battle.includes(counter), counterDef === "BT21-149" || (counterDef === "BT27-073" && low), "leading condition scopes both BT27-073 effects; BT21-149 plays before its additional condition");
    if((counterDef==="BT21-149" || counterDef==="BT18-140")&&low)assert.ok(s.sides[seat].zones.warp.includes(target),"replacement prevents play");
    else {assert.ok(s.sides[seat].zones.battle.includes(target));assert.equal(s.cards[target].mode,counterDef==="BT27-073"&&low?"rest":"active");}
    scenarios++;
  }
}
// A named current-play condition is not a fresh choice of cards already on the board.
const ops=(xs:Op[]):Op[]=>xs.flatMap(o=>[o,...(o.op==="if"?ops(o.then):[])]);
assert.equal(ops(records.find(r=>r.cardId==="BT21-149")!.ops).find(o=>o.op==="resolvingPlay")?.op,"resolvingPlay");
console.log(`support conditions 5: ${scenarios} both-seat runtime scenarios, stored and language records passed`);
