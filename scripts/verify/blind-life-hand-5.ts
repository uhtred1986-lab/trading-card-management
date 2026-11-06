import assert from "node:assert/strict";
import fixture from "./fixtures/blind-life-hand-5.json";
import {card,fifty} from "./harness";
import {skillRecords} from "../../src/lib/arena/draft";
import {rulesFromRows,type RuleRow} from "../../src/lib/arena/rules-store";
import {RULES} from "../../src/lib/arena/vm";
import {rulesetFor} from "../../src/lib/arena/rulesets";
import {moveCard} from "../../src/lib/arena/vm/zones";
import {vmHost} from "../../src/lib/arena/vm/host";
import {stepScript,type ScriptFrame,type Op} from "../../src/lib/arena/vm/script";
import {attrsNow,hasKeyword} from "../../src/lib/arena/vm/program";
import {correctSkillText} from "../../src/lib/catalog/errata";
import {parseRule,printRule,type Rule} from "../../src/lib/arena/lang";
import {bindBlindLifeHandChoice} from "../../src/lib/arena/compile/effects";
import type {Action,CardDef,EngineContext,GameEvent,PlayerId} from "../../src/lib/arena/types";
import type {VmState} from "../../src/lib/arena/vm/state";
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const defs:Record<string,CardDef>={F:card("F",{}),SECRET:card("SECRET",{name:"Secret Life Identity"}),PUBLIC:card("PUBLIC",{name:"Public Life Identity"}),OPPSECRET:card("OPPSECRET",{name:"Opponent Secret Identity"}),L:card("L",{type:"LEADER",power:100000}),BARRIER:card("BARRIER",{skill:"[Barrier]",power:100000})};
for(const color of ["Red","Blue","Green","Yellow"] as const)defs[color]=card(color,{colors:[color]});
for(const [id,item] of Object.entries(fixture)){const c=item.card;defs[id]=card(id,{name:c.name,type:c.type as CardDef["type"],colors:c.colors as CardDef["colors"],energyCost:c.cost===null?null:Number(c.cost),power:c.power,characters:c.characters,traits:c.traits,skill:correctSkillText(id,c.skill),...(c.backSkill?{back:{name:c.backName!,skill:correctSkillText(id,c.backSkill),power:15000}}:{})});}
const admitted=new Set(["BT1-014#0","TB2-024#0","P-092#0","TB3-057#20","TB2-042#10"]);
const records=Object.values(defs).flatMap(skillRecords);
for(const [id,item] of Object.entries(fixture))for(const [key,old] of Object.entries(item.records)){const row=records.find(r=>r.cardId===id&&r.side===old.side&&r.skillIndex===old.skillIndex)!;assert.ok(row);const expected=copy(old) as typeof row;if(admitted.has(key)){assert.equal(expected.ops[0].op,"choose");if(expected.ops[0].op!=="choose")throw Error("choice");expected.ops[0].blind=true;expected.reads=expected.reads.replace("in your Life Area,","in your Life Area, without seeing them,");const rule=copy({kind:row.kind,trigger:row.trigger,cost:row.cost,usage:row.usage,validity:row.validity,cond:row.cond,ops:row.ops}) as Rule;const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);assert.deepEqual(copy(parsed.value),rule);}assert.deepEqual(copy(row),expected);}
const prefix=["you may choose 1 card from your life","add it to your hand"];
const sample=records.find(r=>r.cardId==="BT1-014")!.ops;
for(const fault of ["count","area","filter","link","receipt","owner"]){const ops=copy(sample);const choose=ops[0],move=ops[1];assert.equal(choose.op,"choose");assert.equal(move.op,"moveTo");if(choose.op!=="choose"||move.op!=="moveTo")throw Error("prefix");delete choose.blind;if(fault==="count")choose.sel.count=2;if(fault==="area")choose.sel.area="hand";if(fault==="filter")choose.sel.filter={unreadable:true} as NonNullable<typeof choose.sel.filter>;if(fault==="link")move.target={var:"other"};if(fault==="receipt")delete move.completedAs;if(fault==="owner")move.owner="opponent";assert.equal(bindBlindLifeHandChoice(prefix,ops),false);assert.equal(choose.blind,undefined);}
for(const text of ["[Activate: Main] You may choose 1 card from your life and add it to your hand. If you do, draw 1 card.","[Auto] {r}: When this card attacks, you may choose 1 card from your life and add it to your hand. If you do, draw 1 card.","[Auto] When this card attacks, you may choose 2 cards from your life and add them to your hand.","[Auto] When this card attacks, choose 1 card from your life and add it to your hand.","[Auto] When this card attacks, you may choose 1 card from your life and place it in your Drop Area. If you do, draw 1 card."]){const rows=skillRecords(card("NEAR",{skill:text}));const visits=(ops:Op[]):boolean=>ops.some(o=>o.op==="choose"&&o.blind||o.op==="if"&&(visits(o.then)||visits(o.else??[])));assert.ok(rows.every(r=>!visits(r.ops)));}
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(records.map((r,id)=>({...r,id,status:r.unread.length?"open":"confirmed",source:"compiler"}) as unknown as RuleRow)),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const events:GameEvent[]=[];let cases=0;
function take(s:VmState,a:Action):VmState{const saved=copy(s),before=JSON.stringify(saved);RULES.boardView(ctx,saved,"p1",{});RULES.boardView(ctx,saved,"p2",{});const out=RULES.apply(ctx,saved,a);assert.equal(JSON.stringify(saved),before);assert.equal(out.state.outcome,undefined,JSON.stringify(out.state.outcome));events.push(...out.events);return out.state as VmState;}
function fresh(turn:PlayerId,leader="L"):VmState{let s=RULES.createGame(ctx,{seed:485,p1:{name:"One",leader,main:fifty("F")},p2:{name:"Two",leader,main:fifty("F")}}).state as VmState;for(const a of [{type:"chooseFirst",player:s.chooser,first:turn},{type:"mulligan",player:turn,redraw:false},{type:"mulligan",player:other(turn),redraw:false},{type:"charge",player:turn,card:null},{type:"endMain",player:turn},{type:"charge",player:other(turn),card:null},{type:"endMain",player:other(turn)},{type:"charge",player:turn,card:null}] as Action[])s=take(s,a);s.sides.p1.attrs.energyMarkers=0;s.sides.p2.attrs.energyMarkers=0;return s;}
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

