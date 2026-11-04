/** R-394: both-player and each-name Awaken conditions through native stored activation. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, runtimeSupportOfRow, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { allConditions } from "../../src/lib/arena/compile/conditions";
import { compileCostRecord } from "../../src/lib/arena/compile/prices";
import { parseSkills } from "../../src/lib/arena/text/cards";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const PRINTS=[{"id": "SD18-01", "type": "LEADER", "colors": ["Blue"], "cost": null, "z": null, "power": 10000, "name": "Trunks", "characters": ["Trunks : Future"], "traits": ["Saiyan", "Earthling"], "skill": "[Permanent] During your opponent's turn, if you would add a card from your life to your hand or place it in your Drop, you may reveal it and add it to your hand instead.<br>[Auto] When this card attacks, look at up to 5 cards from the top of your deck, add up to 1 \u226aSaiyan\u226b or \u226aEarthling\u226b card\u2015both blue and with an energy cost of 4 or less\u2015or 1 blue Unison with a specified cost of 2 among them to your hand, then shuffle your deck.<br>[Awaken] When a player's life is at 4 or less or a player has 3 or more Z-Energy: You may draw 1 card and switch up to 1 of your energy to Active Mode.", "backName": "SS2 Trunks, Envoy of Justice Returns", "backSkill": "[permanent] During your opponent's turn, if you would add a card from your life to your hand or place it in your Drop, you may reveal it and add it to your hand instead.<br>[auto] When this card attacks, draw 1 card.<br>[auto] At the end of your turn, switch up to 1 of your mono-blue energy to Active Mode.<br>[activate: main][once per turn]{u}{u}: Draw 1 card, then choose up to 1 of your opponent's Battle Cards and place it at the bottom of its owner's deck. Additionally, if you have a mono-blue Z-Battle Card with an energy cost of 5 or more in play, this card gets +10000 power and [double strike] for the turn."}, {"id": "BT22-002", "type": "LEADER", "colors": ["Red"], "cost": null, "z": null, "power": 10000, "name": "Dr. Hedo", "characters": ["Dr. Hedo: SH"], "traits": ["Earthling", "Scientist", "Red Ribbon Army"], "skill": "[Auto] When this card attacks, look at up to 5 cards from the top of your deck, add up to 1 red \u226aRed Ribbon Army\u226b card to your hand, then shuffle your deck.<br>[Awaken] If your life is at 4 or less or you have 1 or more each of red &lt;Gamma 1: SH&gt; and &lt;Gamma 2: SH&gt; cards in play: Draw 2 cards, and add cards from your life to your hand until you have 6 life left.", "backName": "Dr. Hedo, Admiration for Heroes", "backSkill": "[Permanent] During your turn, your &lt;Gamma 1: SH&gt; and &lt;Gamma 2: SH&gt; cards\u2015both red and with energy costs of 2\u2015gain [Barrier].<br>[Auto][Once per turn] If you discard 1 red \u226aRed Ribbon Army\u226b card from your hand: When your red &lt;Gamma 2: SH&gt; card attacks, draw 2 cards. <br>[Activate: Main][Once per turn] Choose up to 1 red &lt;Gamma 1: SH&gt; card with an energy cost of 3 or less and switch it to Active Mode."}, {"id": "BT20-002", "type": "LEADER", "colors": ["Red"], "cost": null, "z": null, "power": 10000, "name": "Paparoni", "characters": ["Paparoni"], "traits": ["Universe 3"], "skill": "[Auto] When this card attacks, draw 1 card.<br>[Awaken] When your life is at 4 or less or 1 or more &lt;Koitsukai&gt;, &lt;Panchia&gt;, and &lt;Bollarator&gt; cards\u2014all red\u2014are in your energy, Z-Energy, Battle Area, and/or Drop: Draw 1 card, switch up to 1 of your energy to Active Mode, and add cards from your life to your hand until you have 6 life left.", "backName": "Warriors of Universe 3, United as One", "backSkill": "[auto] When this card attacks, look at up to 5 cards from the top of your deck, add up to 1 red \u226aUniverse 3\u226b card among them to your hand, and shuffle your deck.<br>[activate: main]{r}, if your life is at 3 or less, you have 4 or more energy, and you send 1 <Koitsukai> card, 1 <Panchia> card, and 1 <Bollarator> card\u2014all red\u2014from your Drop to your Warp: Play up to 1 red <Koichiarator> card with an energy cost of 4 from your deck or Drop, shuffle your deck if you looked through it, and negate this skill for the game."}, {"id": "BT14-032", "type": "LEADER", "colors": ["Blue"], "cost": null, "z": null, "power": 10000, "name": "Hirudegarn", "characters": ["Hirudegarn"], "traits": ["Phantom Demon"], "skill": "[Auto] When this card attacks, add up to 1 card from your life to your hand, look at up to 5 cards from the top of your deck, add up to 1 card among them to your hand, then shuffle your deck. If you added a card to your hand, choose 1 card in your hand and discard it.<br>[Awaken] When your life is at 4 or less or you have 1 blue &lt;Minotia&gt; card and 1 blue &lt;Tapion&gt; card in your Drop Area: You may draw 1 card, switch up to 1 of your energy to Active Mode, add cards from your life to your hand until you have 5 life left, then flip this card over.", "backName": "Hirudegarn, the Calamity Revived", "backSkill": "[Auto] When this card attacks, draw 1 card.<br>[Auto][Once per turn] When one of your blue Battle Cards activates an [Evolve] skill from your hand, draw 1 card.<br>[Activate: Battle][Once per turn] Place 2 cards from under one of your blue or green Battle Cards in their owners' Drop Areas: Choose up to 1 of your cards and it gets +5000 power for the battle."}];
const defs:Record<string,CardDef>={LEADER:card("LEADER",{type:"LEADER"}),FILLER:card("FILLER",{}),
 G1:card("G1",{colors:["Red"],characters:["Gamma 1: SH"]}),G2:card("G2",{colors:["Red"],characters:["Gamma 2: SH"],skill:"[Barrier]"}),
 MINOTIA:card("MINOTIA",{colors:["Blue"],characters:["Minotia"]}),TAPION:card("TAPION",{colors:["Blue"],characters:["Tapion"]}),
 K:card("K",{colors:["Red"],characters:["Koitsukai"]}),P:card("P",{colors:["Red"],characters:["Panchia"]}),B:card("B",{colors:["Red"],characters:["Bollarator"]}),
};
for(const c of PRINTS)defs[c.id]=card(c.id,{type:"LEADER",colors:c.colors as CardDef["colors"],characters:c.characters,traits:c.traits,power:c.power,skill:c.skill,back:{name:c.backName,power:15000,skill:c.backSkill}});
for(const id of ["G1","G2","MINOTIA","TAPION","K","P","B"]){defs[id+"_WRONG"]={...defs[id],id:id+"_WRONG",colors:["Yellow"]};defs[id+"_MULTI"]={...defs[id],id:id+"_MULTI",colors:[...defs[id].colors,"Yellow"]};}
const records=Object.values(defs).flatMap(skillRecords);
const awaken=records.filter(r=>r.printed.toLowerCase().includes("[awaken]"));
for(const r of awaken){assert.equal(r.cost?.readable,true,r.cardId);assert.deepEqual(runtimeSupportOfRow(r).unsupported,[],r.cardId);}
const ctx:EngineContext={defs,scripts:rulesFromRows(copy(records.map((r,id)=>({...r,id,source:"compiler",status:"draft"}) as unknown as RuleRow)),defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
const take=(s:VmState,a:Action)=>RULES.apply(ctx,copy(s),a).state as VmState;
function fresh(owner:PlayerId,id:string):VmState{
 let s=RULES.createGame(ctx,{seed:394,p1:{name:"One",leader:owner==="p1"?id:"LEADER",main:fifty("FILLER")},p2:{name:"Two",leader:owner==="p2"?id:"LEADER",main:fifty("FILLER")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first:owner},{type:"mulligan",player:owner,redraw:false},{type:"mulligan",player:other(owner),redraw:false},{type:"charge",player:owner,card:null}] as Action[])s=take(s,a);return s;
}
function stage(s:VmState,p:PlayerId,id:string,area:string):string{const cid=s.sides[p].zones.deck.at(-1)!;s.cards[cid].cardId=id;assert.ok(moveCard(s,game,cid,area,{owner:p}).ok);s.pending=[];return cid;}
function life(s:VmState,p:PlayerId,n:number){while(s.sides[p].zones.life.length>n)assert.ok(moveCard(s,game,s.sides[p].zones.life.at(-1)!,"drop",{owner:p}).ok);}
let cases=0;
function check(s:VmState,owner:PlayerId,id:string,expected:boolean,label:string){
 const leader=s.sides[owner].zones.leader[0],row=awaken.find(r=>r.cardId===id)!;
 const offer=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==="activate"&&a.card===leader&&a.skill===row.skillIndex);
 assert.equal(!!offer,expected,id+" "+label);
 if(offer){const before=s.sides[owner].zones.hand.length,oldLife=s.sides[owner].zones.life.length;
 s=take(s,offer);
 for(let i=0;i<40&&s.prompt.kind!=="main";i++){const options=RULES.legalActions(ctx,s).map(x=>x.action);const a=options.find(a=>a.type==="counter"&&a.card===null)??options.find(a=>a.type==="choose")??options[0];assert.ok(a,JSON.stringify(s.prompt));s=take(s,a);}
 assert.equal(s.cards[leader].flipped,true);const target=id==="BT14-032"?5:id==="SD18-01"?oldLife:6;
 assert.equal(s.sides[owner].zones.life.length,Math.min(target,oldLife));assert.equal(s.sides[owner].zones.hand.length,before+(id==="BT22-002"?2:1)+Math.max(0,oldLife-target));
 }cases++;
}
for(const owner of ["p1","p2"] as const){
 for(const [who,n] of [[owner,4],[other(owner),4],[owner,5],[other(owner),5]] as const){const s=fresh(owner,"SD18-01");life(s,who,n);check(s,owner,"SD18-01",n===4,`life ${who} ${n}`);}
 for(const [mine,theirs] of [[3,0],[0,3],[2,0],[0,2],[2,1],[1,2],[4,0]]){const s=fresh(owner,"SD18-01");for(let i=0;i<mine;i++)stage(s,owner,"FILLER","zEnergy");for(let i=0;i<theirs;i++)stage(s,other(owner),"FILLER","zEnergy");check(s,owner,"SD18-01",mine>=3||theirs>=3,`Z ${mine}/${theirs}`);}
 for(const id of ["BT22-002","BT14-032","BT20-002"]){
 const names=id==="BT22-002"?["G1","G2"]:id==="BT14-032"?["MINOTIA","TAPION"]:["K","P","B"];
 const areas=id==="BT22-002"?["battle","battle"]:id==="BT14-032"?["drop","drop"]:["energy","zEnergy","drop"];
 for(const variant of ["life","complete","duplicate","multi","missing0","missing1",...(names.length===3?["missing2"]:[]),...names.map((_,i)=>"color"+i),"area","side","protected"]){
 const s=fresh(owner,id);if(variant==="life")life(s,owner,4);
 if(variant!=="life")for(let i=0;i<names.length;i++){
 if(variant==="missing"+i)continue;
 const name=variant==="color"+i?names[i]+"_WRONG":variant==="multi"?names[i]+"_MULTI":names[i];
 const cid=stage(s,variant==="side"?other(owner):owner,name,variant==="area"?"hand":areas[i]);
 if(variant==="protected")addEffect(s,[],{target:cid,kind:"immune",value:0,until:"game",master:owner});
 if(variant==="duplicate")stage(s,owner,name,areas[i]);
 }
 check(s,owner,id,["life","complete","duplicate","multi","protected"].includes(variant),variant);
 }
 // Every allowed union area independently supports all three names.
 if(id==="BT20-002")for(const area of ["energy","zEnergy","battle","drop"]){const s=fresh(owner,id);for(const name of names)stage(s,owner,name,area);check(s,owner,id,true,"all in "+area);}
 }
}
for(const text of ["[Awaken] If your life is at 4 or less or you choose 1 each of <A> and <B> from your hand and place them in your Drop: Draw 1 card.","[Awaken] If you have 1 or more each of red <A> and <B> cards in play and you choose 1 each of <C> and <D> from your hand: Draw 1 card."]){assert.equal(compileCostRecord(parseSkills(text)[0]).readable,false);cases++;}
assert.equal(allConditions("When a player's life is at or less or a player has 3 or more Z-Energy"),null);
console.log(`Awaken named gates 5: ${cases} stored/native both-seat scenarios passed`);
