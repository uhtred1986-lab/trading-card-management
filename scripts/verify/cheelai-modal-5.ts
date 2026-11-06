import {skillLines} from "../../src/lib/arena/text/cards";
import {parseRule,printRule,type Rule} from "../../src/lib/arena/lang";
import {shuffle as expectedShuffle} from "../../src/lib/arena/vm/rng";
import {vmHost} from "../../src/lib/arena/vm/host";
import {stepScript,type ScriptFrame} from "../../src/lib/arena/vm/script";
import {addEffect} from "../../src/lib/arena/vm/effects";
import assert from "node:assert/strict";
import fixture from "./fixtures/cheelai-modal-5.json";
import {card,fifty} from "./harness";
import {skillRecords} from "../../src/lib/arena/draft";
import {rulesFromRows,type RuleRow} from "../../src/lib/arena/rules-store";
import {RULES} from "../../src/lib/arena/vm";
import {rulesetFor} from "../../src/lib/arena/rulesets";
import {moveCard} from "../../src/lib/arena/vm/zones";
import type {Action,CardDef,EngineContext,GameEvent,PlayerId} from "../../src/lib/arena/types";
import type {VmState} from "../../src/lib/arena/vm/state";
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const c=fixture.cheelai.card;
const defs:Record<string,CardDef>={F:card("F",{}),"BT6-054":card("BT6-054",{name:c.name,type:"LEADER",colors:["Green"],power:100000,characters:c.characters,traits:c.traits,skill:c.skill,back:{name:c.backName,power:100000,skill:c.backSkill}}),Z:card("Z",{type:"Z-LEADER",power:15000}),E:card("E",{colors:["Green"]}),BALL:card("BALL",{type:"EXTRA",skill:"[Dragon Ball]"}),B:card("B",{colors:["Green"],traits:["Frieza's Army"],energyCost:2,power:15000})};
const desire=fixture.desire.card;defs[desire.id]=card(desire.id,{name:desire.name,type:desire.type as CardDef["type"],colors:desire.colors as CardDef["colors"],energyCost:Number(desire.cost),power:desire.power,traits:desire.traits,skill:desire.skill});
defs.WRONGCOLOR=card("WRONGCOLOR",{colors:["Red"],traits:["Frieza's Army"],energyCost:2});defs.WRONGTRAIT=card("WRONGTRAIT",{colors:["Green"],energyCost:2});defs.COST3=card("COST3",{colors:["Green"],traits:["Frieza's Army"],energyCost:3});
defs.CP=card("CP",{type:"EXTRA",energyCost:0,skill:"[Counter: Play] Draw 1 card."});
const records=Object.values(defs).flatMap(skillRecords);assert.ok(records.every(r=>!r.unread.length));
// Full printed records: only the back modal changes; the spurious continuation record disappears.
for(const [key,old] of Object.entries(fixture.cheelai.records)){
 const row=records.find(r=>r.cardId===old.cardId&&r.skillIndex===old.skillIndex&&r.side===old.side);
 if(key==="BT6-054#20b"){assert.equal(row,undefined);continue;}
 assert.ok(row);
 if(key==="BT6-054#10b")for(const field of ["kind","cost","cond","trigger","combo","usage","validity"] as const)assert.deepEqual(copy(row[field]),old[field]);
 else assert.deepEqual(copy(row),old);
}
const modal=records.find(r=>r.cardId==="BT6-054"&&r.side==="back"&&r.skillIndex===10)!.ops[0];assert.equal(modal.op,"chooseMode");if(modal.op!=="chooseMode")throw Error("modal");
assert.deepEqual(copy(modal.modes.slice(0,2)),fixture.cheelai.records["BT6-054#10b"].ops[0].modes.slice(0,2));
const [seven,removal,follow]=modal.modes[2].ops;assert.equal(seven.op,"choose");assert.equal(removal.op,"moveTo");assert.equal(follow.op,"if");if(seven.op!=="choose"||removal.op!=="moveTo"||follow.op!=="if")throw Error("hinge");assert.equal(seven.sel.count,7);assert.equal(seven.sel.upTo,false);assert.equal(removal.completedAs,seven.as);assert.deepEqual(follow.cond,{kind:"moved",var:seven.as,atLeast:7,all:true});
for(const old of Object.values(fixture.desire.records))assert.deepEqual(copy(records.find(r=>r.cardId===old.cardId&&r.skillIndex===old.skillIndex)),old);
for(const row of records.filter(r=>r.cardId==="BT6-054"&&r.side==="back"&&r.skillIndex===10)){const rule=copy({kind:row.kind,trigger:row.trigger,cost:row.cost,usage:row.usage,validity:row.validity,cond:row.cond,ops:row.ops}) as Rule;const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);assert.deepEqual(copy(parsed.value),JSON.parse(JSON.stringify(rule,(key,value)=>key==="upTo"&&value===false?undefined:value)));}
const tail="If you do, choose up to 2 green ≪Frieza's Army≫ cards with an energy cost of 2 or less from your deck and play them, then shuffle your deck and flip this card over at the end of the turn.";
for(const bullet of ["・","･","·","•","‧"])for(const separator of ["\n","\r\n","<br>"]){
 const text=["[Activate: Main] Choose one—",`${bullet}Draw 1 card.`,`${bullet}Remove 7 [Dragon Ball] cards in your Drop Area from the game.`,tail].join(separator);
 const lines=skillLines(text);assert.equal(lines.length,1);assert.ok(lines[0].includes(tail));
 assert.equal(skillLines(text+separator+"[Auto] When this card attacks, draw 1 card.").length,2);
 for(const following of ["[Auto] When this card attacks, draw 1 card.","[Wish] When there are 7 [Dragon Ball] cards in your Drop Area: Flip this card over."]){const split=skillLines(text+" "+following);assert.equal(split.length,2);assert.ok(split[0].endsWith(tail));assert.equal(split[1],following);}
 for(const changed of [text.replace("Remove 7","Remove 8"),text.replace("Remove 7","Remove 6"),text.replace("Drop Area","Warp"),text.replace("up to 2 green","up to 3 green")]){assert.equal(skillLines(changed).length,2);assert.ok(skillRecords(card("NEAR",{skill:changed})).some(r=>r.unread.length));}
}
for(const text of ["[Activate: Main] Draw 1 card.\nIf you do, draw 2 cards.","[Activate: Main] Choose one—\n・Draw 1 card.\n・Draw 2 cards.\nAn unrelated paragraph.","[Activate: Main] Choose one—\n・Draw 1 card.\n・Draw 2 cards.\n[Permanent] This card gains +5000 power."])assert.equal(skillLines(text).length,2);
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(records.map((r,id)=>({...r,id,status:"confirmed",source:"compiler"}) as unknown as RuleRow)),defs)};
const oldScripts=rulesFromRows(copy(Object.values(fixture.cheelai.records).map((r,id)=>({...r,id,status:"confirmed",source:"compiler"}) as unknown as RuleRow)),defs);
assert.ok(oldScripts["BT6-054#back"].unsupported.length);assert.equal(oldScripts["BT6-054#back"].bySkill[20],undefined);
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const events:GameEvent[]=[];let cases=0;
function take(s:VmState,a:Action):VmState{const saved=copy(s),before=JSON.stringify(saved);RULES.boardView(ctx,saved,"p1",{});RULES.boardView(ctx,saved,"p2",{});const out=RULES.apply(ctx,saved,a);assert.equal(JSON.stringify(saved),before);assert.equal(out.state.outcome,undefined,JSON.stringify(out.state.outcome));events.push(...out.events);return out.state as VmState;}
function fresh(turn:PlayerId):VmState{let s=RULES.createGame(ctx,{seed:485,p1:{name:"One",leader:"BT6-054",main:fifty("F"),z:["Z"]},p2:{name:"Two",leader:"BT6-054",main:fifty("F"),z:["Z"]}}).state as VmState;for(const a of [{type:"chooseFirst",player:s.chooser,first:turn},{type:"mulligan",player:turn,redraw:false},{type:"mulligan",player:other(turn),redraw:false},{type:"charge",player:turn,card:null},{type:"endMain",player:turn},{type:"charge",player:other(turn),card:null},{type:"endMain",player:other(turn)},{type:"charge",player:turn,card:null}] as Action[])s=take(s,a);s.cards[s.sides[turn].zones.leader[0]].flipped=true;s.sides.p1.attrs.energyMarkers=0;s.sides.p2.attrs.energyMarkers=0;return s;}
function stage(s:VmState,p:PlayerId,def:string,area:string,rest=false):string{const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);s.cards[id].mode=rest?"rest":"active";if(area==="deck"){s.sides[p].zones.deck=s.sides[p].zones.deck.filter(x=>x!==id);s.sides[p].zones.deck.unshift(id);}return id;}
type Policy={mode?:number;modeText?:string;block?:(s:VmState)=>string|null;counter?:(s:VmState)=>string|null;prefer?:string[];declineCost?:boolean;declineMay?:boolean;choose?:(s:VmState)=>string[]|undefined;stop?:(s:VmState)=>boolean};
function drive(s:VmState,policy:Policy={}):VmState{for(let n=0;n<120;n++){if(policy.stop?.(s)||s.prompt.kind==="main"||s.prompt.kind==="charge")return s;const q=s.prompt;let a:Action|undefined;
 if(q.kind==="chooseCards"){const desired=policy.choose?.(s)??policy.prefer?.filter(x=>q.choice.candidates.includes(x));a={type:"choose",player:q.player,cards:(desired?.length?desired:undefined)?.slice(0,q.choice.max??1)??q.choice.candidates.slice(0,q.choice.min??0)};}
 else if(q.kind==="chooseMode"&&policy.declineCost&&q.reason==="Pay this Auto skill's cost?")a={type:"chooseMode",player:q.player,index:q.options.length-1};
 else if(q.kind==="optionalCost")a={type:"optionalCost",player:q.player,pay:!policy.declineCost};
 else if(q.kind==="combo")a={type:"pass",player:q.player};else if(q.kind==="zEnergyFromCombo")a={type:"zEnergyFromCombo",player:q.player,card:null};
 else if(q.kind==="blocker"&&policy.block)a={type:"block",player:q.player,card:policy.block(s)};
 else if(q.kind==="counter"&&policy.counter)a={type:"counter",player:q.player,card:policy.counter(s)};
 else if(q.kind==="orderPending")a={type:"orderPending",player:q.player,index:s.pendingOrder!.candidates[0],...(policy.declineCost?{decline:true as const}:{})};
 else {const legal=RULES.legalActions(ctx,s).map(x=>x.action);a=legal.find(x=>x.type==="counter"&&x.card===null)??legal.find(x=>x.type==="block"&&x.card===null)??legal.find(x=>x.type==="chooseMode"&&x.index===(policy.modeText&&q.kind==="chooseMode"?q.options.findIndex(x=>x.includes(policy.modeText!)):(policy.mode??(policy.declineMay?1:0))))??legal.find(x=>x.type==="payCost")??legal.find(x=>x.type==="pass");}
 assert.ok(a,JSON.stringify(q));s=take(s,a);
 }throw Error("drive bound");}
