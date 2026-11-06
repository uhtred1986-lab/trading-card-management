import {prepareUnderSourcePlacement,requireUnderSourcePlacement,cleanupUnderSourcePlacement,settleUnderSourcePlacement,requireUnderSourceTriggerHistory} from '../../src/lib/arena/vm/under-source-placement';
import {captureUnderRelease,cleanupUnderRelease} from '../../src/lib/arena/vm/under-release-cleanup';
import {skillsShowing,captureCopiedSkill,capturedSkillShowing} from '../../src/lib/arena/vm/triggers';
import {beginStandingNegationMutation,finishStandingNegationMutation} from '../../src/lib/arena/vm/standing-negation-runtime';
import type {ScriptFrame} from '../../src/lib/arena/vm/script';
import {captureAppliedUnderPlacement,eligibleAppliedUnderPlacement,requireAppliedUnderPlacement,settleAppliedUnderPlacement,effectOccurrence,paymentEffectFrame} from '../../src/lib/arena/vm/applied-effect-receipt';
import {dropEffectsOnExcept,endSourceEffects} from '../../src/lib/arena/vm/effects';
/** R521: complete original sources, native activation/payment, explicitly staged setup. */
import {vmHost} from '../../src/lib/arena/vm/host';
import {addEffect} from '../../src/lib/arena/vm/effects';
import {freshAppliedEffectRoot,recordAppliedEffect,captureAppliedEffectMove} from '../../src/lib/arena/vm/applied-effect-receipt';
import {NotYet} from '../../src/lib/arena/vm/errors';
import assert from 'node:assert/strict';
import fixture from './fixtures/under-source-lifetime-5.json';
import {card,fifty} from './harness';
import {skillRecords} from '../../src/lib/arena/draft';
import {rulesFromRows,type RuleRow} from '../../src/lib/arena/rules-store';
import {RULES} from '../../src/lib/arena/vm';
import {rulesetFor} from '../../src/lib/arena/rulesets';
import {moveCard,findCard} from '../../src/lib/arena/vm/zones';
import type {CardDef,EngineContext,PlayerId,Action,GameEvent} from '../../src/lib/arena/types';
import type {VmState} from '../../src/lib/arena/vm/state';
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const defs:Record<string,CardDef>={
 L:card('L',{type:'LEADER',colors:['Red'],skill:null,power:10000}),
 F:card('F',{colors:['Red'],skill:null,power:5000}),
 SECRET:card('SECRET',{skill:null,name:'private selected card'}),
};
for(const [id,{card:c}] of Object.entries(fixture))defs[id]=card(id,{name:c.name,type:c.type as CardDef['type'],colors:c.colors as CardDef['colors'],energyCost:c.cost===null?null:Number(c.cost),zEnergyCost:c.z===null?null:Number(c.z),power:c.power,characters:c.characters,traits:c.traits,skill:c.skill});
defs.LF=card('LF',{type:'LEADER',colors:['Green'],traits:["Frieza's Army"],skill:null,power:10000});
const rows=Object.values(defs).flatMap(skillRecords),ctx:EngineContext={defs,scripts:rulesFromRows(rows.map((r,id)=>({...r,id,status:r.unread.length?'open':'confirmed',source:'compiler'}) as RuleRow),defs)};
const loaded=rulesetFor('dbs');assert.ok(loaded.ok);const game=loaded.definition;
const other=(p:PlayerId):PlayerId=>p==='p1'?'p2':'p1';
function setup(p:PlayerId,context:EngineContext=ctx){const ctx=context;const q=other(p);let s=RULES.createGame(ctx,{seed:514,p1:{name:'One',leader:'L',main:fifty('F'),z:[]},p2:{name:'Two',leader:'L',main:fifty('F'),z:[]}}).state as VmState;const events:GameEvent[]=[];
 const take=(a:Action)=>{const saved=clone(s),before=JSON.stringify(saved);RULES.boardView(ctx,saved,p,{});RULES.boardView(ctx,saved,q,{});const result=RULES.apply(ctx,saved,a);assert.equal(JSON.stringify(saved),before);s=result.state as VmState;events.push(...result.events);assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));};
 for(const a of [{type:'chooseFirst',player:s.chooser,first:p},{type:'mulligan',player:p,redraw:false},{type:'mulligan',player:q,redraw:false},{type:'charge',player:p,card:null}] as Action[])take(a);
 s.turn=3; // explicit later-turn staging; action sequence below is native
 s.sides[p].attrs.energyMarkers=0;s.sides[q].attrs.energyMarkers=0; // explicit resource setup
 const stage=(owner:PlayerId,zone:string,id='F',host?:string)=>{const key=s.sides[owner].zones.deck.at(-1)!;s.cards[key].cardId=id;assert.ok(moveCard(s,game,key,zone,{owner,...(host?{under:host}:{})}).ok);return key;};
 const actions=()=>RULES.legalActions(ctx,s).map(x=>x.action);
 const settle=(pick?:(state:VmState)=>Action|undefined)=>{for(let i=0;i<30&&!['main','combo'].includes(s.prompt.kind);i++){const pr=s.prompt;let a=pick?.(s);if(!a&&pr.kind==='chooseCards')a={type:'choose',player:pr.player,cards:pr.choice.candidates.slice(0,pr.choice.min??0)};if(!a&&pr.kind==='chooseMode')a={type:'chooseMode',player:pr.player,index:pr.options.length-1};if(!a&&pr.kind==='payCost')a={type:'payCost',player:pr.player,option:0};if(!a&&pr.kind==='orderPending')a={type:'orderPending',player:pr.player,index:s.pendingOrder!.candidates[0]};a??=actions().find(x=>x.type==='counter'&&x.card===null);assert.ok(a,JSON.stringify(pr));take(a);}};
 return {get s(){return s;},set s(v:VmState){s=v;},events,take,stage,actions,settle,p,q};
}


