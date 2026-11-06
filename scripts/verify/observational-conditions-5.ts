/** R-385: existence conditions observe protected cards without choosing them. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { condHolds, countSelected, resolveSelector } from "../../src/lib/arena/vm/program";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { type ScriptFrame } from "../../src/lib/arena/vm/script";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const PRINTS = { "BT7-110": "[Counter: Play] If your opponent has 3 or more Battle Cards in play with energy costs of 2 or more, the Battle Card your opponent is playing is placed in its owner's Drop Area instead, then choose all Battle Cards with energy costs of 2 or less, ignoring [Barrier], and send them to their owners' Warps." };
const defs: Record<string,CardDef> = {
 CB4_LEADER: card("CB4_LEADER",{type:"LEADER"}), CB4_FILLER:card("CB4_FILLER",{}),
 OBS:card("OBS",{skill:PRINTS["BT7-110"]}), GUARD:card("GUARD",{energyCost:2,skill:"[Barrier]"}),
 TWO:card("TWO",{energyCost:2}), ONE:card("ONE",{energyCost:1})
};
const records = Object.values(defs).flatMap(d => skillRecords(d));
assert.deepEqual(records.flatMap(r => r.unread), []);
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
for(const owner of ["p1","p2"] as const){
 const foe=other(owner);
 for(const negative of ["none","cost","area","side"]){
  const s=fresh(owner), source=stage(s,owner,"OBS","battle");
  const guarded=stage(s,foe,"GUARD","battle");
  const immune=stage(s,foe,"TWO","battle");
  const blocked=stage(s,negative==="side"?owner:foe,negative==="cost"?"ONE":"TWO",negative==="area"?"drop":"battle");
  addEffect(s,[],{target:immune,kind:"immune",value:0,until:"game",immune:{from:owner}});
  addEffect(s,[],{target:blocked,kind:"forbid",value:0,until:"game",forbid:{what:"beChosen",player:owner}});
  const f:ScriptFrame={card:source,master:owner,ops:[],ip:0,vars:{}};
  const stored=ctx.scripts!.OBS.bySkill[0].ops[0];assert.equal(stored.op,"if");if(stored.op!=="if")throw Error("if");
  assert.equal(condHolds(ctx,game,s,f,stored.cond),negative==="none","stored BT7-110 threshold respects protection but retains all filters");
  const sel={side:"opponent" as const,area:"battle" as const};
  assert.deepEqual(resolveSelector(ctx,game,s,f,sel),[],"actual choices remain protected");
  assert.equal(countSelected(ctx,game,s,f,sel),0,"default API remains unchanged");
  assert.equal(condHolds(ctx,game,s,{...f,subject:immune},{kind:"count",sel:{special:"subject"},atLeast:1}),true,"immune event subject exists");
  assert.equal(condHolds(ctx,game,s,f,{kind:"count",sel,atMost:1}),false,"upper bounds include protected cards");
  assert.ok(moveCard(s,game,guarded,"drop",{owner:foe}).ok);
  assert.equal(condHolds(ctx,game,s,f,stored.cond),false,"current area count after a move");cases++;
 }
}
console.log(`observational conditions 5: ${cases} both-seat stored condition scenarios passed`);