function act(s:VmState,id:string):VmState{const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===id);assert.ok(a,`activate ${id}/${s.cards[id].cardId}: ${JSON.stringify(s.prompt)}`);return take(s,a);}

for(const p of ["p1","p2"] as PlayerId[])for(const route of ["success","six","prohibited"]){let s=fresh(p);const leader=s.sides[p].zones.leader[0];const balls:string[]=[];for(let i=0;i<(route==="six"?6:7);i++)balls.push(stage(s,p,"BALL","drop"));const target=stage(s,p,"B","deck");if(route==="prohibited"){const f={ops:[{op:"forbid",what:"beMovedBySkill",side:"you",fromArea:"drop",until:"turn",target:{var:"pick"}}],ip:0,vars:{pick:[balls[0]]},card:leader,master:p} as ScriptFrame;assert.equal(stepScript(vmHost(ctx,game,s,[]),f),"done");}s=act(s,leader);s=drive(s,{modeText:"Remove 7",choose:s=>s.prompt.kind==="chooseCards"?(s.prompt.choice.candidates.includes(target)?[target]:s.prompt.choice.candidates):undefined});const played=s.sides[p].zones.battle.includes(target),scheduled=s.delayed.length;cases++;assert.equal(played,route==="success");assert.equal(scheduled,route==="success"?1:0);if(route==="success"){addEffect(s,[],{target:leader,master:p,kind:"negateSkills",value:0,until:"turn"});s=drive(take(s,{type:"endMain",player:p}));assert.equal(s.cards[leader].flipped,false);}}
for(const p of ["p1","p2"] as PlayerId[]){let s=fresh(p);const leader=s.sides[p].zones.leader[0],desire=stage(s,p,"BT9-089","hand"),target=stage(s,p,"B","battle",true);for(let n=0;n<2;n++)stage(s,p,"E","energy",true);s=drive(act(s,leader),{mode:1,prefer:[desire,target]});assert.ok(s.sides[p].zones.drop.includes(desire));assert.equal(s.cards[target].mode,"active");assert.equal(s.sides[p].zones.energy.filter(id=>s.cards[id].mode==="rest").length,2);cases++;}

