/** R-362: stored Life face-up Autos, causal controller, and explicit hand watchers. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { hiddenAliases, resolveAliased } from "../../src/lib/arena/conceal";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const defs:Record<string,CardDef>={
 LF5_LEADER:card("LF5_LEADER",{type:"LEADER",colors:["Red"],traits:["Earthling"],power:10000,energyCost:null,comboCost:null,comboPower:null}),
 LF5_FILLER:card("LF5_FILLER",{}),
 LF5_RED:card("LF5_RED",{colors:["Red"],skill:"[Activate: Main] Flip up to 1 card in your life face up."}),
 LF5_BLUE:card("LF5_BLUE",{colors:["Blue"],skill:"[Activate: Main] Flip up to 1 card in your life face up."}),
 LF5_FOE:card("LF5_FOE",{colors:["Red"],skill:"[Activate: Main] Flip up to 1 card in your opponent's life face up."}),
 LF5_LEFT:card("LF5_LEFT",{colors:["Red"],skill:"[Activate: Main] Place this card into its owner's Drop: Flip up to 1 card in your life face up."}),
 LF5_SELF:card("LF5_SELF",{skill:"[Auto] When this card in your life is flipped face up by one of your red card skills, draw 1 card."}),
 LF5_WATCH:card("LF5_WATCH",{skill:"[Auto] When a card in your life is flipped face up by one of your red card skills, draw 1 card."}),
 LF5_BARE:card("LF5_BARE",{skill:"[Auto] When a card in your life is flipped face up, draw 1 card."}),
};
defs["BT12-001"]=card("BT12-001",{"type": "LEADER", "name": "Launch", "colors": ["Red"], "traits": ["Earthling"], "characters": ["Launch"], "skill": "[Auto][Once per turn] When you combo, draw 1 card.<br>[Auto] When a card in your life is flipped face up by one of your red card skills, you may flip this card over. If you do, draw 1 card and you can't flip your Leader Card to its front for the turn.", "energyCost": 0, "back": {"name": "Launch, Nothing to Sneeze At", "skill": "[Auto] When this card attacks, choose up to 1 of your opponent's cards and it gets -5000 power for the battle.<br>[Auto][Once per turn] When you combo, draw 1 card.<br>[Auto] When a card in your life is flipped face up by one of your red card skills, you may flip this card over. If you do, draw 1 card and you can't flip your Leader Card to its back for the turn.", "power": 15000}});
defs["BT12-005"]=card("BT12-005",{"type": "BATTLE", "name": "Son Goku, Eye for an Eye", "colors": ["Red"], "traits": ["Saiyan"], "characters": ["Son Goku: Childhood"], "skill": "[auto]{r}{r}, if your Leader Card is a red \u226aEarthling\u226b-only card: When this card in your life is flipped face up by one of your red card skills, you may place the top card of your deck in your life, then play this face-up card from your life. If you didn't play a card, place this face-up card in your Drop Area from your life.<br>[auto][once per turn] When your opponent activates a [counter] skill, deal 1 damage to them.", "energyCost": 0, "back": null});
defs["BT12-006"]=card("BT12-006",{"type": "BATTLE", "name": "Son Goku, Ready for Anything", "colors": ["Red"], "traits": ["Saiyan"], "characters": ["Son Goku: Childhood"], "skill": "[unique][critical]<br>[auto]{r}, if your Leader Card is a red \u226aEarthling\u226b-only card and you have 2 or more red energy: When this card in your life is flipped face up by one of your red card skills, you may place the top card of your deck in your life, then play this face-up card from your life. If you didn't play a card, place this face-up card in your Drop Area from your life.", "energyCost": 0, "back": null});
defs["BT12-009"]=card("BT12-009",{"type": "BATTLE", "name": "Tien Shinhan, Ready for Anything", "colors": ["Red"], "traits": ["Earthling"], "characters": ["Tien Shinhan"], "skill": "[unique][double strike]<br>[auto]{r}, if your Leader Card is a red \u226aEarthling\u226b-only card and you have 2 or more red energy: When this card in your life is flipped face up by one of your red card skills, you may place the top card of your deck in your life, then play this face-up card from your life. If you didn't play a card, place this face-up card in your Drop Area from your life.", "energyCost": 0, "back": null});
defs["BT12-010"]=card("BT12-010",{"type": "BATTLE", "name": "Master Roshi, Ready for Anything", "colors": ["Red"], "traits": ["Earthling"], "characters": ["Master Roshi"], "skill": "[unique][blocker][revenge]<br>[auto]{r}, if your Leader Card is a red \u226aEarthling\u226b-only card: When this card in your life is flipped face up by one of your red card skills, you may place the top card of your deck in your life, then play this face-up card from your life. If you didn't play a card, place this face-up card in your Drop Area from your life.", "energyCost": 0, "back": null});
defs["BT12-121"]=card("BT12-121",{"type": "EXTRA", "name": "Cutting-Edge Recovery Device", "colors": ["Yellow"], "traits": [], "characters": [], "skill": "[Barrier][Field]<br>[Auto][Once per turn] When a card in your life is flipped face up, choose up to 1 of your opponent's cards and switch it to Rest Mode.<br>[Activate: Main][Once per turn] If all of your energy is mono-yellow and you choose 1 card in your life and 1 yellow \u226aFrieza's Army\u226b card in your Battle Area and place them in their owners' Drop Areas: Draw 2 cards, then choose up to 1 mono-yellow \u226aFrieza's Army\u226b card or mono-yellow Unison Card in your hand and place it in your life face up.<br>[Activate: Main/Battle] If you have 3 or more face-up cards in your life and you place this card in its owner's Drop Area: You may flip your Leader Card to its back side. If you do, place the top card of your deck in your life face up.", "energyCost": 0, "back": null});
defs["EX19-01"]=card("EX19-01",{"type": "BATTLE", "name": "Bulma, to Incite a Sneeze", "colors": ["Red"], "traits": ["Earthling", "Heroine"], "characters": ["Bulma"], "skill": "[Unique][Barrier]<br>[Auto][Limit 1] If your Leader Card is a red \u226aEarthling\u226b-only card with 10000 power or less: When a card in your life is flipped face up by one of your red card skills, you may play this card from your hand. If you do, choose up to 1 of your red Unison Cards with 1000 power and 2 markers or less, add a marker to it, and you can't play multicolor Battle Cards for the game.<br>[Auto] If your Leader Card is a red \u226aEarthling\u226b-only card with 10000 power or less: When a face-up red Battle Card in your life is played, it gets +5000 power for the turn.", "energyCost": 0, "back": null});
defs.LF5_PLAIN_DOWN=card("LF5_PLAIN_DOWN",{skill:"[Activate: Main] Flip up to 1 card in your life face down."});
defs.LF5_DOWN=card("LF5_DOWN",{skill:"[Activate: Main] Flip 1 face-up card in your life face down."});
defs.LF5_SEEN=card("LF5_SEEN",{skill:"[Activate: Main] Look at up to 3 cards from the top of your deck, then flip up to 1 card among them face up."});
const records=Object.values(defs).flatMap(skillRecords);
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(records.map((r,id)=>({...r,id,source:"compiler",status:"draft"}) as unknown as RuleRow)),defs)};
const flipped=records.filter(r=>r.trigger?.includes("flippedFaceUp"));assert.equal(flipped.filter(r=>!r.cardId.startsWith("LF5_")).length,8);
for(const r of flipped){assert.deepEqual(r.unread,[]);assert.deepEqual(ctx.scripts![r.cardId+(r.side==="back"?"#back":"")].bySkill[r.skillIndex]?.unsupported,[]);}
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>copy(RULES.apply(ctx,copy(s),a).state as VmState);
function fresh(first:PlayerId):VmState{
 let s=RULES.createGame(ctx,{seed:362,p1:{name:"A",leader:"LF5_LEADER",main:fifty("LF5_FILLER")},p2:{name:"B",leader:"LF5_LEADER",main:fifty("LF5_FILLER")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:other(first),redraw:false},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);
 return s;
}
function stage(s:VmState,p:PlayerId,def:string,zone:string):string{
 const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,zone,{owner:p}).ok);return id;
}
function view(s:VmState,viewer:PlayerId){return JSON.stringify(buildSnapshot({id:362,mode:"versus",status:"playing",p1Name:"You",p2Name:"Other",ctx,state:s,legal:RULES.legalActions(ctx,s),log:[],beats:null,spotlight:null,spend:{calls:0,input:0,output:0,cached:0,micros:0},ai:null,viewer,images:{}}));}
function settle(s:VmState):VmState{
 for(let n=0;n<60;n++){
  if(s.prompt.kind==="main")return s;
  const actions=RULES.legalActions(ctx,s).map(x=>x.action);
  const a=actions.find(a=>a.type==="choose"?a.cards.length>0:a.type==="chooseMode"?a.index===0:a.type==="orderPending"?!a.decline:a.type==="counter"?a.card===null:a.type==="payCost"||a.type==="pass")??actions.find(a=>a.type==="choose"&&a.cards.length===0);
  assert.ok(a,`no answer ${s.prompt.kind}`);s=take(s,a);
 }throw Error("did not settle");
}
let cases=0;
for(const owner of ["p1","p2"] as const){
 for(const mode of ["red","blue","foe","left","controlledLeft","already"]){
  const actor=mode==="foe"?other(owner):owner;
  let s=fresh(actor);const source=stage(s,mode==="controlledLeft"?other(owner):actor,mode==="foe"?"LF5_FOE":mode==="blue"?"LF5_BLUE":mode==="left"||mode==="controlledLeft"?"LF5_LEFT":"LF5_RED","battle");
  if(mode==="controlledLeft")assert.ok(moveCard(s,game,source,"battle",{owner:actor,carry:true}).ok);
  const life=stage(s,owner,"LF5_SELF","life");stage(s,owner,"LF5_SELF","battle");stage(s,owner,"LF5_WATCH","battle");stage(s,owner,"LF5_BARE","battle");stage(s,other(owner),"LF5_WATCH","battle");
  if(mode==="already")s.cards[life].faceUp=true;
  const before=s.sides[owner].zones.hand.length,foeBefore=s.sides[other(owner)].zones.hand.length;
  s=take(s,{type:"activate",player:actor,card:source,skill:0});assert.equal(s.prompt.kind,"chooseCards");
  // R-363: both chooser and non-chooser see positions only until the selected Life card turns face up.
  if(mode!=="already")for(const viewer of ["p1","p2"] as const)assert.ok(!view(s,viewer).includes(JSON.stringify(life)),"neither viewer can see face-down Life identity");
  const chosen=take(s,{type:"choose",player:actor,cards:[life]});assert.deepEqual(chosen,take(copy(s),{type:"choose",player:actor,cards:[life]}));
  for(const pending of chosen.pending.filter(p=>p.trigger==="flippedFaceUp"))assert.equal(pending.subject,life,"self and external watchers bind the flipped Life card, never the distinct source");
  assert.ok(view(chosen,other(owner)).includes(JSON.stringify(life)),"actual face-up card becomes public");s=settle(chosen);
  assert.equal(s.sides[owner].zones.hand.length,before+(mode==="already"?0:mode==="foe"||mode==="blue"?1:3),`${owner}/${mode}: exactly self, own-colour watcher, bare watcher`);
  assert.equal(s.sides[other(owner)].zones.hand.length,foeBefore,"other side never watches your Life flip");cases++;
 }
 for(const id of ["BT12-005","BT12-006","BT12-009","BT12-010"]){
  let s=fresh(owner);const source=stage(s,owner,"LF5_RED","battle"),life=stage(s,owner,id,"life");stage(s,owner,"LF5_RED","energy");stage(s,owner,"LF5_RED","energy");
  s=take(s,{type:"activate",player:owner,card:source,skill:0});s=settle(take(s,{type:"choose",player:owner,cards:[life]}));
  assert.ok(s.sides[owner].zones.battle.includes(life),`${id} paid and played its actual face-up Life card`);cases++;
 }
 {
  let s=fresh(owner);const source=stage(s,owner,"LF5_RED","battle"),life=stage(s,owner,"LF5_FILLER","life"),hand=stage(s,owner,"EX19-01","hand");
  s=take(s,{type:"activate",player:owner,card:source,skill:0});s=settle(take(s,{type:"choose",player:owner,cards:[life]}));
  assert.ok(s.sides[owner].zones.battle.includes(hand),"EX19-01 actual explicit hand watcher plays");cases++;
 }
}
for(const owner of ["p1","p2"] as const){
 for(const back of [false,true]){
  let s=fresh(owner);const leader=s.sides[owner].zones.leader[0];s.cards[leader].cardId="BT12-001";s.cards[leader].flipped=back;
  const source=stage(s,owner,"LF5_RED","battle"),life=stage(s,owner,"LF5_FILLER","life"),before=s.sides[owner].zones.hand.length;
  s=take(s,{type:"activate",player:owner,card:source,skill:0});s=settle(take(s,{type:"choose",player:owner,cards:[life]}));
  assert.equal(s.cards[leader].flipped,!back,"actual Launch Auto flips from the triggered face");assert.equal(s.sides[owner].zones.hand.length,before+1);cases++;
 }
 {
  let s=fresh(owner);const source=stage(s,owner,"LF5_RED","battle"),life=stage(s,owner,"LF5_FILLER","life"),watch=stage(s,owner,"BT12-121","battle"),foe=stage(s,other(owner),"LF5_FILLER","battle");
  s=take(s,{type:"activate",player:owner,card:source,skill:0});s=settle(take(s,{type:"choose",player:owner,cards:[life]}));
  assert.ok(s.cards[watch].usedThisTurn.length>0,"actual BT12-121 once-per-turn spent");
  assert.ok(s.cards[foe].mode==="rest"||s.cards[s.sides[other(owner)].zones.leader[0]].mode==="rest","actual BT12-121 rests a chosen opponent card");cases++;
 }
 // A pending hand Auto does not grant permission to play its departed source from another area.
 {
  let s=fresh(owner);const source=stage(s,owner,"LF5_RED","battle"),life=stage(s,owner,"LF5_SELF","life"),hand=stage(s,owner,"EX19-01","hand");
  s=take(s,{type:"activate",player:owner,card:source,skill:0});s=take(s,{type:"choose",player:owner,cards:[life]});
  assert.ok(s.pending.some(p=>p.card===hand));assert.ok(moveCard(s,game,hand,"drop",{owner}).ok);s=settle(s);assert.ok(s.sides[owner].zones.drop.includes(hand));cases++;
 }
}
for(const owner of ["p1","p2"] as const)for(const changed of ["returnedDown","returnedUp","turnedDown","left"]){
 let s=fresh(owner);const source=stage(s,owner,"LF5_RED","battle"),life=stage(s,owner,"BT12-005","life");stage(s,owner,"LF5_BARE","battle");stage(s,owner,"LF5_RED","energy");stage(s,owner,"LF5_RED","energy");
 s=take(s,{type:"activate",player:owner,card:source,skill:0});s=take(s,{type:"choose",player:owner,cards:[life]});assert.ok(s.pending.some(p=>p.card===life));
 if(changed!=="turnedDown")assert.ok(moveCard(s,game,life,"drop",{owner}).ok);
 if(changed.startsWith("returned"))assert.ok(moveCard(s,game,life,"life",{owner}).ok);
 s.cards[life].faceUp=changed==="returnedUp";
 const count=s.sides[owner].zones.life.length;
 s=settle(copy(s));assert.ok(s.sides[owner].zones[changed==="left"?"drop":"life"].includes(life),"pending Life Auto cannot play or discard a departed/reentered or face-down occurrence");
 assert.equal(s.sides[owner].zones.life.length,count+1,"independent top-deck-to-Life effect still resolves");cases++;
}
for(const owner of ["p1","p2"] as const){
 let s=fresh(owner);const source=stage(s,owner,"LF5_RED","battle"),life=stage(s,owner,"LF5_WATCH","life");const before=s.sides[owner].zones.hand.length;
 s=take(s,{type:"activate",player:owner,card:source,skill:0});s=settle(take(s,{type:"choose",player:owner,cards:[life]}));
 assert.equal(s.sides[owner].zones.hand.length,before,"a generic in-play watcher has no Life activation permission");cases++;
}
// R-363: choose using the client's positional alias, revealing only the chosen Life card.
for(const owner of ["p1","p2"] as const)for(const opponent of [false,true]){
 const actor=opponent?other(owner):owner;let s=fresh(actor);const source=stage(s,actor,opponent?"LF5_FOE":"LF5_RED","battle"),life=stage(s,owner,"LF5_FILLER","life"),untouched=s.sides[owner].zones.life[0];
 s=take(s,{type:"activate",player:actor,card:source,skill:0});assert.equal(s.prompt.kind,"chooseCards");if(s.prompt.kind!=="chooseCards")throw Error("choose");assert.equal(s.prompt.choice.blind,true);
 const alias=hiddenAliases(s,actor,game)[life];assert.ok(alias?.startsWith("?"));assert.ok(view(s,actor).includes(alias));
 assert.equal(resolveAliased({type:"choose",player:actor,cards:[life]} as Action,s,actor,game).ok,false,"raw hidden identity is rejected");
 const answer=resolveAliased({type:"choose",player:actor,cards:[alias]} as Action,s,actor,game);assert.ok(answer.ok);
 s=settle(take(s,answer.value));for(const viewer of ["p1","p2"] as const){assert.ok(view(s,viewer).includes(JSON.stringify(life)));assert.ok(!view(s,viewer).includes(JSON.stringify(untouched)));}cases++;
}
for(const owner of ["p1","p2"] as const){
 {
  let s=fresh(owner);const source=stage(s,owner,"LF5_DOWN","battle"),life=stage(s,owner,"LF5_FILLER","life");s.cards[life].faceUp=true;
  const record=records.find(r=>r.cardId==="LF5_DOWN")!;assert.deepEqual(record.unread,[]);const choose=record.ops.find(o=>o.op==="choose");assert.ok(choose&&choose.op==="choose"&&!choose.blind,"explicit face-up selection remains public");
  s=settle(take(s,{type:"activate",player:owner,card:source,skill:0}));assert.equal(s.cards[life].faceUp,false);cases++;
 }
 {
  let s=fresh(owner);const source=stage(s,owner,"LF5_SEEN","battle");const record=records.find(r=>r.cardId==="LF5_SEEN")!;assert.deepEqual(record.unread,[]);const choose=record.ops.find(o=>o.op==="choose");assert.ok(choose&&choose.op==="choose"&&choose.sel.fromVar&&!choose.blind,"already-looked-at pool remains visible");
  s=take(s,{type:"activate",player:owner,card:source,skill:0});assert.equal(s.prompt.kind,"chooseCards");if(s.prompt.kind!=="chooseCards")throw Error("choose");const first=s.prompt.choice.candidates[0];assert.ok(view(s,owner).includes(JSON.stringify(first)));assert.ok(!view(s,other(owner)).includes(JSON.stringify(first)));s=settle(take(s,{type:"choose",player:owner,cards:[first]}));cases++;
 }
}
for(const owner of ["p1","p2"] as const){
 let s=fresh(owner);const source=stage(s,owner,"LF5_PLAIN_DOWN","battle"),life=stage(s,owner,"LF5_FILLER","life"),hidden=s.sides[owner].zones.life[0];s.cards[life].faceUp=true;
 s=take(s,{type:"activate",player:owner,card:source,skill:0});assert.equal(s.prompt.kind,"chooseCards");if(s.prompt.kind!=="chooseCards")throw Error("choose");assert.equal(s.prompt.choice.blind,true);
 for(const viewer of ["p1","p2"] as const){assert.ok(view(s,viewer).includes(JSON.stringify(life)),"blind choice does not hide an already-public face-up Life card");assert.ok(!view(s,viewer).includes(JSON.stringify(hidden)));}
 s=settle(take(s,{type:"choose",player:owner,cards:[life]}));assert.equal(s.cards[life].faceUp,false);cases++;
}
console.log(`stored face up 5: ${cases} scenarios passed; eight actual stored Auto records usable`);
