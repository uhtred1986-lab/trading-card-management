/** R514: complete original sources, native activation/payment, explicitly staged setup. */
import assert from 'node:assert/strict';
import fixture from './fixtures/activate-under-5.json';
import {card,fifty} from './harness';
import {skillRecords} from '../../src/lib/arena/draft';
import {rulesFromRows,type RuleRow} from '../../src/lib/arena/rules-store';
import {RULES} from '../../src/lib/arena/vm';
import {rulesetFor} from '../../src/lib/arena/rulesets';
import {moveCard,findCard} from '../../src/lib/arena/vm/zones';
import {vmHost} from '../../src/lib/arena/vm/host';
import {stepScript,type Op} from '../../src/lib/arena/vm/script';
import {stepActivateUnderCost} from '../../src/lib/arena/vm/activate-under-cost';
import {emptyFilter} from '../../src/lib/arena/text/filters';
import {parseRule,printRule,type Rule} from '../../src/lib/arena/lang';
import {attrsNow} from '../../src/lib/arena/vm/program';
import type {CardDef,EngineContext,PlayerId,Action,GameEvent} from '../../src/lib/arena/types';
import type {VmState} from '../../src/lib/arena/vm/state';
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const defs:Record<string,CardDef>={L:card('L',{type:'LEADER',colors:['Green'],characters:['Broly: Br'],skill:null,power:10000}),ZL:card('ZL',{type:'Z-LEADER',colors:['Green'],characters:['Broly: Br'],skill:null,power:15000}),F:card('F',{colors:['Green'],skill:null,power:5000}),UH:card('UH',{type:'UNISON',colors:['Green'],characters:['Broly: Br'],skill:null}),MAIN:card('MAIN',{skill:'[Activate: Main][Once per turn] Draw 1 card.'}),M:card('M',{colors:['Green','Blue'],skill:null}),GW:card('GW',{colors:['Green','White'],skill:null}),SECRET:card('SECRET',{skill:null,name:'private selected card'})};
for(const [id,{card:c}] of Object.entries(fixture))defs[id]=card(id,{name:c.name,type:c.type as CardDef['type'],colors:c.colors as CardDef['colors'],energyCost:c.cost===null?null:Number(c.cost),zEnergyCost:c.z===null?null:Number(c.z),power:c.power,characters:c.characters,traits:c.traits,skill:c.skill});
defs.MOD={...defs['BT23-098'],id:'MOD',skill:defs['BT23-098'].skill+'<br>[Permanent] During your opponent\'s turn, if you have a blue <Baby> in play, reduce the energy cost of this card in all areas by 2.'};
const rows=Object.values(defs).flatMap(skillRecords),ctx:EngineContext={defs,scripts:rulesFromRows(rows.map((r,id)=>({...r,id,status:r.unread.length?'open':'confirmed',source:'compiler'}) as RuleRow),defs)};
const loaded=rulesetFor('dbs');assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==='p1'?'p2':'p1';let cases=0;
function setup(p:PlayerId){const q=other(p);let s=RULES.createGame(ctx,{seed:514,p1:{name:'One',leader:'L',main:fifty('F'),z:[]},p2:{name:'Two',leader:'L',main:fifty('F'),z:[]}}).state as VmState;const events:GameEvent[]=[];
 const take=(a:Action)=>{const saved=clone(s),before=JSON.stringify(saved);RULES.boardView(ctx,saved,p,{});RULES.boardView(ctx,saved,q,{});const result=RULES.apply(ctx,saved,a);assert.equal(JSON.stringify(saved),before);s=result.state as VmState;events.push(...result.events);assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));};
 for(const a of [{type:'chooseFirst',player:s.chooser,first:p},{type:'mulligan',player:p,redraw:false},{type:'mulligan',player:q,redraw:false},{type:'charge',player:p,card:null}] as Action[])take(a);
 s.sides[p].attrs.energyMarkers=0;s.sides[q].attrs.energyMarkers=0; // explicit resource setup
 const stage=(owner:PlayerId,zone:string,id='F',host?:string)=>{const key=s.sides[owner].zones.deck.at(-1)!;s.cards[key].cardId=id;assert.ok(moveCard(s,game,key,zone,{owner,...(host?{under:host}:{})}).ok);return key;};
 const actions=()=>RULES.legalActions(ctx,s).map(x=>x.action);
 const settle=(pick?:(state:VmState)=>Action|undefined)=>{for(let i=0;i<30&&!['main','combo'].includes(s.prompt.kind);i++){const pr=s.prompt;let a=pick?.(s);if(!a&&pr.kind==='chooseCards')a={type:'choose',player:pr.player,cards:pr.choice.candidates.slice(0,pr.choice.min??0)};if(!a&&pr.kind==='chooseMode')a={type:'chooseMode',player:pr.player,index:pr.options.length-1};if(!a&&pr.kind==='payCost')a={type:'payCost',player:pr.player,option:0};if(!a&&pr.kind==='orderPending')a={type:'orderPending',player:pr.player,index:s.pendingOrder!.candidates[0]};a??=actions().find(x=>x.type==='counter'&&x.card===null);assert.ok(a,JSON.stringify(pr));take(a);}};
 return {get s(){return s;},set s(v:VmState){s=v;},events,take,stage,actions,settle,p,q};
}
for(const p of ['p1','p2'] as PlayerId[])for(const id of ['BT19-096','BT19-097','BT19-098','BT23-098'])for(const foreign of [false,true]){
 const t=setup(p),host=t.s.sides[p].zones.leader[0];if(id==='BT19-098')t.s.cards[host].cardId='BT19-070';
 const source=t.stage(foreign?t.q:p,'under',id,host);const owner=t.s.cards[source].owner;const energy=t.stage(p,'energy');
 const targets=id==='BT19-096'?Array.from({length:3},()=>t.stage(t.q,'battle')):[];
 const paragus=id==='BT19-097'?t.stage(p,'battle','BT19-091'):null;
 const a=t.actions().find(a=>a.type==='activate'&&a.card===source&&a.skill===10);assert.ok(a,JSON.stringify({id,p,foreign,rejected:RULES.rejectedActions(ctx,t.s,RULES.legalActions(ctx,t.s)).filter(x=>x.action.type==='activate'&&x.action.card===source)}));
 t.take(a);assert.equal(findCard(t.s,source)?.zone,'drop');assert.equal(findCard(t.s,source)?.owner,owner);assert.equal(t.s.cards[energy].mode,Number(defs[id].energyCost)>0?'rest':'active');
 t.settle();assert.equal(t.s.programs.length,0);if(paragus)assert.equal(findCard(t.s,paragus)?.zone,'drop');if(targets.length)for(const target of targets)assert.equal(findCard(t.s,target)?.zone,'drop');
 if(id!=='BT19-096')assert.ok(!t.actions().some(a=>a.type==='activate'&&a.card===source&&a.skill===10));cases++;
}


