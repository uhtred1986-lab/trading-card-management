/** R-393: confirmed Combo-departure replacements are supported without a WHEN event. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { vmHost } from "../../src/lib/arena/vm/host";
import { stepScript, programProblem, type Op } from "../../src/lib/arena/vm/script";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const PRINTS={"BT12-074": "[Unique][Blocker]<br>[Auto] If your Leader Card is a \u226aTurles Crusher Corps\u226b card and this card was used in a combo from your deck or hand: When this card would be placed in its owner's Drop Area from a Combo Area, you may play it instead.<br>[Auto] If your Leader Card is a \u226aTurles Crusher Corps\u226b card: When this card is played, play up to 1 green &lt;Lakasei&gt; card with an energy cost of 2 from your deck in Rest Mode, then shuffle your deck.", "BT12-072": "[Unique]<br>[Auto] If your Leader Card is a \u226aTurles Crusher Corps\u226b card and this card was used in a combo from your deck or hand: When this card would be placed in its owner's Drop Area from a Combo Area, you may play it in Rest Mode instead.<br>[Auto] When this card is played, look at up to 3 cards from the top of your deck, add up to 1 \u226aTurles Crusher Corps\u226b card among them to your hand, then shuffle your deck.", "BT12-071": "[unique]<br>[auto] If your Leader Card is a \u226aTurles Crusher Corps\u226b card and this card was used in a combo from your deck or hand: When this card would be placed in its owner's Drop Area from a Combo Area, you may play it in Rest Mode instead.<br>[activate: main]{g}: Send this card to its owner's Warp, then choose 1 of your opponent's Battle Cards with an energy cost of 5 or more and KO it. You can't play copies of this card for the turn.", "BT12-075": "[Unique]<br>[Auto] If your Leader Card is a \u226aTurles Crusher Corps\u226b card and this card was used in a combo from your deck or hand: When this card would be placed in its owner's Drop Area from a Combo Area, you may play it in Rest Mode instead.<br>[Auto] If your Leader Card is a \u226aTurles Crusher Corps\u226b card: When this card is played, play up to 1 green &lt;Rasin&gt; card with an energy cost of 2 from your deck, then shuffle your deck; draw 1 card, then choose 1 card in your hand and discard it."};
const defs:Record<string,CardDef>={LEADER:card("LEADER",{type:"LEADER",traits:["Turles Crusher Corps"]}),WRONG:card("WRONG",{type:"LEADER"}),FILLER:card("FILLER",{skill:null})};
for(const [id,skill] of Object.entries(PRINTS))defs[id]=card(id,{colors:["Green"],energyCost:id==="BT12-071"?3:2,skill});
defs.DROP=card("DROP",{skill:"[Activate: Battle] Choose 1 card in your Combo Area and place it in its owner's Drop Area."});
defs.HAND=card("HAND",{skill:"[Activate: Battle] Choose 1 card in your Combo Area and return it to its owner's hand."});
const records=Object.values(defs).flatMap(skillRecords);
const rows=records.map((r,id)=>({...r,id,source:"compiler",status:"confirmed"}) as unknown as RuleRow);
for(const r of rows)assert.deepEqual(runtimeSupportOfRow(r).unsupported,[],r.cardId+"#"+r.skillIndex);
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(rows),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action,engine=ctx)=>RULES.apply(engine,copy(s),a).state as VmState;
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
let cases=0;
for(const owner of ["p1","p2"] as const)for(const id of Object.keys(PRINTS))for(const origin of ["hand","deck","battle"] as const)for(const condition of ["accept","decline","wrong-leader"] as const){
 let s=fresh(owner);const leader=s.sides[owner].zones.leader[0];if(condition==="wrong-leader")s.cards[leader].cardId="WRONG";
 const combo=stage(s,owner,id,origin);
 s=take(s,{type:"attack",player:owner,attacker:leader,target:s.sides[other(owner)].zones.leader[0]});
 while(s.prompt.kind!=="combo"){const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="counter"&&a.card===null);assert.ok(a);s=take(s,a);}
 if(origin==="deck")assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"comboFrom",target:{var:"chosen"}}],ip:0,vars:{chosen:[combo]},card:leader,master:owner}),"done");
 else s=take(s,{type:"combo",player:owner,card:combo});
 assert.equal(s.battle?.comboOrigins?.[combo],origin);
 const result=advance(s,condition!=="decline");s=result.state;
 const offered=origin!=="battle"&&condition!=="wrong-leader";
 assert.equal(result.offered,offered);const played=offered&&condition==="accept";
 assert.equal(s.sides[owner].zones.battle.includes(combo),played);assert.equal(s.sides[owner].zones.drop.includes(combo),!played);
 if(played)assert.equal(s.cards[combo].mode,id==="BT12-074"?"active":"rest");cases++;
}
// A real Activate:Battle requests a departure; only Drop is replaced (own Q&A).
for(const owner of ["p1","p2"] as const)for(const destination of ["DROP","HAND"] as const){
 let s=fresh(owner);const leader=s.sides[owner].zones.leader[0],combo=stage(s,owner,"BT12-071","hand"),driver=stage(s,owner,destination,"battle");
 s=take(s,{type:"attack",player:owner,attacker:leader,target:s.sides[other(owner)].zones.leader[0]});
 while(s.prompt.kind!=="combo"){const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="counter"&&a.card===null);assert.ok(a);s=take(s,a);}
 s=take(s,{type:"combo",player:owner,card:combo});
 const activation=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===driver);assert.ok(activation);s=take(s,activation);
 const result=advance(s,true,combo);s=result.state;assert.equal(result.offered,destination==="DROP");assert.equal(s.sides[owner].zones.battle.includes(combo),destination==="DROP");assert.equal(s.sides[owner].zones.hand.includes(combo),destination==="HAND");cases++;
}
const base=rows.find(r=>r.cardId==="BT12-071"&&r.skillIndex===10)!;
for(const change of ["mixed","nested-mixed","stale","priced","condition","empty"]){
 const row=copy(base),ops=row.ops as Op[];
 if(change==="mixed")ops.push({op:"draw",n:1});
 if(change==="nested-mixed")row.ops=[{op:"if",cond:row.cond!,then:[...ops,{op:"draw",n:1}]}];
 if(change==="stale")for(const op of ops)if(op.op==="replace")delete op.to;
 if(change==="priced")row.cost={...row.cost!,orbs:{Green:1}};
 if(change==="condition")row.cond=null;
 if(change==="empty")row.ops=[];
 assert.ok(runtimeSupportOfRow(row).unsupported.includes("the Auto rule has no readable WHEN trigger"),change);cases++;
}
// Stale draft rows must not bypass the destination contract either.
for(const owner of ["p1","p2"] as const){
 const stale=copy(rows);const row=stale.find(r=>r.cardId==="BT12-071"&&r.skillIndex===10)!;row.status="draft";
 for(const op of row.ops as Op[])if(op.op==="replace")delete op.to;
 assert.ok(runtimeSupportOfRow(row).unsupported.some(g=>g.includes("original destination")));
 const engine:EngineContext={defs,scripts:rulesFromRows(stale,defs)};
 let s=fresh(owner);const leader=s.sides[owner].zones.leader[0],combo=stage(s,owner,"BT12-071","hand");
 s=take(s,{type:"attack",player:owner,attacker:leader,target:s.sides[other(owner)].zones.leader[0]},engine);
 while(s.prompt.kind!=="combo"){const a=RULES.legalActions(engine,s).map(x=>x.action).find(a=>a.type==="counter"&&a.card===null);assert.ok(a);s=take(s,a,engine);}
 s=take(s,{type:"combo",player:owner,card:combo},engine);const result=advance(s,true,undefined,engine);assert.equal(result.offered,false);assert.ok(result.state.sides[owner].zones.drop.includes(combo));cases++;
}
assert.ok(programProblem([{op:"replace",event:"play",to:"drop",with:[]}])?.includes('"to"'));
console.log(`Combo replacement support 5: ${cases} confirmed/native both-seat scenarios passed`);
