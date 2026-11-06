/** R476 stack preflight: later stamped materials cannot fail after the first placement. */
import assert from "node:assert/strict";
import { CTX, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { resolvePlay } from "../../src/lib/arena/vm/play";
import { newCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import type { GameEvent } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
let count=0;
for(const player of ["p1","p2"] as const)for(const stamped of [false,true])for(const extraArea of ["energy","battle"] as const){
 const state=RULES.createGame(CTX,{seed:476,p1:{name:"One",leader:"L-RED",main:fifty("V1")},p2:{name:"Two",leader:"L-BLUE",main:fifty("V-BLUE")}}).state as VmState;
 for(const [id,area] of [["incoming","hand"],["base","battle"],["extra",extraArea]]){state.cards[id]=newCard(id,"V1",player);state.sides[player].zones[area].push(id);state.cards[id].mode=area==="hand"?null:"active";}
 if(stamped)addEffect(state,[],{target:"extra",source:"extra",master:player,kind:"negateKeyword",value:"Energy-Exhaust",until:"game",energyEntryEpoch:state.cards.extra.zoneEpoch??0});
 const before=JSON.stringify(state),events:GameEvent[]=[];
 if(stamped){assert.throws(()=>resolvePlay(CTX,game,state,events,"incoming",player,{onto:"base",under:["extra"]}),/optional Energy negation occurrence/);assert.equal(JSON.stringify(state),before);assert.equal(events.length,0);}
 // Expanded-origin materials must be normalized by the native host first.
 // An unstamped Energy card still cannot bypass that separate physical-area guard.
 else if(extraArea==="energy"){assert.throws(()=>resolvePlay(CTX,game,state,events,"incoming",player,{onto:"base",under:["extra"]}),/stack materials must reach the actual play area/);assert.equal(JSON.stringify(state),before);assert.equal(events.length,0);}
 else {resolvePlay(CTX,game,state,events,"incoming",player,{onto:"base",under:["extra"]});assert.ok(state.sides[player].zones.battle.includes("incoming"));assert.deepEqual(state.cards.incoming.under,["base","extra"]);}
 count++;
}
console.log(`energy-entry stack preflight: ${count} cases passed`);