// Mechanism-only injected completion reports: ordinary Drop effect replacements are not currently discovered natively.
for(const p of ["p1","p2"] as PlayerId[])for(const destination of ["removed","warp"] as const){const s=fresh(p),leader=s.sides[p].zones.leader[0];const balls:string[]=[];for(let i=0;i<7;i++)balls.push(stage(s,p,"BALL","drop"));const h=vmHost(ctx,game,s,[]),move=h.move;h.move=(id,to,owner,opts)=>move(id,id===balls[0]?destination:to,owner,{...opts,onResult:result=>opts?.onResult?.({...result,completed:id!==balls[0]&&result.completed})});const f={ops:[{op:"moveTo",target:{var:"c0"},to:"removed",completedAs:"c0"},{op:"if",cond:{kind:"moved",var:"c0",atLeast:7,all:true},then:[{op:"draw",n:1}]}],ip:0,vars:{c0:balls},card:leader,master:p} as ScriptFrame;const hand=s.sides[p].zones.hand.length;assert.equal(stepScript(h,f),"done");assert.equal(s.sides[p].zones.hand.length,hand);cases++;}
for(const p of ["p1","p2"] as PlayerId[])for(const restored of [false,true]){let s=fresh(p);const leader=s.sides[p].zones.leader[0];for(let i=0;i<7;i++)stage(s,p,"BALL","drop");s=drive(act(s,leader),{modeText:"Remove 7",choose:s=>s.prompt.kind==="chooseCards"?s.prompt.choice.candidates:undefined});assert.equal(s.delayed.length,1);const epoch=s.cards[leader].zoneEpoch??0,z=s.sides[p].zones.zDeck[0];assert.ok(vmHost(ctx,game,s,[]).placeOnTop(z,leader));if(restored)assert.ok(moveCard(s,game,z,"removed",{owner:p}).ok);const now=s.cards[leader].zoneEpoch??0;s=drive(take(s,{type:"endMain",player:p}));assert.equal(epoch,now);cases++;assert.equal(s.cards[leader].flipped,!restored);}

