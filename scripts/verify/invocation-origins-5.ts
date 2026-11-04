/** R-420: effect-invoked Extras use their own lines from hand, deck, or Drop. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { resolvePlay } from "../../src/lib/arena/vm/play";
import { run } from "../../src/lib/arena/vm/flow";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const defs:Record<string,CardDef>={
 IO5_LEADER:card("IO5_LEADER",{type:"LEADER",colors:["Red"],traits:["Shenron"],energyCost:null,comboCost:null,comboPower:null}),
 IO5_FILLER:card("IO5_FILLER",{}),
};
for(const origin of ["hand","deck","drop"]){
 defs[`IO5_${origin}`]=card(`IO5_${origin}`,{skill:`[Activate: Main] Choose up to 1 {Invoke Target} from your ${origin}, activate it, then draw 1 card.`});
}
for(const kind of ["Main","Battle","Main/Battle"]){
 defs[`IO5_${kind}`]=card(`IO5_${kind}`,{name:"Invoke Target",type:"EXTRA",energyCost:5,power:null,comboCost:null,comboPower:null,skill:`[Activate: ${kind}] {r}{r}: Draw 2 cards.`});
}
defs.IO5_COND=card("IO5_COND",{name:"Invoke Target",type:"EXTRA",energyCost:5,power:null,comboCost:null,comboPower:null,skill:"[Activate: Main] If your Leader is blue: Draw 2 cards."});
defs["P-389"]=card("P-389",{"type": "EXTRA", "name": "Negative Energy Charge", "colors": ["Black"], "traits": [], "characters": [], "skill": "[counter: attack] Negate the attack, then add 1 [dragon ball] card from your Drop Area to your hand.\r [permanent] This card gains \u226aShadow Dragon\u226b in all areas.\r [activate: main/battle] Send 7 cards from your Drop Area to your Warp: Choose one\u2014\r \u30fbActivate up to 1 {Dragon Balls, Negative Energy Overflow} from your deck, then shuffle your deck.\r \u30fbYou may pay {4}. If you do, play up to 1 {Black Smoke Dragon, Eternal Evil} from your deck or hand, then shuffle your deck if you looked through it.", "energyCost": 0});
defs["P-119"]=card("P-119",{"type": "BATTLE", "name": "King Piccolo, Evil Ambitions", "colors": ["Red"], "traits": ["Namekian"], "characters": ["King Piccolo"], "skill": "[Auto] When you play this card, if your Leader Card is a red \u226aShenron\u226b card, choose up to 3 [Dragon Ball] cards from your deck, place them in your Drop Area, then shuffle your deck. If you placed cards in your Drop Area, choose up to 1 {A King's Return to Youth} from your deck, activate it, then shuffle your deck.", "energyCost": 0});
defs["BT5-025"]=card("BT5-025",{"type": "EXTRA", "name": "A King's Return to Youth", "colors": ["Red"], "traits": [], "characters": [], "skill": "[Permanent] This card gains \u226aDesire\u226b in all areas.<br>[Activate: Main] Your Leader Card is a red \u226aShenron\u226b card: Choose up to 1 {King Piccolo, Terror Unleashed} and {A King's Return to Youth} from your deck and add them to your hand, then shuffle your deck.", "energyCost": 0});
defs["BT8-137"]=card("BT8-137",{"type": "EXTRA", "name": "Dragon Balls, Negative Energy Overflow", "colors": ["Black"], "traits": [], "characters": [], "skill": "[Ultimate]<br>[Permanent] Reduce the energy cost of this card in your hand by 1 for each Battle Card in your Drop Area.<br>[Activate: Battle] At the end of this turn, choose all Battle Cards ignoring [Barrier] and place them in their owners' Drop Areas.", "energyCost": 0});
defs.IO5_DB=card("IO5_DB",{skill:"[Dragon Ball]"});
defs.IO5_KING=card("IO5_KING",{name:"King Piccolo, Terror Unleashed"});
defs.IO5_BARRIER=card("IO5_BARRIER",{skill:"[Barrier]"});
defs.IO5_TWO=card("IO5_TWO",{name:"Invoke Target",type:"EXTRA",energyCost:9,power:null,comboCost:null,comboPower:null,skill:"[Activate: Main] Draw 2 cards. [Activate: Battle] Draw 3 cards."});
defs.IO5_LIMIT=card("IO5_LIMIT",{name:"Invoke Target",type:"EXTRA",energyCost:9,power:null,comboCost:null,comboPower:null,skill:"[Activate: Main][Limit 1] Draw 2 cards."});
defs.IO5_FIELD=card("IO5_FIELD",{name:"Invoke Target",type:"EXTRA",energyCost:9,power:null,comboCost:null,comboPower:null,skill:"[Field]"});
defs.IO5_BATTLE=card("IO5_BATTLE",{name:"Invoke Target",skill:"[Activate: Main] Draw 2 cards."});
defs.IO5_BURST=card("IO5_BURST",{name:"Invoke Target",type:"EXTRA",energyCost:5,power:null,comboCost:null,comboPower:null,skill:"[Activate: Main][Burst 3] If a black card is placed in your Drop Area by this skill, draw 2 cards."});
defs.IO5_BLACK=card("IO5_BLACK",{colors:["Black"]});
const records=Object.values(defs).flatMap(skillRecords);assert.deepEqual(records.flatMap(r=>r.unread),[]);
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(records.map((r,id)=>({...r,id,source:"compiler",status:"draft"}) as unknown as RuleRow)),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>copy(RULES.apply(ctx,copy(s),a).state as VmState);
function fresh(first:PlayerId):VmState{
 let s=RULES.createGame(ctx,{seed:420,p1:{name:"A",leader:"IO5_LEADER",main:fifty("IO5_FILLER")},p2:{name:"B",leader:"IO5_LEADER",main:fifty("IO5_FILLER")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:other(first),redraw:false},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);
 return s;
}
function stage(s:VmState,p:PlayerId,def:string,zone:string):string{
 const id=s.sides[p].zones.deck.findLast(id=>s.cards[id].cardId==="IO5_FILLER")!;s.cards[id].cardId=def;if(zone!=="deck")assert.ok(moveCard(s,game,id,zone,{owner:p}).ok);return id;
}
function settle(s:VmState,decline=false):VmState{
 for(let n=0;n<40;n++){
  if(s.prompt.kind==="main"||s.prompt.kind==="charge")return s;
  const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="choose"?(decline?a.cards.length===0:a.cards.length>0):a.type==="chooseMode"?a.index===0:a.type==="counter"?a.card===null:a.type==="payCost"||a.type==="pass");
  const answer=a??RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="choose"&&a.cards.length===0);
  assert.ok(answer,`no answer ${s.prompt.kind}: ${JSON.stringify(s.outcome)}`);s=take(s,answer);
 }throw Error("did not settle");
}
let cases=0;
for(const seat of ["p1","p2"] as const)for(const origin of ["hand","deck","drop"]){
 for(const kind of ["Main","Battle","Main/Battle","COND"]){
  let s=fresh(seat);const src=stage(s,seat,`IO5_${origin}`,"battle"),target=stage(s,seat,kind==="COND"?"IO5_COND":`IO5_${kind}`,origin);const before=s.sides[seat].zones.hand.length;
  s=settle(take(s,{type:"activate",player:seat,card:src,skill:0}));
  assert.equal(s.sides[seat].zones.hand.length,before+1+(kind==="COND"?0:2)-(origin==="hand"&&kind!=="COND"?1:0),`${seat}/${origin}/${kind}`);
  if(kind!=="COND")assert.ok(s.sides[seat].zones.drop.includes(target));
  else assert.ok(s.sides[seat].zones[origin].includes(target));
  assert.ok(!s.sides[seat].zones.battle.includes(target));cases++;
 }
}
for(const seat of ["p1","p2"] as const){
 {
  let s=fresh(seat);const src=stage(s,seat,"P-119","hand"),dragon=stage(s,seat,"IO5_DB","deck"),extra=stage(s,seat,"BT5-025","deck"),king=stage(s,seat,"IO5_KING","deck");
  assert.equal(resolvePlay(ctx,game,s,[],src,seat),true);run(ctx,game,s,[]);s=settle(copy(s));
  assert.ok(s.sides[seat].zones.drop.includes(dragon),"P119 placed the chosen Dragon Ball");
  assert.ok(s.sides[seat].zones.drop.includes(extra),"P119 Extra moved deck to Drop");
  assert.ok(s.sides[seat].zones.hand.includes(king),"P119 invoked target's actual Main search");cases++;
 }
 {
  let s=fresh(seat);const src=stage(s,seat,"P-389","hand"),extra=stage(s,seat,"BT8-137","deck");
  for(let i=0;i<7;i++)stage(s,seat,"IO5_FILLER","drop");
  const barrier=stage(s,other(seat),"IO5_BARRIER","battle");
  s=settle(take(s,{type:"activate",player:seat,card:src,skill:20}));
  assert.equal(s.sides[seat].zones.warp.length,7,"P389 pays its original seven-card price");
  assert.ok(s.sides[seat].zones.drop.includes(extra),"P389 invokes Battle line from deck into Drop");
  assert.ok(s.sides[other(seat)].zones.battle.includes(barrier),"BT8-137 waits until end of turn");
  s=settle(take(s,{type:"endMain",player:seat}));
  assert.ok(s.sides[other(seat)].zones.drop.includes(barrier),"BT8-137 delayed clear ignores Barrier");cases++;
 }
}
for(const seat of ["p1","p2"] as const)for(const origin of ["hand","deck","drop"]){
 for(const stop of ["decline","negated","forbidden"]){
  let s=fresh(seat);const src=stage(s,seat,`IO5_${origin}`,"battle"),target=stage(s,seat,"IO5_Main",origin);const before=s.sides[seat].zones.hand.length;
  if(stop==="negated")addEffect(s,[],{target,kind:"negateSkills",value:0,until:"game"});
  if(stop==="forbidden")addEffect(s,[],{target,kind:"forbid",value:0,until:"game",forbid:{what:"activateSkill",player:seat}});
  s=settle(take(s,{type:"activate",player:seat,card:src,skill:0}),stop==="decline");
  assert.equal(s.sides[seat].zones.hand.length,before+1,`${origin}/${stop}: only parent draws`);assert.ok(s.sides[seat].zones[origin].includes(target));cases++;
 }
 {
  let s=fresh(seat);const src=stage(s,seat,`IO5_${origin}`,"battle"),target=stage(s,seat,"IO5_TWO",origin);
  s=take(s,{type:"activate",player:seat,card:src,skill:0});
  if(origin!=="drop"){
   const snap=buildSnapshot({id:420,mode:"versus",status:"playing",p1Name:"You",p2Name:"Other",ctx,state:s,legal:RULES.legalActions(ctx,s),log:[],beats:null,spotlight:null,spend:{calls:0,input:0,output:0,cached:0,micros:0},ai:null,viewer:other(seat),images:{}});
   assert.ok(!JSON.stringify(snap).includes(target),"opponent never receives private candidate identity");
  }
  for(let i=0;i<6&&s.prompt.kind!=="chooseMode";i++)s=take(s,{type:"choose",player:seat,cards:[target]});
  assert.equal(s.prompt.kind,"chooseMode");const before=s.sides[seat].zones.hand.length;
  const resolved=settle(take(s,{type:"chooseMode",player:seat,index:1}));
  assert.equal(resolved.sides[seat].zones.hand.length,before+4-(origin==="hand"?1:0),"selected Battle line resolves then parent");
  assert.deepEqual(resolved,settle(take(copy(s),{type:"chooseMode",player:seat,index:1})),"saved line choice replays identically");
  const changed=copy(s);assert.ok(moveCard(changed,game,target,origin==="drop"?"hand":"drop",{owner:seat}).ok);assert.ok(moveCard(changed,game,target,origin,{owner:seat}).ok);
  assert.throws(()=>take(changed,{type:"chooseMode",player:seat,index:1}),/same occurrence|no longer eligible/);cases++;
 }
}
for(const seat of ["p1","p2"] as const)for(const origin of ["hand","deck","drop"]){
 for(const def of ["IO5_FIELD","IO5_BATTLE","IO5_LIMIT"]){
  let s=fresh(seat);const src=stage(s,seat,`IO5_${origin}`,"battle"),target=stage(s,seat,def,origin);const before=s.sides[seat].zones.hand.length;
  assert.ok(!RULES.legalActions(ctx,s).some(x=>x.action.type==="activate"&&x.action.card===target),"no ordinary activation permission for these unaffordable or out-of-play cards");
  s=settle(take(s,{type:"activate",player:seat,card:src,skill:0}));
  assert.equal(s.sides[seat].zones.hand.length,before+1+(def==="IO5_LIMIT"?2:0)-(origin==="hand"&&def!=="IO5_BATTLE"?1:0));
  assert.ok(s.sides[seat].zones[def==="IO5_FIELD"?"battle":def==="IO5_LIMIT"?"drop":origin].includes(target));
  if(def==="IO5_LIMIT"){
   const second=stage(s,seat,"IO5_drop","battle"),hand=s.sides[seat].zones.hand.length;
   s=settle(take(s,{type:"activate",player:seat,card:second,skill:0}));
   assert.equal(s.sides[seat].zones.hand.length,hand+1,"Limit survives hand/deck-to-Drop invocation");
  }cases++;
 }
}
// R-389/R-420: a waived payment has known-empty history, not an obsolete save.
for(const seat of ["p1","p2"] as const)for(const origin of ["hand","deck","drop"]){
 let s=fresh(seat);const src=stage(s,seat,`IO5_${origin}`,"battle"),target=stage(s,seat,"IO5_BURST",origin);
 stage(s,seat,"IO5_BLACK","drop");for(const id of s.sides[seat].zones.deck.slice(0,3))s.cards[id].cardId="IO5_BLACK";
 const deck=s.sides[seat].zones.deck.length,hand=s.sides[seat].zones.hand.length;
 s=settle(take(s,{type:"activate",player:seat,card:src,skill:0}));
 assert.ok(s.sides[seat].zones.drop.includes(target));
 assert.equal(s.sides[seat].zones.deck.length,deck-1-(origin==="deck"?1:0),"Burst is waived; only parent draws");
 assert.equal(s.sides[seat].zones.hand.length,hand+1-(origin==="hand"?1:0),"unpaid cards do not satisfy historical condition");cases++;
}
console.log(`invocation origins 5: ${cases} scenarios passed`);