function effect(t:ReturnType<typeof setup>,target:string,op:Op){assert.equal(stepScript(vmHost(ctx,game,t.s,t.events),{card:t.s.sides[t.p].zones.leader[0],master:t.p,ops:[op],ip:0,vars:{t:[target]}}),'done');}
function refusedApply(state:VmState,a:Action){const before=JSON.stringify(state);let refused=false;try{const r=RULES.apply(ctx,state,a);refused=!!r.state.outcome;}catch(e){assert.ok(e instanceof Error);assert.notEqual(e.name,'TypeError');assert.notEqual(e.name,'RangeError');refused=true;}assert.ok(refused);assert.equal(JSON.stringify(state),before);}
// Full source siblings and actual-record DSL, not regenerated fixture expectations.
for(const [id,item] of Object.entries(fixture))for(const [key,old] of Object.entries(item.records)){
 const row=rows.find(r=>r.cardId===id&&r.skillIndex===old.skillIndex&&r.side===old.side)!;
 if(['BT19-093','BT19-096','BT19-097','BT19-098','BT23-098'].includes(id)&&old.skillIndex===0){
  assert.deepEqual(Object.fromEntries(Object.entries(row).filter(([k])=>!['ops','reads','unread','pattern'].includes(k))),Object.fromEntries(Object.entries(old).filter(([k])=>!['ops','reads','unread','pattern'].includes(k))),key);
  assert.deepEqual(row.unread,[]);assert.equal(row.ops.length,1);const op=row.ops[0];assert.equal(op.op,'permit');if(op.op!=='permit')throw Error('permit');assert.equal(op.what,'activateFromUnder');assert.equal(op.activateUnderPolicy,id==='BT23-098'?'asHandV1':'asHandGreenBrolyLeaderV1');assert.deepEqual(op.source?.characters,['broly: br']);assert.deepEqual(op.target,{sel:{special:'self'}});
  const rule=clone({kind:row.kind,trigger:row.trigger,cost:row.cost,usage:row.usage,validity:row.validity,cond:row.cond,ops:row.ops}) as Rule;const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);assert.deepEqual(clone(parsed.value),rule);
 }else assert.deepEqual(clone(row),old,key);
}
for(const p of ['p1','p2'] as PlayerId[])for(const defending of [false,true])for(const decline of [false,true]){
 const t=setup(p),host=t.s.sides[p].zones.leader[0],source=t.stage(p,'under','BT19-093',host);
 while(t.s.sides[p].zones.life.length>4)assert.ok(moveCard(t.s,game,t.s.sides[p].zones.life[0],'hand',{owner:p}).ok);
 t.take({type:'endMain',player:p});t.take({type:'charge',player:t.q,card:null});
 if(!defending){t.take({type:'endMain',player:t.q});t.take({type:'charge',player:p,card:null});}
 const attacker=defending?t.s.sides[t.q].zones.leader[0]:host,target=defending?host:t.s.sides[t.q].zones.leader[0];
 t.take({type:'attack',player:defending?t.q:p,attacker,target});t.settle();if(defending){const pass=t.actions().find(a=>a.type==='pass');assert.ok(pass);t.take(pass);}
 const a=t.actions().find(a=>a.type==='activate'&&a.card===source&&a.skill===10);assert.ok(a);const power=attrsNow(ctx,game,t.s,host).power;
 t.take(a);t.settle(s=>s.prompt.kind==='chooseCards'?{type:'choose',player:s.prompt.player,cards:decline?[]:[host]}:undefined);assert.equal(attrsNow(ctx,game,t.s,host).power,Number(power)+(decline?0:5000));assert.equal(findCard(t.s,source)?.zone,'drop');cases++;
}
// Native strict-price effects, including prevented negation and failed/replaced movement.
for(const p of ['p1','p2'] as PlayerId[])for(const route of ['negation','move','sameDrop','warp','mixed','success'] as const){
 const t=setup(p),source=t.stage(p,'under','BT19-097',t.s.sides[p].zones.leader[0]),payer=t.stage(p,'battle','BT19-091');
 if(route==='negation'||route==='mixed')effect(t,payer,{op:'forbid',what:'beNegated',until:'turn',target:{var:'t'}});
 if(route==='move')effect(t,payer,{op:'forbid',what:'beMovedBySkill',until:'turn',target:{var:'t'}});
 if(route==='sameDrop'||route==='warp')effect(t,payer,{op:'replaceLeave',from:['battle'],requestedTo:'drop',to:route==='sameDrop'?'drop':'warp',until:'turn',target:{var:'t'}});
 const good=route==='mixed'?t.stage(p,'battle','BT19-091'):payer;
 if(route==='mixed'||route==='success')t.stage(p,'battle','BT19-091');
 const a=t.actions().find(a=>a.type==='activate'&&a.card===source&&a.skill===10);
 if(route==='success'||route==='mixed'){assert.ok(a);t.take(a);assert.equal(t.s.prompt.kind,'chooseCards');if(t.s.prompt.kind!=='chooseCards')throw Error('price');if(route==='mixed')assert.ok(!t.s.prompt.choice.candidates.includes(payer));assert.ok(t.s.prompt.choice.candidates.includes(good));t.take({type:'choose',player:p,cards:[good]});t.settle();assert.equal(findCard(t.s,good)?.zone,'drop');}
 else {assert.equal(a,undefined);assert.equal(findCard(t.s,source),null);assert.equal(findCard(t.s,payer)?.zone,'battle');}
 cases++;
}
// Saving at the actual energy prompt cannot replace source or host occurrences.
for(const p of ['p1','p2'] as PlayerId[])for(const fault of ['none','sourceABA','hostABA','hostIdentity','sourceFace','hostHiddenABA','holder','missing','owner','null'] as const){
 const t=setup(p),host=t.stage(p,'battle','BT19-088'),source=t.stage(p,'under','BT19-096',host);t.stage(p,'energy');t.stage(p,'energy','M');for(let i=0;i<3;i++)t.stage(t.q,'battle');
 const a=t.actions().find(a=>a.type==='activate'&&a.card===source&&a.skill===10);assert.ok(a);t.take(a);assert.equal(t.s.prompt.kind,'payCost');if(t.s.prompt.kind!=='payCost')throw Error('pay');const saved=clone(t.s);
 if(fault==='sourceABA'){assert.ok(moveCard(saved,game,source,'hand',{owner:p}).ok);assert.ok(moveCard(saved,game,source,'under',{owner:p,under:host}).ok);}
 if(fault==='hostABA'){saved.cards[host].zoneEpoch=(saved.cards[host].zoneEpoch??0)+2;}
 if(fault==='hostIdentity')saved.cards[host].cardId='F';
 if(fault==='sourceFace')saved.cards[source].flipped=!saved.cards[source].flipped;
 if(fault==='hostHiddenABA')saved.cards[host].hiddenCount=(saved.cards[host].hiddenCount??0)+1;
 if(fault==='holder')assert.ok(moveCard(saved,game,host,'battle',{owner:t.q}).ok);
 if(saved.prompt.kind!=='payCost')throw Error('savedpay');
 if(fault==='missing')delete saved.prompt.activateUnderOrigin;
 if(fault==='null')saved.prompt.activateUnderOrigin=null as never;
 if(fault==='owner')saved.prompt.activateUnderOrigin!.owner=t.q;
 if(fault==='none'){t.s=saved;t.take({type:'payCost',player:p,option:0});t.settle();assert.equal(findCard(t.s,source)?.zone,'drop');}
 else refusedApply(saved,{type:'payCost',player:p,option:0});cases++;
}
// Malformed private continuation fields deliberately refuse, never crash or mutate.
for(const p of ['p1','p2'] as PlayerId[]){const t=setup(p),source=t.stage(p,'under','BT19-097',t.s.sides[p].zones.leader[0]);t.stage(p,'battle','BT19-091');t.stage(p,'battle','BT19-091');const a=t.actions().find(a=>a.type==='activate'&&a.card===source&&a.skill===10);assert.ok(a);t.take(a);assert.equal(t.s.prompt.kind,'chooseCards');
 for(const fault of ['origin','energy','payers','payerNull','huge','ops','vars','varsArray','receipt','negation','stagedFace'] as const){const saved=clone(t.s),frame=saved.programs.find(f=>f.activateUnderCost)!;assert.ok(frame);const c=frame.activateUnderCost!;
  if(fault==='origin')c.origin=null as never;if(fault==='energy')c.energy=null as never;if(fault==='payers')c.energy.payers=null as never;if(fault==='payerNull'){c.energy.price.total=1;c.origin.cardPrice.total=1;c.energy.payers=[null as never];}if(fault==='huge'){c.energy.price.orbs={Green:Number.MAX_SAFE_INTEGER};c.origin.cardPrice.orbs={Green:Number.MAX_SAFE_INTEGER};}if(fault==='ops')frame.ops=null as never;if(fault==='vars')frame.vars=null as never;if(fault==='varsArray')frame.vars=[] as never;if(fault==='receipt')delete frame.activateUnderCost;if(fault==='negation')c.negatedPayer=null as never;if(fault==='stagedFace')c.stagedFace.hiddenCount++;
  const before=JSON.stringify(saved);assert.throws(()=>stepActivateUnderCost(ctx,game,saved,[],frame),e=>e instanceof Error&&e.name!=='TypeError'&&e.name!=='RangeError');assert.equal(JSON.stringify(saved),before);cases++;
 }
}


