import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import fixture from "./fixtures/normalized-battle-attack-5.json";
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const defs:Record<string,CardDef>={F:card("F",{}),L:card("L",{type:"LEADER",power:100000}),E:card("E",{colors:["Yellow"]}),B:card("B",{colors:["Black"],power:100000,energyCost:7}),HIGH:card("HIGH",{colors:["Black"],power:100000,energyCost:8}),UNI:card("UNI",{type:"UNISON",power:100000}),Z:card("Z",{type:"Z-BATTLE",colors:["Black"],power:100000,energyCost:1,zEnergyCost:1}),TOKENMAKER:card("TOKENMAKER",{colors:["Black"],skill:"[Activate: Main] Play 2 Ghost Tokens with 100000 power."})};
for(const key of ["BT8-089","BT1-091"] as const){const c=fixture[key].card;defs[key]=card(c.id,{name:c.name,type:c.type as CardDef["type"],colors:c.colors as CardDef["colors"],energyCost:c.cost===null?null:Number(c.cost),power:c.power,characters:c.characters,traits:c.traits,skill:key==="BT1-091"?c.skill:fixture.expectedRecords.filter(r=>r.cardId===key&&r.side==="front").map(r=>r.printed).join("<br>"),back:c.backName?{name:c.backName,power:15000,skill:fixture.expectedRecords.filter(r=>r.cardId===key&&r.side==="back").map(r=>r.printed).join("<br>")}:null});}
const records=Object.values(defs).flatMap(skillRecords);assert.ok(records.every(r=>!r.unread.length),JSON.stringify(records.filter(r=>r.unread.length)));
assert.deepEqual(copy(records.filter(r=>["BT8-089","BT1-091"].includes(r.cardId))).sort((a,b)=>`${a.cardId}/${a.side}/${a.skillIndex}`.localeCompare(`${b.cardId}/${b.side}/${b.skillIndex}`)),copy(fixture.expectedRecords).sort((a,b)=>`${a.cardId}/${a.side}/${a.skillIndex}`.localeCompare(`${b.cardId}/${b.side}/${b.skillIndex}`)),"actual complete records remain unchanged");
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(records.map((r,id)=>({...r,id,status:"confirmed",source:"compiler"}) as unknown as RuleRow)),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const events:GameEvent[]=[];
function take(s:VmState,a:Action):VmState{const saved=copy(s),before=JSON.stringify(saved);RULES.boardView(ctx,saved,"p1",{});RULES.boardView(ctx,saved,"p2",{});const out=RULES.apply(ctx,saved,a);assert.equal(JSON.stringify(saved),before);assert.equal(out.state.outcome,undefined,JSON.stringify(out.state.outcome));events.push(...out.events);return out.state as VmState;}
function fresh(turn:PlayerId):VmState{let s=RULES.createGame(ctx,{seed:485,p1:{name:"One",leader:"L",main:fifty("F"),z:["Z"]},p2:{name:"Two",leader:"L",main:fifty("F"),z:["Z"]}}).state as VmState;for(const a of [{type:"chooseFirst",player:s.chooser,first:turn},{type:"mulligan",player:turn,redraw:false},{type:"mulligan",player:other(turn),redraw:false},{type:"charge",player:turn,card:null},{type:"endMain",player:turn},{type:"charge",player:other(turn),card:null},{type:"endMain",player:other(turn)},{type:"charge",player:turn,card:null}] as Action[])s=take(s,a);s.sides.p1.attrs.energyMarkers=0;s.sides.p2.attrs.energyMarkers=0;return s;}
function stage(s:VmState,p:PlayerId,def:string,area:string,rest=false):string{const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);s.cards[id].mode=rest?"rest":"active";if(area==="deck"){s.sides[p].zones.deck=s.sides[p].zones.deck.filter(x=>x!==id);s.sides[p].zones.deck.unshift(id);}return id;}
type Policy={block?:(s:VmState)=>string|null;counter?:(s:VmState)=>string|null;prefer?:string[];declineCost?:boolean;declineMay?:boolean;choose?:(s:VmState)=>string[]|undefined;stop?:(s:VmState)=>boolean};
function drive(s:VmState,policy:Policy={}):VmState{for(let n=0;n<120;n++){if(policy.stop?.(s)||s.prompt.kind==="main"||s.prompt.kind==="charge")return s;const q=s.prompt;let a:Action|undefined;
 if(q.kind==="chooseCards"){const desired=policy.choose?.(s)??policy.prefer?.filter(x=>q.choice.candidates.includes(x));a={type:"choose",player:q.player,cards:desired?.slice(0,q.choice.max??1)??q.choice.candidates.slice(0,q.choice.min??0)};}
 else if(q.kind==="chooseMode"&&policy.declineCost&&q.reason==="Pay this Auto skill's cost?")a={type:"chooseMode",player:q.player,index:q.options.length-1};
 else if(q.kind==="optionalCost")a={type:"optionalCost",player:q.player,pay:!policy.declineCost};
 else if(q.kind==="combo")a={type:"pass",player:q.player};else if(q.kind==="zEnergyFromCombo")a={type:"zEnergyFromCombo",player:q.player,card:null};
 else if(q.kind==="blocker"&&policy.block)a={type:"block",player:q.player,card:policy.block(s)};
 else if(q.kind==="counter"&&policy.counter)a={type:"counter",player:q.player,card:policy.counter(s)};
 else if(q.kind==="orderPending")a={type:"orderPending",player:q.player,index:s.pendingOrder!.candidates[0],...(policy.declineCost?{decline:true as const}:{})};
 else {const legal=RULES.legalActions(ctx,s).map(x=>x.action);a=legal.find(x=>x.type==="counter"&&x.card===null)??legal.find(x=>x.type==="block"&&x.card===null)??legal.find(x=>x.type==="chooseMode"&&x.index===(policy.declineMay?1:0))??legal.find(x=>x.type==="payCost")??legal.find(x=>x.type==="pass");}
 assert.ok(a,JSON.stringify(q));s=take(s,a);
 }throw Error("drive bound");}
