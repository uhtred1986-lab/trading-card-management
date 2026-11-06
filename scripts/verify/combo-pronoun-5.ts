/** R-440: “combo it with this card” uses the chosen card, including an opponent-owned card. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy = <T,>(v:T):T => JSON.parse(JSON.stringify(v));
const defs:Record<string,CardDef> = {
 CP5_LEADER:card("CP5_LEADER",{type:"LEADER"}), CP5_FILLER:card("CP5_FILLER",{}),
 CP5_XD3:card("CP5_XD3",{skill:"[auto][once per turn] When this card attacks, choose up to 1 yellow <Son Goku> card in your Drop Area and combo it with this card."}),
 CP5_BT10:card("CP5_BT10",{skill:"[Auto] When this card attacks, your opponent chooses 1 card in their hand and sends it to their Warp. If the card your opponent sent to their Warp was a Battle Card, combo it with this card."}),
 CP5_GOOD:card("CP5_GOOD",{colors:["Yellow"],characters:["Son Goku"],comboCost:2}),
 CP5_BLUE:card("CP5_BLUE",{colors:["Blue"],characters:["Son Goku"]}),
 CP5_EXTRA:card("CP5_EXTRA",{type:"EXTRA",power:null,comboPower:null,comboCost:null}),
};
const records=Object.values(defs).flatMap(skillRecords);assert.deepEqual(records.flatMap(r=>r.unread),[]);
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(records.map((r,id)=>({...r,id,source:"compiler",status:"draft"}) as unknown as RuleRow)),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>copy(RULES.apply(ctx,copy(s),a).state as VmState);
function fresh(seat:PlayerId):VmState {
 let s=RULES.createGame(ctx,{seed:440,p1:{name:"A",leader:"CP5_LEADER",main:fifty("CP5_FILLER")},p2:{name:"B",leader:"CP5_LEADER",main:fifty("CP5_FILLER")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first:other(seat)},{type:"mulligan",player:other(seat),redraw:false},{type:"mulligan",player:seat,redraw:false},{type:"charge",player:other(seat),card:null},{type:"endMain",player:other(seat)},{type:"charge",player:seat,card:null}] as Action[])s=take(s,a);
 for(const p of ["p1","p2"] as const)for(const id of [...s.sides[p].zones.hand])assert.ok(moveCard(s,game,id,"deck",{owner:p}).ok);
 return s;
}
function stage(s:VmState,p:PlayerId,def:string,zone:string):string {
 const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,zone,{owner:p}).ok);return id;
}
let cases=0;
for(const seat of ["p1","p2"] as const)for(const variant of ["chosen","decline","colour","area","side","opponentBattle","opponentExtra"]){
 let s=fresh(seat);const foe=other(seat),opponent=variant.startsWith("opponent");
 const src=stage(s,seat,opponent?"CP5_BT10":"CP5_XD3","battle");stage(s,seat,"CP5_FILLER","hand");
 const owner=opponent||variant==="side"?foe:seat;
 const origin=opponent||variant==="area"?"hand":"drop";
 const target=stage(s,owner,variant==="opponentExtra"?"CP5_EXTRA":variant==="colour"?"CP5_BLUE":"CP5_GOOD",origin);
 s=take(s,{type:"attack",player:seat,attacker:src,target:s.sides[foe].zones.leader[0]});
 for(let i=0;i<30&&s.prompt.kind!=="combo";i++){
  const q=s.prompt;
  if(q.kind==="chooseCards"){
   assert.equal(q.player,opponent?foe:seat,"the printed chooser answers after reload");
   if(!opponent&&["colour","area","side"].includes(variant))assert.ok(!q.choice.candidates.includes(target));
   s=take(s,{type:"choose",player:q.player,cards:variant!=="decline"&&q.choice.candidates.includes(target)?[target]:[]});
  }else if(q.kind==="counter")s=take(s,{type:"counter",player:q.player,card:null});
  else {const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="pass"||a.type==="chooseMode"||a.type==="payCost");assert.ok(a,JSON.stringify(q));s=take(s,a);}
 }
 assert.equal(s.prompt.kind,"combo");
 const used=variant==="chosen"||variant==="opponentBattle";
 assert.equal(s.sides[seat].zones.combo.includes(target),used,variant);
 assert.ok(s.sides[seat].zones.battle.includes(src),"the attacker is not the combo card");
 assert.equal(s.cards[target].owner,owner,"ownership survives a combo on the other side");
 if(used)assert.equal(s.battle?.comboOrigins?.[target],opponent?"warp":"drop");
 else assert.ok(s.sides[owner].zones[opponent?"warp":origin].includes(target));
 cases++;
}
console.log(`combo pronoun 5: ${cases} actual attacks and saved choices passed`);
