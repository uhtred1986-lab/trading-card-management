/** R472: Putine watches successful other-own Dark Over Realm arrivals. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { vmHost } from "../../src/lib/arena/vm/host";
import type { Action, CardDef, EngineContext, PlayerId, GameEvent } from "../../src/lib/arena/types";
import type { Cond } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
const actual=[
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
  }
];

const defs:Record<string,CardDef>={L:card("L",{type:"LEADER",colors:["Black"],characters:["Mechikabura"]}),F:card("F",{colors:["Black"]}), C:card("C",{type:"EXTRA",energyCost:0,skill:"[Counter: Play] The Battle Card being played is placed in its owner's Drop Area instead of being played."})};
for(const c of actual)defs[c.id]=card(c.id,{type:c.type as CardDef["type"],name:c.name,characters:c.characters,traits:c.traits,colors:c.colors as CardDef["colors"],energyCost:Number(c.cost),power:c.power,skill:c.skill});
const rows=Object.values(defs).flatMap(skillRecords).map(r=>({...r,source:"compiler",status:"confirmed"}) as RuleRow);
const watcherRow=rows.find(r=>r.cardId==="BT27-102"&&r.skillIndex===10)!;
assert.deepEqual(watcherRow.unread,[]);assert.deepEqual(watcherRow.trigger,["yourOtherBattlePlayedUsingDarkOverRealm"]);
const ctx:EngineContext={defs,scripts:rulesFromRows(rows,defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x)); const other=(p:PlayerId):PlayerId=>p==="p1"?"p2":"p1";
let events:GameEvent[]=[];
const take=(s:VmState,a:Action)=>{const r=RULES.apply(clone(ctx),clone(s),clone(a));events.push(...r.events);return r.state as VmState;};
function fresh(p:PlayerId){let s=RULES.createGame(ctx,{seed:472,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;
 for(const a of [{type:"chooseFirst",player:s.chooser,first:p},{type:"mulligan",player:p,redraw:false},{type:"mulligan",player:other(p),redraw:false},{type:"charge",player:p,card:null}] as Action[])s=take(s,a);
 s.sides.p1.attrs.energyMarkers=0;s.sides.p2.attrs.energyMarkers=0;return s;}
function stage(s:VmState,p:PlayerId,id:string,area:string){const cid=s.sides[p].zones.deck.at(-1)!;s.cards[cid].cardId=id;assert.ok(moveCard(s,game,cid,area,{owner:p}).ok);return cid;}
function finish(s:VmState){for(let n=0;n<40&&s.prompt.kind!=="main"&&!s.outcome;n++){const q=s.prompt;if(q.kind==="counter")s=take(s,{type:"counter",player:q.player,card:null});else if(q.kind==="chooseMode")s=take(s,{type:"chooseMode",player:q.player,index:0});else if(q.kind==="payCost")s=take(s,{type:"payCost",player:q.player,option:0});else if(q.kind==="chooseCards")s=take(s,{type:"choose",player:q.player,cards:q.choice.candidates.slice(0,q.choice.min)});else if(q.kind==="orderPending")s=take(s,{type:"orderPending",player:q.player,index:q.candidates[0]});else throw Error(JSON.stringify(q));}assert.equal(s.outcome,undefined);return s;}
function resources(s:VmState,p:PlayerId,n=4){stage(s,p,"F","energy");for(let i=0;i<n;i++)stage(s,p,"F","drop");}
const activations=(watcher:string)=>events.filter(e=>e.type==="skill"&&e.card===watcher&&e.skill===10).length;
let checks=0;
for(const p of ["p1","p2"] as const)for(const variant of ["other","self","opponent","ordinary","replaced","sourceABA","borrowedWatcher"]) {
 let s=fresh(p);const source=stage(s,p,variant==="self"?"BT27-102":variant==="ordinary"?"DB3-109":"BT27-100","hand");
 const watcher=variant==="self"?source:stage(s,variant==="opponent"||variant==="borrowedWatcher"?other(p):p,"BT27-102","battle");
 if(variant==="borrowedWatcher")assert.ok(moveCard(s,game,watcher,"battle",{owner:p,carry:true}).ok);
 resources(s,p,variant==="ordinary"?5:4); if(variant==="ordinary")stage(s,p,"F","energy"); const counter=variant==="replaced"||variant==="sourceABA"?stage(s,other(p),"C","hand"):undefined;
 events=[];const action=RULES.legalActions(ctx,s).find(l=>l.action.type==="activate"&&l.action.card===source&&l.action.skill===(variant==="self"||variant==="ordinary"?0:10))?.action;assert.ok(action,variant);
 s=take(s,action);
 if(counter){assert.equal(s.prompt.kind,"counter");assert.equal(activations(watcher),0,"activation alone is not an arrival");if(variant==="sourceABA"){assert.ok(moveCard(s,game,source,"drop",{owner:p}).ok);assert.ok(moveCard(s,game,source,"hand",{owner:p}).ok);s=take(s,{type:"counter",player:other(p),card:null});}else s=take(s,{type:"counter",player:other(p),card:counter,skill:0});}
 s=finish(s);const yes=variant==="other"||variant==="borrowedWatcher";assert.equal(activations(watcher),yes?1:0,`${p}/${variant}`);
 if(yes){assert.ok(events.some(e=>e.type==="draw"&&e.player===p));assert.equal(events.some(e=>e.type==="draw"&&e.player===other(p)),false,"watcher controller receives its effect");}
 if(counter)assert.equal(s.sides[p].zones.battle.includes(source),false);checks++;
}
// Protocol control transfer during a real saved simultaneous-Auto ordering
// prompt cannot reassign the already-triggered arrival to a new controller.
for(const p of ["p1","p2"] as const){let s=fresh(p);const watchers=[stage(s,p,"BT27-102","battle"),stage(s,p,"BT27-102","battle")],source=stage(s,p,"BT27-100","hand");resources(s,p);events=[];
 const a=RULES.legalActions(ctx,s).find(l=>l.action.type==="activate"&&l.action.card===source)?.action;assert.ok(a);s=take(s,a);assert.equal(s.prompt.kind,"orderPending");assert.ok(s.sides[p].zones.battle.includes(source));
 assert.ok(moveCard(s,game,source,"battle",{owner:other(p),carry:true}).ok);s=finish(s);
 assert.equal(watchers.reduce((n,id)=>n+activations(id),0),1);assert.equal(events.some(e=>e.type==="draw"&&e.player===other(p)),false);checks++;
}
// Two Putines share printed Limit1. A second actual Dark play is legal through
// Demigra's Wormhole, but neither physical watcher activates a second time.
for(const p of ["p1","p2"] as const){let s=fresh(p);const watchers=[stage(s,p,"BT27-102","battle"),stage(s,p,"BT27-102","battle")];events=[];
 for(let n=0;n<2;n++){const source=stage(s,p,"BT27-100","hand");resources(s,p);const a=RULES.legalActions(ctx,s).find(l=>l.action.type==="activate"&&l.action.card===source)?.action;assert.ok(a);s=finish(take(s,a));assert.ok(s.sides[p].zones.battle.includes(source));}
 assert.equal(watchers.reduce((n,id)=>n+activations(id),0),1);checks++;
}
// Putine's own arrival neither triggers nor spends Limit1 before a later
// successful other-card arrival in the same turn (Wormhole permits both).
for(const p of ["p1","p2"] as const){let s=fresh(p);stage(s,p,"BT27-100","battle");const watcher=stage(s,p,"BT27-102","hand");events=[];
 for(const source of [watcher,stage(s,p,"BT27-100","hand")]){resources(s,p);const a=RULES.legalActions(ctx,s).find(l=>l.action.type==="activate"&&l.action.card===source)?.action;assert.ok(a);s=finish(take(s,a));assert.equal(activations(watcher),source===watcher?0:1);}checks++;
}
// Typed subject qualification remains Battle-only and excludes the watcher.
for(const p of ["p1","p2"] as const){const s=fresh(p),watcher=stage(s,p,"BT27-102","battle"),extra=stage(s,p,"C","battle"),battle=stage(s,p,"F","battle");assert.ok(watcherRow.cond);const h=vmHost(ctx,game,s,[]);
 for(const [subject,yes] of [[watcher,false],[extra,false],[battle,true]] as const)assert.equal(h.condHolds({card:watcher,master:p,ops:[],ip:0,vars:{},subject},watcherRow.cond as Cond),yes);checks++;
}
console.log(`Dark watcher: ${checks} both-seat native and subject qualification cases passed`);
