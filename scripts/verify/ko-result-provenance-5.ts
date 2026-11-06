/** Focused native-writer mechanisms; staged boards, not additional printed paid-play claims. */
import assert from "node:assert/strict";
import {copy,ctx,game,fresh,stage,other,take,drive} from "./conditional-ko-result-harness-5";
import {addEffect} from "../../src/lib/arena/vm/effects";
import {vmHost} from "../../src/lib/arena/vm/host";
import {stepScript} from "../../src/lib/arena/vm/script";
import {queryHookStatics} from "../../src/lib/arena/vm/program";
import {NotYet} from "../../src/lib/arena/vm/errors";
import type {KoOutcome} from "../../src/lib/arena/vm/ko-result";
import type {GameEvent,PlayerId} from "../../src/lib/arena/types";
let cases=0;
for(const p of ["p1","p2"] as PlayerId[])for(const route of ["ordinary","ultimate","ultimateAfterSkill","ultimateSubstitute","sameDrop","token","z","wrongArea","wrongType","prohibited","unknownHook"]){const s=fresh(p),q=other(p),source=stage(s,p,"BT3-071","battle"),events:GameEvent[]=[],selectedGame=route==="unknownHook"?copy(game):game,h=vmHost(ctx,selectedGame,s,events);let victim:string;
 if(route==="token")victim=h.createToken(q,"Ghost Token",15000,null,null,[])!;
 else {victim=stage(s,q,route.startsWith("ultimate")||route==="unknownHook"?"BT4-124":route==="z"?"BT18-034":route==="wrongType"?"L":"LOW",route==="wrongArea"?"hand":"battle");if(route==="z")s.cards[victim].zCard=true;}
 if(route==="ultimateAfterSkill"||route==="sameDrop")assert.equal(stepScript(h,{card:victim,master:q,vars:{t:[victim]},ip:0,ops:[{op:"replaceLeave",target:{var:"t"},from:["battle"],requestedTo:"drop",to:"drop",until:"turn"}]}),"done");
 if(route==="ultimateSubstitute")h.addEffect({source:victim,master:q,target:victim,kind:"replaceLeave",until:"turn",value:{by:"ko",source:victim,master:q,ops:[{op:"ko",target:{sel:{special:"self"}}}]}});
 if(route==="prohibited")assert.equal(stepScript(h,{card:victim,master:q,vars:{t:[victim]},ip:0,ops:[{op:"forbid",what:"beKOd",target:{var:"t"},until:"turn"}]}),"done");
 if(route==="ultimate"){const facts=queryHookStatics(ctx,game,s,victim,"wouldLeave");assert.ok(facts.some(f=>f.op==="replace"&&f.keyword.name==="Ultimate"));}
 if(route==="unknownHook"){const hook=selectedGame.keywords.Ultimate.hooks!.find(x=>x.at==="wouldLeave")!;hook.ops=[{op:"replace",event:"leave",with:[{op:"moveTo",target:{sel:{special:"self"}},to:"warp"}]}];assert.throws(()=>h.ko(victim,source,{onKoResult:()=>assert.fail("unknown callback")}),e=>e instanceof NotYet&&e.issue==="R506");assert.ok(s.sides[q].zones.battle.includes(victim));assert.equal(events.filter(e=>e.type==="ko").length,0);cases++;continue;}
 const outcomes:KoOutcome[]=[];h.ko(victim,source,{onKoResult:o=>outcomes.push(copy(o))});assert.equal(outcomes.length,1,route);const out=outcomes[0];
 assert.equal(out.moved,!["wrongArea","wrongType","prohibited","ultimateSubstitute"].includes(route),route+JSON.stringify(out));assert.equal(out.route.skillReplacementApplied,["sameDrop","ultimateAfterSkill","ultimateSubstitute"].includes(route));assert.equal(out.route.nativeHook,route.startsWith("ultimate")&&route!=="ultimateSubstitute"?"ultimate":"none");assert.equal(out.route.primitiveRemoval,route==="z"?"zBattle":route==="token"?"token":"none");
 assert.equal(out.cost,["wrongArea","wrongType","prohibited","sameDrop","ultimateAfterSkill","ultimateSubstitute","token"].includes(route)?null:route==="ultimate"?10:3);
 if(route==="ultimateSubstitute")assert.ok(s.sides[q].zones.removed.includes(victim));
 if(["wrongArea","wrongType","prohibited"].includes(route))assert.equal(events.filter(e=>e.type==="ko").length,0);cases++;
}
// Explicit copy-grant + event-dispatch mechanism, not a claim of a printed copy/play procedure.
for(const p of ["p1","p2"] as PlayerId[]){let s=fresh(p);const source=stage(s,p,"F","battle"),victim=stage(s,other(p),"LOW","battle");addEffect(s,[],{source,target:source,master:p,kind:"copiedSkills",value:0,until:"game",copied:{cardId:"BT3-071",side:"front",skills:[10],from:source}});vmHost(ctx,game,s,[]).pend("played",source);const pending=s.pending.find(x=>x.card===source)!;assert.ok("koBinding" in pending&&pending.koBinding);assert.ok("copiedSkillCapture" in pending&&pending.copiedSkillCapture);const hand=s.sides[p].zones.hand.length;s=drive(take(s,{type:"endMain",player:p}));assert.ok(s.sides[other(p)].zones.drop.includes(victim));assert.equal(s.sides[p].zones.hand.length,hand+1);cases++;}
console.log(`ko-result-provenance-5: ${cases} native writer mechanism cases PASS`);
