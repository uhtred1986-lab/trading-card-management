/** R506 preparation: native helpers only; no candidate KO semantics or admitted Android14 body. */
import assert from "node:assert/strict";
import {card,fifty} from "./harness";
import {skillRecords} from "../../src/lib/arena/draft";
import {rulesFromRows,type RuleRow} from "../../src/lib/arena/rules-store";
import {RULES} from "../../src/lib/arena/vm";
import {rulesetFor} from "../../src/lib/arena/rulesets";
import {moveCard} from "../../src/lib/arena/vm/zones";
import {correctSkillText} from "../../src/lib/catalog/errata";
import type {Action,CardDef,EngineContext,PlayerId} from "../../src/lib/arena/types";
import type {VmState} from "../../src/lib/arena/vm/state";
import fixture from "./fixtures/conditional-ko-result-5.json";
export const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
export const defs:Record<string,CardDef>={F:card("F",{}),L:card("L",{type:"LEADER",power:100000}),LOW:card("LOW",{energyCost:3}),HIGH:card("HIGH",{energyCost:4}),INDEST:card("INDEST",{energyCost:3,skill:"[Indestructible]"}),BARRIER:card("BARRIER",{energyCost:3,skill:"[Barrier]"}),WATCH:card("WATCH",{skill:"[Auto] When you play a Battle Card, draw 1 card."}),TAX:card("TAX",{skill:"[Permanent] Your opponent can't activate skills unless they send 1 card from their hand to their Warp each time."})};
for(const color of ["Red","Green","Blue","Black"] as const)defs[color]=card(color,{colors:[color]});
for(const [id,item] of Object.entries(fixture)){const c=item.card;defs[id]=card(id,{name:c.name,type:c.type as CardDef["type"],colors:c.colors as CardDef["colors"],energyCost:Number(c.cost),zEnergyCost:c.z===null?null:Number(c.z),power:c.power,characters:c.characters,traits:c.traits,skill:correctSkillText(id,c.skill)});}
export const records=Object.values(defs).flatMap(skillRecords);
export const ctx:EngineContext={defs,scripts:rulesFromRows(copy(records.map((r,id)=>({...r,id,status:r.unread.length?"open":"confirmed",source:"compiler"}) as unknown as RuleRow)),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);export const game=loaded.definition;
export const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
export function take(s:VmState,a:Action,allowOutcome=false):VmState{const saved=copy(s),before=JSON.stringify(saved);for(const viewer of ["p1","p2"] as const){const view=JSON.stringify(RULES.boardView(ctx,saved,viewer,{}));assert.ok(!view.includes('"koResults"')&&!view.includes('"koBinding"'),"internal KO capture stays private");}const result=RULES.apply(ctx,saved,a);assert.equal(JSON.stringify(saved),before);if(!allowOutcome)assert.equal(result.state.outcome,undefined,JSON.stringify(result.state.outcome));return result.state as VmState;}
export function fresh(turn:PlayerId):VmState{let s=RULES.createGame(ctx,{seed:506,p1:{name:"One",leader:"L",main:fifty("F"),z:["BT18-034"]},p2:{name:"Two",leader:"L",main:fifty("F"),z:["BT18-034"]}}).state as VmState;for(const a of [{type:"chooseFirst",player:s.chooser,first:turn},{type:"mulligan",player:turn,redraw:false},{type:"mulligan",player:other(turn),redraw:false},{type:"charge",player:turn,card:null},{type:"endMain",player:turn},{type:"charge",player:other(turn),card:null},{type:"endMain",player:other(turn)},{type:"charge",player:turn,card:null}] as Action[])s=take(s,a);s.sides.p1.attrs.energyMarkers=0;s.sides.p2.attrs.energyMarkers=0;return s;}
/** Explicit board/resource setup, not a claimed printed skill procedure. */
export function stage(s:VmState,p:PlayerId,def:string,area:string):string{const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);return id;}
export function drive(s:VmState,allowOutcome=false):VmState{for(let i=0;i<100;i++){if(s.outcome||s.prompt.kind==="main"||s.prompt.kind==="charge")return s;const q=s.prompt;let a:Action|undefined;if(q.kind==="chooseCards")a={type:"choose",player:q.player,cards:q.choice.candidates.slice(0,q.choice.min??0)};else if(q.kind==="orderPending")a={type:"orderPending",player:q.player,index:s.pendingOrder!.candidates[0]};else if(q.kind==="optionalCost")a={type:"optionalCost",player:q.player,pay:true};else {const legal=RULES.legalActions(ctx,s).map(x=>x.action);a=legal.find(x=>x.type==="counter"&&x.card===null)??legal.find(x=>x.type==="payCost")??legal.find(x=>x.type==="chooseMode"&&x.index===0)??legal.find(x=>x.type==="pass");}assert.ok(a,JSON.stringify(q));s=take(s,a,allowOutcome);}throw Error("drive bound");}
export function playHand(s:VmState,id:string,allowOutcome=false):VmState{const a=RULES.legalActions(ctx,s).map(x=>x.action).find(x=>x.type==="play"&&x.card===id);assert.ok(a,JSON.stringify(RULES.legalActions(ctx,s)));return drive(take(s,a,allowOutcome),allowOutcome);}
export function paidCell(s:VmState,p:PlayerId):{state:VmState;card:string}{for(let i=0;i<3;i++)stage(s,p,"Blue","energy");for(let i=0;i<2;i++)stage(s,p,"F","zEnergy");const id=s.sides[p].zones.zDeck.find(id=>s.cards[id].cardId==="BT18-034")!;assert.ok(id);const a=RULES.legalActions(ctx,s).map(x=>x.action).find(x=>x.type==="playZ"&&x.card===id);assert.ok(a);const next=drive(take(s,a));assert.ok(next.sides[p].zones.battle.includes(id));assert.equal(next.cards[id].zCard,true);assert.equal(next.sides[p].zones.energy.filter(id=>next.cards[id].mode==="rest").length,3);assert.equal(next.sides[p].zones.zEnergy.length,0);return {state:next,card:id};}
