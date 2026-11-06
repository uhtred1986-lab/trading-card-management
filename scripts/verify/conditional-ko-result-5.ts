import assert from "node:assert/strict";
import {copy,ctx,game,fresh,stage,paidCell,playHand,other,take} from "./conditional-ko-result-harness-5";
import {RULES} from "../../src/lib/arena/vm";
import {vmHost} from "../../src/lib/arena/vm/host";
import {stepScript,type Op} from "../../src/lib/arena/vm/script";
import {attrsNow} from "../../src/lib/arena/vm/program";
import {moveCard} from "../../src/lib/arena/vm/zones";
import {emptyFilter} from "../../src/lib/arena/text/filters";
import type {Action,PlayerId} from "../../src/lib/arena/types";
import type {VmState} from "../../src/lib/arena/vm/state";
function drive(s:VmState,policy:{stop?:(s:VmState)=>boolean;pick?:string;order?:string;decline?:boolean;replacement?:number;allowOutcome?:boolean}={}):VmState{for(let n=0;n<120;n++){if(s.outcome||policy.stop?.(s)||s.prompt.kind==="main"||s.prompt.kind==="charge")return s;const q=s.prompt;let a:Action|undefined;
 if(q.kind==="chooseCards")a={type:"choose",player:q.player,cards:policy.pick&&q.choice.candidates.includes(policy.pick)?[policy.pick]:q.choice.candidates.slice(0,q.choice.min??0)};
 else if(q.kind==="orderPending")a={type:"orderPending",player:q.player,index:s.pendingOrder!.candidates.find(i=>s.pending[i].card===policy.order)??s.pendingOrder!.candidates[0]};
 else if(q.kind==="optionalCost")a={type:"optionalCost",player:q.player,pay:!policy.decline};
 else {const legal=RULES.legalActions(ctx,s).map(x=>x.action);a=legal.find(x=>x.type==="counter"&&x.card===null)??legal.find(x=>x.type==="payCost")??legal.find(x=>x.type==="chooseMode"&&x.index===(q.kind==="chooseMode"&&policy.decline?q.options.length-1:policy.replacement??0))??legal.find(x=>x.type==="pass");}
 assert.ok(a,JSON.stringify(q));s=take(s,a,policy.allowOutcome);
 }throw Error("drive bound");}