function cardsInView(x:unknown,id:string):Record<string,unknown>[]{if(!x||typeof x!=='object')return[];const o=x as Record<string,unknown>;return [...(o.id===id?[o]:[]),...Object.values(o).flatMap(v=>cardsInView(v,id))];}
// Private look/search choices and opponent-owned sources retain the controlling host's chooser.
for(const p of ['p1','p2'] as PlayerId[])for(const id of ['BT19-097','BT23-098']){
 const t=setup(p),host=t.s.sides[p].zones.leader[0],source=t.stage(t.q,'under',id,host);if(id==='BT19-097')t.stage(p,'battle','BT19-091');
 const hidden=t.s.sides[p].zones.deck[0];t.s.cards[hidden].cardId=id==='BT19-097'?'BT19-093':'BT19-088';
 const a=t.actions().find(a=>a.type==='activate'&&a.card===source&&a.skill===10);assert.ok(a);t.take(a);assert.equal(t.s.prompt.kind,'chooseCards');if(t.s.prompt.kind!=='chooseCards')throw Error('look');assert.equal(t.s.prompt.player,p);assert.ok(t.s.prompt.choice.candidates.includes(hidden));
 const own=RULES.boardView(ctx,t.s,p,{}),opp=RULES.boardView(ctx,t.s,t.q,{});assert.ok(cardsInView(own,hidden).some(c=>c.cardId===t.s.cards[hidden].cardId));assert.ok(cardsInView(opp,hidden).every(c=>!c.cardId));assert.ok(!JSON.stringify(opp).includes(defs[t.s.cards[hidden].cardId].name));
 const saved=clone(t.s);t.take({type:'choose',player:p,cards:[hidden]});t.settle();const end=clone(t.s);t.s=saved;t.take({type:'choose',player:p,cards:[hidden]});t.settle();assert.deepEqual(t.s,end);assert.equal(id==='BT19-097'?t.s.cards[host].under.includes(hidden):t.s.sides[p].zones.hand.includes(hidden),true);cases++;
}
// Native opponent discard choice is private, optional and distinct from the future tax branch.
for(const p of ['p1','p2'] as PlayerId[])for(const pay of [false,true]){
 const t=setup(p),host=t.s.sides[p].zones.leader[0];t.s.cards[host].cardId='BT19-070';const source=t.stage(p,'under','BT19-098',host);t.stage(p,'energy');const secret=t.stage(t.q,'hand','SECRET');const before=t.s.sides[t.q].zones.hand.length;const taxed=t.stage(t.q,'battle','MAIN');
 const a=t.actions().find(a=>a.type==='activate'&&a.card===source&&a.skill===10);assert.ok(a);t.take(a);assert.equal(t.s.prompt.kind,'chooseMode');t.take({type:'chooseMode',player:t.q,index:pay?0:1});
 if(pay){assert.equal(t.s.prompt.kind,'chooseCards');assert.ok(!JSON.stringify(RULES.boardView(ctx,t.s,p,{})).includes('private selected card'));assert.ok(cardsInView(RULES.boardView(ctx,t.s,t.q,{}),secret).some(c=>c.cardId==='SECRET'));}
 t.settle();assert.equal(t.s.sides[t.q].zones.hand.length,before-(pay?2:0));t.take({type:'endMain',player:p});t.take({type:'charge',player:t.q,card:null});t.settle();assert.equal(t.s.effects.some(e=>e.kind==='skillCost'&&e.source===source),!pay);assert.equal(t.actions().some(a=>a.type==='activate'&&a.card===taxed),pay,JSON.stringify({pay,attrs:t.s.sides[t.q].attrs,energy:t.s.sides[t.q].zones.energy,effects:t.s.effects.filter(e=>e.source===source),actions:RULES.legalActions(ctx,t.s).filter(x=>x.action.type==='activate'&&x.action.card===taxed)}));cases++;
}
// Actual Out of Control Power FAQ: activation consumes one of six Extras, leaving five for Broly's replacement.
for(const p of ['p1','p2'] as PlayerId[]){const t=setup(p),leader=t.s.sides[p].zones.leader[0],host=t.stage(p,'battle','BT19-088');const extras=Array.from({length:5},()=>t.stage(p,'under','BT19-093',host));const source=t.stage(p,'under','BT19-096',host);t.stage(p,'energy');const targets=Array.from({length:3},()=>t.stage(t.q,'battle'));
 const a=t.actions().find(a=>a.type==='activate'&&a.card===source&&a.skill===10);assert.ok(a);t.take(a);assert.equal(t.s.cards[host].under.length,5);assert.equal(t.s.prompt.kind,'chooseCards');t.take({type:'choose',player:p,cards:[host]});
 t.settle(s=>s.prompt.kind==='replaceMove'?{type:'chooseMode',player:s.prompt.player,index:0}:s.prompt.kind==='chooseCards'?{type:'choose',player:s.prompt.player,cards:s.prompt.choice.candidates.slice(0,s.prompt.choice.min)}:undefined);
 assert.equal(findCard(t.s,host)?.zone,'battle');for(const extra of extras)assert.ok(t.s.cards[leader].under.includes(extra));for(const target of targets)assert.equal(findCard(t.s,target)?.zone,'drop');cases++;
}
// Permission conditions, original-area exclusions and actor/physical-owner distinction.
for(const p of ['p1','p2'] as PlayerId[])for(const route of ['wrongHost','wrongLeader','duplicateHost','standalone','negated','sourceHidden','hostHidden','ownSourceForeignHost','dropSkill19','dropSkill23'] as const){const t=setup(p),leader=t.s.sides[p].zones.leader[0],host=t.stage(route==='ownSourceForeignHost'?t.q:p,'battle','BT19-088'),id=route==='dropSkill23'?'BT23-098':route==='dropSkill19'?'BT19-098':'BT19-097',source=t.stage(p,'under',id,host);t.stage(p,'battle','BT19-091');
 if(route==='wrongHost')t.s.cards[host].cardId='F';if(route==='wrongLeader')t.s.cards[leader].cardId='F';if(route==='duplicateHost')t.s.cards[leader].under.push(source);if(route==='standalone')t.s.sides[p].zones.hand.push(source);if(route==='negated')vmHost(ctx,game,t.s,t.events).negateAll(source);if(route==='sourceHidden')t.s.cards[source].hidden=true;if(route==='hostHidden')t.s.cards[host].hidden=true;
 const acts=t.actions().filter(a=>a.type==='activate'&&a.card===source);assert.ok(!acts.some(a=>a.type==='activate'&&(route.startsWith('dropSkill')?a.skill===20:true)),route);cases++;
}