function play(s:VmState,id:string):VmState{const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="play"&&a.card===id);assert.ok(action,JSON.stringify(RULES.legalActions(ctx,s)));return take(s,action);}
function cardsInView(x:unknown,id:string):Record<string,unknown>[]{if(!x||typeof x!=="object")return[];const o=x as Record<string,unknown>;return [...(o.id===id?[o]:[]),...Object.values(o).flatMap(v=>cardsInView(v,id))];}
for(const p of ["p1","p2"] as PlayerId[])for(const id of ["BT1-014","TB2-024","P-092","TB3-057","TB2-042"] as const)for(const route of ["success","decline","blocked","faceUp"]){let s=fresh(p,id==="P-092"?"P-092":"L");const leader=s.sides[p].zones.leader[0],source=id==="P-092"?leader:stage(s,p,id,"hand");const chosen=s.sides[p].zones.life[3],publicLife=s.sides[p].zones.life[5];s.cards[chosen].cardId="SECRET";s.cards[publicLife].cardId="PUBLIC";s.cards[publicLife].faceUp=true;if(route==="faceUp")s.cards[chosen].faceUp=true;
 const target=stage(s,other(p),"BARRIER","battle");const opponentPick=s.sides[other(p)].zones.hand[2];s.cards[opponentPick].cardId="OPPSECRET";const ownHand=s.sides[p].zones.hand.length,opponentHand=s.sides[other(p)].zones.hand.length,life=s.sides[p].zones.life.length;
 if(id==="TB3-057")for(let n=0;n<5;n++)stage(s,p,"F","drop");
 for(let n=0;n<Number(defs[id].energyCost??0);n++)stage(s,p,defs[id].colors[0],"energy");
 if(route==="blocked"){const frame={ops:[{op:"forbid",what:"beMovedBySkill",side:"you",fromArea:"any",until:"turn",target:{var:"t"}}],ip:0,vars:{t:[chosen]},card:leader,master:p} as ScriptFrame;assert.equal(stepScript(vmHost(ctx,game,s,[]),frame),"done");}
 if(id!=="P-092")s=drive(play(s,source),{stop:s=>s.prompt.kind==="chooseCards"});
 if(["BT1-014","TB2-024","P-092"].includes(id))s=drive(take(s,{type:"attack",player:p,attacker:source,target:s.sides[other(p)].zones.leader[0]}),{stop:s=>s.prompt.kind==="chooseCards"});
 assert.equal(s.prompt.kind,"chooseCards");if(s.prompt.kind!=="chooseCards")throw Error("Life choice");assert.equal(s.prompt.player,p);assert.equal(s.prompt.choice.blind,true);assert.ok(s.prompt.choice.candidates.includes(chosen));
 for(const viewer of [p,other(p)]){const view=RULES.boardView(ctx,s,viewer,{});assert.ok(cardsInView(view,chosen).every(c=>c.cardId===(route==="faceUp"?"SECRET":"")));if(route==="faceUp")assert.ok(cardsInView(view,chosen).some(c=>c.cardId==="SECRET"));assert.ok(cardsInView(view,publicLife).some(c=>c.cardId==="PUBLIC"));if(route!=="faceUp")assert.ok(!JSON.stringify(view).includes("Secret Life Identity"));}
 const offered=RULES.legalActions(ctx,s).find(x=>x.action.type==="choose"&&x.action.cards.includes(chosen));assert.ok(offered);assert.equal(offered.label,route==="faceUp"?"Choose Secret Life Identity":"Choose face-down card 4");
 const saved=copy(s),selection=route==="decline"?[]:[chosen];const finish=(state:VmState)=>{let next=drive(take(state,{type:"choose",player:p,cards:selection}),{prefer:[target],stop:s=>id==="TB2-042"&&s.prompt.kind==="chooseCards"&&s.prompt.player===other(p)});if(next.prompt.kind==="chooseCards"&&next.prompt.player===other(p)){assert.ok(cardsInView(RULES.boardView(ctx,next,other(p),{}),opponentPick).some(c=>c.cardId==="OPPSECRET"));assert.ok(!JSON.stringify(RULES.boardView(ctx,next,p,{})).includes("Opponent Secret Identity"));next=drive(take(next,{type:"choose",player:other(p),cards:[opponentPick]}));}return next;};s=finish(s);assert.deepEqual(s,finish(saved));const success=route==="success"||route==="faceUp";assert.equal(s.sides[p].zones.life.length,life-(success?1:0));assert.equal(s.sides[p].zones.hand.includes(chosen),success);assert.equal(s.sides[p].zones.hand.length,ownHand-(id==="P-092"?0:1)+(success?(id==="P-092"?2:1):0));
 if(id==="BT1-014"||id==="TB2-024"){assert.equal(attrsNow(ctx,game,s,source).power,5000+(success?10000:0));if(id==="BT1-014")assert.equal(hasKeyword(ctx,game,s,source,"Strike"),success);}
 if(id==="TB3-057")assert.equal(s.cards[target].mode,success?"rest":"active");
 if(id==="TB2-042")assert.equal(s.sides[other(p)].zones.hand.length,opponentHand-(success?1:0));
 cases++;
}
for(const p of ["p1","p2"] as PlayerId[])for(const drop of [0,4]){let s=fresh(p);const source=stage(s,p,"TB3-057","hand");for(let n=0;n<4;n++)stage(s,p,"Yellow","energy");for(let n=0;n<drop;n++)stage(s,p,"F","drop");const life=s.sides[p].zones.life.length;s=drive(play(s,source));assert.equal(s.prompt.kind,"main");assert.equal(s.sides[p].zones.life.length,life);cases++;}
console.log(`blind-life-hand-5: ${cases} gameplay scenarios PASS`);
