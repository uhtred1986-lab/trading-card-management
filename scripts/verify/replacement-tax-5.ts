/** R-425: actual EX06-35 taxes on stored Turles replacement Autos. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const PRINTS={"BT12-074": "[Unique][Blocker]<br>[Auto] If your Leader Card is a \u226aTurles Crusher Corps\u226b card and this card was used in a combo from your deck or hand: When this card would be placed in its owner's Drop Area from a Combo Area, you may play it instead.<br>[Auto] If your Leader Card is a \u226aTurles Crusher Corps\u226b card: When this card is played, play up to 1 green &lt;Lakasei&gt; card with an energy cost of 2 from your deck in Rest Mode, then shuffle your deck.", "BT12-072": "[Unique]<br>[Auto] If your Leader Card is a \u226aTurles Crusher Corps\u226b card and this card was used in a combo from your deck or hand: When this card would be placed in its owner's Drop Area from a Combo Area, you may play it in Rest Mode instead.<br>[Auto] When this card is played, look at up to 3 cards from the top of your deck, add up to 1 \u226aTurles Crusher Corps\u226b card among them to your hand, then shuffle your deck.", "BT12-071": "[unique]<br>[auto] If your Leader Card is a \u226aTurles Crusher Corps\u226b card and this card was used in a combo from your deck or hand: When this card would be placed in its owner's Drop Area from a Combo Area, you may play it in Rest Mode instead.<br>[activate: main]{g}: Send this card to its owner's Warp, then choose 1 of your opponent's Battle Cards with an energy cost of 5 or more and KO it. You can't play copies of this card for the turn.", "BT12-075": "[Unique]<br>[Auto] If your Leader Card is a \u226aTurles Crusher Corps\u226b card and this card was used in a combo from your deck or hand: When this card would be placed in its owner's Drop Area from a Combo Area, you may play it in Rest Mode instead.<br>[Auto] If your Leader Card is a \u226aTurles Crusher Corps\u226b card: When this card is played, play up to 1 green &lt;Rasin&gt; card with an energy cost of 2 from your deck, then shuffle your deck; draw 1 card, then choose 1 card in your hand and discard it."};
const defs:Record<string,CardDef>={LEADER:card("LEADER",{type:"LEADER",traits:["Turles Crusher Corps"]}),WRONG:card("WRONG",{type:"LEADER"}),FILLER:card("FILLER",{skill:null})};
for(const [id,skill] of Object.entries(PRINTS))defs[id]=card(id,{colors:["Green"],energyCost:id==="BT12-071"?3:2,skill});
defs.DROP=card("DROP",{skill:"[Activate: Battle] Choose 1 card in your Combo Area and place it in its owner's Drop Area."});
defs.HAND=card("HAND",{skill:"[Activate: Battle] Choose 1 card in your Combo Area and return it to its owner's hand."});
defs.ANSWER=card("ANSWER",{type:"EXTRA",energyCost:0,skill:"[Counter: Play] The Battle Card played is played in Rest Mode."});
defs.MAYDROP=card("MAYDROP",{skill:"[Activate: Battle] You may place 1 card from your Combo Area in its owner's Drop Area. If you do, draw 1 card."});
defs["EX06-35"]=card("EX06-35",{skill:"[triple attack]<br>[over realm 8] {4}<br>[permanent] Your opponent can't activate skills unless they choose 1 card in their hand and send it to their Warp."});
const records=Object.values(defs).flatMap(skillRecords);
const rows=records.map((r,id)=>({...r,id,source:"compiler",status:"confirmed"}) as unknown as RuleRow);
for(const r of rows)assert.deepEqual(runtimeSupportOfRow(r).unsupported,[],r.cardId+"#"+r.skillIndex);
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(rows),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const history:GameEvent[]=[];
const take=(s:VmState,a:Action,engine=ctx)=>{const out=RULES.apply(engine,copy(s),a);history.push(...out.events);return out.state as VmState;};
function fresh(first:PlayerId):VmState{
 let s=RULES.createGame(ctx,{seed:393,p1:{name:"One",leader:"LEADER",main:fifty("FILLER")},p2:{name:"Two",leader:"LEADER",main:fifty("FILLER")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:other(first),redraw:false},{type:"charge",player:first,card:null},{type:"endMain",player:first},{type:"charge",player:other(first),card:null},{type:"endMain",player:other(first)},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);
 return s;
}
function stage(s:VmState,owner:PlayerId,def:string,area:"deck"|"hand"|"battle"):string{
 const id=s.sides[owner].zones.deck.at(-1)!;s.cards[id].cardId=def;if(area!=="deck")assert.ok(moveCard(s,game,id,area,{owner}).ok);return id;
}
function advance(s:VmState,accept=true,selected?:string,engine=ctx):{state:VmState;offered:boolean}{
 let offered=false;
 for(let i=0;i<80&&s.prompt.kind!=="main";i++){
  const p=s.prompt;let a:Action|undefined;
  if(p.kind==="replaceMove"){offered=true;a={type:"chooseMode",player:p.player,index:accept?0:p.options.length-1};}
  else if(p.kind==="chooseCards")a={type:"choose",player:p.player,cards:selected&&p.choice.candidates.includes(selected)?[selected]:p.choice.candidates.slice(0,p.choice.min??0)};
  else if(p.kind==="combo")a={type:"pass",player:p.player};
  else if(p.kind==="zEnergyFromCombo")a={type:"zEnergyFromCombo",player:p.player,card:null};
  else {const legal=RULES.legalActions(engine,s).map(x=>x.action);a=legal.find(x=>x.type==="counter"&&x.card===null)??legal.find(x=>x.type==="chooseMode"&&x.index===0)??legal[0];}
  assert.ok(a,JSON.stringify(p));s=take(s,a,engine);
 }assert.equal(s.prompt.kind,"main");return {state:s,offered};
}
function pass(s:VmState):VmState {
 const legal=RULES.legalActions(ctx,s).map(x=>x.action);
 const a=legal.find(x=>x.type==="counter"&&x.card===null)??legal.find(x=>x.type==="pass")??legal.find(x=>x.type==="zEnergyFromCombo"&&x.card===null)??legal.find(x=>x.type==="chooseMode"&&x.index===0);
 assert.ok(a,JSON.stringify(s.prompt));return take(s,a);
}
function taxReady(owner:PlayerId,id:string,empty=false){
 history.length=0;let s=fresh(owner);
 const leader=s.sides[owner].zones.leader[0],combo=stage(s,owner,id,"hand"),tax=stage(s,other(owner),"EX06-35","battle");
 stage(s,other(owner),"ANSWER","hand");
 if(empty)for(const c of [...s.sides[owner].zones.hand])if(c!==combo)assert.ok(moveCard(s,game,c,"deck",{owner}).ok);
 s=take(s,{type:"attack",player:owner,attacker:leader,target:s.sides[other(owner)].zones.leader[0]});
 while(s.prompt.kind!=="combo")s=pass(s);s=take(s,{type:"combo",player:owner,card:combo});
 for(let n=0;n<20&&s.prompt.kind!=="replaceMove";n++)s=pass(s);
 assert.equal(s.prompt.kind,"replaceMove");s=take(copy(s),{type:"chooseMode",player:owner,index:0});
 return {s,combo,tax};
}
let cases=0;
for(const owner of ["p1","p2"] as const)for(const id of Object.keys(PRINTS))for(const pay of [false,true]){
 const initial=taxReady(owner,id);let s=initial.s;const {combo}=initial;
 assert.equal(s.prompt.kind,"chooseMode");assert.equal(s.skillPlayScopes,undefined,"no Counter timing before activation tax");
 assert.equal(history.filter(e=>e.type==="skill"&&e.card===combo&&e.skill===10).length,0);
 const hand=s.sides[owner].zones.hand.slice();
 s=take(copy(s),{type:"chooseMode",player:owner,index:pay?0:1});
 if(pay){
  assert.equal(s.prompt.kind,"chooseCards");assert.equal(s.prompt.player,owner);
  s=take(copy(s),{type:"choose",player:owner,cards:[hand[0]]});
  assert.ok(s.sides[owner].zones.warp.includes(hand[0]));
  assert.equal(s.resolving?.scopeWindow?.boundary,"before");assert.equal(history.filter(e=>e.type==="skill"&&e.card===combo&&e.skill===10).length,1);
  const paidAt=history.findIndex(e=>e.type==="move"&&e.card===hand[0]);
  const activatedAt=history.findIndex(e=>e.type==="skill"&&e.card===combo&&e.skill===10);assert.ok(paidAt>=0&&paidAt<activatedAt);
 }
 s=advance(copy(s)).state;
 assert.ok(s.sides[owner].zones[pay?"battle":"drop"].includes(combo));
 if(!pay)assert.deepEqual(s.sides[owner].zones.hand,hand);
 assert.equal(history.filter(e=>e.type==="skill"&&e.card===combo&&e.skill===10).length,pay?1:0);cases++;
}
for(const owner of ["p1","p2"] as const){
 const {s,combo}=taxReady(owner,"BT12-071",true);
 assert.ok(s.sides[owner].zones.drop.includes(combo));assert.equal(s.prompt.kind,"main");assert.equal(history.filter(e=>e.type==="skill"&&e.card===combo&&e.skill===10).length,0);cases++;
}
// Staged source departure during a real tax choice: payment already made
// remains spent, but the fresh Combo occurrence cannot be played or dropped.
for(const owner of ["p1","p2"] as const)for(const reenter of [false,true]){
 const initial=taxReady(owner,"BT12-071");let s=initial.s;const {combo}=initial;
 s=take(copy(s),{type:"chooseMode",player:owner,index:0});assert.equal(s.prompt.kind,"chooseCards");
 const payerCard=s.sides[owner].zones.hand[0];
 assert.throws(()=>take(copy(s),{type:"choose",player:other(owner),cards:[payerCard]}));
 assert.ok(moveCard(s,game,combo,"hand",{owner}).ok);if(reenter)assert.ok(moveCard(s,game,combo,"combo",{owner}).ok);
 s=take(copy(s),{type:"choose",player:owner,cards:[payerCard]});
 s=advance(copy(s)).state;
 assert.ok(s.sides[owner].zones.warp.includes(payerCard));assert.ok(s.sides[owner].zones[reenter?"combo":"hand"].includes(combo));
 assert.equal(history.filter(e=>e.type==="skill"&&e.card===combo&&e.skill===10).length,0);cases++;
}
// A second actual tax becomes unpayable after the first was paid. Its gate
// removes only the pending activation, leaving the original departure alive.
for(const owner of ["p1","p2"] as const){
 const initial=taxReady(owner,"BT12-071");let s=initial.s;const {combo}=initial;
 s=take(copy(s),{type:"chooseMode",player:owner,index:0});assert.equal(s.prompt.kind,"chooseCards");
 const payerCard=s.sides[owner].zones.hand[0];
 for(const c of [...s.sides[owner].zones.hand])if(c!==payerCard)assert.ok(moveCard(s,game,c,"deck",{owner}).ok);
 stage(s,other(owner),"EX06-35","battle");
 s=take(copy(s),{type:"choose",player:owner,cards:[payerCard]});s=advance(copy(s)).state;
 assert.ok(s.sides[owner].zones.warp.includes(payerCard));assert.ok(s.sides[owner].zones.drop.includes(combo));assert.equal(history.filter(e=>e.type==="skill"&&e.card===combo&&e.skill===10).length,0);cases++;
}
for(const owner of ["p1","p2"] as const){
 const initial=taxReady(owner,"BT12-071");let s=initial.s;const {combo}=initial;
 s=take(s,{type:"chooseMode",player:owner,index:0});s=take(s,{type:"choose",player:owner,cards:[s.sides[owner].zones.hand[0]]});
 const frame=s.skillPlayScopes!.at(-1)!.window!.programs.find(f=>f.replacementAuto)!;
 frame.replacementAuto!.version=1;delete frame.replacementAuto!.activation;
 s=advance(copy(s)).state;assert.ok(s.sides[owner].zones.battle.includes(combo));assert.equal(history.filter(e=>e.type==="skill"&&e.card===combo&&e.skill===10).length,1,"legacy already-activated cursor is never activated twice");cases++;
}
console.log(`replacement-tax-5: ${cases} native tax/replacement and staged fault controls passed`);