// Explicit prepayment bounds for omitted/consumable modifiers and additional taxes.
for(const p of ['p1','p2'] as PlayerId[])for(const route of ['ownDiscount','handCoupon','wrongCoupon','targetCoupon','tax'] as const){const t=setup(p),source=t.stage(p,'under',route==='ownDiscount'?'MOD':'BT23-098',t.s.sides[p].zones.leader[0]);const before=clone(t.s.cards[source]);
 if(route==='handCoupon'||route==='wrongCoupon')effect(t,source,{op:'costReduction',target:{sel:{side:'you',area:'hand',filter:{...emptyFilter(),type:'EXTRA',colors:[route==='wrongCoupon'?'Blue':'Green']}}},amount:1,energyActivation:'activate',uses:1,until:'turn'});
 if(route==='targetCoupon')effect(t,source,{op:'costReduction',target:{var:'t'},amount:1,uses:1,until:'turn'});
 if(route==='tax')effect(t,source,{op:'forbid',what:'activateSkill',side:'you',target:{var:'t'},unlessPay:[{op:'discard',side:'you',n:1}],until:'turn'});
 const a=t.actions().find(a=>a.type==='activate'&&a.card===source&&a.skill===10);assert.equal(!!a,route==='wrongCoupon',route);assert.deepEqual(t.s.cards[source],before);cases++;
}
// No alternative's source-area permission is manufactured by staging to Drop.
for(const p of ['p1','p2'] as PlayerId[])for(const id of ['BT19-098','BT23-098'])for(const area of ['hand','drop'] as const){const t=setup(p),source=t.stage(p,area,id);t.stage(p,'hand','BT19-093');t.stage(p,'energy');const a=t.actions().find(a=>a.type==='activate'&&a.card===source&&a.skill===20);assert.equal(!!a,area==='drop');if(a){const hand=t.s.sides[p].zones.hand.length;t.take(a);t.settle();assert.equal(findCard(t.s,source)?.zone,'warp');assert.equal(t.s.sides[p].zones.hand.length,hand);}cases++;}
// Limit belongs to the host controller across Hand and under copies of the same skill.
for(const p of ['p1','p2'] as PlayerId[]){const t=setup(p),host=t.s.sides[p].zones.leader[0],one=t.stage(t.q,'under','BT23-098',host),two=t.stage(p,'under','BT23-098',host),hand=t.stage(p,'hand','BT23-098');const a=t.actions().find(a=>a.type==='activate'&&a.card===one&&a.skill===10);assert.ok(a);t.take(a);t.settle();assert.ok(!t.actions().some(a=>a.type==='activate'&&[two,hand].includes(a.card)&&a.skill===10));cases++;}