function begin(s:VmState,card:string):VmState{const a=RULES.legalActions(ctx,s).map(x=>x.action).find(x=>x.type==="play"&&x.card===card);assert.ok(a);return take(s,a);}
function effect(s:VmState,p:PlayerId,card:string,ops:Op[],vars:Record<string,string[]>={}):void{assert.equal(stepScript(vmHost(ctx,game,s,[]),{card,master:p,ops,vars,ip:0}),"done");}
function android(s:VmState,p:PlayerId):string{for(let i=0;i<4;i++)stage(s,p,"Green","energy");return stage(s,p,"BT3-071","hand");}
let cases=0;
for(const p of ["p1","p2"] as PlayerId[])for(const route of ["cost3","cost4","none","indestructible","barrier","prohibited","sameDrop","warp","optionalDecline","substituteKO","substituteBounce"]){
 let s=fresh(p);const q=other(p),source=android(s,p),victim=route==="none"?undefined:stage(s,q,route==="cost4"?"HIGH":route==="indestructible"?"INDEST":route==="barrier"?"BARRIER":"LOW","battle");
 if(victim){
  if(route==="prohibited")effect(s,q,victim,[{op:"forbid",what:"beKOdBySkill",side:"opponent",until:"turn",target:{var:"t"}}],{t:[victim]});
  if(["sameDrop","warp","optionalDecline"].includes(route))effect(s,q,victim,[{op:"replaceLeave",from:["battle"],requestedTo:"drop",to:route==="sameDrop"?"drop":"warp",until:"turn",optional:route==="optionalDecline",target:{var:"t"}}],{t:[victim]});
  if(route.startsWith("substitute")){const body:Op[]=[...(route==="substituteBounce"?[{op:"moveTo",target:{sel:{side:"opponent",area:"battle",filter:{...emptyFilter(),names:["unfeeling destroyer android 14"]}}},to:"hand"} as Op]:[]),{op:"ko",target:{sel:{special:"self"}}}];vmHost(ctx,game,s,[]).addEffect({source:victim,master:q,target:victim,kind:"replaceLeave",until:"turn",value:{by:"ko",ops:body,source:victim,master:q}});}
 }
 const hand=s.sides[p].zones.hand.length;
 s=drive(begin(s,source),{pick:victim,replacement:route==="optionalDecline"?1:0});
 const draws=["cost3","optionalDecline"].includes(route)?1:0;
 assert.equal(s.sides[p].zones.hand.length,hand-1+draws+(route==="substituteBounce"?1:0),`${p}/${route}`);
 if(victim){const zone=route==="warp"?"warp":["indestructible","prohibited","barrier"].includes(route)?"battle":"drop";assert.ok(s.sides[q].zones[zone].includes(victim),`${route}/${zone}`);}
 cases++;
}
for(const p of ["p1","p2"] as PlayerId[])for(const target of ["z","gohan","ultimate"]){
 const q=other(p);let s=fresh(q),victim:string;
 if(target==="z"){const played=paidCell(s,q);s=played.state;victim=played.card;}
 else {if(target==="gohan")for(const id of [...s.sides[q].zones.hand])assert.ok(moveCard(s,game,id,"deck").ok);victim=stage(s,q,target==="gohan"?"BT2-006":"BT4-124","hand");for(let i=0;i<(target==="gohan"?2:10);i++)stage(s,q,target==="gohan"?"Red":"Black","energy");s=playHand(s,victim);}
 assert.equal(attrsNow(ctx,game,s,victim).costOf,target==="gohan"?2:target==="z"?3:10);
 s=take(s,{type:"endMain",player:q});s=take(s,{type:"charge",player:p,card:null});const source=android(s,p),hand=s.sides[p].zones.hand.length;s=drive(begin(s,source),{pick:victim});
 assert.equal(s.sides[p].zones.hand.length,hand-1+(target==="z"?1:0));assert.ok(s.sides[q].zones[target==="gohan"?"drop":"removed"].includes(victim));assert.equal(attrsNow(ctx,game,s,victim).costOf,target==="gohan"?6:target==="z"?3:10);cases++;
}
for(const p of ["p1","p2"] as PlayerId[])for(const mode of ["paid","declined","unpayable"]){let s=fresh(p);const source=android(s,p);stage(s,other(p),"TAX","battle");const victim=stage(s,other(p),"LOW","battle");if(mode==="unpayable")for(const id of [...s.sides[p].zones.hand])if(id!==source)assert.ok(moveCard(s,game,id,"deck").ok);const hand=s.sides[p].zones.hand.length;s=drive(begin(s,source),{pick:victim,decline:mode==="declined"});assert.equal(s.sides[p].zones.hand.length,hand-1);assert.ok(s.sides[other(p)].zones[mode==="paid"?"drop":"battle"].includes(victim));cases++;}
for(const p of ["p1","p2"] as PlayerId[]){let s=fresh(p);const source=android(s,p),victim=stage(s,other(p),"LOW","battle");stage(s,p,"WATCH","battle");s=drive(begin(s,source),{stop:s=>s.prompt.kind==="orderPending"});assert.equal(s.prompt.kind,"orderPending");const pending=s.pending.find(x=>x.card===source)!;assert.ok("koBinding" in pending&&pending.koBinding);const original=copy(pending.koBinding);vmHost(ctx,game,s,[]).move(source,"hand",p);assert.notEqual(s.cards[source].zoneEpoch,original.sourceEpoch);const hand=s.sides[p].zones.hand.length;s=drive(s,{order:source,pick:victim});assert.equal(s.sides[p].zones.hand.length,hand+2);assert.ok(s.sides[other(p)].zones.drop.includes(victim));cases++;}
// Saved pending binding deletion must refuse before any victim mutation.
for(const p of ["p1","p2"] as PlayerId[]){let s=fresh(p);const source=android(s,p),victim=stage(s,other(p),"LOW","battle");stage(s,p,"WATCH","battle");s=drive(begin(s,source),{stop:s=>s.prompt.kind==="orderPending"});const pending=s.pending.find(x=>x.card===source)!;if("koBinding" in pending)delete pending.koBinding;s.pendingOrder!.queue=copy(s.pending);s=drive(s,{order:source,pick:victim,allowOutcome:true});assert.equal(s.outcome?.kind,"interrupted");assert.ok(JSON.stringify(s.outcome).includes("R506"));assert.ok(s.sides[other(p)].zones.battle.includes(victim));cases++;}
// Real native token creation has no energy cost; it is not cost zero.
for(const p of ["p1","p2"] as PlayerId[]){let s=fresh(p);const source=android(s,p),victim=vmHost(ctx,game,s,[]).createToken(other(p),"Ghost Token",15000,null,null,[]);assert.ok(victim);assert.equal(attrsNow(ctx,game,s,victim).costOf,undefined);const hand=s.sides[p].zones.hand.length;s=drive(begin(s,source),{pick:victim});assert.equal(s.sides[p].zones.hand.length,hand-1);assert.ok(s.sides[other(p)].zones.removed.includes(victim));cases++;}
// Saved Auto price offer retains original source through a native return before payment.
for(const p of ["p1","p2"] as PlayerId[]){let s=fresh(p);const source=android(s,p),victim=stage(s,other(p),"LOW","battle");stage(s,other(p),"TAX","battle");s=drive(begin(s,source),{stop:s=>s.prompt.kind==="chooseMode"&&s.programs.some(f=>f.card===source&&!!f.autoCost)});assert.equal(s.prompt.kind,"chooseMode");const saved=copy(s),frame=s.programs.find(f=>f.card===source&&f.autoCost)!;assert.ok(frame.koBinding);const epoch=frame.koBinding.sourceEpoch;vmHost(ctx,game,s,[]).move(source,"hand",p);assert.notEqual(s.cards[source].zoneEpoch,epoch);const hand=s.sides[p].zones.hand.length;s=drive(s,{pick:victim});assert.equal(s.sides[p].zones.hand.length,hand);assert.ok(s.sides[other(p)].zones.drop.includes(victim));cases++;
 for(const fault of ["binding","effect","ops","sourceEpoch","vars"]){const bad=copy(saved),f=bad.programs.find(f=>f.card===source&&f.autoCost)!;if(fault==="binding")delete f.koBinding;if(fault==="effect")f.autoCost!.effect=[{op:"draw",n:1}];if(fault==="ops")f.ops=[{op:"draw",n:1}];if(fault==="sourceEpoch")f.koBinding!.sourceEpoch=Infinity;if(fault==="vars")f.vars={bad:[]};const hand=bad.sides[p].zones.hand.length;const out=drive(bad,{pick:victim,allowOutcome:true});assert.equal(out.outcome?.kind,"interrupted",fault);assert.equal(out.sides[p].zones.hand.length,hand);assert.ok(out.sides[other(p)].zones.battle.includes(victim));cases++;}
}
// A replacement child pauses after bouncing the source and KO'ing its own victim.
// The outer completed receipt is already substituted and cannot inherit that child's KO.
for(const p of ["p1","p2"] as PlayerId[]){let s=fresh(p);const q=other(p),source=android(s,p),victim=stage(s,q,"LOW","battle");const body:Op[]=[{op:"moveTo",target:{sel:{side:"opponent",area:"battle",filter:{...emptyFilter(),names:["unfeeling destroyer android 14"]}}},to:"hand"},{op:"ko",target:{sel:{special:"self"}}},{op:"choose",sel:{side:"you",area:"hand",count:1,upTo:true},as:"pause"}];vmHost(ctx,game,s,[]).addEffect({source:victim,master:q,target:victim,kind:"replaceLeave",until:"turn",value:{by:"ko",ops:body,source:victim,master:q}});
 s=drive(begin(s,source),{pick:victim,stop:s=>s.prompt.kind==="chooseCards"&&s.programs.some(f=>f.replacing)});assert.equal(s.prompt.kind,"chooseCards");const parent=s.programs.find(f=>f.card===source&&f.koResults)!;assert.ok(parent);assert.ok(s.sides[p].zones.hand.includes(source));assert.ok(s.sides[q].zones.drop.includes(victim));assert.equal(parent.koResults!.c0.outcomes[0].route.skillReplacementApplied,true);assert.equal(parent.koResults!.c0.outcomes[0].moved,false);assert.notEqual(parent.koBinding!.sourceEpoch,s.cards[source].zoneEpoch);const saved=copy(s),hand=s.sides[p].zones.hand.length;const finish=(x:VmState)=>drive(x,{pick:undefined});const good=finish(copy(saved));assert.equal(good.sides[p].zones.hand.length,hand);assert.deepEqual(good,finish(copy(saved)));cases++;
 for(const fault of ["binding","receipt","outcomes","cost","target","owner","epoch","futureEpoch","route","condition","completedAs"]){const bad=copy(saved),f=bad.programs.find(f=>f.card===source&&f.koResults)!;
  if(fault==="binding")delete f.koBinding;if(fault==="receipt")delete f.koResults;if(fault==="outcomes")f.koResults!.c0.outcomes=[];if(fault==="cost")f.koResults!.c0.outcomes[0].cost=3;if(fault==="target")f.koResults!.c0.outcomes[0].card=source;if(fault==="owner")f.koResults!.c0.outcomes[0].owner=p;if(fault==="epoch")f.koResults!.c0.selected[0].epoch=-1;if(fault==="futureEpoch"){const r=f.koResults!.c0;r.selected[0].epoch=999;r.outcomes[0].fromEpoch=999;r.outcomes[0].toEpoch=999;}if(fault==="route")f.koResults!.c0.outcomes[0].route.nativeHook="bad" as "none";
  if(fault==="condition")f.ops[2]={op:"if",cond:{kind:"did",what:"ko"},then:[{op:"draw",n:1}]};if(fault==="completedAs"&&f.ops[1].op==="ko")delete f.ops[1].completedAs;
  const out=drive(bad,{allowOutcome:true});assert.equal(out.outcome?.kind,"interrupted",fault);assert.ok(JSON.stringify(out.outcome).includes("R506"));assert.equal(out.sides[p].zones.hand.length,hand);cases++;
 }
}
for(const p of ["p1","p2"] as PlayerId[]){let s=fresh(p);const source=android(s,p),victim=stage(s,other(p),"LOW","battle");s.cards[victim].owner=p;const hand=s.sides[p].zones.hand.length;s=drive(begin(s,source),{pick:victim});assert.equal(s.sides[p].zones.hand.length,hand);assert.ok(s.sides[p].zones.drop.includes(victim));assert.ok(!s.sides[other(p)].zones.drop.includes(victim));cases++;}
console.log(`conditional-ko-result-5: ${cases} native saved gameplay scenarios PASS`);