// Native Wish, including the official no-Broly case, and the independent draw mode.
for(const p of ["p1","p2"] as PlayerId[]){let s=fresh(p);const leader=s.sides[p].zones.leader[0];s.cards[leader].flipped=false;for(let n=0;n<7;n++)stage(s,p,"BALL","drop");const legal=RULES.legalActions(ctx,s).map(x=>x.action);const wish=legal.find(a=>a.type==="activate"&&a.card===leader&&a.skill===20);assert.ok(wish,JSON.stringify(legal));s=drive(take(s,wish));assert.equal(s.cards[leader].flipped,true);assert.equal(s.sides[p].zones.drop.length,7);cases++;
 const hand=s.sides[p].zones.hand.length;s=drive(act(s,leader),{modeText:"Draw 1"});assert.equal(s.sides[p].zones.hand.length,hand+1);assert.equal(RULES.legalActions(ctx,s).some(x=>x.action.type==="activate"&&x.action.card===leader),false);cases++;
}
// Optional zero/one/two plays all shuffle exactly once and schedule the flip. Eight available balls still remove exactly seven.
for(const p of ["p1","p2"] as PlayerId[])for(const count of [0,1,2]){let s=fresh(p);const leader=s.sides[p].zones.leader[0],balls=Array.from({length:8},()=>stage(s,p,"BALL","drop")),targets=Array.from({length:2},()=>stage(s,p,"B","deck"));
 s=drive(act(s,leader),{modeText:"Remove 7",choose:s=>s.prompt.kind==="chooseCards"?balls.filter(x=>s.prompt.kind==="chooseCards"&&s.prompt.choice.candidates.includes(x)).slice(0,7):undefined,stop:s=>s.prompt.kind==="chooseCards"&&s.prompt.choice.candidates.includes(targets[0])});assert.equal(s.prompt.kind,"chooseCards");
 const ownView=JSON.stringify(RULES.boardView(ctx,s,p,{})),otherView=JSON.stringify(RULES.boardView(ctx,s,other(p),{}));assert.ok(ownView.includes(JSON.stringify(targets[0])));assert.ok(!otherView.includes(JSON.stringify(targets[0])));
 const saved=copy(s),selected=targets.slice(0,count),expected=expectedShuffle(s.sides[p].zones.deck.filter(x=>!selected.includes(x)),s.rngState);
 const finish=(state:VmState)=>drive(state,{choose:s=>s.prompt.kind==="chooseCards"?selected.filter(x=>s.prompt.kind==="chooseCards"&&s.prompt.choice.candidates.includes(x)):undefined});s=finish(s);assert.deepEqual(s,finish(saved));assert.deepEqual(s.sides[p].zones.deck,expected.items);assert.equal(s.rngState,expected.state);assert.equal(s.sides[p].zones.battle.length,count);assert.equal(s.sides[p].zones.removed.length,7);assert.equal(s.sides[p].zones.drop.length,1);assert.equal(s.delayed.length,1);s=drive(take(s,{type:"endMain",player:p}));assert.equal(s.cards[leader].flipped,false);cases++;
}

