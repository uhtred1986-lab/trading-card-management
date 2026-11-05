import { counterEffectOps, counterHasPaidAdmission } from "../../src/lib/arena/vm/counter-admission";
import { counterBindingProblem } from "../../src/lib/arena/vm/skill-play-binding";
/** R432: actual future-card Counter continuation prototype. */
import assert from "node:assert/strict";
import {card,fifty} from "./harness";
import {skillRecords} from "../../src/lib/arena/draft";
import {rulesFromRows,type RuleRow} from "../../src/lib/arena/rules-store";
import {RULES} from "../../src/lib/arena/vm";
import {rulesetFor} from "../../src/lib/arena/rulesets";
import {moveCard} from "../../src/lib/arena/vm/zones";
import type {Action,CardDef,EngineContext,PlayerId} from "../../src/lib/arena/types";
import type {VmState} from "../../src/lib/arena/vm/state";
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const defs:Record<string,CardDef>={F:card("F",{}),L:card("L",{type:"LEADER"}),ENERGY:card("ENERGY",{colors:["Blue","Yellow","Black","Green","White"]}),HIGH:card("HIGH",{energyCost:6,power:40000}),SOURCE:card("SOURCE",{skill:"[Activate: Main] Choose up to 1 Battle Card from your hand and play it."})};
defs["DB2-169"]=card("DB2-169",{"name": "Geene & Martinne, Universe 12 Destroyer & Angel", "colors": ["Blue", "Yellow"], "power": 19000, "characters": ["Geene", "Martinne"], "traits": ["God", "Universe 12"], "skill": "[Counter: Play] If the Battle Card being played has an energy cost of 5 or less, negate its skills for the turn and play this card.<br>[Energy-Exhaust]<br>[Aegis Blue/Yellow][Once per turn]<br>[Auto][Once per turn] When you activate [Aegis Blue/Yellow], draw 2 cards.", "type": "BATTLE", "energyCost": 3});
defs["BT1-110"]=card("BT1-110",{"name": "Crusher Ball", "colors": ["Yellow"], "power": null, "characters": [], "traits": [], "skill": "[Counter: Play] The Battle Card played is played in Rest Mode.", "type": "EXTRA", "energyCost": 1});
defs["BT10-136"]=card("BT10-136",{"name": "Towa, Twisted Sister", "colors": ["Black"], "power": 4000, "characters": ["Towa"], "traits": ["Demon Realm Race", "Demon God"], "skill": "[Counter: Play] Play this card.<br>[Auto] When this card is played, draw 1 card, then shuffle up to 1 card from your opponent's Drop Area into their deck.", "type": "BATTLE", "energyCost": 1});
defs["DB2-040"]=card("DB2-040",{"name": "Hit, Deadly Vanguard", "colors": ["Blue"], "power": 15000, "characters": ["Hit"], "traits": ["Alien", "Universe 6"], "skill": "[Counter: Play] If the Battle Card being played has an energy cost of 5 or less, it is returned to its owner's hand instead of being played, then play this card.<br>[Permanent] During your opponent's turn, reduce the energy cost of this card in your hand by 2.<br>[Permanent] This card can't be returned to your hand by your skills.<br>[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards with an energy cost of 5 or less and return it to its owner's hand.", "type": "BATTLE", "energyCost": 5});
defs["BT29-112"]=card("BT29-112",{"name": "Hyper Meta-Rilldo, Masterpiece", "type": "BATTLE", "colors": ["White"], "power": 15000, "characters": ["General Rilldo"], "traits": ["Machine Mutant"], "skill": "[Counter: Play][Limit 1] If the Battle Card being played has an energy cost of 3 or less, place it in its owner's Drop instead of playing it, then play this card.\n[Permanent] If your life is at 4 or less and you have a Hidden Mode card, reduce the energy cost of this card in your hand by 2.\n[Auto] When this card is played, choose up to 1 of your white Battle Cards and it gets +5000 power for the turn.", "energyCost": 3});
defs["BT27-073"]=card("BT27-073",{"name": "Mercenary Tao, Confrontation", "type": "BATTLE", "colors": ["Yellow"], "power": 25000, "characters": ["Mercenary Tao"], "traits": ["Earthling", "Fierce Foe"], "skill": "[Blocker]\n[br]\n[Counter: Play][Limit 1] If your opponent's Battle Card being played has 35000 power or less, it's played in Rest Mode, then you play this card.\n[br]\n[Permanent] If your Leader is a yellow \u226aFierce Foe\u226b card and all of your energy is in Rest Mode, you can activate this card's [Counter] skill from your hand by adding 1 card from your life to your hand instead of paying its energy cost.", "energyCost": 4});
defs["BT9-027"]=card("BT9-027",{"name": "Frieza, Undying Emperor", "type": "BATTLE", "colors": ["Blue"], "power": 15000, "characters": ["Frieza"], "traits": ["Frieza Clan", "Universe 7"], "skill": "[Counter: Play] If the Battle Card being played has an energy cost of 3 or less, it is returned to its owner's hand instead of being played, then play this card.", "energyCost": 2});
defs["BT25-092"]=card("BT25-092",{"name": "Bujin, Space Pirate Psychic", "type": "BATTLE", "colors": ["Green"], "power": 4000, "characters": ["Bujin"], "traits": ["Boujack Brigade"], "skill": "[Counter: Play][Limit 1] If the Battle Card being played has an energy cost of 2 or less, place it in its owner's Drop instead of playing it, then play this card.\n[br]\n[Permanent] If you have 3 or more face-up \u226aBoujack Brigade\u226b cards in your Z-Deck, you can activate this card's [Counter] skill from your hand by adding 1 card from your life to your hand instead of paying its energy cost.", "energyCost": 1});
defs["BT11-042"]=card("BT11-042",{"name": "Baby, Golden Avenger", "type": "BATTLE", "colors": ["Blue"], "power": 30000, "characters": ["Baby"], "traits": ["Saiyan", "Machine Mutant", "Great Ape"], "skill": "[Unique][Triple Strike]<br>[Counter: Play] Play this card, then if the Battle Card being played has an energy cost of 7 or less, it's returned to its owner's hand instead of being played.<br>[Counter: Counter] Negate the [Counter] skill and play this card.<br>[Auto] When this card is played, draw 1 card, then choose up to 1 of your opponent's Battle Cards, ignoring [Barrier], and place it at the bottom of its owner's deck.", "energyCost": 5});
defs.UNISON=card("UNISON",{type:"UNISON"});
defs.SOURCEMANY=card("SOURCEMANY",{skill:"[Activate: Main] Choose up to 2 Battle Cards from your hand and play them."});
defs.SOURCEANY=card("SOURCEANY",{skill:"[Activate: Main] Choose up to 1 Unison Card from your hand and play it with 2 markers on it."});
defs.DEFLECT=card("DEFLECT",{skill:"[Deflect]"});
defs["DB1-040"]=card("DB1-040",{type:"EXTRA",colors:["Blue"],energyCost:1,skill:"[Counter: Play] If the Battle Card your opponent is playing has an energy cost of 2 or less, it is returned to its owner's hand instead of being played, then choose up to 1 of your blue Battle Cards with an energy cost of 3 or less and return it to its owner's hand."});
defs["BT2-043"]=card("BT2-043",{colors:["Blue"],skill:"[Activate: Main] Place this card at the bottom of your deck: Choose 1 blue <Son Goku> or <Vegeta> with an energy cost of 3 or less from your hand and play it."});
defs.BLUEBARRIER=card("BLUEBARRIER",{colors:["Blue"],energyCost:3,skill:"[Barrier]"});
defs.RED=card("RED",{colors:["Red"],energyCost:1});defs.BIG=card("BIG",{colors:["Blue"],energyCost:4});
defs.LOW=card("LOW",{colors:["Blue"],characters:["Son Goku"],energyCost:2});defs.THREE=card("THREE",{colors:["Blue"],characters:["Vegeta"],energyCost:3});defs.BLUE=card("BLUE",{colors:["Blue"],energyCost:3});
const rows=Object.values(defs).flatMap(skillRecords).map((r,id)=>({...r,id,source:"compiler",status:"confirmed"}) as unknown as RuleRow);
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(rows),defs)};const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>RULES.apply(ctx,copy(s),a).state as VmState;
function fresh(first:PlayerId,leader="L"){
 let s=RULES.createGame(ctx,{seed:430,p1:{name:"One",leader:first==="p1"?leader:"L",main:fifty("F")},p2:{name:"Two",leader:first==="p2"?leader:"L",main:fifty("F")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:other(first),redraw:false},{type:"charge",player:first,card:null},{type:"endMain",player:first},{type:"charge",player:other(first),card:null},{type:"endMain",player:other(first)},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);return s;
}
function stage(s:VmState,p:PlayerId,def:string,area:string){const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);return id;}
function answer(s:VmState,id:string|null){assert.equal(s.prompt.kind,"counter");return take(s,{type:"counter",player:s.prompt.player!,card:id});}
function finish(s:VmState):VmState{
 for(let n=0;n<50&&s.prompt.kind!=="main";n++){
  assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));const p=s.prompt;
  if(p.kind==="chooseCards")s=take(s,{type:"choose",player:p.player,cards:p.choice.candidates.slice(0,p.choice.min??0)});
  else {const actions=RULES.legalActions(ctx,s).map(x=>x.action),a=actions.find(a=>a.type==="payCost")??actions.find(a=>a.type==="counter"&&a.card===null)??actions.find(a=>a.type==="orderPending"&&a.index===0);assert.ok(a,JSON.stringify(p));s=take(s,a);}
 }assert.equal(s.prompt.kind,"main");return s;
}
let cases=0;
for(const owner of ["p1","p2"] as const)for(const high of [false,true])for(const decline of [false,true]){
 let s=fresh(owner);const source=stage(s,owner,"BT2-043","battle"),target=stage(s,owner,high?"THREE":"LOW","hand"),counter=stage(s,other(owner),"DB1-040","hand"),own=stage(s,other(owner),"BLUE","battle");stage(s,other(owner),"ENERGY","energy");
 const protectedOwn=stage(s,other(owner),"BLUEBARRIER","battle");
 const foreign=stage(s,owner,"BLUE","battle"),red=stage(s,other(owner),"RED","battle"),big=stage(s,other(owner),"BIG","battle"),unison=stage(s,other(owner),"UNISON","unison");
 const activate=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source);assert.ok(activate);s=take(s,activate);
 // Actual Trunks price and its shared before window.
 for(let n=0;n<15&&s.prompt.kind!=="counter";n++){const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="payCost"||a.type==="choose");assert.ok(a,JSON.stringify(s.prompt));s=take(s,a);}
 assert.equal(s.prompt.kind,"counter");assert.ok(RULES.legalActions(ctx,s).some(x=>x.action.type==="counter"&&x.action.card===counter));s=answer(s,counter);
 for(let n=0;n<15&&s.prompt.kind!=="chooseCards";n++){const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="payCost"||a.type==="counter"&&a.card===null);assert.ok(a,JSON.stringify(s.prompt));s=take(s,a);}
 assert.ok(s.prompt.kind==="chooseCards");assert.equal(s.prompt.player,owner);assert.equal(s.skillPlayScopes?.[0].retainedCounters?.[0].scope?.purpose,"counterContinuation");
 if(!high&&!decline)for(const before of [false,true]){
  // Staged binding-cursor control, not an invented second response in one window.
  let saved=copy(s);const parent=saved.skillPlayScopes![0];parent.bindings=[{skillPlayInternal:{version:1,kind:"arrivalBinding"},ops:[{op:"resolvingPlay",mode:"rest"}],ip:0,vars:{},card:counter,master:other(owner),counterPlay:true}];parent.retainedCounters![0].at=before?1:0;
  saved=take(saved,{type:"choose",player:owner,cards:[target]});assert.ok(saved.prompt.kind==="chooseCards");const resume=saved.programs.find(frame=>frame.retainedResume)?.retainedResume;assert.ok(resume);assert.equal(resume.frame.pendingArrival?.cursor,before?1:0);
  saved=take(saved,{type:"choose",player:other(owner),cards:[]});saved=finish(saved);assert.ok(saved.sides[owner].zones.hand.includes(target));assert.ok(saved.sides[other(owner)].zones.battle.includes(own));assert.equal(saved.skillPlayScopes,undefined);cases++;
 }
 s=take(s,{type:"choose",player:owner,cards:[target]});
 if(!high){assert.ok(s.prompt.kind==="chooseCards");assert.equal(s.prompt.player,other(owner));assert.ok(s.prompt.choice.candidates.includes(own));assert.ok(s.prompt.choice.candidates.includes(protectedOwn));
 if(!decline){
  const ended=take(copy(s),{type:"concede",player:other(owner)});assert.equal(ended.outcome?.winner,owner);assert.equal(ended.skillPlayScopes,undefined);assert.equal(ended.programs.length,0);cases++;
  for(const malformed of ["missing","array","sourceRule"]){const stale=copy(s);const frame=stale.programs.find(f=>f.card===counter&&f.counterChoice)!;assert.ok(frame);if(malformed==="missing")delete frame.counterChoice!.candidates;else if(malformed==="array")frame.counterChoice!.candidates={} as never;else frame.skillIndex=999;const stopped=take(stale,{type:"choose",player:other(owner),cards:[own]});assert.match(JSON.stringify(stopped.outcome),/rebuild this saved Counter chooser occurrences|rebuild this Counter continuation against its current stored rule/);assert.ok(stopped.sides[other(owner)].zones.battle.includes(own));cases++;}
 }
 if(!decline){const stale=copy(s);assert.ok(moveCard(stale,game,own,"hand").ok);assert.ok(moveCard(stale,game,own,"battle").ok);let rejected=false;try{const result=take(stale,{type:"choose",player:other(owner),cards:[own]});rejected=!!result.outcome||result.sides[other(owner)].zones.battle.includes(own);}catch(error){assert.match(String(error),/Counter choice occurrence/);rejected=true;}assert.ok(rejected,"fresh own-card occurrence must not be returned");cases++;}
 for(const id of [foreign,red,big,unison])assert.ok(!s.prompt.choice.candidates.includes(id));s=take(s,{type:"choose",player:other(owner),cards:decline?[]:[own]});}
 s=finish(s);assert.equal(s.sides[other(owner)].zones.energy.filter(id=>s.cards[id].mode==="rest").length,1);assert.ok(s.sides[other(owner)].zones.drop.includes(counter));assert.equal(s.sides[owner].zones.deck.at(-1),source);assert.ok(s.sides[owner].zones[high?"battle":"hand"].includes(target));assert.ok(s.sides[other(owner)].zones[!high&&!decline?"hand":"battle"].includes(own));assert.equal(s.skillPlayScopes,undefined);cases++;
}
for(const owner of ["p1","p2"] as const)for(const mode of ["zero","deflect","unison","counterNegated","staleMarker","sourceReentered"]){
 let s=fresh(owner);const source=stage(s,owner,mode==="unison"?"SOURCEANY":"SOURCE","battle"),target=stage(s,owner,mode==="deflect"?"DEFLECT":mode==="unison"?"UNISON":"F","hand"),counter=stage(s,other(owner),"DB1-040","hand"),own=stage(s,other(owner),"BLUE","battle");stage(s,other(owner),"ENERGY","energy");
 let negate:string|undefined;if(mode==="counterNegated"){negate=stage(s,owner,"BT11-042","hand");for(let n=0;n<6;n++)stage(s,owner,"ENERGY","energy");}
 const activate=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source);assert.ok(activate);s=answer(take(s,activate),counter);
 for(let n=0;n<20&&s.prompt.kind!=="chooseCards";n++){
  const actions=RULES.legalActions(ctx,s).map(x=>x.action);const paid=actions.find(a=>a.type==="payCost");
  const reply=negate?actions.find(a=>a.type==="counter"&&a.card===negate&&(a.skill===20||a.skill===undefined)):undefined;
  if(reply){assert.equal(s.prompt.kind,"counter");s=take(s,reply);negate=undefined;continue;}
  const a=paid??actions.find(a=>a.type==="counter"&&a.card===null);assert.ok(a,JSON.stringify(s.prompt));s=take(s,a);
 }
 assert.ok(s.prompt.kind==="chooseCards");assert.equal(s.prompt.player,owner);
 if(mode==="staleMarker"){delete s.skillPlayScopes![0].retainedCounters![0].scope!.purpose;s=take(s,{type:"choose",player:owner,cards:[target]});assert.match(JSON.stringify(s.outcome),/rebuild this retained Counter choice lifetime/);cases++;continue;}
 if(mode==="sourceReentered"){assert.ok(moveCard(s,game,counter,"hand").ok);assert.ok(moveCard(s,game,counter,"drop").ok);}
 s=take(s,{type:"choose",player:owner,cards:mode==="zero"?[]:[target]});
 if(mode==="deflect"||mode==="sourceReentered"){assert.ok(s.prompt.kind==="chooseCards");assert.equal(s.prompt.player,other(owner));s=take(s,{type:"choose",player:other(owner),cards:[own]});}
 s=finish(s);assert.equal(s.skillPlayScopes,undefined);assert.ok(s.sides[other(owner)].zones[mode==="deflect"||mode==="sourceReentered"?"hand":"battle"].includes(own));if(mode==="deflect"||mode==="counterNegated")assert.ok(s.sides[owner].zones.battle.includes(target),JSON.stringify({mode,negate,target:s.cards[target],zones:s.sides[owner].zones}));cases++;
}
for(const owner of ["p1","p2"] as const){
 let s=fresh(owner);const source=stage(s,owner,"SOURCE","battle"),target=stage(s,owner,"F","hand"),counter=stage(s,other(owner),"DB1-040","hand"),own=stage(s,other(owner),"BLUE","battle");stage(s,other(owner),"ENERGY","energy");
 const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source);assert.ok(a);s=answer(take(s,a),null);assert.ok(s.prompt.kind==="chooseCards");s=take(s,{type:"choose",player:owner,cards:[target]});assert.equal(s.prompt.kind,"counter");s=answer(s,counter);s=finish(s);assert.ok(s.sides[owner].zones.battle.includes(target));assert.ok(s.sides[other(owner)].zones.battle.includes(own));assert.equal(s.skillPlayScopes,undefined);cases++;
}
const admission={kind:"count" as const,sel:{side:"you" as const,area:"leader" as const},atLeast:1};
const original=ctx.scripts!["DB1-040"].bySkill[0];const gated={...original,price:{...original.price!,condition:admission},paidAdmission:{version:1 as const,condition:admission},ops:[{op:"if" as const,cond:admission,then:original.ops}]};
assert.equal(counterHasPaidAdmission(gated),false);assert.equal(counterEffectOps(gated),gated.ops);assert.ok(counterBindingProblem(counterEffectOps(gated),false,true));cases++;
console.log(`counter-choice-tail-5: ${cases} native cases passed`);
