/** R456: complete Over Realm costs and exact dark arrival/cleanup. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { stepScript } from "../../src/lib/arena/vm/script";
import { canonicalTaxValue, taxReceiptIdentity } from "../../src/lib/arena/vm/tax-receipt";
import { vmHost } from "../../src/lib/arena/vm/host";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const actual=[
{"id": "BT13-154", "type": "BATTLE", "colors": ["Black"], "cost": "8", "specified": null, "z": null, "power": 40000, "name": "Robelu, Demigra's Secretary", "characters": ["Robelu"], "traits": ["Demon Realm Race"], "skill": "[ultimate][double strike]<br>[dark over realm 8]{2}<br>[permanent] If this card would be removed from a Battle Area, remove it from the game instead.<br>[auto] If you have 4 or more energy: When this card is played using [dark over realm], play up to 2 Battle Cards with different card names, energy costs of 6 or less, and the [over realm] skill from your Warp.<br>[auto] Choose 1 card in your Battle Area with the [over realm] skill and place it in its owner's Drop Area: When one of your opponent's cards attacks, negate the attack.", "backName": null, "backSkill": null},
  {
    "id": "DB3-109",
    "type": "BATTLE",
    "colors": [
      "Black"
    ],
    "cost": "5",
    "specified": null,
    "z": null,
    "power": 30000,
    "name": "Demon God Demigra, True Power Unleashed",
    "characters": [
      "Demigra"
    ],
    "traits": [
      "Demon God"
    ],
    "skill": "[over realm 5]{2}<br>[dark over realm 5]{2}<br>[auto] When this card is played using [over realm] or [dark over realm], draw 1 card, then choose up to 1 of your opponent's Battle Cards and send it to its owner's Warp.<br>[auto] When this card attacks, your opponent chooses 1 card in their hand and sends it to their Warp.",
    "backName": null,
    "backSkill": null
  },
  {
    "id": "BT31-093",
    "type": "BATTLE",
    "colors": [
      "Black"
    ],
    "cost": "8",
    "specified": null,
    "z": null,
    "power": 35000,
    "name": "SS4 Limit Breaker Vegito, Crimson Flash, Super Full Power",
    "characters": [
      "Vegito: Xeno"
    ],
    "traits": [
      "Saiyan"
    ],
    "skill": "[double strike]\n[br]\n[xeno-evolve] {b}: <Vegito: Xeno> card with an energy cost of 7.\n[br]\n[auto] [limit 1] If you have 3 or more energy: When this card is played, draw 1 card, choose up to 1 of your opponent's Battle Cards, send it to its owner's Warp and during your opponent's next turn, when your opponent's Battle Card is played, your opponent can't play it unless they send 3 cards from their Drop to their owner's Warp.\n[br]\n[activate: main] {b}{b}: Play this card from your hand.",
    "backName": null,
    "backSkill": null
  },
  {
    "id": "BT27-102",
    "type": "BATTLE",
    "colors": [
      "Black"
    ],
    "cost": "4",
    "specified": null,
    "z": null,
    "power": 20000,
    "name": "Demon God Putine, Scheming",
    "characters": [
      "Putine"
    ],
    "traits": [
      "Demon God"
    ],
    "skill": "[Dark Over Realm 4]{b}, if your Leader is a <Mechikabura> card and you draw 1 card:\n[br]\n[Auto][Limit 1] When your Battle Card other than this card is played by a [Dark Over Realm] skill, draw 1 card.",
    "backName": null,
    "backSkill": null
  },
  {
    "id": "BT27-100",
    "type": "BATTLE",
    "colors": [
      "Black"
    ],
    "cost": "4",
    "specified": null,
    "z": null,
    "power": 20000,
    "name": "Demigra, Encroaching Shadow",
    "characters": [
      "Demigra"
    ],
    "traits": [
      "Demon God"
    ],
    "skill": "[Wormhole]\n[br]\n[Dark Over Realm 4]{b}, if your Leader is a <Mechikabura> card and you draw 1 card:",
    "backName": null,
    "backSkill": null
  },
  {
    "id": "BT31-150",
    "type": "BATTLE",
    "colors": [
      "Black"
    ],
    "cost": "8",
    "specified": null,
    "z": null,
    "power": 40000,
    "name": "SSB Kaio-ken Vegito, True God Power",
    "characters": [
      "Vegito"
    ],
    "traits": [
      "Saiyan"
    ],
    "skill": "[ultimate] [triple strike]\n[br]\n[over realm 6] If your Leader is black and you have 4 or more energy: \n[br]\n[permanent] This card's [over realm] skill can be activated from its owner's Warp under the same conditions as if it were in your hand.\n[br]\n[auto] When this card is played, choose up to 1 of your opponent's Battle Cards, send it to its owner's Warp, and until the end of your opponent's turn, when your opponent's card is plyed, they can't play it unless they send 1 card from their hand to its owner's Warp.",
    "backName": null,
    "backSkill": null
  }
];
const defs:Record<string,CardDef>={
 WRONGL:card("WRONGL",{type:"LEADER",characters:["Demigra"]}),
 L:card("L",{type:"LEADER",colors:["Black"],characters:["Mechikabura"]}),F:card("F",{colors:["Black"]}),RED:card("RED",{colors:["Red"]}),
 OR:card("OR",{skill:"[Over Realm 4]{1}",power:20000}),DARK:card("DARK",{colors:["Black"],skill:"[Dark Over Realm 4]{1}",power:20000}),
 DUAL:card("DUAL",{colors:["Black","Red"]}),
 C:card("C",{type:"EXTRA",energyCost:0,skill:"[Counter: Play] Draw 1 card."}),
};
for(const c of actual)defs[c.id]=card(c.id,{type:c.type as CardDef["type"],name:c.name,characters:c.characters,traits:c.traits,colors:c.colors as CardDef["colors"],energyCost:Number(c.cost),power:c.power,skill:c.skill});
const rows=Object.values(defs).flatMap(skillRecords).map(r=>({...r,source:"compiler",status:"confirmed"}) as RuleRow);
for(const id of ["BT27-100","BT27-102"]){const r=rows.find(r=>r.cardId===id&&r.kind==="keyword")!;assert.equal((r.cost as {readable:boolean}).readable,true);}
assert.ok(rows.find(r=>r.cardId==="BT27-102"&&r.skillIndex===10)!.unread!.length,"Putine sibling remains unread");
const ctx:EngineContext={defs,scripts:rulesFromRows(rows,defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const events:unknown[]=[];
const take=(s:VmState,a:Action)=>{const result=RULES.apply(clone(ctx),clone(s),clone(a));events.push(...result.events);return result.state as VmState;};
function fresh(p:PlayerId){let s=RULES.createGame(ctx,{seed:456,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first:p},{type:"mulligan",player:p,redraw:false},{type:"mulligan",player:other(p),redraw:false},{type:"charge",player:p,card:null}] as Action[])s=take(s,a);
 s.sides.p1.attrs.energyMarkers=0;s.sides.p2.attrs.energyMarkers=0;return s;}
function stage(s:VmState,p:PlayerId,id:string,area:string){const cid=s.sides[p].zones.deck.at(-1)!;s.cards[cid].cardId=id;assert.ok(moveCard(s,game,cid,area,{owner:p}).ok);return cid;}
function finish(s:VmState){for(let n=0;n<30&&s.prompt.kind!=="main"&&!s.outcome;n++){const q=s.prompt;if(q.kind==="counter")s=take(s,{type:"counter",player:q.player,card:null});else if(q.kind==="chooseMode")s=take(s,{type:"chooseMode",player:q.player,index:0});else if(q.kind==="payCost")s=take(s,{type:"payCost",player:q.player,option:0});else if(q.kind==="chooseCards")s=take(s,{type:"choose",player:q.player,cards:q.choice.candidates.slice(0,q.choice.min)});else throw Error(JSON.stringify(q));}return s;}
let checks=0;
for(const p of ["p1","p2"] as const)for(const id of ["BT27-100","BT27-102","DARK","OR"])for(const variant of ["normal","shortBlack","shortEnergy","wrongLeader","emptyDeck","sourceReentry"]){
 if(variant==="emptyDeck"&&!id.startsWith("BT27"))continue;
 let s=fresh(p);const source=stage(s,p,id,"hand");
 if(variant==="wrongLeader")s.cards[s.sides[p].zones.leader[0]].cardId="WRONGL";
 if(variant!=="shortEnergy")stage(s,p,"F","energy");
 const paid=Array.from({length:variant==="shortBlack"?3:4},()=>stage(s,p,"F","drop"));paid.push(stage(s,p,"RED","drop"));
 if(variant==="emptyDeck")for(const cid of s.sides[p].zones.deck.slice())assert.ok(moveCard(s,game,cid,"warp",{owner:p}).ok);
 if(variant==="sourceReentry")stage(s,other(p),"C","hand");
 const action=RULES.legalActions(ctx,s).find(l=>l.action.type==="activate"&&l.action.card===source)?.action;
 const draw=id.startsWith("BT27");const yes=variant!=="shortEnergy"&&!(variant==="shortBlack"&&id!=="OR")&&!(draw&&["wrongLeader","emptyDeck"].includes(variant));
 assert.equal(!!action,yes,`${p}/${id}/${variant}`);if(!action){checks++;continue;}
 const hand=s.sides[p].zones.hand.length;events.length=0;s=take(s,action);
 if(variant==="sourceReentry"){assert.equal(s.prompt.kind,"counter");assert.ok(moveCard(s,game,source,"drop",{owner:p}).ok);assert.ok(moveCard(s,game,source,"hand",{owner:p}).ok);}
 s=finish(s);assert.equal(s.outcome,undefined,`${id}/${variant}`);for(const cid of paid)assert.ok(s.sides[p].zones.warp.includes(cid));
 assert.equal(s.sides[p].zones.battle.includes(source),variant!=="sourceReentry");assert.equal(s.sides[p].attrs.overRealms,1);
 if(variant!=="sourceReentry"){assert.equal(s.sides[p].zones.hand.length,hand-1+(draw?1:0));assert.equal(s.cards[source].playedUsing,id==="OR"?"Over Realm":"Dark Over Realm");s=take(s,{type:"endMain",player:p});assert.equal(s.sides[p].zones.battle.includes(source),id!=="OR","dark cards remain at turn end");}
 checks++;
}
// Save after native Drop payment but before the remaining energy choice.
for(const p of ["p1","p2"] as const)for(const fault of ["none","source","payer","deck","missingSource"]) {
 let s=fresh(p);const source=stage(s,p,"BT27-102","hand"),energy=[stage(s,p,"F","energy"),stage(s,p,"DUAL","energy")];
 const drop=Array.from({length:4},()=>stage(s,p,"F","drop"));
 const act=RULES.legalActions(ctx,s).find(l=>l.action.type==="activate"&&l.action.card===source)!.action;
 s=take(s,act);assert.equal(s.prompt.kind,"chooseMode");for(const id of drop)assert.ok(s.sides[p].zones.warp.includes(id));
 assert.equal(s.sides[p].attrs.overRealms??0,0);for(const id of energy)assert.equal(s.cards[id].mode,"active");
 if(fault==="source"){assert.ok(moveCard(s,game,source,"drop",{owner:p}).ok);assert.ok(moveCard(s,game,source,"hand",{owner:p}).ok);}
 if(fault==="payer"){for(const id of energy){assert.ok(moveCard(s,game,id,"drop",{owner:p}).ok);assert.ok(moveCard(s,game,id,"energy",{owner:p}).ok);}}
 if(fault==="deck")for(const id of s.sides[p].zones.deck.slice())assert.ok(moveCard(s,game,id,"warp",{owner:p}).ok);
 if(fault==="missingSource")for(const f of s.programs)if(f.keywordCost?.overRealm)delete (f.keywordCost.overRealm as {source?:unknown}).source;
 if(fault==="payer")assert.throws(()=>take(s,{type:"chooseMode",player:p,index:0}),/no longer available/,`${p}/${fault}`);
 else {s=take(s,{type:"chooseMode",player:p,index:0});if(fault==="deck")assert.equal(s.outcome?.kind,"win","empty deck ends the game before unpaid continuation");if(fault==="none"){s=finish(s);assert.ok(s.sides[p].zones.battle.includes(source));}else {assert.ok(s.sides[p].zones.hand.includes(source));assert.equal(s.sides[p].attrs.overRealms??0,0);}}
 checks++;
}
// An optional replacement can make a previously payable native cost fail.
for(const p of ["p1","p2"] as const)for(const replace of [false,true]) {
 let s=fresh(p);const source=stage(s,p,"BT27-102","hand"),energy=stage(s,p,"F","energy");
 const drop=Array.from({length:4},()=>stage(s,p,"F","drop"));
 addEffect(s,[],{target:drop[1],kind:"replaceLeave",value:{to:"hand",optional:true,target:{special:"self"}},until:"turn",source:drop[1],master:p});
 const act=RULES.legalActions(ctx,s).find(l=>l.action.type==="activate"&&l.action.card===source);assert.ok(act);
 s=take(s,act.action);assert.equal(s.prompt.kind,"replaceMove");assert.ok(s.sides[p].zones.warp.includes(drop[0]));
 s=take(s,{type:"chooseMode",player:p,index:replace?0:1});s=finish(s);
 if(replace){assert.ok(s.sides[p].zones.hand.includes(drop[1]));assert.ok(s.sides[p].zones.hand.includes(source));assert.equal(s.cards[energy].mode,"active");assert.equal(s.sides[p].attrs.overRealms??0,0);}
 else assert.ok(s.sides[p].zones.battle.includes(source));checks++;
}
// Actual BT31-093 grants its next-turn tax through native activation/on-play Auto.
for(const p of ["p1","p2"] as const)for(const variant of ["six","seven","darkGood","darkBad","decline","sourceABA"]) {
 let s=fresh(other(p));const taxer=stage(s,other(p),"BT31-093","hand");for(let i=0;i<3;i++)stage(s,other(p),"F","energy");
 const issue=RULES.legalActions(ctx,s).find(l=>l.action.type==="activate"&&l.action.card===taxer&&l.action.skill===30);assert.ok(issue);s=finish(take(s,issue.action));
 s=take(s,{type:"endMain",player:other(p)});s=take(s,{type:"charge",player:p,card:null});
 const dark=variant.startsWith("dark"),source=stage(s,p,dark?"DARK":"OR","hand"),energy=stage(s,p,"F","energy");
 const black=Array.from({length:dark?4:variant==="six"?6:7},()=>stage(s,p,"F","drop"));
 const red=dark?Array.from({length:3},()=>stage(s,p,"RED","drop")):[];
 const act=RULES.legalActions(ctx,s).find(l=>l.action.type==="activate"&&l.action.card===source);
 if(variant==="six"){assert.equal(act,undefined);checks++;continue;}assert.ok(act);
 s=take(s,act.action);assert.equal(s.prompt.kind,"chooseMode");assert.equal(s.cards[energy].mode,"active");
 if(variant==="sourceABA"){assert.ok(moveCard(s,game,source,"drop",{owner:p}).ok);assert.ok(moveCard(s,game,source,"hand",{owner:p}).ok);}
 s=take(s,{type:"chooseMode",player:p,index:variant==="decline"?1:0});
 if(variant==="decline"||variant==="sourceABA"){assert.ok(s.sides[p].zones.hand.includes(source));assert.equal(s.sides[p].attrs.overRealms??0,0);assert.equal(s.cards[energy].mode,"active");checks++;continue;}
 assert.equal(s.prompt.kind,"chooseCards");
 const pay=variant==="darkGood"?red:black.slice(0,3);
 for(let i=0;i<6&&s.prompt.kind==="chooseCards";i++){const q=s.prompt;const ids=pay.filter(id=>q.choice.candidates.includes(id));s=take(s,{type:"choose",player:p,cards:ids.slice(0,q.choice.max)});}
 s=finish(s);for(const id of pay)assert.ok(s.sides[p].zones.warp.includes(id));
 if(variant==="darkBad"){assert.ok(s.sides[p].zones.hand.includes(source));assert.equal(s.sides[p].attrs.overRealms??0,0);assert.equal(s.cards[energy].mode,"active");assert.equal(s.sides[p].zones.drop.length,4);}
 else {assert.ok(s.sides[p].zones.battle.includes(source));assert.equal(s.sides[p].zones.drop.length,0);assert.equal(s.sides[p].attrs.overRealms,1);assert.equal(s.cards[energy].mode,"rest");}
 checks++;
}
// An old OR arrival must not warp a fresh ordinary Battle occurrence.
for (const p of ["p1", "p2"] as const) {
 let s=fresh(p);const source=stage(s,p,"OR","hand");stage(s,p,"F","energy");for(let i=0;i<4;i++)stage(s,p,"F","drop");
 const act=RULES.legalActions(ctx,s).find(l=>l.action.type==="activate"&&l.action.card===source)!;
 s=finish(take(s,act.action));assert.ok(s.sides[p].zones.battle.includes(source));
 assert.ok(moveCard(s,game,source,"drop",{owner:p}).ok);assert.ok(moveCard(s,game,source,"battle",{owner:p}).ok);
 s=take(s,{type:"endMain",player:p});assert.ok(s.sides[p].zones.battle.includes(source),"OR cleanup is bound to the actual arrival occurrence");checks++;
}
// Existing stored Auto readers retain the exact ordinary/dark distinction.
for (const p of ["p1", "p2"] as const) for (const dark of [false, true]) {
 let s=fresh(p);const source=stage(s,p,"DB3-109","hand");for(let i=0;i<2;i++)stage(s,p,"F","energy");for(let i=0;i<5;i++)stage(s,p,"F","drop");
 const before=s.sides[p].zones.hand.length;
 const act=RULES.legalActions(ctx,s).find(l=>l.action.type==="activate"&&l.action.card===source&&l.action.skill===(dark?10:0));assert.ok(act);
 s=finish(take(s,act.action));assert.ok(s.sides[p].zones.battle.includes(source));assert.equal(s.sides[p].zones.hand.length,before,"both printed arrival procedures draw once");checks++;
}
for (const p of ["p1", "p2"] as const) for (const dark of [false, true]) {
 let s=fresh(p);const source=stage(s,p,"BT13-154","hand"),target=stage(s,p,"OR","warp");for(let i=0;i<8;i++)stage(s,p,"F","energy");for(let i=0;i<8;i++)stage(s,p,"F","drop");
 const act=RULES.legalActions(ctx,s).find(l=>dark?l.action.type==="activate"&&l.action.card===source&&l.action.skill===10:l.action.type==="play"&&l.action.card===source);assert.ok(act);
 s=take(s,act.action);
 // No opposing Counter cards: the dark-only Auto is the next actual choice.
 if(dark){assert.equal(s.prompt.kind,"chooseCards");if(s.prompt.kind==="chooseCards")assert.ok(s.prompt.choice.candidates.includes(target));}
 else assert.equal(s.prompt.kind,"main","ordinary arrival does not trigger Dark Over Realm Auto");
 s=finish(s);checks++;
}
// Protocol setup: a tax appears after early tax assessment while resource
// payment is suspended. Its native late payment is strict and saved-source bound.
for(const p of ["p1","p2"] as const)for(const variant of ["pay","decline","sourceABA","replace"]) {
 let s=fresh(p);const source=stage(s,p,"BT27-102","hand"),payer=stage(s,p,"RED","hand");stage(s,p,"F","energy");stage(s,p,"DUAL","energy");for(let i=0;i<4;i++)stage(s,p,"F","drop");
 const act=RULES.legalActions(ctx,s).find(l=>l.action.type==="activate"&&l.action.card===source)!;s=take(s,act.action);assert.equal(s.prompt.kind,"chooseMode");
 assert.equal(stepScript(vmHost(ctx,game,s,[]),{card:s.sides[other(p)].zones.leader[0],master:other(p),vars:{},ip:0,ops:[{op:"forbid",what:"play",side:"opponent",until:"turn",unlessPay:[{op:"choose",sel:{side:"you",area:"hand",count:1,upTo:false},as:"lateTax"},{op:"moveTo",target:{var:"lateTax"},to:"drop"}]}]}),"done");
 s=take(s,{type:"chooseMode",player:p,index:0});assert.equal(s.prompt.kind,"chooseMode");assert.equal(s.sides[p].attrs.overRealms,1);
 s=take(s,{type:"chooseMode",player:p,index:variant==="decline"?1:0});
 if(variant!=="decline"){
  assert.equal(s.prompt.kind,"chooseCards");
  if(variant==="sourceABA"){assert.ok(moveCard(s,game,source,"warp",{owner:p}).ok);assert.ok(moveCard(s,game,source,"hand",{owner:p}).ok);}
  if(variant==="replace")addEffect(s,[],{target:payer,kind:"replaceLeave",value:{to:"warp",optional:true,target:{special:"self"}},until:"turn",source:payer,master:p});
  s=take(s,{type:"choose",player:p,cards:[payer]});
  if(variant==="replace"){assert.equal(s.prompt.kind,"replaceMove");s=take(s,{type:"chooseMode",player:p,index:0});}
 }
 s=finish(s);assert.equal(s.sides[p].zones.battle.includes(source),variant==="pay");assert.equal(s.sides[p].attrs.overRealms,1);
 if(variant==="pay")assert.ok(s.sides[p].zones.drop.includes(payer));
 if(variant==="sourceABA"||variant==="decline")assert.ok(s.sides[p].zones.hand.includes(payer));
 if(variant==="replace")assert.ok(s.sides[p].zones.warp.includes(payer));checks++;
}
// A new tax during the actual preliminary window is checked once on resume.
for(const p of ["p1","p2"] as const)for(const pay of [false,true]) {
 let s=fresh(p);const source=stage(s,p,"OR","hand"),payer=stage(s,p,"RED","hand");stage(s,p,"F","energy");stage(s,other(p),"C","hand");for(let i=0;i<4;i++)stage(s,p,"F","drop");
 const act=RULES.legalActions(ctx,s).find(l=>l.action.type==="activate"&&l.action.card===source)!;s=take(s,act.action);assert.equal(s.prompt.kind,"counter");
 assert.equal(stepScript(vmHost(ctx,game,s,[]),{card:s.sides[other(p)].zones.leader[0],master:other(p),vars:{},ip:0,ops:[{op:"forbid",what:"play",side:"opponent",until:"turn",unlessPay:[{op:"choose",sel:{side:"you",area:"hand",count:1,upTo:false},as:"lateTax"},{op:"moveTo",target:{var:"lateTax"},to:"drop"}]}]}),"done");
 s=take(s,{type:"counter",player:other(p),card:null});assert.equal(s.prompt.kind,"chooseMode");s=take(s,{type:"chooseMode",player:p,index:pay?0:1});
 if(pay){assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:p,cards:[payer]});}
 s=finish(s);assert.equal(s.sides[p].zones.battle.includes(source),pay);assert.equal(s.resolving,null);assert.equal(s.sides[p].attrs.overRealms,1);checks++;
}
// Original OR cleanup survives skill negation, but no failed arrival owns one.
for(const p of ["p1","p2"] as const)for(const failed of [false,true]) {
 let s=fresh(p);const source=stage(s,p,"OR","hand");stage(s,p,"F","energy");stage(s,other(p),"C","hand");for(let i=0;i<4;i++)stage(s,p,"F","drop");
 const act=RULES.legalActions(ctx,s).find(l=>l.action.type==="activate"&&l.action.card===source)!;s=take(s,act.action);assert.equal(s.prompt.kind,"counter");
 // Protocol replacement result at the real native response checkpoint.
 if(failed)s.resolving!.replaced=true;
 s=finish(s);
 if(failed){assert.ok(s.sides[p].zones.hand.includes(source));assert.ok(moveCard(s,game,source,"battle",{owner:p}).ok);}
 else addEffect(s,[],{target:source,kind:"negateSkills",value:0,until:"turn",source:s.sides[other(p)].zones.leader[0],master:other(p)});
 s=take(s,{type:"endMain",player:p});assert.equal(s.sides[p].zones.battle.includes(source),failed);checks++;
}
// Actual Wormhole permits a second combined use, never a third.
for(const p of ["p1","p2"] as const) {
 let s=fresh(p);const first=stage(s,p,"BT27-100","hand");for(let i=0;i<3;i++)stage(s,p,"F","energy");for(let i=0;i<4;i++)stage(s,p,"F","drop");
 s=finish(take(s,RULES.legalActions(ctx,s).find(l=>l.action.type==="activate"&&l.action.card===first)!.action));
 const second=stage(s,p,"OR","hand");for(let i=0;i<4;i++)stage(s,p,"F","drop");
 const act=RULES.legalActions(ctx,s).find(l=>l.action.type==="activate"&&l.action.card===second);assert.ok(act);s=finish(take(s,act.action));assert.equal(s.sides[p].attrs.overRealms,2);
 const third=stage(s,p,"DARK","hand");for(let i=0;i<4;i++)stage(s,p,"F","drop");assert.equal(RULES.legalActions(ctx,s).some(l=>l.action.type==="activate"&&l.action.card===third),false);checks++;
}
// BT31-150's own printed Warp permission keeps its source separate from Drop.
for(const p of ["p1","p2"] as const)for(const area of ["warp","drop"] as const) {
 let s=fresh(p);const source=stage(s,p,"BT31-150",area);for(let i=0;i<4;i++)stage(s,p,"F","energy");for(let i=0;i<8;i++)stage(s,p,"F","drop");
 const act=RULES.legalActions(ctx,s).find(l=>l.action.type==="activate"&&l.action.card===source&&l.action.skill===10);
 if(area==="drop")assert.equal(act,undefined);else {assert.ok(act);s=finish(take(s,act.action));assert.ok(s.sides[p].zones.battle.includes(source));}
 checks++;
}
// Current cost is recomputed at the saved resource answer, not read from menu data.
for(const p of ["p1","p2"] as const) {
 let s=fresh(p);const source=stage(s,p,"BT27-102","hand");stage(s,p,"F","energy");stage(s,p,"DUAL","energy");for(let i=0;i<4;i++)stage(s,p,"F","drop");
 s=take(s,RULES.legalActions(ctx,s).find(l=>l.action.type==="activate"&&l.action.card===source)!.action);assert.equal(s.prompt.kind,"chooseMode");
 addEffect(s,[],{target:source,kind:"skillCost",value:-1,colors:["any"],until:"turn",master:p});
 assert.throws(()=>take(s,{type:"chooseMode",player:p,index:0}),/no longer available/);assert.equal(s.sides[p].attrs.overRealms??0,0);checks++;
}
// Carrying control and native Battle→Combo→Battle retain only this OR token.
for(const p of ["p1","p2"] as const)for(const control of [false,true]) {
 let s=fresh(p);const source=stage(s,p,"OR","hand");stage(s,p,"F","energy");for(let i=0;i<4;i++)stage(s,p,"F","drop");
 s=finish(take(s,RULES.legalActions(ctx,s).find(l=>l.action.type==="activate"&&l.action.card===source)!.action));
 const witness=clone(s.cards[source].overRealmReturn);
 if(control)assert.equal(stepScript(vmHost(ctx,game,s,[]),{card:s.sides[other(p)].zones.leader[0],master:other(p),ip:0,vars:{chosen:[source]},ops:[{op:"control",target:{var:"chosen"}}]}),"done");
 else {assert.ok(moveCard(s,game,source,"combo",{owner:p}).ok);assert.ok(moveCard(s,game,source,"combo",{owner:p}).ok);assert.deepEqual(s.cards[source].overRealmReturn,witness,"same-area movement preserves the token");assert.ok(moveCard(s,game,source,"battle",{owner:p}).ok);}
 assert.deepEqual(s.cards[source].overRealmReturn,witness);s=take(s,{type:"endMain",player:p});assert.ok(s.sides[p].zones.warp.includes(source),"owner's Warp after effect-carry paths");checks++;
}
{
 const rule={forbid:{what:"play",unless:undefined},target:undefined,master:"p1"};
 assert.equal(canonicalTaxValue(rule),canonicalTaxValue(clone(rule)));
 assert.equal(taxReceiptIdentity("static:s:0",rule,{card:"s",cardId:"DEF",epoch:1}),taxReceiptIdentity("static:s:0",clone(rule),{epoch:1,cardId:"DEF",card:"s"}));
 assert.notEqual(taxReceiptIdentity("static:s:0",rule,{card:"s",cardId:"DEF",epoch:1}),taxReceiptIdentity("static:s:0",rule,{card:"s",cardId:"DEF",epoch:2}));checks++;
}
// A second distinct rule appearing during a late payment is not covered by
// the first tax's receipt or the generic per-card play-tax settlement marker.
for(const p of ["p1","p2"] as const) {
 let s=fresh(p);const source=stage(s,p,"OR","hand"),payer=stage(s,p,"RED","hand"),second=stage(s,p,"RED","hand");stage(s,p,"F","energy");stage(s,other(p),"C","hand");for(let i=0;i<4;i++)stage(s,p,"F","drop");
 s=take(s,RULES.legalActions(ctx,s).find(l=>l.action.type==="activate"&&l.action.card===source)!.action);assert.equal(s.prompt.kind,"counter");
 const tax=()=>stepScript(vmHost(ctx,game,s,[]),{card:s.sides[other(p)].zones.leader[0],master:other(p),ip:0,vars:{},ops:[{op:"forbid",what:"play",side:"opponent",until:"turn",unlessPay:[{op:"choose",sel:{side:"you",area:"hand",count:1,upTo:false},as:"tax"},{op:"moveTo",target:{var:"tax"},to:"drop"}]}]});assert.equal(tax(),"done");
 s=take(s,{type:"counter",player:other(p),card:null});s=take(s,{type:"chooseMode",player:p,index:0});assert.equal(s.prompt.kind,"chooseCards");
 addEffect(s,[],{target:payer,kind:"replaceLeave",value:{to:"warp",optional:true,target:{special:"self"}},until:"turn",source:payer,master:p});
 s=take(s,{type:"choose",player:p,cards:[payer]});assert.equal(s.prompt.kind,"replaceMove");assert.equal(tax(),"done");
 s=take(s,{type:"chooseMode",player:p,index:1});assert.equal(s.prompt.kind,"chooseMode","new rule must be offered separately");
 s=take(s,{type:"chooseMode",player:p,index:0});assert.equal(s.prompt.kind,"chooseCards");s=take(s,{type:"choose",player:p,cards:[second]});s=finish(s);
 assert.ok(s.sides[p].zones.battle.includes(source));assert.ok(s.sides[p].zones.drop.includes(payer));assert.ok(s.sides[p].zones.drop.includes(second));checks++;
}
console.log(`Dark Over Realm prices: ${checks} native both-seat cases passed`);
