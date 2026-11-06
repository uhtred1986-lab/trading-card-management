/** Isolated R506 serialization contract, not native gameplay or compiler admission. */
import assert from "node:assert/strict";
import {completedKoCost,recordKoOutcome,requireKoResult,requireKoRoute,startKoResult,type KoBinding,type KoOutcome} from "../../src/lib/arena/vm/ko-result";
import {condProblem,programProblem} from "../../src/lib/arena/vm/script-schema";
import {parseRule,printRule,validateRule,type Rule} from "../../src/lib/arena/lang";
import {NotYet} from "../../src/lib/arena/vm/errors";
const copy=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const binding:KoBinding={card:"source",sourceEpoch:2,skillIndex:10,master:"p1",name:"c0"};
const picked={card:"target",epoch:4,owner:"p2" as const};
const ordinary:KoOutcome={card:"target",fromEpoch:4,toEpoch:5,to:"drop",owner:"p2",moved:true,route:{skillReplacementApplied:false,nativeHook:"none",primitiveRemoval:"none"},cost:3};
let cases=0;
for(const route of [ordinary.route,{...ordinary.route,nativeHook:"ultimate" as const},{...ordinary.route,primitiveRemoval:"zBattle" as const},{...ordinary.route,primitiveRemoval:"token" as const}])for(const replacement of [false,true])for(const cost of [null,2,3,4,6]){
 const r=startKoResult(binding,[picked]);const removed=route.nativeHook!=="none"||route.primitiveRemoval!=="none";
 recordKoOutcome(r,binding,0,{...ordinary,route:{...route,skillReplacementApplied:replacement},to:removed?"removed":"drop",cost:replacement?null:cost});
 assert.equal(completedKoCost(copy(r),binding,1,3),!replacement&&cost!==null&&cost<=3);cases++;
}
const empty=startKoResult(binding,[]);assert.equal(completedKoCost(empty,binding,0,3),false);cases++;
const refused=startKoResult(binding,[picked]);recordKoOutcome(refused,binding,0,{...ordinary,to:"battle",toEpoch:4,moved:false,cost:null});assert.equal(completedKoCost(refused,binding,1,3),false);cases++;
const complete=startKoResult(binding,[picked]);recordKoOutcome(complete,binding,0,ordinary);
const reject=(f:()=>void)=>{assert.throws(f,e=>e instanceof NotYet&&e.issue==="R506");cases++;};
for(const fault of ["missing","version","binding","name","master","sourceEpoch","duplicateSelection","missingOutcome","duplicateOutcome","wrongTarget","fromEpoch","futureCursor","nanEpoch","infiniteEpoch","negativeEpoch","noDeparture","wrongOwner","wrongDestination","missingCost","nanCost","infiniteCost","negativeCost","substituteCost","unknownHook","unknownPrimitive","missingRoute"]){
 const r=JSON.parse(JSON.stringify(complete));
 if(fault==="missing"){reject(()=>requireKoResult(undefined,binding,1));continue;}
 if(fault==="version")r.version=2;if(fault==="binding")delete r.binding;if(fault==="name")r.binding.name="other";if(fault==="master")r.binding.master="p2";if(fault==="sourceEpoch")r.binding.sourceEpoch=3;
 if(fault==="duplicateSelection")r.selected.push(copy(r.selected[0]));if(fault==="missingOutcome")r.outcomes=[];if(fault==="duplicateOutcome")r.outcomes.push(copy(r.outcomes[0]));
 if(fault==="wrongTarget")r.outcomes[0].card="other";if(fault==="fromEpoch")r.outcomes[0].fromEpoch=3;if(fault==="nanEpoch")r.outcomes[0].toEpoch=NaN;if(fault==="infiniteEpoch")r.outcomes[0].toEpoch=Infinity;if(fault==="negativeEpoch")r.outcomes[0].toEpoch=-1;if(fault==="noDeparture")r.outcomes[0].toEpoch=4;
 if(fault==="wrongOwner")r.outcomes[0].owner="p1";if(fault==="wrongDestination")r.outcomes[0].to="warp";if(fault==="missingCost")delete r.outcomes[0].cost;if(fault==="nanCost")r.outcomes[0].cost=NaN;if(fault==="infiniteCost")r.outcomes[0].cost=Infinity;if(fault==="negativeCost")r.outcomes[0].cost=-1;if(fault==="substituteCost")r.outcomes[0].route.skillReplacementApplied=true;
 if(fault==="unknownHook")r.outcomes[0].route.nativeHook="custom";if(fault==="unknownPrimitive")r.outcomes[0].route.primitiveRemoval="other";if(fault==="missingRoute")delete r.outcomes[0].route;
 reject(()=>requireKoResult(r,binding,fault==="futureCursor"?2:1));
}
reject(()=>recordKoOutcome(complete,binding,1,ordinary));
reject(()=>requireKoResult(startKoResult(binding,[picked]),binding,1));
reject(()=>completedKoCost(complete,binding,0,3));
reject(()=>requireKoRoute({skillReplacementApplied:false,nativeHook:"unreviewed",primitiveRemoval:"none"}));
reject(()=>completedKoCost(complete,binding,1,NaN));
for(const to of [null,"invented","under","play"]){const r=copy(complete);r.outcomes[0].route.skillReplacementApplied=true;r.outcomes[0].cost=null;(r.outcomes[0] as {to:unknown}).to=to;reject(()=>requireKoResult(r,binding,1));}
// Original attempt stays: record before a replacement child mutates the victim.
const substitute=startKoResult(binding,[picked]);recordKoOutcome(substitute,binding,0,{...ordinary,to:"battle",toEpoch:4,moved:false,route:{...ordinary.route,skillReplacementApplied:true},cost:null});assert.equal(completedKoCost(copy(substitute),binding,1,3),false);cases++;
const initial=startKoResult(binding,[picked]),saved=JSON.stringify(initial);reject(()=>recordKoOutcome(initial,binding,0,{...ordinary,to:"warp"}));assert.equal(JSON.stringify(initial),saved,"failed append is atomic");
const oldRule:Rule={kind:"auto",trigger:["played"],cost:null,cond:null,ops:[{op:"choose",sel:{side:"opponent",area:"battle",count:1},as:"c0"},{op:"ko",target:{var:"c0"}}]};
const oldText=printRule(oldRule),oldParsed=parseRule(oldText);assert.ok(oldParsed.ok);assert.deepEqual(oldParsed.value.ops[1],oldRule.ops[1]);assert.equal(printRule(oldParsed.value),oldText);cases++;
for(const op of [{op:"ko",target:{var:"c0"},completedAs:""},{op:"ko",target:{var:"c0"},completedAs:" "},{op:"ko",target:{var:"c0"},completedAs:"other"},{op:"ko",target:{sel:{special:"self"}},completedAs:"c0"},{op:"ko",target:{sel:{fromVar:"c0"}},completedAs:"c0"}]){assert.ok(programProblem([op]));const malformed=copy(oldRule);malformed.ops[1]=op as typeof malformed.ops[1];const parsed=parseRule(printRule(malformed));assert.ok(!parsed.ok||validateRule(parsed.value,"auto"));cases++;}
for(const costMax of [-1,NaN,Infinity]){assert.ok(condProblem({kind:"koedByThisSkill",var:"c0",costMax}));cases++;}
assert.ok(condProblem({kind:"koedByThisSkill",var:"",costMax:3}));cases++;
console.log(`ko-result-contract-5: ${cases} isolated contract cases PASS`);
