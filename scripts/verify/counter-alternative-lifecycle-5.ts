/** R461: alternative action payment finishes before Counter activation. */
import assert from "node:assert/strict";
import {card,fifty} from "./harness";
import {rulesFromCompiler} from "../../src/lib/arena/draft";
import {RULES} from "../../src/lib/arena/vm";
import {rulesetFor} from "../../src/lib/arena/rulesets";
import {stepScript} from "../../src/lib/arena/vm/script";
import {vmHost} from "../../src/lib/arena/vm/host";
import {buildSnapshot} from "../../src/lib/arena/snapshot";
import {vmRevealedTo} from "../../src/lib/arena/vm/view";
import {usesLeft} from "../../src/lib/arena/vm/limits";
import {skillsShowing} from "../../src/lib/arena/vm/triggers";
import {moveCard} from "../../src/lib/arena/vm/zones";
import type {Action,EngineContext,PlayerId} from "../../src/lib/arena/types";
import type {VmState} from "../../src/lib/arena/vm/state";
const defs={L:card("L",{type:"LEADER"}),F:card("F",{}),BLACK:card("BLACK",{colors:["Black"]}),ALT:card("ALT",{type:"EXTRA",colors:["Blue"],energyCost:3,skill:"[Counter: Attack][Limit 1] Negate the attack.<br>[Permanent] You can activate this card's [Counter] skill from your hand without paying its energy cost by choosing 1 other black card in your hand and placing it in your Drop Area.<br>[Auto] When you activate this card, draw 1 card."}),WATCH:card("WATCH",{skill:"[Auto] When you activate a blue Extra Card from your hand, draw 1 card."})};
Object.assign(defs,{REPLACEALT:card("REPLACEALT",{...defs.ALT,id:"REPLACEALT",name:"REPLACEALT",skill:defs.ALT.skill!.replace("1 other black card in your hand","1 of your Battle Cards")}),UUB:card("UUB",{type:"LEADER",colors:["Blue"],characters:["Uub"]}),BUU:card("BUU",{colors:["Blue"],characters:["Mr. Buu"]}),"BT21-065":card("BT21-065",{type:"EXTRA",name:"Full Strength Absorption",colors:["Blue"],energyCost:1,skill:"[Counter: Attack][Limit 1] Negate the attack. Additionally, if your opponent has 4 or more Z-Energy, draw 1 card.<br>[Permanent] If your Leader is a blue <Uub> and your life is at 4 or less, you can activate this card's [Counter] skill from your hand without paying its energy cost by discarding 1 blue <Mr. Buu> from your hand."}),ANSWER:card("ANSWER",{type:"EXTRA",energyCost:0,skill:"[Counter: Counter] Negate the [Counter]."})});
// R462: DB2-164's official FAQ explicitly excludes the activating Extra
// from a hand discard that replaces its energy payment.
Object.assign(defs, {
 REDSAIYAN: card("REDSAIYAN", {type:"LEADER",colors:["Red"],traits:["Saiyan"]}),
 GREENSAIYAN: card("GREENSAIYAN", {type:"LEADER",colors:["Green"],traits:["Saiyan"]}),
 "BT13-030": card("BT13-030", {type:"EXTRA",name:"King Vegeta's Imposing Presence",colors:["Red"],energyCost:1,skill:"[Counter: Attack] If your Leader Card is a mono-red ≪Saiyan≫ card: You may choose the attacking card, ignoring [Barrier], and it gets -10000 power for the turn; your opponent can't attack with cards for the turn unless they give the attacking card -5000 power for the turn each time. You can't activate copies of this card from your hand for the turn.<br>[Permanent] If your life is at 3 or less, you can activate this card's [Counter] skill from your hand without paying its energy cost by choosing 1 card in your hand and discarding it."}),
 "BT21-097": card("BT21-097", {type:"EXTRA",name:"Uneasing Awakened Rage",colors:["Green"],energyCost:1,skill:"[Counter: Attack][Limit 1] If your Leader is a mono-green ≪Saiyan≫: Negate the attack. Additionally, if your life is at 4 or less, you may discard 1 card from your hand. If you do, your opponent can't attack for the turn unless they add 1 card from their hand to their Z-Energy.<br>[Permanent] You may activate this card's [Counter] skill from your hand without paying its energy cost by discarding 1 green card from your hand."}),
});
const ctx:EngineContext={defs,scripts:rulesFromCompiler(defs)},loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>RULES.apply(ctx,copy(s),a).state as VmState;
const snapshot=(s:VmState,viewer:PlayerId)=>buildSnapshot({id:461,revision:1,mode:"versus",status:"playing",p1Name:"One",p2Name:"Two",ctx,state:s,legal:[],log:[],beats:null,spotlight:null,spend:{calls:0,input:0,output:0,cached:0,micros:0},ai:null,viewer,images:{}});

