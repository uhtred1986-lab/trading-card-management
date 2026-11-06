import { buildSnapshot } from "../../src/lib/arena/snapshot";
/** R438: exact stored Drop permission and native Counter payment. */
import assert from "node:assert/strict";
import {card,fifty} from "./harness";
import {skillRecords} from "../../src/lib/arena/draft";
import {programProblem} from "../../src/lib/arena/vm/script-schema";
import {counterDropPermitProblem} from "../../src/lib/arena/vm/counter-drop-contract";
import {rulesFromRows,type RuleRow} from "../../src/lib/arena/rules-store";
import {RULES} from "../../src/lib/arena/vm";
import {rulesetFor} from "../../src/lib/arena/rulesets";
import {moveCard} from "../../src/lib/arena/vm/zones";
import {counterDropPermission} from "../../src/lib/arena/vm/counter-drop";
import {stepScript} from "../../src/lib/arena/vm/script";
import {vmHost} from "../../src/lib/arena/vm/host";
import type {VmState} from "../../src/lib/arena/vm/state";
import type {GameEvent,Action,PlayerId,CardDef,EngineContext} from "../../src/lib/arena/types";
const defs:Record<string,CardDef>={};
defs["BT7-024"]=card("BT7-024",{"type": "EXTRA", "name": "The Final Guardian", "colors": ["Red"], "specifiedCost": {"Red": 1}, "energyCost": 1, "skill": "[Counter: Attack] If your Leader Card is red: Negate the attack, then choose up to 1 of your Battle Cards and it gets +5000 power for the duration of the turn.<br>[Permanent] If this card is in your Drop Area, you can activate it by paying its energy cost and removing it and 1 red card in your hand from the game.<br>[Auto] When you activate this card, you can't activate {The Final Guardian} for the duration of the turn."});
defs["BT7-048"]=card("BT7-048",{"type": "EXTRA", "name": "All Too Easy...", "colors": ["Blue"], "specifiedCost": {"Blue": 1}, "energyCost": 1, "skill": "[Counter: Attack] If your Leader Card is blue: Negate the attack, then choose up to 1 of your opponent's Battle Cards with an energy cost of 1 and return it to its owner's hand.<br>[Permanent] If this card is in your Drop Area, you can activate it by paying its energy cost and removing it and 1 blue card in your hand from the game.<br>[Auto] When you activate this card, you can't activate {All Too Easy...} for the duration of the turn."});
defs["BT7-073"]=card("BT7-073",{"type": "EXTRA", "name": "For the Greater Good", "colors": ["Green"], "specifiedCost": {"Green": 1}, "energyCost": 1, "skill": "[Counter: Attack] If your Leader Card is green: Negate the attack, then choose up to 1 of your opponent's Battle Cards with an energy cost of 1 and KO it.<br>[Permanent] If this card is in your Drop Area, you can activate it by paying its energy cost and removing it and 1 green card in your hand from the game.<br>[Auto] When you activate this card, you can't activate {For the Greater Good} for the duration of the turn."});
defs["BT7-098"]=card("BT7-098",{"type": "EXTRA", "name": "Restrain", "colors": ["Yellow"], "specifiedCost": {"Yellow": 1}, "energyCost": 1, "skill": "[Counter: Attack] If your Leader Card is yellow: Negate the attack, then choose up to 1 of your opponent's Battle Cards with an energy cost of 1 or less and switch it to Rest Mode.<br>[Permanent] If this card is in your Drop Area, you can activate it by paying its energy cost and removing it and 1 yellow card in your hand from the game.<br>[Auto] When you activate this card, you can't activate {Restrain} for the duration of the turn."});
defs["BT10-092"]=card("BT10-092",{"name": "Gotenks", "type": "LEADER", "colors": ["Yellow"], "power": 10000, "characters": ["Gotenks: Adolescence"], "traits": ["Saiyan", "Earthling"], "skill": "[Auto] When this card attacks, add up to 1 card from your life to your hand, then draw 1 card.<br>[Auto][Once per turn] If your opponent has 1 or more energy: When your opponent activates an Extra Card, draw 1 card.<br>[Awaken] When your life is at 4 or less: You may switch up to 2 of your energy to Active Mode and flip this card over.", "energyCost": null, "back": {"name": "SS Gotenks, Display of Mastery", "power": 10000, "skill": "[Auto] When this card attacks, draw 1 card.<br>[Auto][Once per turn] When your opponent activates an Extra Card, draw 1 card, then choose up to 1 of your opponent's Battle Cards and switch it to Rest Mode.<br>[Auto][Once per turn] When you activate [Union-Fusion], this card gets +5000 power and [Critical] for the turn."}});
defs.TAX=card("TAX",{skill:"[Permanent] Your opponent can’t activate skills unless they send 1 card from their hand to their Warp each time."});
defs.ANSWER=card("ANSWER",{type:"EXTRA",energyCost:0,skill:"[Counter: Counter] Negate the [Counter]."});
const reorder=(value:unknown):unknown=>Array.isArray(value)?value.map(reorder):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reorder(item)])):value;
let cases=0;
for(const def of Object.values(defs).filter(d=>d.id.startsWith("BT7-"))){
 const row=skillRecords(def).find(r=>r.kind==="permanent")!;
 assert.deepEqual(row.unread,[]);assert.equal(row.ops.length,1);assert.equal(programProblem(row.ops),null);assert.equal(counterDropPermitProblem(row.ops[0]),null);
 assert.equal(counterDropPermitProblem(reorder(row.ops[0])),null,"property order is not authority");
 const bad=structuredClone(row.ops[0]);assert.equal(bad.op,"permit");if(bad.op!=="permit")throw new Error("permit");bad.until="turn";assert.ok(counterDropPermitProblem(bad));
 const free=structuredClone(row.ops[0]);if(free.op!=="permit")throw new Error("permit");free.price!.ops=free.price!.ops!.slice(1);assert.ok(counterDropPermitProblem(free),"source removal cannot be omitted");
 cases++;
}
const ids=Object.keys(defs).filter(id=>id.startsWith("BT7-"));for(const color of ["Red","Blue","Green","Yellow"] as const)defs[`L${color}`]=card(`L${color}`,{type:"LEADER",colors:[color]});defs.L=card("L",{type:"LEADER"});defs.F=card("F",{});
const rows=Object.values(defs).flatMap(skillRecords).map((r,id)=>({...r,id,source:"compiler",status:"confirmed"}) as unknown as RuleRow);
const ctx:EngineContext={defs,scripts:rulesFromRows(rows,defs)},loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
for(const owner of ["p1","p2"] as const)for(const cardId of ids){
 const s=RULES.createGame(ctx,{seed:438,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 const source=s.sides[owner].zones.deck.at(-1)!;s.cards[source].cardId=cardId;
 for(const area of ["hand","energy","warp","removed","battle"]){assert.ok(moveCard(s,game,source,area,{owner}).ok);assert.equal(counterDropPermission(ctx,game,s,owner,source),null);}
 assert.ok(moveCard(s,game,source,"drop",{owner}).ok);assert.ok(counterDropPermission(ctx,game,s,owner,source));assert.equal(counterDropPermission(ctx,game,s,owner==="p1"?"p2":"p1",source),null);
 assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"negateSkills",target:{var:"target"},until:"turn"}],ip:0,vars:{target:[source]},card:s.sides[owner].zones.leader[0],master:owner}),"done");assert.equal(counterDropPermission(ctx,game,s,owner,source),null,"negated permission grants nothing");cases++;
}
console.log(`drop-counter-5: ${cases} stored contracts passed`);

