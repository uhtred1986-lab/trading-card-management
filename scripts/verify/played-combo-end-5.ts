/** R-485: full frozen printed skills; synthetic numeric play/combo costs explicitly zero. */
import assert from "node:assert/strict";
import gohan from "./fixtures/gohan-target-paired-5.json";
import fixtures from "./fixtures/played-combo-end-5.json";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { shuffle as expectedShuffle } from "../../src/lib/arena/vm/rng";
import { vmRevealedTo } from "../../src/lib/arena/vm/view";
import type { Action, CardDef, Color, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const keys=["P-656#10","BT16-131#10","BT16-143#20"] as const;
const defs:Record<string,CardDef>={
 F:card("F",{}),L:card("L",{type:"LEADER",colors:["Blue"],characters:["Whis"]}),
 WRONGCHAR:card("WRONGCHAR",{type:"LEADER",colors:["Blue"],characters:["Son Goku"]}),WRONGCOLOR:card("WRONGCOLOR",{type:"LEADER",colors:["Red"],characters:["Whis"]}),
 A:card("A",{power:10000,energyCost:0}),G:card("G",{power:100000}),MULTI:card("MULTI",{colors:["Blue","Yellow"]}),BLUE:card("BLUE",{colors:["Blue"]}),YELLOW:card("YELLOW",{colors:["Yellow"]}),
 VICTIM:card("VICTIM",{energyCost:4,skill:""}),HIGH:card("HIGH",{energyCost:5,skill:""}),BARRIER:card("BARRIER",{energyCost:4,skill:"[Barrier]"}),UNI:card("UNI",{type:"UNISON",energyCost:2}),
 TWO:card("TWO",{energyCost:2,skill:""}),ONE:card("ONE",{energyCost:1,skill:""}),THREE:card("THREE",{energyCost:3,skill:""}),SKILLED:card("SKILLED",{energyCost:2,skill:"[Critical]"}),
};
for(const key of keys){const c=fixtures[key].card;defs[c.id]=card(c.id,{name:c.name,colors:c.colors as Color[],characters:c.characters,traits:c.traits,skill:c.skill,energyCost:0,comboCost:0,power:10000});}
for(const area of ["hand","Drop Area","deck"]){
 defs[`PLAY-${area}`]=card(`PLAY-${area}`,{energyCost:0,skill:`[Activate: Main] Choose up to 1 Battle Card from your ${area} and play it.`});
 defs[`COUNTER-${area}`]=card(`COUNTER-${area}`,{type:"EXTRA",energyCost:0,skill:`[Counter: Play] Choose up to 1 Battle Card from your ${area} and play it.`});
 defs[`COMBO-${area}`]=card(`COMBO-${area}`,{energyCost:0,skill:`[Activate: Battle] Choose up to 1 Battle Card from your ${area} and use it in a combo.`});
}
defs.NEGATEDPLAY=card("NEGATEDPLAY",{skill:"[Activate: Main] Choose up to 1 Battle Card from your hand and play it with its skills negated for the turn."});
defs.REACTOR=card("REACTOR",{skill:"[Auto] At the end of a battle, choose up to 1 Battle Card from your Drop Area and return it to your hand."});
defs.ENERGYRETURN=card("ENERGYRETURN",{skill:"[Auto] At the end of a battle, choose up to 1 of your energy and return it to your hand."});
defs.RETURN=card("RETURN",{skill:"[Activate: Battle] Choose up to 1 card in your Combo Area and return it to its owner's hand."});
defs.DROP=card("DROP",{skill:"[Activate: Battle] Choose up to 1 card in your Combo Area and place it in its owner's Drop Area."});
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const records=Object.values(defs).flatMap(skillRecords);
for(const key of keys){const old=fixtures[key].record;const row=records.find(r=>r.cardId===old.cardId&&r.skillIndex===old.skillIndex)!;assert.ok(row,key);assert.deepEqual(row.unread,[]);assert.deepEqual(copy(row.ops),fixtures[key].expectedOps);assert.deepEqual(copy(row.cond),fixtures[key].expectedCond);for(const field of ["printed","trigger","combo","cost","usage","validity"] as const)assert.deepEqual(copy(row[field]),old[field],`${key}/${field}`);}
for(const old of Object.values(fixtures.refused)){
 const r=skillRecords(card("refused",{skill:old.printed}))[0];
 if(old.cardId==="BT4-019"){assert.deepEqual(r.unread,[]);assert.deepEqual(r.trigger,["attacks","playedUsingUnionPotara"]);assert.equal(r.cond,null);}
 else if(old.cardId==="BT26-100"){assert.deepEqual(r.unread,[]);assert.deepEqual(r.trigger,["played","attacksOpponentBattle"]);assert.equal(r.cond,null);assert.deepEqual(copy(r.ops),gohan.expectedOps);}
 else assert.ok(r.unread.length);
}
for(const tail of [" from your hand"," during your turn"," by your Leader's skill"]){const text=fixtures["P-656#10"].record.printed.replace("used in a combo,",`used in a combo${tail},`);assert.ok(skillRecords(card("unrepresented",{skill:text}))[0].unread.length);}
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(records.map((r,id)=>({...r,id,status:"confirmed",source:"compiler"}) as unknown as RuleRow)),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
let events:GameEvent[]=[];
function take(s:VmState,a:Action):VmState{const saved=copy(s),before=JSON.stringify(saved);RULES.boardView(ctx,saved,"p1",{});RULES.boardView(ctx,saved,"p2",{});const out=RULES.apply(ctx,saved,a);assert.equal(JSON.stringify(saved),before);assert.equal(out.state.outcome,undefined,JSON.stringify(out.state.outcome));events.push(...out.events);return out.state as VmState;}
function fresh(turn:PlayerId):VmState{let s=RULES.createGame(ctx,{seed:485,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;for(const a of [{type:"chooseFirst",player:s.chooser,first:turn},{type:"mulligan",player:turn,redraw:false},{type:"mulligan",player:other(turn),redraw:false},{type:"charge",player:turn,card:null},{type:"endMain",player:turn},{type:"charge",player:other(turn),card:null},{type:"endMain",player:other(turn)},{type:"charge",player:turn,card:null}] as Action[])s=take(s,a);s.sides.p1.attrs.energyMarkers=0;s.sides.p2.attrs.energyMarkers=0;return s;}
function stage(s:VmState,p:PlayerId,def:string,area:string,rest=false):string{const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);s.cards[id].mode=rest?"rest":"active";if(area==="deck"){s.sides[p].zones.deck=s.sides[p].zones.deck.filter(x=>x!==id);s.sides[p].zones.deck.unshift(id);}return id;}
type Policy={prefer?:string[];declineCost?:boolean;declineMay?:boolean;choose?:(s:VmState)=>string[]|undefined;stop?:(s:VmState)=>boolean};
function drive(s:VmState,policy:Policy={}):VmState{for(let n=0;n<120;n++){if(policy.stop?.(s)||s.prompt.kind==="main"||s.prompt.kind==="charge")return s;const q=s.prompt;let a:Action|undefined;
 if(q.kind==="chooseCards"){const desired=policy.choose?.(s)??policy.prefer?.filter(x=>q.choice.candidates.includes(x));a={type:"choose",player:q.player,cards:desired?.slice(0,q.choice.max??1)??q.choice.candidates.slice(0,q.choice.min??0)};}
 else if(q.kind==="chooseMode"&&policy.declineCost&&q.reason==="Pay this Auto skill's cost?")a={type:"chooseMode",player:q.player,index:q.options.length-1};
 else if(q.kind==="optionalCost")a={type:"optionalCost",player:q.player,pay:!policy.declineCost};
 else if(q.kind==="combo")a={type:"pass",player:q.player};else if(q.kind==="zEnergyFromCombo")a={type:"zEnergyFromCombo",player:q.player,card:null};
 else if(q.kind==="orderPending")a={type:"orderPending",player:q.player,index:s.pendingOrder!.candidates[0],...(policy.declineCost?{decline:true as const}:{})};
 else {const legal=RULES.legalActions(ctx,s).map(x=>x.action);a=legal.find(x=>x.type==="counter"&&x.card===null)??legal.find(x=>x.type==="block"&&x.card===null)??legal.find(x=>x.type==="chooseMode"&&x.index===(policy.declineMay?1:0))??legal.find(x=>x.type==="payCost")??legal.find(x=>x.type==="pass");}
 assert.ok(a,JSON.stringify(q));s=take(s,a);
 }throw Error("drive bound");}
function act(s:VmState,id:string):VmState{const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===id);assert.ok(a,`activate ${id}/${s.cards[id].cardId}: ${JSON.stringify(s.prompt)}`);return take(s,a);}
function setup(p:PlayerId,key:typeof keys[number],turn:PlayerId,area:string){const s=fresh(turn);const source=stage(s,p,fixtures[key].card.id,area),energy=stage(s,p,"MULTI","energy");stage(s,p,"MULTI","energy");stage(s,p,"MULTI","energy");const victim=stage(s,other(p),"VICTIM","battle",true),searched=stage(s,p,"TWO","drop"),existing=stage(s,p,"TWO","hand");return {s,source,energy,victim,searched,existing};}
function beginBattle(s:VmState,p:PlayerId):VmState{const turn=s.turnPlayer;const attacker=stage(s,turn,"A","battle"),guard=stage(s,other(turn),"G","battle",true);s=take(s,{type:"attack",player:turn,attacker,target:guard});return drive(s,{stop:s=>s.prompt.kind==="combo"&&s.prompt.player===p});}
function autoCount(id:string){return events.filter(e=>e.type==="skill"&&e.card===id).length;}
let cases=0;
// Native play from Hand or by another skill from Hand/Drop/Deck, on both turns.
for(const p of ["p1","p2"] as const)for(const key of keys)for(const ownTurn of [true,false])for(const area of ["hand","drop","deck"]){
 const {s:initial,source,victim,searched,existing}=setup(p,key,ownTurn?p:other(p),area);let s=initial;const words=area==="drop"?"Drop Area":area;
 if(ownTurn){const actor=stage(s,p,`PLAY-${words}`,"battle");s=act(s,actor);}
 else {const counter=stage(s,p,`COUNTER-${words}`,"hand"),incoming=stage(s,other(p),"A","hand");s=take(s,{type:"play",player:other(p),card:incoming});assert.equal(s.prompt.kind,"counter");s=take(s,{type:"counter",player:p,card:counter});}
 events=[];s=drive(s,{prefer:[source,victim,existing,searched]});
 const fires=key==="P-656#10"||area==="hand";assert.equal(autoCount(source),fires?1:0,`${key} play ${area}/${ownTurn}`);
 if(fires&&key==="P-656#10"){assert.ok(s.sides[other(p)].zones.energy.includes(victim));assert.equal(s.cards[victim].mode,"rest");}
 if(fires&&key==="BT16-143#20")assert.ok(s.sides[other(p)].zones.drop.includes(victim));
 if(fires&&key==="BT16-131#10"){assert.ok(s.sides[p].zones.hand.includes(searched));if(!ownTurn)assert.ok(s.sides[p].zones.battle.includes(existing));}
 cases++;
}
// Actual Combo entry is silent; only normal cleanup supplies the second moment.
for(const p of ["p1","p2"] as const)for(const key of keys)for(const ownTurn of [true,false])for(const area of ["hand","battle","drop","deck"]){
 const {s:initial,source,victim,searched,existing}=setup(p,key,ownTurn?p:other(p),area);let s=beginBattle(initial,p);
 if(area==="hand"||area==="battle")s=take(s,{type:"combo",player:p,card:source});
 else {const actor=stage(s,p,`COMBO-${area==="drop"?"Drop Area":"deck"}`,"battle");s=act(s,actor);s=drive(s,{prefer:[source],stop:s=>s.prompt.kind==="combo"&&s.prompt.player===p});}
 assert.ok(s.sides[p].zones.combo.includes(source));assert.ok(!s.pending.some(x=>x.card===source),"not a combo-entry Auto");events=[];
 s=drive(s,{prefer:[victim,existing,searched]});const fires=key==="P-656#10"||area==="hand";assert.equal(autoCount(source),fires?1:0,`${key} combo ${area}/${ownTurn}`);assert.ok(s.sides[p].zones.drop.includes(source));cases++;
}
// Ordinary native play pays card energy independently of any Auto price.
for(const p of ["p1","p2"] as const)for(const key of keys){
 const {s:initial,source,victim,searched}=setup(p,key,p,"hand");let s=initial;events=[];
 s=take(s,{type:"play",player:p,card:source});s=drive(s,{prefer:[victim,searched]});assert.equal(autoCount(source),1);cases++;
}
// P656 printed own Activate:Main pays Blue before its separate Yellow Auto.
for(const p of ["p1","p2"] as const){
 const {s:initial,source,victim}=setup(p,"P-656#10",p,"hand");let s=initial;events=[];s=act(s,source);s=drive(s,{prefer:[victim]});
 assert.ok(s.sides[p].zones.battle.includes(source));assert.equal(s.sides[p].zones.energy.filter(id=>s.cards[id].mode==="rest").length,2);assert.equal(events.filter(e=>e.type==="skill"&&e.card===source&&e.skill===10).length,1);cases++;
}
// Printed paid/conditional admission, including decline and optional zero.
for(const p of ["p1","p2"] as const)for(const fault of ["wrong-character","wrong-color","no-yellow","decline","zero-target"]){
 const {s:initial,source,victim}=setup(p,"P-656#10",p,"hand");let s=initial;
 if(fault.startsWith("wrong"))s.cards[s.sides[p].zones.leader[0]].cardId=fault==="wrong-character"?"WRONGCHAR":"WRONGCOLOR";
 if(fault==="no-yellow")for(const id of s.sides[p].zones.energy)s.cards[id].cardId="BLUE";
 const deck=s.sides[p].zones.deck.length;events=[];s=take(s,{type:"play",player:p,card:source});s=drive(s,{prefer:fault==="zero-target"?[]:[victim],declineCost:fault==="decline"});
 assert.equal(autoCount(source),fault==="zero-target"?1:0);assert.equal(s.sides[p].zones.deck.length,deck-(fault==="zero-target"?1:0));assert.ok(s.sides[other(p)].zones.battle.includes(victim));cases++;
}
// P656 ignores Barrier and sends a borrowed opposing Battle to its OWN owner's Energy.
for(const p of ["p1","p2"] as const)for(const borrowed of [false,true]){
 const {s:initial,source}=setup(p,"P-656#10",p,"hand");let s=initial;const target=stage(s,borrowed?p:other(p),"BARRIER","battle");
 if(borrowed)assert.ok(moveCard(s,game,target,"battle",{owner:other(p)}).ok);
 s=take(s,{type:"play",player:p,card:source});s=drive(s,{prefer:[target]});assert.ok(s.sides[borrowed?p:other(p)].zones.energy.includes(target));assert.equal(s.cards[target].mode,"rest");cases++;
}
// Sawar requires one multicolor Energy, not two differently colored mono cards.
for(const p of ["p1","p2"] as const)for(const multi of [true,false]){
 const {s:initial,source,victim}=setup(p,"BT16-143#20",p,"hand");let s=initial;
 for(const [i,id] of s.sides[p].zones.energy.entries())s.cards[id].cardId=i===0&&multi?"MULTI":i%2?"BLUE":"YELLOW";
 events=[];s=take(s,{type:"play",player:p,card:source});s=drive(s,{prefer:[victim]});assert.equal(autoCount(source),multi?1:0);assert.equal(s.sides[other(p)].zones.drop.includes(victim),multi);cases++;
}
// Full target exclusions, preserving Sawar's ordinary Barrier restriction.
for(const p of ["p1","p2"] as const)for(const key of ["P-656#10","BT16-143#20"] as const){
 const {s:initial,source,victim}=setup(p,key,p,"hand");let s=initial;const high=stage(s,other(p),"HIGH","battle",true),active=stage(s,other(p),"VICTIM","battle"),barrier=stage(s,other(p),"BARRIER","battle",true),own=stage(s,p,"VICTIM","battle",true),unison=stage(s,other(p),"UNI","unison");
 s=take(s,{type:"play",player:p,card:source});s=drive(s,{stop:s=>s.prompt.kind==="chooseCards"});assert.equal(s.prompt.kind,"chooseCards");if(s.prompt.kind!=="chooseCards")throw Error("target");
 const offered=s.prompt.choice.candidates;assert.ok(offered.includes(victim));assert.ok(!offered.includes(own)&&!offered.includes(unison));assert.ok(!offered.includes(s.sides[other(p)].zones.leader[0]));
 for(const id of [high,active,barrier])assert.equal(offered.includes(id),key==="P-656#10");s=take(s,{type:"choose",player:p,cards:[]});s=drive(s);assert.ok(s.sides[other(p)].zones.battle.includes(victim));cases++;
}
// Search pool and independent opponent-turn play, including decline of either step.
for(const p of ["p1","p2"] as const)for(const ownTurn of [true,false])for(const search of ["deck","drop","decline"] as const)for(const play of [true,false]){
 const {s:initial,source,searched,existing}=setup(p,"BT16-131#10",ownTurn?p:other(p),"hand");let s=initial;
 const fromDeck=stage(s,p,"TWO","deck"),bad1=stage(s,p,"ONE","drop"),bad3=stage(s,p,"THREE","drop"),skilled=stage(s,p,"SKILLED","drop");
 s=beginBattle(s,p);s=take(s,{type:"combo",player:p,card:source});events=[];
 s=drive(s,{stop:s=>s.prompt.kind==="chooseCards"});assert.equal(s.prompt.kind,"chooseCards");if(s.prompt.kind!=="chooseCards")throw Error("search");
 assert.ok(s.prompt.choice.candidates.includes(fromDeck)&&s.prompt.choice.candidates.includes(searched));for(const id of [bad1,bad3,skilled])assert.ok(!s.prompt.choice.candidates.includes(id));
 assert.ok(vmRevealedTo(game,s,p).has(fromDeck));assert.ok(!vmRevealedTo(game,s,other(p)).has(fromDeck));
 const expected=expectedShuffle(s.sides[p].zones.deck.filter(id=>search!=="deck"||id!==fromDeck),s.rngState);
 s=take(s,{type:"choose",player:p,cards:search==="decline"?[]:[search==="deck"?fromDeck:searched]});s=drive(s,{prefer:[existing],declineMay:!play});
 assert.equal(s.sides[p].zones.battle.includes(existing),!ownTurn&&play);if(!ownTurn&&play)assert.equal(s.cards[existing].mode,"rest");
 assert.deepEqual(s.sides[p].zones.deck,expected.items,"exactly one seeded shuffle after the joint search");assert.equal(s.rngState,expected.state);cases++;
}
// Mid-battle exits and a replacement away from Drop do not create battle-end occurrences.
for(const p of ["p1","p2"] as const)for(const key of keys)for(const departure of ["RETURN","DROP","warp","negated"]){
 const {s:initial,source,victim,searched}=setup(p,key,p,"hand");let s=beginBattle(initial,p);s=take(s,{type:"combo",player:p,card:source});events=[];
 if(departure==="RETURN"||departure==="DROP"){const actor=stage(s,p,departure,"battle");s=act(s,actor);s=drive(s,{prefer:[source],stop:s=>s.prompt.kind==="combo"&&s.prompt.player===p});}
 else if(departure==="warp")addEffect(s,[],{kind:"replaceLeave",target:source,source,master:p,value:{to:"warp"},until:"turn"});
 else addEffect(s,[],{kind:"negateSkills",target:source,value:0,until:"turn"});
 s=drive(s,{prefer:[victim,searched]});assert.equal(autoCount(source),0,`${key}/${departure}`);if(departure==="warp")assert.ok(s.sides[p].zones.warp.includes(source));cases++;
}
// Another queued Auto can move the already-pending source; its occurrence remains valid.
for(const p of ["p1","p2"] as const)for(const key of keys){
 const {s:initial,source,victim,searched}=setup(p,key,p,"hand");let s=initial;const reactor=stage(s,p,"REACTOR","battle");s=beginBattle(s,p);s=take(s,{type:"combo",player:p,card:source});events=[];
 s=drive(s,{stop:s=>s.prompt.kind==="orderPending"});assert.equal(s.prompt.kind,"orderPending");assert.ok(s.pending.some(x=>x.card===source));
 s=take(s,{type:"orderPending",player:p,index:s.pending.findIndex(x=>x.card===reactor)});assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:p,cards:[source]});s=drive(s,{prefer:[victim,searched]});
 assert.ok(s.sides[p].zones.hand.includes(source));assert.equal(autoCount(source),1);cases++;
}
// A pending competing Auto can invalidate Sawar's admission BEFORE activation.
for(const p of ["p1","p2"] as const){
 const {s:initial,source,energy,victim}=setup(p,"BT16-143#20",p,"hand");let s=initial;for(const id of s.sides[p].zones.energy)if(id!==energy)s.cards[id].cardId="BLUE";
 const reactor=stage(s,p,"ENERGYRETURN","battle");s=beginBattle(s,p);s=take(s,{type:"combo",player:p,card:source});events=[];s=drive(s,{stop:s=>s.prompt.kind==="orderPending"});
 s=take(s,{type:"orderPending",player:p,index:s.pending.findIndex(x=>x.card===reactor)});s=take(s,{type:"choose",player:p,cards:[energy]});s=drive(s,{prefer:[victim]});assert.equal(autoCount(source),0);assert.ok(s.sides[other(p)].zones.battle.includes(victim));cases++;
}
// A normal play and later Battle-origin Combo are distinct occurrences on
// the same source; the hand-only cards answer only the first occurrence.
for(const p of ["p1","p2"] as const)for(const key of keys){
 const {s:initial,source,victim,searched}=setup(p,key,p,"hand");let s=initial;events=[];
 s=take(s,{type:"play",player:p,card:source});s=drive(s,{prefer:[victim,searched]});assert.equal(autoCount(source),1);
 s=beginBattle(s,p);s=take(s,{type:"combo",player:p,card:source});s=drive(s,{prefer:[]});assert.equal(autoCount(source),key==="P-656#10"?2:1);cases++;
}
// Reusing the same copy from Drop in a later battle replaces its Hand origin.
for(const p of ["p1","p2"] as const)for(const key of keys){
 const {s:initial,source,victim,searched}=setup(p,key,p,"hand");let s=beginBattle(initial,p);s=take(s,{type:"combo",player:p,card:source});s=drive(s,{prefer:[victim,searched]});
 const actor=stage(s,p,"COMBO-Drop Area","battle");s=beginBattle(s,p);s=act(s,actor);s=drive(s,{prefer:[source],stop:s=>s.prompt.kind==="combo"&&s.prompt.player===p});assert.equal(s.battle?.comboOrigins?.[source],"drop");events=[];
 s=drive(s,{prefer:[]});assert.equal(autoCount(source),key==="P-656#10"?1:0);cases++;
}
for(const p of ["p1","p2"] as const)for(const key of keys){
 {const {s:initial,source}=setup(p,key,p,"battle");let s=beginBattle(initial,p);events=[];s=drive(s);assert.equal(autoCount(source),0,"unrelated battle is not a combo occurrence");cases++;}
 {const {s:initial,source}=setup(p,key,p,"hand");let s=initial;const actor=stage(s,p,"NEGATEDPLAY","battle");events=[];s=act(s,actor);s=drive(s,{prefer:[source]});assert.equal(autoCount(source),0,"negated arrival does not trigger");assert.ok(s.sides[p].zones.battle.includes(source));cases++;}
}
// Old executable records cannot invent the combo qualification of a saved pending Auto.
for(const p of ["p1","p2"] as const)for(const key of keys){
 const {s:initial,source}=setup(p,key,p,"hand");let s=initial;stage(s,p,"REACTOR","battle");s=beginBattle(s,p);s=take(s,{type:"combo",player:p,card:source});s=drive(s,{stop:s=>s.prompt.kind==="orderPending"});
 const bad:EngineContext={...ctx,scripts:copy(ctx.scripts!)};delete bad.scripts![fixtures[key].card.id].bySkill[fixtures[key].record.skillIndex].combo;
 const saved=copy(s),before=JSON.stringify(saved);const stopped=RULES.apply(bad,saved,{type:"orderPending",player:p,index:s.pending.findIndex(x=>x.card===source)}).state as VmState;
 assert.equal(JSON.stringify(saved),before);assert.equal(stopped.outcome?.kind,"interrupted");assert.match(stopped.outcome?.privateContext?.detail??"",/typed combo/);cases++;
}
console.log(`played / Combo battle end: ${cases} native saved cases`);