const results=[];
const routes=[['battle','battle',false,true],['battle','combo',false,true],['combo','battle',false,true],['combo','leader',false,false],['battle','battle',true,true],['combo','combo',true,false],['leader','battle',false,false],['drop','battle',false,false]] as const;
for(const p of ['p1','p2'] as PlayerId[])for(const buried of [false,true])for(const [from,to,foreignHolder,keepsParent] of routes){
 if(!buried&&from==='leader'||buried&&from==='drop')continue;
 const t=setup(p),holder=foreignHolder?t.q:p,oldHost=from==='leader'?t.s.sides[p].zones.leader[0]:t.stage(p,from,'BT1-016'),source=buried?t.stage(p,'under','BT1-016',oldHost):oldHost;
 const dest=to==='leader'?t.s.sides[holder].zones.leader[0]:t.stage(holder,to,'BT1-016'),author=t.stage(p,'battle','F'),ev:GameEvent[]=[];
 const parent:ScriptFrame=freshAppliedEffectRoot(t.s,{card:author,master:p,skillIndex:0,ops:[],ip:0,vars:{}},'activate');
 const a=recordAppliedEffect(t.s,parent,source,()=>addEffect(t.s,ev,{source:author,master:p,target:source,kind:'power',value:5000,until:'turn'}))!;
 const current:ScriptFrame=freshAppliedEffectRoot(t.s,{card:author,master:p,skillIndex:1,ops:[],ip:0,vars:{}},'activate');
 const b=recordAppliedEffect(t.s,current,source,()=>addEffect(t.s,ev,{source:author,master:p,target:source,kind:'power',value:1000,until:'turn'}))!;
 const duration=from==='battle'?addEffect(t.s,ev,{source,master:p,target:author,kind:'power',value:2000,until:'whileSourceInPlay'}):undefined;
 const token=captureAppliedUnderPlacement(t.s,source,dest,current),policy=eligibleAppliedUnderPlacement(t.s,token);
 assert.equal(policy.retained.includes(a.id),keepsParent);assert.equal(policy.retained.includes(b.id),true);
 const copyIds=policy.retained as number[];copyIds.push(999999);assert.equal(eligibleAppliedUnderPlacement(t.s,token).retained.includes(999999),false);
 requireAppliedUnderPlacement(t.s,token);const move=moveCard(t.s,game,source,'drop',{under:dest});assert.ok(move.ok);
 dropEffectsOnExcept(t.s,ev,source,eligibleIdsWithoutAdded(policy.retained));if(policy.endBattleSourceEffects)endSourceEffects(t.s,ev,source);
 settleAppliedUnderPlacement(t.s,token,move.move);
 assert.equal(t.s.effects.some(e=>e.id===a.id),keepsParent);assert.equal(t.s.effects.some(e=>e.id===b.id),true);
 assert.deepEqual(t.s.appliedEffectOwnership?.[b.id].current,effectOccurrence(t.s,source));assert.equal(effectOccurrence(t.s,source).area,'underOrRemoved');assert.equal(effectOccurrence(t.s,source).holder,p);
 if(duration)assert.equal(t.s.effects.some(e=>e.id===duration.id),to==='battle');
 assert.doesNotThrow(()=>captureAppliedEffectMove(t.s,source,parent.appliedEffects));assert.doesNotThrow(()=>captureAppliedEffectMove(t.s,source,current.appliedEffects));assert.throws(()=>settleAppliedUnderPlacement(t.s,token,move.move),NotYet);
 results.push({p,buried,from,to,foreignHolder});
}
function eligibleIdsWithoutAdded(ids:readonly number[]){return ids.filter(id=>id!==999999);}
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),source=t.stage(p,'battle','BT1-016'),first=t.stage(p,'battle','BT1-016'),last=t.stage(p,'battle','BT1-016'),leader=t.s.sides[p].zones.leader[0],author=t.stage(p,'battle','F'),ev:GameEvent[]=[];
 const parent:ScriptFrame=freshAppliedEffectRoot(t.s,{card:author,master:p,skillIndex:0,ops:[],ip:0,vars:{}},'activate'),child:ScriptFrame=freshAppliedEffectRoot(t.s,{card:author,master:p,skillIndex:1,ops:[],ip:0,vars:{}},'activate');
 const a=recordAppliedEffect(t.s,parent,source,()=>addEffect(t.s,ev,{source:author,master:p,target:source,kind:'power',value:5000,until:'turn'}))!,b=recordAppliedEffect(t.s,child,source,()=>addEffect(t.s,ev,{source:author,master:p,target:source,kind:'power',value:1000,until:'turn'}))!;
 const place=(host:string,frame:ScriptFrame)=>{const token=captureAppliedUnderPlacement(t.s,source,host,frame),policy=eligibleAppliedUnderPlacement(t.s,token),move=moveCard(t.s,game,source,'drop',{under:host});assert.ok(move.ok);dropEffectsOnExcept(t.s,ev,source,policy.retained);if(policy.endBattleSourceEffects)endSourceEffects(t.s,ev,source);settleAppliedUnderPlacement(t.s,token,move.move);};
 place(first,child);assert.ok(t.s.effects.some(e=>e.id===a.id));assert.doesNotThrow(()=>captureAppliedEffectMove(t.s,source,parent.appliedEffects));
 place(leader,parent);assert.ok(t.s.effects.some(e=>e.id===a.id));assert.equal(t.s.effects.some(e=>e.id===b.id),false);
 place(last,child);assert.equal(t.s.effects.some(e=>e.id===a.id||e.id===b.id),false);assert.equal(t.s.appliedEffectOwnership?.[a.id],undefined);assert.equal(t.s.appliedEffectOwnership?.[b.id],undefined);
 results.push({p,sequentialParkedRoot:true});
}
for(const p of ['p1','p2'] as PlayerId[])for(const kind of ['clone','partial','deleted','payment','buriedZ','stale','receiptDeletion','receiptMutation'] as const){
 const t=setup(p),host=t.stage(p,'battle','BT1-016'),source=t.stage(p,kind==='buriedZ'?'under':'drop','BT1-016',kind==='buriedZ'?host:undefined),dest=t.stage(p,kind==='buriedZ'?'combo':'battle','BT1-016'),author=t.stage(p,'battle','F'),ev:GameEvent[]=[];
 const root:ScriptFrame=freshAppliedEffectRoot(t.s,{card:author,master:p,skillIndex:0,ops:[],ip:0,vars:{}},'activate'),frame=kind==='payment'?paymentEffectFrame(root)!:root;
 const effect=recordAppliedEffect(t.s,frame,source,()=>addEffect(t.s,ev,{source:author,master:p,target:source,kind:'power',value:5000,until:'turn'}))!;
 if(kind==='buriedZ')t.s.cards[source].zCard=true;
 if(kind==='payment'||kind==='buriedZ'){const before=JSON.stringify(t.s);assert.throws(()=>captureAppliedUnderPlacement(t.s,source,dest,frame),NotYet);assert.equal(JSON.stringify(t.s),before);results.push({p,kind});continue;}
 const token=captureAppliedUnderPlacement(t.s,source,dest,frame);
 if(kind==='stale'){t.s.cards[dest].zoneEpoch=(t.s.cards[dest].zoneEpoch??0)+1;assert.throws(()=>requireAppliedUnderPlacement(t.s,token),NotYet);results.push({p,kind});continue;}
 const original=JSON.stringify(t.s),board=kind==='clone'?clone(t.s):t.s,owned=kind==='clone'?captureAppliedUnderPlacement(board,source,dest,clone(frame)):token;
 if(kind==='clone')assert.throws(()=>requireAppliedUnderPlacement(board,token),NotYet);
 const policy=eligibleAppliedUnderPlacement(board,owned),move=moveCard(board,game,source,'drop',{under:dest});assert.ok(move.ok);dropEffectsOnExcept(board,[],source,kind==='deleted'?[]:policy.retained);
 if(kind==='partial')board.effects.find(e=>e.id===effect.id)!.value=2500;
 if(kind==='receiptDeletion'||kind==='receiptMutation'){
  const tags=JSON.stringify(board.appliedEffectOwnership);
  if(kind==='receiptDeletion')frame.appliedEffects!.entries=[];else frame.appliedEffects!.entries[0].target.epoch++;
  assert.throws(()=>settleAppliedUnderPlacement(board,owned,move.move),NotYet);assert.equal(JSON.stringify(board.appliedEffectOwnership),tags);results.push({p,kind});continue;
 }
 settleAppliedUnderPlacement(board,owned,move.move);
 assert.doesNotThrow(()=>captureAppliedEffectMove(board,source,frame.appliedEffects));
 if(kind==='clone')assert.equal(JSON.stringify(t.s),original);if(kind==='partial')assert.equal(board.effects.find(e=>e.id===effect.id)?.value,2500);if(kind==='deleted')assert.equal(board.appliedEffectOwnership?.[effect.id],undefined);
 results.push({p,kind});
}
// Complete isolated clone lifecycle; native host hookup follows bridge review.
for(const p of ['p1','p2'] as PlayerId[])for(const route of ['plainReset','copyCarry','copyLoss','oldNegation','unrelatedNegation','newNegation','newCopy','materials'] as const){
 const t=setup(p),source=t.stage(p,route==='copyCarry'||route==='materials'?'battle':'hand',route==='plainReset'||route==='copyCarry'||route==='copyLoss'||route==='materials'?'BT1-016':'BT23-025'),host=t.stage(p,route==='materials'?'combo':'battle',route==='copyCarry'||route==='copyLoss'||route==='materials'?'BT2-013':'BT23-006');
 const material=route==='materials'?t.stage(p,'under','BT1-016',source):undefined; // real recursive release in this constructed projection
 const author=t.stage(p,'battle','F'),ev:GameEvent[]=[];
 let oldCapture:ReturnType<typeof captureCopiedSkill>;
 if(route==='copyCarry'||route==='copyLoss'){
  addEffect(t.s,ev,{target:source,kind:'copiedSkills',value:0,until:'turn',copied:{cardId:'BT29-140',side:'front',skills:[30],from:source}});
  const showing=skillsShowing(ctx,t.s,source),copied=showing.skills.find(x=>x.index>=100000)!;assert.ok(copied);oldCapture=captureCopiedSkill(t.s,source,copied,showing.scripts.bySkill[copied.index]);
 }
 if(route==='oldNegation'||route==='unrelatedNegation')addEffect(t.s,ev,{target:source,kind:'negateSkill',value:route==='oldNegation'?10:0,until:'turn'});
 addEffect(t.s,ev,{source:author,master:p,target:source,kind:'power',value:5000,until:'turn'});
 if(material){
  const owned:ScriptFrame=freshAppliedEffectRoot(t.s,{card:author,master:p,skillIndex:0,ops:[],ip:0,vars:{}},'activate');
  recordAppliedEffect(t.s,owned,source,()=>addEffect(t.s,ev,{source:material,master:p,target:source,kind:'power',value:1000,until:'whileSourceInPlay'}));
  recordAppliedEffect(t.s,owned,material,()=>addEffect(t.s,ev,{source,master:p,target:material,kind:'power',value:1000,until:'whileSourceInPlay'}));
 }
 const original=JSON.stringify(t.s),projected=clone(t.s),events:GameEvent[]=[];
 const sourceToken=prepareUnderSourcePlacement(ctx,game,projected,source,host),release=captureUnderRelease(projected,source,host);
 const transaction=projected.mixedStandingNegationHistory?beginStandingNegationMutation(ctx,projected):undefined;
 requireUnderSourcePlacement(projected,sourceToken);const actual=moveCard(projected,game,source,'drop',{under:host});assert.ok(actual.ok);
 cleanupUnderSourcePlacement(projected,events,sourceToken,actual.move);cleanupUnderRelease(projected,events,release,actual.move);settleUnderSourcePlacement(projected,sourceToken,actual.move);
 if(route==='newCopy')addEffect(projected,events,{target:source,kind:'copiedSkills',value:0,until:'turn',copied:{cardId:'BT23-025',side:'front',skills:[10],from:source}});
 if(route==='newNegation')addEffect(projected,events,{target:source,kind:'negateSkill',value:10,until:'turn'});
 finishStandingNegationMutation(ctx,projected,transaction,[source,host]);
 if(['copyLoss','oldNegation','newNegation','newCopy'].includes(route))assert.throws(()=>requireUnderSourceTriggerHistory(ctx,game,projected,sourceToken),NotYet);else requireUnderSourceTriggerHistory(ctx,game,projected,sourceToken);
 if(material){assert.equal(findCard(projected,material)?.zone,'drop');assert.equal(projected.effects.some(e=>e.until==='whileSourceInPlay'&&(e.source===source||e.source===material)),false);assert.deepEqual(projected.appliedEffectOwnership,{});}
 if(oldCapture&&route==='copyCarry')assert.equal(capturedSkillShowing(ctx,projected,source,oldCapture.index,oldCapture).deleted,false);
 assert.equal(JSON.stringify(t.s),original);results.push({p,route,completeProjection:true});
}
// Native ordinary host moves; injected effects/roots are explicit mechanism setup.
for(const p of ['p1','p2'] as PlayerId[])for(const buried of [false,true])for(const reset of [false,true]){
 const t=setup(p),old=t.stage(p,reset?'combo':'battle','BT1-016'),source=t.stage(p,buried?'under':reset?'drop':'battle','BT1-016',buried?old:undefined),dest=reset?t.s.sides[p].zones.leader[0]:t.stage(p,'battle','BT1-016'),author=t.stage(p,'battle','F'),ev:GameEvent[]=[];
 const parent:ScriptFrame=freshAppliedEffectRoot(t.s,{card:author,master:p,skillIndex:0,ops:[],ip:0,vars:{}},'activate'),current=freshAppliedEffectRoot(t.s,{card:author,master:p,skillIndex:1,ops:[],ip:0,vars:{}},'activate');
 const prior=recordAppliedEffect(t.s,parent,source,()=>addEffect(t.s,ev,{target:source,source:author,master:p,kind:'power',value:5000,until:'turn'}))!;
 const own=recordAppliedEffect(t.s,current,source,()=>addEffect(t.s,ev,{target:source,source:author,master:p,kind:'power',value:1000,until:'turn'}))!;
 const duration=!reset?addEffect(t.s,ev,{target:author,source,master:p,kind:'power',value:2000,until:'whileSourceInPlay'}):undefined;
 assert.equal(vmHost(ctx,game,t.s,ev,current).placeUnder(source,dest,current),true);
 assert.equal(t.s.effects.some(e=>e.id===prior.id),!reset);assert.ok(t.s.effects.some(e=>e.id===own.id));
 if(duration)assert.ok(t.s.effects.some(e=>e.id===duration.id));
 assert.deepEqual(t.s.appliedEffectOwnership?.[own.id].current,effectOccurrence(t.s,source));
 assert.doesNotThrow(()=>captureAppliedEffectMove(t.s,source,parent.appliedEffects));
 assert.equal(t.s.cards[dest].under.includes(source),true);assert.equal(findCard(t.s,source),null);
 results.push({p,buried,reset,nativeHost:true});
}
for(const p of ['p1','p2'] as PlayerId[])for(const fault of ['matchingNegation','copyLoss','buriedZ','payment'] as const){
 const t=setup(p),old=t.stage(p,'battle','BT1-016'),source=t.stage(p,fault==='buriedZ'?'under':'hand',fault==='matchingNegation'?'BT23-025':'BT1-016',fault==='buriedZ'?old:undefined),dest=t.stage(p,fault==='buriedZ'?'combo':'battle',fault==='matchingNegation'?'BT23-006':'BT2-013'),author=t.stage(p,'battle','F'),ev:GameEvent[]=[];
 const body=freshAppliedEffectRoot(t.s,{card:author,master:p,skillIndex:0,ops:[],ip:0,vars:{}},'activate');
 if(fault==='matchingNegation')addEffect(t.s,ev,{target:source,kind:'negateSkill',value:10,until:'turn'});
 if(fault==='copyLoss')addEffect(t.s,ev,{target:source,kind:'copiedSkills',value:0,until:'turn',copied:{cardId:'BT29-140',side:'front',skills:[30],from:source}});
 if(fault==='buriedZ')t.s.cards[source].zCard=true;
 const execution=fault==='payment'?paymentEffectFrame(body)!:body;
 if(fault==='payment')recordAppliedEffect(t.s,execution,source,()=>addEffect(t.s,ev,{target:source,source:author,master:p,kind:'power',value:1000,until:'turn'}));
 const h=vmHost(ctx,game,t.s,ev,execution),before=JSON.stringify(t.s),events=JSON.stringify(ev);
 assert.throws(()=>h.placeUnder(source,dest,body),NotYet);assert.equal(JSON.stringify(t.s),before);assert.equal(JSON.stringify(ev),events);
 results.push({p,fault,nativeRefusal:true});
}
for(const p of ['p1','p2'] as PlayerId[])for(const buried of [false,true]){
 const t=setup(p),old=t.stage(p,'battle','BT1-016'),source=t.stage(p,buried?'under':'battle','BT1-016',buried?old:undefined),dest=t.stage(p,'combo','BT1-016'),other=t.stage(p,'battle','F'),events:GameEvent[]=[];
 const power=addEffect(t.s,events,{target:source,kind:'power',value:5000,until:'turn'}),duration=addEffect(t.s,events,{target:other,source,master:p,kind:'power',value:1000,until:'whileSourceInPlay'});
 assert.equal(vmHost(ctx,game,t.s,events).placeUnder(source,dest),true);assert.ok(t.s.effects.some(e=>e.id===power.id));assert.equal(t.s.effects.some(e=>e.id===duration.id),false);
 results.push({p,buried,nativeBattleDeparture:true});
}
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),source=t.stage(p,'battle','BT1-016'),dest=t.stage(p,'battle','BT2-013'),events:GameEvent[]=[];
 addEffect(t.s,events,{target:source,kind:'copiedSkills',value:0,until:'turn',copied:{cardId:'BT29-140',side:'front',skills:[20],from:source}});
 const showing=skillsShowing(ctx,t.s,source),skill=showing.skills.find(x=>x.index>=100000)!;const captured=captureCopiedSkill(t.s,source,skill,showing.scripts.bySkill[skill.index]);assert.ok(captured);
 const h=vmHost(ctx,game,t.s,events);assert.equal(h.placeUnder(source,dest),true);assert.equal(capturedSkillShowing(ctx,t.s,source,captured.index,captured).deleted,false);
 const before=JSON.stringify(t.s),prior=JSON.stringify(events);assert.equal(h.placeUnder(source,dest),false);assert.equal(h.placeUnder('missing',dest),false);assert.equal(JSON.stringify(t.s),before);assert.equal(JSON.stringify(events),prior);
 for(const viewer of [p,t.q])assert.doesNotMatch(JSON.stringify(RULES.boardView(ctx,t.s,viewer,{})),/appliedEffectOwnership|appliedEffects|placedUnderRelation/);
 assert.doesNotMatch(JSON.stringify(events),/appliedEffectOwnership|appliedEffects|placedUnderRelation/);
 results.push({p,nativeRetainedCopyAndInvalid:true});
}
// Actual printed City Activate cost and Android 17 arrival Auto. City is staged
// in Battle; no claim is made about its absent catalog Z-play cost.
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),city=t.stage(p,'battle','BT23-006'),android=t.stage(p,'hand','BT23-025');t.s.cards[city].zCard=true;
 const hand=t.s.sides[p].zones.hand.length;
 const action=t.actions().find(x=>x.type==='activate'&&x.card===city&&x.skill===20);assert.ok(action,JSON.stringify(t.actions()));t.take(action);
 t.settle(state=>state.prompt.kind==='chooseCards'&&state.prompt.choice.candidates.includes(android)?{type:'choose',player:p,cards:[android]}:undefined);
 assert.ok(t.s.cards[city].under.includes(android));assert.equal(t.s.sides[p].zones.hand.length,hand);
 assert.ok(t.events.some(e=>e.type==='note'&&e.text===`${t.s.sides[p].name} shuffles their deck`)); // optional zero Android 18 still shuffles
 assert.ok(t.events.some(e=>e.type==='skill'&&e.card===city&&e.master===p));assert.ok(t.events.some(e=>e.type==='skill'&&e.card===android&&e.master===p));
 assert.ok(Object.keys(t.s.sides[p].limitUses??{}).some(k=>k.includes('BT23-025')));assert.equal(Object.keys(t.s.sides[t.q].limitUses??{}).some(k=>k.includes('BT23-025')),false);
 results.push({p,printedCity:true});
}
console.log(`under-source-lifetime-5: ${results.length} bridge/projection/native cases PASS`);
