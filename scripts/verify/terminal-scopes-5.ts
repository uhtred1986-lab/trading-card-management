/** R436: terminal outcomes discard parked effect lifetimes as well as running queues. */
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
const defs:Record<string,CardDef>={F:card("F",{}),L:card("L",{type:"LEADER"}),ENERGY:card("ENERGY",{colors:["Blue","Yellow","Red"]}),SOURCE:card("SOURCE",{skill:"[Activate: Main] Choose up to 1 Battle Card from your hand and play it."}),HOLD:card("HOLD",{energyCost:3,skill:"[Counter: Play] If the Battle Card being played has an energy cost of 5 or less, negate its skills for the turn and play this card."}),WIN:card("WIN",{skill:"[Counter: Play] Play this card, then you win the game."}),NEG:card("NEG",{type:"EXTRA",skill:"[Counter: Counter] Negate the [Counter]."})};
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
let cases=0;
for(const owner of ["p1","p2"] as const)for(const mode of ["interrupt","win","concede"] as const){
 let s=fresh(owner);const source=stage(s,owner,"SOURCE","battle"),target=stage(s,owner,"F","hand"),counter=stage(s,other(owner),mode==="win"?"WIN":"HOLD","hand");stage(s,owner,"NEG","hand");stage(s,owner,"ENERGY","energy");for(let n=0;n<4;n++)stage(s,other(owner),"ENERGY","energy");
 const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===source);assert.ok(action);s=take(s,action);s=answer(s,counter);
 while(s.prompt.kind==="payCost"){const pay=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="payCost");assert.ok(pay);s=take(s,pay);}
 assert.equal(s.prompt.kind,"counter");assert.equal(s.skillPlayScopes?.length,2);assert.ok(s.skillPlayScopes![0].window);assert.ok(s.skillPlayScopes![1].window);
 if(mode==="interrupt"){
  // Staged corrupted save at an actual nested Counter timing.
  const frame=s.skillPlayScopes![1].window!.programs.find(frame=>frame.card===counter&&frame.counterPlay)!;assert.ok(frame);frame.counterSource!.epoch=-1;
 }
 const result=RULES.apply(ctx,copy(s),mode==="concede"?{type:"concede",player:owner}:{type:"counter",player:s.prompt.player,card:null});s=result.state as VmState;
 assert.equal(s.outcome?.kind,mode==="interrupt"?"interrupted":mode==="win"?"win":"concession");
 if(mode==="interrupt"){assert.equal(s.outcome?.privateContext?.sourceCard,counter);assert.match(s.outcome?.privateContext?.detail??"",/rebuild this activated Counter before retaining/);}else assert.equal(s.winner,other(owner));
 assert.equal(s.phase,"over");assert.equal(s.prompt.kind,"gameOver");assert.equal(s.programs.length,0);assert.equal(s.skillPlayScopes,undefined);assert.equal(s.resolving,null);assert.deepEqual(s.pending,[]);assert.ok(s.sides[owner].zones.hand.includes(target));assert.equal(result.events.filter(event=>event.type==="gameOver").length,1);assert.equal(copy(s).outcome?.kind,s.outcome?.kind);cases++;
}
console.log(`terminal-scopes-5: ${cases} native terminal cases passed`);