function stage(s:VmState,p:PlayerId,def:string,area:string){const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner:p}).ok);return id;}
let cases=0;
for(const owner of ["p1","p2"] as const)for(const mode of ["success","actual","decline-response","negate-response","source-reentry","stale-payer","replacement","legacy","missing","malformed"] as const){const first=other(owner);
 let s=RULES.createGame(ctx,{seed:461,p1:{name:"One",leader:mode==="actual"&&owner==="p1"?"UUB":"L",main:fifty("F")},p2:{name:"Two",leader:mode==="actual"&&owner==="p2"?"UUB":"L",main:fifty("F")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:owner,redraw:false},{type:"charge",player:first,card:null},{type:"endMain",player:first},{type:"charge",player:owner,card:null},{type:"endMain",player:owner},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);
 const source=stage(s,owner,mode==="actual"?"BT21-065":mode==="replacement"?"REPLACEALT":"ALT","hand");stage(s,owner,mode==="actual"?"BUU":"BLACK",mode==="replacement"?"battle":"hand");stage(s,owner,mode==="actual"?"BUU":"BLACK",mode==="replacement"?"battle":"hand");stage(s,owner,"WATCH","battle");if(mode==="actual"){for(const id of s.sides[owner].zones.life.slice(4))assert.ok(moveCard(s,game,id,"drop",{owner}).ok);}const before=s.sides[owner].zones.hand.length;const response=mode.includes("response")?stage(s,first,"ANSWER","hand"):null;
 if(mode==="replacement"){const probe=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});assert.ok(RULES.legalActions(ctx,probe).some(x=>x.action.type==="counter"&&x.action.card===source&&x.action.alt),"same replacement fixture offers the alternative before replacement");const payers=[...s.sides[owner].zones.battle];assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"replaceLeave",from:["battle"],requestedTo:"drop",to:"warp",until:"turn",target:{var:"payers"}}],ip:0,vars:{payers},card:s.sides[first].zones.leader[0],master:first}),"done");}
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});if(mode==="replacement"){assert.ok(!RULES.legalActions(ctx,s).some(x=>x.action.type==="counter"&&x.action.card===source),"replaced Battle departure cannot pay the alternative");assert.equal(s.pending.length,0);assert.ok(s.sides[owner].zones.hand.includes(source));cases++;continue;}s=take(s,{type:"counter",player:owner,card:source,alt:true});
 assert.equal(s.prompt.kind,"chooseCards");assert.ok(s.sides[owner].zones.hand.includes(source),"unpaid Counter stays in hand");assert.equal(s.pending.length,0,"no activation Autos before complete action payment");assert.ok(vmRevealedTo(game,s,first).has(source),"declared source is revealed");const publicView=snapshot(s,first);assert.deepEqual(publicView.view.them.revealedHand?.map(c=>c.id),[source]);assert.equal(publicView.view.them.hand,null);assert.ok(JSON.stringify(publicView).includes(mode==="actual"?"Full Strength Absorption":"ALT"),"snapshot includes declared identity");assert.ok(s.sides[owner].zones.hand.filter(id=>id!==source).every(id=>!JSON.stringify(publicView).includes(JSON.stringify(id))),"snapshot hides unpaid payer instance IDs");assert.ok(s.sides[owner].zones.hand.filter(id=>id!==source).every(id=>!vmRevealedTo(game,s,first).has(id)),"other hand cards remain private");
 if(s.prompt.kind!=="chooseCards")throw new Error("price chooser");const payer=s.prompt.choice.candidates[0];const skill=skillsShowing(ctx,s,source).skills.find(sk=>sk.kind==="counter:attack")!;assert.equal(usesLeft(s,owner,source,skill),1,"usage remains unspent before payment");
 // Explicit saved-state fault controls: no native interleaving is invented during price resolution.
 if(mode==="source-reentry"){assert.ok(moveCard(s,game,source,"drop",{owner}).ok);assert.ok(moveCard(s,game,source,"hand",{owner}).ok);assert.ok(!vmRevealedTo(game,s,first).has(source),"new source occurrence is not revealed by old declaration");assert.equal(snapshot(s,first).view.them.revealedHand,undefined);}
 if(mode==="stale-payer"){assert.ok(moveCard(s,game,payer,"drop",{owner}).ok);assert.throws(()=>take(s,{type:"choose",player:owner,cards:[payer]}));assert.equal(s.pending.length,0);assert.equal(usesLeft(s,owner,source,skill),1);cases++;continue;}
 if(mode==="legacy"){const f=s.programs.find(f=>f.counterCost)!;delete f.counterCost;f.saveVarsAs=`costvars:${source}:${skill.index}`;}
 if(mode==="missing"){delete s.programs.find(f=>f.counterCost)!.counterCost!.alternative;}
 if(mode==="malformed"){s.programs.find(f=>f.counterCost)!.counterCost!.alternative!.version=0 as 1;}
 s=take(s,{type:"choose",player:owner,cards:[payer]});
 if(mode==="legacy"||mode==="missing"||mode==="malformed"){assert.equal(s.outcome?.kind,"interrupted");assert.match(s.outcome?.privateContext?.detail??"",mode==="legacy"?/rebuild the saved ordinary Activate payment source/:/rebuild.*alternative Counter/);assert.ok(s.sides[owner].zones.hand.includes(payer),"invalid saved payment cannot consume its payer");assert.ok(s.sides[owner].zones.hand.includes(source));assert.equal(usesLeft(s,owner,source,skill),1);cases++;continue;}
 if(mode==="source-reentry"){assert.ok(s.sides[owner].zones.hand.includes(source));assert.equal(usesLeft(s,owner,source,skill),1);assert.equal(s.pending.length,0);cases++;continue;}
 assert.equal(usesLeft(s,owner,source,skill),0,"successful payment spends one use");
 if(response){assert.equal(s.prompt.kind,"counter");assert.equal(s.prompt.player,first);s=take(s,{type:"counter",player:first,card:mode==="negate-response"?response:null});}
 
 for(let n=0;n<20&&s.prompt.kind!==(mode==="negate-response"?"combo":"main");n++){const a=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="orderPending")??RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="counter"&&a.card===null);assert.ok(a,JSON.stringify(s.prompt));s=take(s,a);}
 assert.equal(s.prompt.kind,mode==="negate-response"?"combo":"main");assert.ok(s.sides[owner].zones.drop.includes(source));assert.equal(snapshot(s,first).view.them.revealedHand,undefined);assert.equal(s.sides[owner].zones.hand.length,before-2+(mode==="actual"?1:2));cases++;
}
for(const owner of ["p1","p2"] as const)for(const cardId of ["BT13-030","BT21-097"] as const){
 const first=other(owner),leader=cardId==="BT13-030"?"REDSAIYAN":"GREENSAIYAN";
 let s=RULES.createGame(ctx,{seed:462,p1:{name:"One",leader:owner==="p1"?leader:"L",main:fifty("F")},p2:{name:"Two",leader:owner==="p2"?leader:"L",main:fifty("F")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:owner,redraw:false},{type:"charge",player:first,card:null},{type:"endMain",player:first},{type:"charge",player:owner,card:null},{type:"endMain",player:owner},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);
 for(const id of [...s.sides[owner].zones.hand,...s.sides[owner].zones.life.slice(3)])assert.ok(moveCard(s,game,id,"drop",{owner}).ok);
 s.sides[owner].attrs.energyMarkers=0;
 const source=stage(s,owner,cardId,"hand");
 const beforeAttack=copy(s);
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 assert.equal(s.sides[owner].zones.hand.length,1);
 assert.ok(!RULES.legalActions(ctx,s).some(x=>x.action.type==="counter"&&x.action.card===source),"the activating Extra cannot pay its own alternative discard");
 assert.throws(()=>take(s,{type:"counter",player:owner,card:source,alt:true}));
 s=beforeAttack;const payer=stage(s,owner,cardId,"hand"),secondPayer=stage(s,owner,cardId,"hand");
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:s.sides[owner].zones.leader[0]});
 const action=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="counter"&&a.card===source&&a.alt);
 assert.ok(action,"a separate copy can pay the generic discard");
 s=take(s,action);assert.equal(s.prompt.kind,"chooseCards");
 if(s.prompt.kind!=="chooseCards")throw new Error("alternative discard chooser");
 assert.deepEqual([...s.prompt.choice.candidates].sort(),[payer,secondPayer].sort());
 assert.throws(()=>take(copy(s),{type:"choose",player:owner,cards:[source]}),"saved prompt rejects forged self-payment");
 s=take(copy(s),{type:"choose",player:owner,cards:[payer]});
 assert.ok(s.sides[owner].zones.drop.includes(payer));assert.ok(s.sides[owner].zones.drop.includes(source));assert.ok(s.sides[owner].zones.hand.includes(secondPayer));assert.equal(s.outcome,undefined);
 cases++;
}
console.log(`counter-alternative-lifecycle-5: ${cases} native and saved-state cases passed`);
