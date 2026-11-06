/** Native-host mechanism tests; no P-764 admission. */
import assert from 'node:assert/strict';
import {card,fifty} from './harness';
import {RULES} from '../../src/lib/arena/vm';
import {rulesetFor} from '../../src/lib/arena/rulesets';
import {rulesFromCompiler} from '../../src/lib/arena/draft';
import {vmHost} from '../../src/lib/arena/vm/host';
import {moveCard,findCard} from '../../src/lib/arena/vm/zones';
import {stepScript,type ScriptFrame,type Op} from '../../src/lib/arena/vm/script';
import {programProblem} from '../../src/lib/arena/vm/script-schema';
import {parseRule,printRule,type Rule} from '../../src/lib/arena/lang';
import {emptyFilter} from '../../src/lib/arena/text/filters';
import type {EngineContext,PlayerId} from '../../src/lib/arena/types';
import type {VmState} from '../../src/lib/arena/vm/state';
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const defs={L:card('L',{type:'LEADER',skill:null}),F:card('F',{skill:null}),G2:card('G2',{colors:['Green'],energyCost:2,skill:null}),G3:card('G3',{colors:['Green'],energyCost:3,skill:null}),G4:card('G4',{colors:['Green'],energyCost:4,skill:null}),B3:card('B3',{colors:['Blue'],energyCost:3,skill:null}),N:card('N',{colors:['Green'],energyCost:null,skill:null})};
const ctx:EngineContext={defs,scripts:rulesFromCompiler(defs)},loaded=rulesetFor('dbs');assert.ok(loaded.ok);const game=loaded.definition;
const choice:Extract<Op,{op:'choose'}>={op:'choose',sel:{side:'you',area:'drop',count:1,upTo:true,filter:{...emptyFilter(),colors:['Green']}},as:'chosen',energyCostEquals:{var:'paid_warp'}};
const ops:Op[]=[choice,{op:'moveTo',target:{var:'chosen'},to:'hand',reveal:true}];
assert.equal(programProblem(ops),null);
const rule={kind:'auto',trigger:['attacks'],cost:null,cond:null,ops} as Rule;const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);assert.deepEqual(parsed.value,rule);
let cases=0;
for(const p of ['p1','p2'] as PlayerId[])for(const route of ['choose','decline','reduced','twoSmall','none'] as const){
 const s=RULES.createGame(ctx,{seed:522,p1:{name:'One',leader:'L',main:fifty('F'),z:[]},p2:{name:'Two',leader:'L',main:fifty('F'),z:[]}}).state as VmState;
 const stage=(def:string)=>{const id=s.sides[p].zones.deck.at(-1)!;s.cards[id].cardId=def;assert.ok(moveCard(s,game,id,'drop',{owner:p}).ok);return id;};
 const a=stage('G2'),b=stage('G2'),three=stage('G3'),four=stage('G4'),blue=stage('B3'),none=stage('N');
 if(route==='twoSmall'||route==='none')moveCard(s,game,three,'warp',{owner:p});
 const source=s.sides[p].zones.leader[0],h=vmHost(ctx,game,s,[]);
 if(route==='reduced')stepScript(h,{card:source,master:p,ops:[{op:'costReduction',target:{var:'target'},amount:1,until:'turn'}],ip:0,vars:{target:[four]}});
 const frame:ScriptFrame={card:source,master:p,ops:clone(ops),ip:0,vars:{paid_warp:['one','two','three']}};
 const result=stepScript(h,frame);
 if(route==='twoSmall'||route==='none'){assert.equal(result,'done');assert.deepEqual(frame.vars.chosen,[]);}
 else{assert.equal(result,'wait');assert.equal(s.prompt.kind,'chooseCards');if(s.prompt.kind!=='chooseCards')throw Error('prompt');assert.equal(s.prompt.choice.min,0);assert.equal(s.prompt.choice.max,1);assert.deepEqual(new Set(s.prompt.choice.candidates),new Set(route==='reduced'?[three,four]:[three]));assert.ok(!s.prompt.choice.candidates.some(x=>[a,b,blue,none].includes(x)));
  const saved=clone(frame);s.programs=[];s.lastChoice=route==='decline'?[]:[route==='reduced'?four:three];assert.equal(stepScript(h,saved),'done');assert.equal(findCard(s,route==='reduced'?four:three)?.zone,route==='decline'?'drop':'hand');}
 cases++;
}
for(const value of [-1,0.5,null,{var:''},{x:true}]){assert.notEqual(programProblem([{...choice,energyCostEquals:value}]),null,JSON.stringify(value));cases++;}
for(const extra of [{sumTo:3},{namedSet:true},{permission:'unionFusionDropBottom'}]){assert.notEqual(programProblem([{...choice,...extra}]),null);cases++;}
console.log(`choose-energy-equals-5: ${cases} native-host/schema cases PASS`);