const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const snapshot=(s:VmState,viewer:PlayerId)=>buildSnapshot({id:438,revision:1,mode:"versus",status:"playing",p1Name:"One",p2Name:"Two",ctx,state:s,legal:[],log:[],beats:null,spotlight:null,spend:{calls:0,input:0,output:0,cached:0,micros:0},ai:null,viewer,images:{}});
const history:GameEvent[]=[];
const take=(s:VmState,a:Action)=>{const result=RULES.apply(ctx,copy(s),a);history.push(...result.events);return result.state as VmState;};
for(const owner of ["p1","p2"] as const)for(const cardId of ids)for(const mode of ["success","wrong-leader","no-energy","wrong-payer","negated","hand-to-drop","pay-reentry","pay-missing","prompt-reentry","prompt-missing","prompt-malformed","price-reentry","missing","malformed","tax-pay","tax-fail","tax-source","counter-negate","counter-decline"] as const){
 history.length=0;
 const first:PlayerId=owner==="p1"?"p2":"p1";
 let s=RULES.createGame(ctx,{seed:438,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first},{type:"mulligan",player:first,redraw:false},{type:"mulligan",player:owner,redraw:false},{type:"charge",player:first,card:null},{type:"endMain",player:first},{type:"charge",player:owner,card:null},{type:"endMain",player:owner},{type:"charge",player:first,card:null}] as Action[])s=take(s,a);
 const color=defs[cardId].colors[0];const leader=s.sides[owner].zones.leader[0];
 const lid=`L${color}`;defs[lid]=card(lid,{type:"LEADER",colors:[color]});s.cards[leader].cardId=lid;
 const stage=(def:string,area:string)=>{const id=s.sides[owner].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,area,{owner}).ok);return id;};
 const source=stage(cardId,"drop"),energy=stage(cardId,"energy"),payer=stage(cardId,"hand");const secondPayer=stage(cardId,"hand");
 if(mode==="wrong-leader")s.cards[leader].cardId=`L${color=== "Blue"?"Red":"Blue"}`;
 if(mode==="no-energy"){s.cards[energy].mode="rest";s.sides[owner].attrs.energyMarkers=0;}
 if(mode==="wrong-payer"){for(const id of s.sides[owner].zones.hand)s.cards[id].cardId=color==="Red"?"BT7-048":"BT7-024";}
 if(mode==="negated")assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"negateSkills",target:{var:"target"},until:"turn"}],ip:0,vars:{target:[source]},card:s.sides[first].zones.leader[0],master:first}),"done");
 if(mode.startsWith("tax")){const tax=s.sides[first].zones.deck.at(-1)!;s.cards[tax].cardId="TAX";assert.ok(moveCard(s,game,tax,"battle",{owner:first}).ok);}
 const answer=mode.startsWith("counter-")?s.sides[first].zones.deck.at(-1)!:null;if(answer){s.cards[answer].cardId="ANSWER";assert.ok(moveCard(s,game,answer,"hand",{owner:first}).ok);}
 s=take(s,{type:"attack",player:first,attacker:s.sides[first].zones.leader[0],target:leader});
 const offered=RULES.legalActions(ctx,s).some(l=>l.action.type==="counter"&&l.action.card===source);
 if(["wrong-leader","no-energy","wrong-payer","negated"].includes(mode)){assert.ok(!offered,mode+" must not offer");cases++;continue;}
 assert.ok(offered,cardId+" Drop Counter offered");
 assert.throws(()=>take(s,{type:"counter",player:owner,card:source,alt:true}),/energy cost/);
 if(mode.startsWith("prompt-")){
 assert.equal(s.prompt.kind,"counter");if(s.prompt.kind!=="counter")throw new Error("counter");
 if(mode==="prompt-reentry"){assert.ok(moveCard(s,game,source,"hand",{owner}).ok);assert.ok(moveCard(s,game,source,"drop",{owner}).ok);}
 if(mode==="prompt-missing")delete s.prompt.dropOccurrences;
 if(mode==="prompt-malformed")s.prompt.dropOccurrences!.version=0 as 1;
 const legal=RULES.legalActions(ctx,s),rejected=RULES.rejectedActions(ctx,s,legal);assert.ok(!legal.some(l=>l.action.type==="counter"&&l.action.card===source));
 assert.ok(rejected.some(l=>l.action.type==="counter"&&l.action.card===source));assert.equal(RULES.abilityAvailability(ctx,s,owner,legal,rejected).find(r=>r.card===source&&r.skill===0)?.state,"refused");
 assert.throws(()=>take(s,{type:"counter",player:owner,card:source}),/Drop Counter/);cases++;continue;
 }
 if(mode==="hand-to-drop"){
 assert.ok(s.prompt.kind==="counter"&&s.prompt.candidates.includes(payer));assert.ok(moveCard(s,game,payer,"drop",{owner}).ok);
 assert.ok(!RULES.legalActions(ctx,s).some(l=>l.action.type==="counter"&&l.action.card===payer));assert.throws(()=>take(s,{type:"counter",player:owner,card:payer}),/rebuild.*Drop Counter/);cases++;continue;
 }
 const opponentHand=s.sides[first].zones.hand.length;
 if(mode==="success"){const opponentLeader=s.sides[first].zones.leader[0];s.cards[opponentLeader].cardId="BT10-092";s.cards[opponentLeader].flipped=true;}
 s=take(s,{type:"counter",player:owner,card:source});
 if(s.prompt.kind==="payCost"){const pay=RULES.legalActions(ctx,s)[0]?.action;assert.ok(pay);
 if(mode.startsWith("pay-")){if(mode==="pay-reentry"){assert.ok(moveCard(s,game,source,"hand",{owner}).ok);assert.ok(moveCard(s,game,source,"drop",{owner}).ok);}else delete s.prompt.dropOccurrences;assert.throws(()=>take(s,pay),/Drop Counter/);assert.equal(s.cards[energy].mode,"active");cases++;continue;}
 s=take(s,pay);}
 else assert.ok(!mode.startsWith("pay-"),"energy chooser required for saved-payment proof");
 assert.equal(s.prompt.kind,"chooseCards",JSON.stringify(s.outcome));assert.ok(s.sides[owner].zones.removed.includes(source));assert.equal(s.cards[energy].mode,"rest");
 if(mode==="success"){const view=snapshot(s,first);assert.equal(view.view.them.hand,null);for(const id of s.sides[owner].zones.hand)assert.ok(!JSON.stringify(view).includes(JSON.stringify(id)),"opponent projection hides unpaid hand IDs");}
 if(mode==="tax-fail")for(const id of [...s.sides[owner].zones.hand])if(id!==payer)assert.ok(moveCard(s,game,id,"deck",{owner}).ok);
 // Saved-state fault controls, not an invented interrupt during payment.
 if(mode==="price-reentry"){assert.ok(moveCard(s,game,source,"drop",{owner}).ok);assert.ok(moveCard(s,game,source,"removed",{owner}).ok);}
 if(mode==="missing")delete s.programs.find(f=>f.counterCost)!.counterCost!.dropOrigin;
 if(mode==="malformed")s.programs.find(f=>f.counterCost)!.counterCost!.dropOrigin!.version=0 as 1;
 s=take(s,{type:"choose",player:owner,cards:[payer]});
 if(mode==="missing"||mode==="malformed"){assert.match(JSON.stringify(s.outcome),/rebuild/);assert.ok(s.sides[owner].zones.hand.includes(payer));cases++;continue;}
 if(mode==="price-reentry"){assert.ok(s.sides[owner].zones.hand.includes(payer));assert.ok(s.sides[owner].zones.removed.includes(source));cases++;continue;}
 if(mode!=="tax-fail")assert.ok(s.sides[owner].zones.hand.includes(secondPayer));
 if(mode.startsWith("tax")){
 assert.equal(history.filter(e=>e.type==="skill"&&e.card===source&&e.skill===0).length,0);
 if(mode==="tax-pay"||mode==="tax-source"){assert.equal(s.prompt.kind,"chooseCards");if(mode==="tax-source")assert.ok(moveCard(s,game,source,"hand",{owner}).ok);s=take(s,{type:"choose",player:owner,cards:[secondPayer]});assert.equal(s.sides[owner].zones.warp.includes(secondPayer),mode==="tax-pay");if(mode==="tax-source")assert.ok(s.sides[owner].zones.hand.includes(secondPayer));}
 assert.equal(history.filter(e=>e.type==="skill"&&e.card===source&&e.skill===0).length,mode==="tax-pay"?1:0);
 assert.ok(s.sides[owner].zones[mode==="tax-source"?"hand":"removed"].includes(source));assert.ok(s.sides[owner].zones.removed.includes(payer));cases++;continue;
 }
 if(answer){assert.equal(s.prompt.kind,"counter");assert.equal(s.prompt.player,first);s=take(s,{type:"counter",player:first,card:mode==="counter-negate"?answer:null});if(mode==="counter-negate"){assert.equal(history.filter(e=>e.type==="skill"&&e.card===source&&e.skill===0).length,1);assert.ok(s.sides[owner].zones.removed.includes(source));assert.ok(s.sides[owner].zones.removed.includes(payer));cases++;continue;}}

 for(let n=0;n<15&&s.prompt.kind!=="main";n++){
 const actions=RULES.legalActions(ctx,s).map(x=>x.action);const a=actions.find(a=>a.type==="orderPending")??actions.find(a=>a.type==="choose"&&a.cards.length===0)??actions.find(a=>a.type==="counter"&&a.card===null);assert.ok(a,JSON.stringify(s.prompt)+JSON.stringify(s.outcome));s=take(s,a);
 }
 assert.equal(s.prompt.kind,"main");assert.ok(s.sides[owner].zones.removed.includes(source));assert.ok(s.sides[owner].zones.removed.includes(payer));
 if(mode==="success"){
 assert.equal(s.sides[first].zones.hand.length,opponentHand+1,"actual Gotenks observes permitted Drop Extra activation");
 const second=stage(cardId,"drop");s.cards[energy].mode="active";
 const attacker=s.sides[first].zones.deck.at(-1)!;s.cards[attacker].cardId="F";assert.ok(moveCard(s,game,attacker,"battle",{owner:first}).ok);
 s=take(s,{type:"attack",player:first,attacker,target:leader});assert.ok(!RULES.legalActions(ctx,s).some(l=>l.action.type==="counter"&&l.action.card===second),"own activation Auto locks second same-name Drop Counter");
 }
 cases++;
}
console.log(`drop-counter-5: ${cases} total contracts/native cases passed`);