function act(s:VmState,id:string):VmState{const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===id);assert.ok(a,`activate ${id}/${s.cards[id].cardId}: ${JSON.stringify(s.prompt)}`);return take(s,a);}

const cases:string[]=[];
function tokens(s:VmState,p:PlayerId):[VmState,string[]]{const maker=stage(s,p,"TOKENMAKER","battle");s=drive(act(s,maker));return [s,s.sides[p].zones.battle.filter(id=>s.cards[id].cardId.startsWith("TOKEN:"))];}
function zplay(s:VmState,p:PlayerId):[VmState,string]{stage(s,p,"B","energy");stage(s,p,"F","zEnergy");const id=s.sides[p].zones.zDeck[0];const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="playZ"&&a.card===id);assert.ok(a);s=drive(take(s,a));assert.ok(s.sides[p].zones.battle.includes(id));return [s,id];}

function attacker(s:VmState,p:PlayerId,kind:string):[VmState,string]{if(kind==="Z")return zplay(s,p);if(kind==="TOKEN"){const [next,ids]=tokens(s,p);assert.equal(ids.length,2);return [next,ids[0]];}if(kind==="LEADER")return [s,s.sides[p].zones.leader[0]];const id=stage(s,p,kind==="UNISON"?"UNI":"B",kind==="UNISON"?"unison":"battle");if(kind==="UNISON")s.cards[id].markers=5;return [s,id];}
function canAttack(s:VmState,id:string):boolean{return RULES.legalActions(ctx,s).some(x=>x.action.type==="attack"&&x.action.attacker===id);}
for(const p of ["p1","p2"] as PlayerId[])for(const own of [false,true])for(const back of [false,true])for(const kind of ["B","Z","TOKEN","LEADER","UNISON"]){
 let s=fresh(p);const watcher=s.sides[own?p:other(p)].zones.leader[0];s.cards[watcher].cardId="BT8-089";s.cards[watcher].flipped=back;
 // The real front-face Leader cannot attack. Its attack negative is checked through the legal menu.
 if(own&&!back&&kind==="LEADER"){assert.equal(canAttack(s,watcher),false);cases.push(`${p}/${own}/${back}/front-Leader-forbidden`);continue;}
 const entry=attacker(s,p,kind);s=entry[0];const id=entry[1];const low=stage(s,p,"B","battle"),high=stage(s,p,"HIGH","battle");const made=tokens(s,p);s=made[0];const others=made[1];const before=events.length;
 assert.ok(canAttack(s,id),`offered ${p}/${own}/${back}/${kind}`);s=drive(take(s,{type:"attack",player:p,attacker:id,target:s.sides[other(p)].zones.leader[0]}));const expected=["B","Z","TOKEN"].includes(kind)?1:0;
 assert.equal(events.slice(before).filter(e=>e.type==="skill"&&e.card===watcher&&e.skill===10).length,expected,`${p}/${own}/${back}/${kind}`);
 assert.equal(canAttack(s,low),!expected);assert.equal(canAttack(s,others[0]),!expected);assert.equal(canAttack(s,high),true);
 // Staged ready mode isolates the restriction's printed exception, independent of a restand skill.
 s.cards[id].mode="active";assert.equal(canAttack(s,id),true);
 if(expected){const again=events.length;s=drive(take(s,{type:"attack",player:p,attacker:id,target:s.sides[other(p)].zones.leader[0]}));assert.equal(events.slice(again).filter(e=>e.type==="skill"&&e.card===watcher&&e.skill===10).length,1,"one new Auto per distinct declaration");}
 cases.push(`${p}/watcherOwn-${own}/back-${back}/${kind}`);
}
for(const p of ["p1","p2"] as PlayerId[])for(const kind of ["B","Z","TOKEN","LEADER","UNISON"])for(const energyCount of [3,4]){
 let s=fresh(p);const entry=attacker(s,p,kind);s=entry[0];const id=entry[1];const king=stage(s,other(p),"BT1-091","hand"),energy=Array.from({length:energyCount},()=>stage(s,other(p),"E","energy"));const before=events.length;
 s=take(s,{type:"attack",player:p,attacker:id,target:s.sides[other(p)].zones.leader[0]});const expected=["B","Z","TOKEN"].includes(kind)&&energyCount===4;
 assert.equal(RULES.legalActions(ctx,s).some(x=>x.action.type==="counter"&&x.action.card===king),expected,`${kind}/${energyCount}`);
 if(expected){s=take(s,{type:"counter",player:other(p),card:king});s=drive(s,{stop:s=>s.prompt.kind==="combo"});assert.equal(s.battle?.guard,king);assert.ok(s.sides[other(p)].zones.battle.includes(king));assert.equal(energy.filter(e=>s.cards[e].mode==="rest").length,4);s=drive(s);assert.ok(!s.sides[p].zones.battle.includes(id),"Revenge KOs the original attacker after redirection");assert.equal(events.slice(before).filter(e=>e.type==="action"&&e.action.type==="counter"&&e.action.card===king).length,1);assert.equal(events.slice(before).filter(e=>e.type==="skill"&&e.card===king&&e.skill===30).length,1,"played Auto once");}
 else{s=drive(s);assert.ok(s.sides[other(p)].zones.hand.includes(king));assert.equal(energy.filter(e=>s.cards[e].mode==="rest").length,0);}
 cases.push(`${p}/KingCold/${kind}/${energyCount}`);
}
for(const p of ["p1","p2"] as PlayerId[]){
 let s=fresh(p);const combo=stage(s,p,"F","hand"),energy=stage(s,p,"B","energy"),id=s.sides[p].zones.zDeck[0];
 s=drive(take(s,{type:"attack",player:p,attacker:s.sides[p].zones.leader[0],target:s.sides[other(p)].zones.leader[0]}),{stop:s=>s.prompt.kind==="combo"});
 s=take(s,{type:"combo",player:p,card:combo});s=drive(s,{stop:s=>s.prompt.kind==="zEnergyFromCombo"});assert.equal(s.prompt.kind,"zEnergyFromCombo");s=drive(take(s,{type:"zEnergyFromCombo",player:p,card:combo}));assert.ok(s.sides[p].zones.zEnergy.includes(combo));
 const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="playZ"&&a.card===id);assert.ok(action);s=drive(take(s,action));assert.ok(s.sides[p].zones.drop.includes(combo));assert.equal(s.cards[energy].mode,"rest");assert.ok(s.sides[p].zones.battle.includes(id));
 const watcher=s.sides[other(p)].zones.leader[0];s.cards[watcher].cardId="BT8-089";const before=events.length;s=drive(take(s,{type:"attack",player:p,attacker:id,target:watcher}));assert.equal(events.slice(before).filter(e=>e.type==="skill"&&e.card===watcher&&e.skill===10).length,1);cases.push(`${p}/native-Combo-ZEnergy-playZ-attack`);
}
for(const p of ["p1","p2"] as PlayerId[])for(const kind of ["B","Z","TOKEN"]){
 let s=fresh(p);const watcher=s.sides[p].zones.leader[0];s.cards[watcher].cardId="BT8-089";s.cards[watcher].flipped=true;const entry=attacker(s,p,kind);s=entry[0];const id=entry[1];const king=stage(s,other(p),"BT1-091","hand");for(let n=0;n<4;n++)stage(s,other(p),"E","energy");const before=events.length;
 s=take(s,{type:"attack",player:p,attacker:id,target:s.sides[other(p)].zones.leader[0]});s=drive(take(s,{type:"counter",player:other(p),card:king}));
 assert.equal(events.slice(before).filter(e=>e.type==="skill"&&e.card===watcher&&e.skill===10).length,1,"redirected target event does not duplicate attacker declaration");assert.equal(events.slice(before).filter(e=>e.type==="skill"&&e.card===king&&e.skill===30).length,1);cases.push(`${p}/${kind}/Counter-redirection-no-duplicate-watcher`);
}
console.log(`normalized-battle-attack-5: ${cases.length} cases PASS`);