// Mechanism hosts cover each RM23-2 pile area, including foreign physical host ownership.
for(const p of ['p1','p2'] as PlayerId[])for(const area of ['leader','battle','unison','combo'] as const){const t=setup(p);let host=t.s.sides[p].zones.leader[0];
 if(area==='battle') {host=t.stage(t.q,'battle','BT19-088');assert.ok(moveCard(t.s,game,host,'battle',{owner:p}).ok);}
 if(area==='unison'){host=t.stage(p,'unison','UH');t.s.cards[host].markers=2;}
 if(area==='combo'){
  t.take({type:'endMain',player:p});t.take({type:'charge',player:t.q,card:null});t.take({type:'endMain',player:t.q});t.take({type:'charge',player:p,card:null});
  t.take({type:'attack',player:p,attacker:host,target:t.s.sides[t.q].zones.leader[0]});t.settle();host=t.stage(p,'battle','BT19-088');
  const a=t.actions().find(a=>a.type==='combo'&&a.card===host);assert.ok(a);t.take(a);
 }
 const source=t.stage(t.q,'under',area==='combo'?'BT19-093':'BT23-098',host);if(area==='combo')while(t.s.sides[p].zones.life.length>4)assert.ok(moveCard(t.s,game,t.s.sides[p].zones.life[0],'hand',{owner:p}).ok);
 const a=t.actions().find(a=>a.type==='activate'&&a.card===source&&a.skill===10);assert.ok(a,area);t.take(a);t.settle();assert.equal(findCard(t.s,source)?.owner,t.q);assert.equal(findCard(t.s,source)?.zone,'drop');assert.equal(findCard(t.s,host)?.owner,p);cases++;
}
// The negation is paid before a native optional replacement; only declining it completes the original Drop cost.
for(const p of ['p1','p2'] as PlayerId[])for(const route of ['decline','accept','sourceABA','hostGone','badAttrs'] as const){
 const t=setup(p),host=t.stage(p,'battle','BT19-088'),source=t.stage(p,'under','BT19-097',host),payer=t.stage(p,'battle','BT19-091');
 effect(t,payer,{op:'replaceLeave',to:'drop',optional:true,until:'turn',target:{var:'t'}});
 const a=t.actions().find(a=>a.type==='activate'&&a.card===source&&a.skill===10);assert.ok(a);t.take(a);
 if(t.s.prompt.kind==='chooseCards')t.take({type:'choose',player:p,cards:[payer]});
 assert.equal(t.s.prompt.kind,'replaceMove');if(t.s.prompt.kind!=='replaceMove')throw Error('replacement');
 const frame=t.s.programs.find(f=>f.activateUnderCost)!;assert.equal(frame.ip,2);assert.ok(frame.activateUnderCost!.negatedPayer);assert.equal(findCard(t.s,source)?.zone,'drop');
 if(route==='badAttrs'){
  const saved=clone(t.s),f=saved.programs.find(f=>f.activateUnderCost)!;f.activateUnderCost!.negatedPayer!.attributes={colors:null,characters:1} as never;const before=JSON.stringify(saved);assert.throws(()=>stepActivateUnderCost(ctx,game,saved,[],f),e=>e instanceof Error&&e.name!=='TypeError');assert.equal(JSON.stringify(saved),before);cases++;continue;
 }
 if(route==='sourceABA'){assert.ok(moveCard(t.s,game,source,'hand',{owner:p}).ok);assert.ok(moveCard(t.s,game,source,'drop',{owner:p}).ok);refusedApply(clone(t.s),{type:'chooseMode',player:t.s.prompt.player,index:t.s.prompt.options.length-1});cases++;continue;}
 if(route==='hostGone'){assert.ok(moveCard(t.s,game,host,'drop',{owner:p}).ok);delete t.s.cards[host];t.s.sides[p].zones.drop=t.s.sides[p].zones.drop.filter(x=>x!==host);}
 const saved=clone(t.s),reply:Action={type:'chooseMode',player:t.s.prompt.player,index:route==='accept'?0:t.s.prompt.options.length-1};
 t.take(reply);t.settle();const end=clone(t.s);t.s=saved;t.take(reply);t.settle();assert.deepEqual(t.s,end);
 assert.equal(findCard(t.s,payer)?.zone,'drop');assert.equal(t.events.filter(e=>e.type==='skill'&&e.card===source).length,route==='accept'?0:2);cases++;
}
// Printed activation thresholds and real payment reject before mutation.
for(const p of ['p1','p2'] as PlayerId[])for(const route of ['life5','opponent2','nonZ','noEnergy','greenWhite'] as const){
 const t=setup(p),host=t.s.sides[p].zones.leader[0],id=route==='life5'?'BT19-093':route==='nonZ'?'BT19-098':'BT19-096',source=t.stage(p,'under',id,host);
 if(route!=='noEnergy')t.stage(p,'energy',route==='greenWhite'?'GW':'F');
 for(let i=0;i<(route==='opponent2'?2:3);i++)t.stage(t.q,'battle');
 if(route==='life5'){
  while(t.s.sides[p].zones.life.length>5)assert.ok(moveCard(t.s,game,t.s.sides[p].zones.life[0],'hand',{owner:p}).ok);
  t.take({type:'endMain',player:p});t.take({type:'charge',player:t.q,card:null});t.take({type:'endMain',player:t.q});t.take({type:'charge',player:p,card:null});
  t.take({type:'attack',player:p,attacker:host,target:t.s.sides[t.q].zones.leader[0]});t.settle();
 }
 const before=JSON.stringify(t.s),a=t.actions().find(a=>a.type==='activate'&&a.card===source&&a.skill===10);assert.equal(JSON.stringify(t.s),before);assert.equal(!!a,route==='greenWhite',route);
 if(a){t.take(a);t.settle();assert.equal(findCard(t.s,source)?.zone,'drop');}else refusedApply(clone(t.s),{type:'activate',player:p,card:source,skill:10});cases++;
}
console.log(`activate-under-5: ${cases} native/contract cases PASS`);