for(const p of ["p1","p2"] as PlayerId[]){let s=fresh(p);const leader=s.sides[p].zones.leader[0];for(let n=0;n<7;n++)stage(s,p,"BALL","drop");const good=stage(s,p,"B","deck"),bad=[stage(s,p,"WRONGCOLOR","deck"),stage(s,p,"WRONGTRAIT","deck"),stage(s,p,"COST3","deck"),stage(s,p,"B","hand")];s=drive(act(s,leader),{modeText:"Remove 7",choose:s=>s.prompt.kind==="chooseCards"?s.prompt.choice.candidates:undefined,stop:s=>s.prompt.kind==="chooseCards"&&s.prompt.choice.candidates.includes(good)});assert.equal(s.prompt.kind,"chooseCards");if(s.prompt.kind!=="chooseCards")throw Error("choice");for(const id of bad)assert.ok(!s.prompt.choice.candidates.includes(id));s=drive(s,{prefer:[good]});assert.ok(s.sides[p].zones.battle.includes(good));cases++;}
for(const p of ["p1","p2"] as PlayerId[]){let s=fresh(p);const leader=s.sides[p].zones.leader[0];for(let n=0;n<6;n++)stage(s,p,"BALL","drop");stage(s,p,"F","drop");stage(s,p,"BALL","hand");s=drive(act(s,leader),{modeText:"Remove 7",choose:s=>s.prompt.kind==="chooseCards"?s.prompt.choice.candidates:undefined});assert.equal(s.sides[p].zones.removed.length,6);assert.equal(s.delayed.length,0);assert.equal(RULES.legalActions(ctx,s).some(x=>x.action.type==="activate"&&x.action.card===leader),false);cases++;}

// Native play windows and a standing play prohibition do not change the completed removal hinge.
for(const p of ["p1","p2"] as PlayerId[])for(const prohibited of [false,true]){let s=fresh(p);const leader=s.sides[p].zones.leader[0];for(let n=0;n<7;n++)stage(s,p,"BALL","drop");const target=stage(s,p,"B","deck"),cp=stage(s,other(p),"CP","hand");if(prohibited){const frame={ops:[{op:"forbid",what:"play",side:"you",until:"turn"}],ip:0,vars:{},card:leader,master:p} as ScriptFrame;assert.equal(stepScript(vmHost(ctx,game,s,[]),frame),"done");}
 let used=false;const before=s.sides[other(p)].zones.hand.length;s=drive(act(s,leader),{modeText:"Remove 7",choose:s=>s.prompt.kind==="chooseCards"?(s.prompt.choice.candidates.includes(target)?[target]:s.prompt.choice.candidates):undefined,counter:s=>{const legal=RULES.legalActions(ctx,s).some(x=>x.action.type==="counter"&&x.action.card===cp);if(legal&&!used){used=true;return cp;}return null;}});assert.equal(s.sides[p].zones.battle.includes(target),!prohibited);assert.equal(s.delayed.length,1);assert.equal(s.sides[p].zones.removed.length,7);if(!prohibited){assert.ok(used);assert.ok(s.sides[other(p)].zones.drop.includes(cp));assert.equal(s.sides[other(p)].zones.hand.length,before);}s=drive(take(s,{type:"endMain",player:p}));assert.equal(s.cards[leader].flipped,false);cases++;}

console.log(`cheelai-modal-5: ${cases} native cases PASS`);
