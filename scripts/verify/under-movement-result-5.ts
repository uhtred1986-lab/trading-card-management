/** R-428: original under-placement results, pile order, and rule-normalized departures. */
import assert from "node:assert/strict";
import { card, fifty } from "./harness";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { stepScript, type ScriptFrame } from "../../src/lib/arena/vm/script";
import { completedMovement } from "../../src/lib/arena/vm/movement-result";
import { NotYet } from "../../src/lib/arena/vm/errors";
import { vmHost } from "../../src/lib/arena/vm/host";
import type { EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const defs={L:card("L",{type:"LEADER"}),F:card("F",{}),"TOKEN:R428":card("TOKEN:R428",{})};
const ctx:EngineContext={defs,scripts:rulesFromCompiler(defs)};
const loaded=rulesetFor("dbs");assert.ok(loaded.ok);const game=loaded.definition;
function fresh(){return RULES.createGame(ctx,{seed:428,p1:{name:"One",leader:"L",main:fifty("F")},p2:{name:"Two",leader:"L",main:fifty("F")}}).state as VmState;}
function stage(s:VmState,p:PlayerId,area:"battle"|"unison"|"hand"|"combo"){const id=s.sides[p].zones.deck[0];assert.ok(moveCard(s,game,id,area,{owner:p}).ok);return id;}
let cases=0;
for(const p of ["p1","p2"] as const){
 const s=fresh(),host=stage(s,p,"battle"),first=stage(s,p,"hand"),second=stage(s,p,"hand"),incoming=stage(s,p,"battle"),carried=stage(s,p,"hand");
 assert.ok(moveCard(s,game,first,"drop",{under:host}).ok);assert.ok(moveCard(s,game,second,"drop",{under:host}).ok);
 assert.deepEqual(s.cards[host].under,[first,second],"23-2-4 appends each new card at the bottom");
 assert.equal(moveCard(s,game,first,"drop",{under:host}).ok,false,"existing membership cannot reorder the pile or count as a new placement");assert.deepEqual(s.cards[host].under,[first,second]);
 assert.ok(moveCard(s,game,carried,"drop",{under:incoming}).ok);assert.ok(moveCard(s,game,incoming,"drop",{under:host}).ok);
 assert.deepEqual(s.cards[host].under,[first,second,incoming,carried],"existing pile and carried stack retain order");cases++;
}
for(const p of ["p1","p2"] as const)for(const kind of ["token","z"] as const)for(const sameArea of [false,true]){
 const s=fresh(),host=sameArea?stage(s,p,"battle"):s.sides[p].zones.leader[0],id=stage(s,p,"battle");
 if(kind==="token")s.cards[id].cardId="TOKEN:R428";else s.cards[id].zCard=true;
 const placed=vmHost(ctx,game,s,[]).placeUnder(id,host);
 assert.equal(placed,sameArea);assert.equal(s.cards[host].under.includes(id),sameArea);assert.equal(s.sides[p].zones.removed.includes(id),!sameArea);cases++;
}
for(const p of ["p1","p2"] as const)for(const kind of ["token","z"] as const){
 const s=fresh(),foe=p==="p1"?"p2":"p1",host=stage(s,foe,"battle"),id=stage(s,p,"battle");
 if(kind==="token")s.cards[id].cardId="TOKEN:R428";else s.cards[id].zCard=true;
 assert.equal(vmHost(ctx,game,s,[]).placeUnder(id,host),kind==="token");assert.equal(s.sides[p].zones.removed.includes(id),kind==="z");cases++;
}
for(const p of ["p1","p2"] as const){
 const s=fresh(),host=stage(s,p,"battle"),z=stage(s,p,"unison"),token=stage(s,p,"combo");s.cards[z].zCard=true;s.cards[token].cardId="TOKEN:R428";
 assert.equal(vmHost(ctx,game,s,[]).placeUnder(z,host),false);assert.ok(s.sides[p].zones.removed.includes(z));assert.equal(vmHost(ctx,game,s,[]).placeUnder(token,host),true);cases++;
 const old=stage(s,p,"hand"),incoming=stage(s,p,"battle"),carried=stage(s,p,"hand"),leader=s.sides[p].zones.leader[0];
 assert.ok(moveCard(s,game,old,"drop",{under:leader}).ok);assert.ok(moveCard(s,game,carried,"drop",{under:incoming}).ok);assert.ok(vmHost(ctx,game,s,[]).placeUnder(incoming,leader));assert.deepEqual(s.cards[leader].under,[old,incoming]);assert.ok(s.sides[p].zones.drop.includes(carried));cases++;
}
for(const p of ["p1","p2"] as const)for(const kind of ["token","z"] as const){
 const s=fresh(),invalid=stage(s,p,"hand"),id=stage(s,p,"battle");if(kind==="token")s.cards[id].cardId="TOKEN:R428";else s.cards[id].zCard=true;
 const before=JSON.stringify(s);assert.equal(vmHost(ctx,game,s,[]).placeUnder(id,invalid),false);assert.equal(JSON.stringify(s),before,"invalid host is refused before token/Z normalization");cases++;
}
// Staged typed chooser controls: JSON reload freezes both selected and destination occurrences.
for(const p of ["p1","p2"] as const)for(const variant of ["success","decline","host-left","host-returned","host-controlled","chosen-returned","prohibited","legacy"] as const){
 let s=fresh();const host=stage(s,p,"battle"),id=stage(s,p,"hand");let f:ScriptFrame={ops:[{op:"choose",sel:{area:"hand",side:"you",count:1,upTo:true},as:"pick"},{op:"moveTo",target:{var:"pick"},to:"under",completedAs:"pick"},{op:"if",cond:{kind:"moved",var:"pick",all:true},then:[{op:"draw",n:1}]}],ip:0,vars:{},card:host,master:p};
 assert.equal(stepScript(vmHost(ctx,game,s,[]),f),"wait");assert.equal(s.prompt.kind,"chooseCards");
 const saved=JSON.parse(JSON.stringify({s,f}));s=saved.s;f=saved.f;s.programs=[];
 if(variant==="host-left"||variant==="host-returned"){assert.ok(moveCard(s,game,host,"hand",{owner:p}).ok);if(variant==="host-returned")assert.ok(moveCard(s,game,host,"battle",{owner:p}).ok);}
 if(variant==="host-controlled")assert.ok(moveCard(s,game,host,"battle",{owner:p==="p1"?"p2":"p1"}).ok);
 if(variant==="prohibited")assert.equal(stepScript(vmHost(ctx,game,s,[]),{ops:[{op:"forbid",what:"placeUnder",side:"you",until:"turn",target:{var:"host"}}],ip:0,vars:{host:[host]},card:host,master:p}),"done");
 if(variant==="legacy")delete f.movementResults;
 s.lastChoice=variant==="decline"?[]:[id];
 if(variant==="legacy"){assert.throws(()=>stepScript(vmHost(ctx,game,s,[]),f),NotYet);cases++;continue;}
 if(variant==="chosen-returned"){
  // An already-submitted saved choice reaches its next operation after this staged fault.
  f.vars.pick=[id];f.vars["pick@epoch"]=[`${id}@${s.cards[id].zoneEpoch??0}`];f.awaiting=undefined;f.ip=1;s.lastChoice=null;
  assert.ok(moveCard(s,game,id,"drop",{owner:p}).ok);assert.ok(moveCard(s,game,id,"hand",{owner:p}).ok);
 }
 const before=s.sides[p].zones.hand.length;
 assert.equal(stepScript(vmHost(ctx,game,s,[]),f),"done");
 assert.equal(completedMovement(f,"pick",1,true),variant==="success");assert.equal(s.cards[host].under.includes(id),variant==="success");
 assert.equal(s.sides[p].zones.hand.length,before,"successful placement removes one then draws one; refused/declined placement draws none");cases++;
}
console.log(`under-movement-result-5: ${cases} native pile controls passed`);
