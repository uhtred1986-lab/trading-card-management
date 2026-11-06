import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { stepScript, type ScriptFrame } from "../../src/lib/arena/vm/script";
import { vmHost, returnLoans } from "../../src/lib/arena/vm/host";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
import fixture from "./fixtures/control-guard-5.json";
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const defs:Record<string,CardDef>={SECRET:card("SECRET",{name:"Private control fixture secret"}),F:card("F",{}),L:card("L",{type:"LEADER",power:100000}),GOHAN:card("GOHAN",{type:"LEADER",colors:["Blue"],characters:["Son Gohan: SH"],power:100000}),E:card("E",{colors:["Black"]}),Y:card("Y",{colors:["Yellow"]}),B:card("B",{traits:["Great Ape"],energyCost:1}),INDEST:card("INDEST",{traits:["Great Ape"],energyCost:1,skill:"[Indestructible]"}),IMMUNE:card("IMMUNE",{traits:["Great Ape"],energyCost:1,skill:"[Permanent] This card can't be removed from your Battle Area by your opponent's skills."}),REMOVE:card("REMOVE",{skill:"[Activate: Main] Choose up to 1 of your Battle Cards and place it in its owner\'s Drop Area."}),BARRIER:card("BARRIER",{traits:["Great Ape"],energyCost:1,skill:"[Barrier]"})};
for(const key of ["BT15-118","BT19-055","BT4-111"] as const){const c=fixture[key].card;let skill=c.skill;if(key==="BT19-055")skill=skill.replace("[Activate: Main] Your opponent gains control of this card.",fixture["BT19-055"].records["BT19-055#20"].printed);defs[key]=card(key,{name:c.name,type:c.type as CardDef["type"],colors:c.colors as CardDef["colors"],energyCost:Number(c.cost),power:c.power,characters:c.characters,traits:c.traits,skill});}
const records=Object.values(defs).flatMap(skillRecords);assert.ok(records.every(r=>!r.unread.length));
for(const key of ["BT15-118","BT19-055","BT4-111"] as const)assert.deepEqual(copy(records.filter(r=>r.cardId===key)),Object.values(fixture[key].records),`unchanged ${key} full records`);
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(records.map((r,id)=>({...r,id,status:"confirmed",source:"compiler"}) as unknown as RuleRow)),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const events:GameEvent[]=[];
function take(s:VmState,a:Action):VmState{const saved=copy(s),before=JSON.stringify(saved);RULES.boardView(ctx,saved,"p1",{});RULES.boardView(ctx,saved,"p2",{});const out=RULES.apply(ctx,saved,a);assert.equal(JSON.stringify(saved),before);assert.equal(out.state.outcome,undefined,JSON.stringify(out.state.outcome));events.push(...out.events);return out.state as VmState;}
function fresh(turn:PlayerId):VmState{let s=RULES.createGame(ctx,{seed:485,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;for(const a of [{type:"chooseFirst",player:s.chooser,first:turn},{type:"mulligan",player:turn,redraw:false},{type:"mulligan",player:other(turn),redraw:false},{type:"charge",player:turn,card:null},{type:"endMain",player:turn},{type:"charge",player:other(turn),card:null},{type:"endMain",player:other(turn)},{type:"charge",player:turn,card:null}] as Action[])s=take(s,a);s.sides.p1.attrs.energyMarkers=0;s.sides.p2.attrs.energyMarkers=0;return s;}
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
function loanCount(s:VmState,id:string):number{return s.effects.filter(e=>e.kind==="control"&&e.target===id).length;}
for(const p of ["p1","p2"] as PlayerId[])for(const sourceDef of ["BT15-118","BT4-111"])for(const targetDef of ["B","INDEST","IMMUNE","BARRIER"]){
 let s=fresh(p);const source=stage(s,p,sourceDef,sourceDef==="BT4-111"?"hand":"battle"),victim=stage(s,other(p),targetDef,"battle",true);s.cards[victim].markers=3;const energy=Array.from({length:4},()=>stage(s,p,"E","energy"));const before=events.length;
 if(sourceDef==="BT4-111"){const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="play"&&a.card===source);assert.ok(action);s=drive(take(s,action),{prefer:[victim]});}
 else{s=drive(act(s,source),{stop:s=>s.prompt.kind==="chooseCards"});if(s.prompt.kind==="chooseCards")assert.equal(s.prompt.choice.candidates.includes(victim),targetDef!=="BARRIER");s=drive(s,{prefer:[victim]});assert.equal(RULES.legalActions(ctx,s).some(x=>x.action.type==="activate"&&x.action.card===source&&x.action.skill===20),false,"Once consumed even when chosen movement is prohibited");}
 assert.equal(s.sides[p].zones.battle.includes(victim),targetDef==="B");assert.equal(s.cards[victim].mode,"rest");assert.equal(s.cards[victim].markers,3);assert.equal(energy.filter(e=>s.cards[e].mode==="rest").length,sourceDef==="BT4-111"?4:1);assert.equal(loanCount(s,victim),sourceDef==="BT15-118"&&targetDef==="B"?1:0);assert.equal(events.slice(before).filter(e=>e.type==="move"&&e.card===victim).length,targetDef==="B"?1:0);cases.push(`${p}/${sourceDef}/${targetDef}`);
}
for(const p of ["p1","p2"] as PlayerId[])for(const originallyOwned of [false,true]){
 let s=fresh(p);const field=stage(s,p,"BT15-118","battle"),victim=stage(s,other(p),"B","battle",true);if(originallyOwned)s.cards[victim].owner=p;stage(s,p,"E","energy");addEffect(s,[],{target:victim,source:victim,master:other(p),kind:"negateSkills",value:0,until:"game"});s=drive(act(s,field),{prefer:[victim]});assert.ok(s.sides[p].zones.battle.includes(victim));assert.equal(s.cards[victim].owner,originallyOwned?p:other(p));assert.ok(s.effects.some(e=>e.target===victim&&e.kind==="negateSkills"));assert.equal(loanCount(s,victim),1);s=drive(take(s,{type:"endMain",player:p}));assert.ok(s.sides[other(p)].zones.battle.includes(victim));assert.equal(s.cards[victim].mode,"active","next controller refreshes after the loan returns");assert.equal(loanCount(s,victim),0);assert.ok(s.effects.some(e=>e.target===victim&&e.kind==="negateSkills"));cases.push(`${p}/own-original-${originallyOwned}/retained-negation-loan-expiry`);
}
for(const p of ["p1","p2"] as PlayerId[])for(const protectedOwn of [false,true]){
 let s=fresh(p);s.cards[s.sides[p].zones.leader[0]].cardId="GOHAN";const pan=stage(s,p,"BT19-055","battle",true);if(protectedOwn)addEffect(s,[],{target:pan,source:pan,master:p,kind:"keyword",value:{name:"Indestructible"},until:"turn"});s=drive(act(s,pan));assert.ok(s.sides[other(p)].zones.battle.includes(pan));assert.equal(s.cards[pan].mode,"rest");assert.equal(s.cards[pan].owner,p);assert.equal(loanCount(s,pan),0);cases.push(`${p}/Pan-own-actor-gift/${protectedOwn}`);
}
for(const p of ["p1","p2"] as PlayerId[])for(const originallyOwned of [false,true]){
 let s=fresh(p);const field=stage(s,p,"BT15-118","hand");stage(s,p,"Y","energy");s=drive(act(s,field));assert.ok(s.sides[p].zones.battle.includes(field),"native Field activation plays the actual Extra");const victim=stage(s,other(p),"B","battle",true);if(originallyOwned)s.cards[victim].owner=p;stage(s,p,"E","energy");s=drive(act(s,field),{prefer:[victim]});const remover=stage(s,p,"REMOVE","battle");s=drive(act(s,remover),{prefer:[victim]});assert.ok(s.sides[originallyOwned?p:other(p)].zones.drop.includes(victim));assert.equal(loanCount(s,victim),0);cases.push(`${p}/Field-native-play-ownerDrop/${originallyOwned}`);
}
// Focused native host return, before the next Charge refresh changes the mode.
for(const p of ["p1","p2"] as PlayerId[]){let s=fresh(p);const field=stage(s,p,"BT15-118","battle"),victim=stage(s,other(p),"B","battle",true);stage(s,p,"E","energy");s=drive(act(s,field),{prefer:[victim]});const ended=s.effects.filter(e=>e.kind==="control"&&e.target===victim);s.effects=s.effects.filter(e=>!ended.includes(e));returnLoans(ctx,game,s,[],ended);assert.ok(s.sides[other(p)].zones.battle.includes(victim));assert.equal(s.cards[victim].mode,"rest");cases.push(`${p}/returnLoan-before-refresh`);}
// Mechanism fixtures inject movement outcomes; they do not claim a printed replacement route.
for(const p of ["p1","p2"] as PlayerId[])for(const route of ["success","refused","replaced-away","replaced-transfer","no-callback","wrong-result-card","wrong-result-from","wrong-holder","wrong-area","already-held","unsupported-host"]){
 const s=fresh(p),source=stage(s,p,"BT15-118","battle"),victim=stage(s,route==="already-held"?p:other(p),"B",route==="wrong-area"?"hand":"battle",true);const frame:ScriptFrame={card:source,master:p,ip:0,vars:{c0:[victim]},ops:[{op:"control",target:{var:"c0"},until:"turn"}]};const h=vmHost(ctx,game,s,[],frame);let moves=0,sets=0;h.enteredTurnOf=()=>7;h.setEnteredTurn=(_id,n)=>{assert.equal(n,7);sets++;};const native=h.move;
 if(route==="unsupported-host")delete h.reportsMovement;
 else if(route!=="success")h.move=(id,to,owner,opts)=>{moves++;assert.equal(opts?.actor,p);assert.equal(opts?.source,source);if(route==="replaced-away")moveCard(s,game,id,"drop");if(route==="replaced-transfer")moveCard(s,game,id,"battle",{owner,carry:true});if(route!=="no-callback")opts?.onResult?.({card:route==="wrong-result-card"?source:id,from:route==="wrong-result-from"?"hand":"battle",fromEpoch:0,to:route==="replaced-away"?"drop":"battle",toEpoch:0,completed:["wrong-result-card","wrong-result-from","wrong-holder"].includes(route)});return to;};
 else h.move=(...args)=>{moves++;return native(...args);};
 if(route==="unsupported-host")assert.throws(()=>stepScript(h,frame),/authoritative movement completion/);else assert.equal(stepScript(h,frame),"done");assert.equal(sets,route==="success"?1:0);assert.equal(loanCount(s,victim),route==="success"?1:0);if(["wrong-area","already-held","unsupported-host"].includes(route))assert.equal(moves,0);cases.push(`${p}/mechanism/${route}`);
}
for(const p of ["p1","p2"] as PlayerId[]){
 let s=fresh(p);const field=stage(s,p,"BT15-118","battle"),victim=stage(s,other(p),"B","battle",true),under1=stage(s,other(p),"F","hand"),under2=stage(s,other(p),"F","hand");assert.ok(moveCard(s,game,under1,"under",{owner:other(p),under:victim}).ok);assert.ok(moveCard(s,game,under2,"under",{owner:other(p),under:victim}).ok);const pile=s.cards[victim].under.slice();stage(s,other(p),"SECRET","hand");stage(s,p,"E","energy");addEffect(s,[],{target:victim,source:victim,master:other(p),kind:"power",value:5000,until:"game"});s=drive(act(s,field),{stop:s=>s.prompt.kind==="chooseCards"});assert.equal(s.prompt.kind,"chooseCards");assert.ok(!JSON.stringify(RULES.boardView(ctx,s,p,{})).includes("Private control fixture secret"));assert.ok(JSON.stringify(RULES.boardView(ctx,s,other(p),{})).includes("Private control fixture secret"));const action:Action={type:"choose",player:p,cards:[victim]};const replay=RULES.apply(ctx,copy(s),action);assert.deepEqual(copy(replay),copy(RULES.apply(ctx,copy(s),action)));s=drive(take(s,action));assert.deepEqual(s.cards[victim].under,pile);assert.equal(s.cards[victim].mode,"rest");assert.ok(s.effects.some(e=>e.target===victim&&e.kind==="power"&&e.value===5000));cases.push(`${p}/stack-effects-saved-choice-privacy`);
}
console.log(`control-guard-5: ${cases.length} cases PASS`);
