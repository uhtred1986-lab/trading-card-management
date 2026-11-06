import type {ScriptFrame} from '../../src/lib/arena/vm/script';
import {captureUnderRelease,requireUnderReleaseCapture,cleanupUnderRelease} from '../../src/lib/arena/vm/under-release-cleanup';
/** R514: complete original sources, native activation/payment, explicitly staged setup. */
import {vmHost} from '../../src/lib/arena/vm/host';
import {addEffect} from '../../src/lib/arena/vm/effects';
import {freshAppliedEffectRoot,recordAppliedEffect,captureAppliedEffectMove} from '../../src/lib/arena/vm/applied-effect-receipt';
import {NotYet} from '../../src/lib/arena/vm/errors';
import assert from 'node:assert/strict';
import fixture from './fixtures/under-release-5.json';
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
for(const p of ['p1','p2'] as PlayerId[])for(const route of ['cross','same','foreign','zUnison','zPending'] as const){
 const t=setup(p),top=t.stage(p,'battle','BT1-016'),base=t.stage(route==='foreign'?t.q:p,'under','BT1-016',top),dest=t.stage(p,route==='same'?'battle':route==='zUnison'?'unison':'combo','BT1-016'),otherCard=t.stage(p,'battle','F');
 const prior=t.stage(p,'under','F',dest);
 if(route==='zUnison'||route==='zPending')t.s.cards[base].zCard=true;
 const events:GameEvent[]=[];
 const root:ScriptFrame=freshAppliedEffectRoot(t.s,{card:otherCard,master:p,skillIndex:0,ops:[],ip:0,vars:{}},'activate');
 const target=recordAppliedEffect(t.s,root,base,()=>addEffect(t.s,events,{source:otherCard,master:p,target:base,kind:'power',value:5000,until:'turn'}))!;
 const source=addEffect(t.s,events,{source:base,master:p,target:otherCard,kind:'power',value:1000,until:'whileSourceInPlay'});
 if(route==='zPending'){const before=JSON.stringify(t.s);assert.throws(()=>captureUnderRelease(t.s,top,dest),NotYet);assert.equal(JSON.stringify(t.s),before);results.push({p,route});continue;}
 const token=captureUnderRelease(t.s,top,dest);requireUnderReleaseCapture(t.s,token);
 const actual=moveCard(t.s,game,top,'drop',{under:dest});assert.ok(actual.ok);
 const released=cleanupUnderRelease(t.s,events,token,actual.move),retained=route==='same';
 assert.equal(released.length,retained?0:1);assert.equal(t.s.effects.some(e=>e.id===target.id),retained);assert.equal(t.s.effects.some(e=>e.id===source.id),retained);
 assert.equal(!!t.s.appliedEffectOwnership?.[target.id],retained);assert.doesNotThrow(()=>captureAppliedEffectMove(t.s,base,root.appliedEffects));
 assert.deepEqual(t.s.cards[dest].under,[prior,top,...(retained?[base]:[])]);
 if(!retained){assert.equal(findCard(t.s,base)?.zone,route==='zUnison'?'removed':'drop');assert.equal(findCard(t.s,base)?.owner,route==='foreign'?t.q:p);}
 assert.throws(()=>cleanupUnderRelease(t.s,events,token,actual.move),NotYet);assert.equal(t.s.pending.length,0);
 results.push({p,route});
}
for(const p of ['p1','p2'] as PlayerId[])for(const from of ['battle','combo']){
 const t=setup(p),top=t.stage(p,from,'BT1-016'),base=t.stage(t.q,'under','BT1-016',top),dest=t.stage(p,from==='battle'?'combo':'battle','BT1-016'),source=t.stage(p,'battle','F');
 const ev:GameEvent[]=[];const root:ScriptFrame=freshAppliedEffectRoot(t.s,{card:source,master:p,skillIndex:0,ops:[],ip:0,vars:{}},'activate');
 const e=recordAppliedEffect(t.s,root,base,()=>addEffect(t.s,ev,{source,master:p,target:base,kind:'power',value:5000,until:'turn'}))!;
 const h=vmHost(ctx,game,t.s,ev),before=ev.length;assert.equal(h.placeUnder(top,dest),true);
 assert.equal(t.s.effects.some(x=>x.id===e.id),false);assert.equal(t.s.appliedEffectOwnership?.[e.id],undefined);assert.doesNotThrow(()=>captureAppliedEffectMove(t.s,base,root.appliedEffects));
 assert.equal(findCard(t.s,base)?.owner,t.q);assert.deepEqual(ev.slice(before).filter(x=>x.type==='move'||x.type==='stack').map(x=>x.type),['move','stack']);assert.equal(t.s.pending.length,0);
 results.push({p,from,nativeHost:true});
}
for(const p of ['p1','p2'] as PlayerId[])for(const mutation of ['wrongBoard','staleHost','staleMaterial']){
 const t=setup(p),top=t.stage(p,'battle','BT1-016'),base=t.stage(p,'under','BT1-016',top),dest=t.stage(p,'combo','BT1-016');
 const token=captureUnderRelease(t.s,top,dest);
 if(mutation==='wrongBoard')assert.throws(()=>requireUnderReleaseCapture(clone(t.s),token),NotYet);
 else {if(mutation==='staleHost')t.s.cards[dest].zoneEpoch=(t.s.cards[dest].zoneEpoch??0)+1;else t.s.cards[base].zoneEpoch=(t.s.cards[base].zoneEpoch??0)+1;assert.throws(()=>requireUnderReleaseCapture(t.s,token),NotYet);}
 results.push({p,mutation});
}

for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),base=t.stage(p,'hand','BT1-016'),top=t.stage(p,'hand','BT1-016');
 const energy=Array.from({length:6},()=>t.stage(p,'energy'));
 const play=t.actions().find(a=>a.type==='play'&&a.card===base);assert.ok(play);t.take(play);t.settle();
 assert.equal(findCard(t.s,base)?.zone,'battle');
 const evolve=t.actions().find(a=>a.type==='activate'&&a.card===top);assert.ok(evolve);t.take(evolve);
 t.settle(state=>state.prompt.kind==='chooseCards'&&state.prompt.choice.candidates.includes(base)?{type:'choose',player:p,cards:[base]}:undefined);
 assert.equal(findCard(t.s,top)?.zone,'battle');assert.deepEqual(t.s.cards[top].under,[base]);
 const destination=t.stage(p,'combo','BT1-016');
 const ev:GameEvent[]=[];const done=vmHost(ctx,game,t.s,ev).placeUnder(top,destination);
 assert.equal(done,true);assert.equal(findCard(t.s,base)?.zone,'drop');
 assert.equal(energy.filter(id=>t.s.cards[id].mode==='rest').length,5);
 results.push({p,paidPlayAndEvolve:true,attachmentMover:'constructed direct native host.placeUnder, not printed Frost ability',base:findCard(t.s,base),destinationPile:t.s.cards[destination].under,events:ev});
}

for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),top=t.stage(p,'battle','BT1-016'),base=t.stage(p,'under','BT6-063',top),dest=t.stage(p,'combo','BT1-016');
 t.s.cards[t.s.sides[p].zones.leader[0]].cardId='LF';
 const ev:GameEvent[]=[];assert.equal(vmHost(ctx,game,t.s,ev).placeUnder(top,dest),true);assert.equal(t.s.pending.some(x=>x.card===base),false);
 results.push({p,fullBrolyMaterialNoAuto:true});
 const u=setup(p),uTop=u.stage(p,'battle','BT1-016'),uBase=u.stage(p,'under','BT1-016',uTop),uDest=u.stage(p,'combo','BT1-016');u.s.cards[uBase].zCard=true;
 const events:GameEvent[]=[];const h=vmHost(ctx,game,u.s,events),before=JSON.stringify(u.s);assert.throws(()=>h.placeUnder(uTop,uDest),NotYet);assert.equal(JSON.stringify(u.s),before);assert.deepEqual(events,[]);results.push({p,hostPendingNoMutation:true});
 const v=setup(p),vTop=v.stage(p,'battle','BT1-016'),vBase=v.stage(p,'under','BT1-016',vTop),vDest=v.stage(p,'combo','BT1-016');v.stage(p,'hand','SECRET');
 const original=JSON.stringify(v.s),projected=clone(v.s),token=captureUnderRelease(projected,vTop,vDest),move=moveCard(projected,game,vTop,'drop',{under:vDest});assert.ok(move.ok);cleanupUnderRelease(projected,[],token,move.move);assert.equal(JSON.stringify(v.s),original);assert.equal(findCard(projected,vBase)?.zone,'drop');
 for(const viewer of [p,v.q]){const view=JSON.stringify(RULES.boardView(ctx,v.s,viewer,{}));assert.equal(view.includes('underReleaseCapture'),false);assert.equal(view.includes('appliedEffectOwnership'),false);if(viewer===v.q)assert.equal(view.includes('private selected card'),false);}
 results.push({p,cloneAndPrivacy:true});
}
for(const p of ['p1','p2'] as PlayerId[])for(const missing of ['source','host']){
 const t=setup(p),top=t.stage(p,'battle','BT1-016');t.stage(p,'under','BT1-016',top);const dest=t.stage(p,'combo','BT1-016');
 const token=captureUnderRelease(t.s,top,dest),actual=moveCard(t.s,game,top,'drop',{under:dest});assert.ok(actual.ok);
 delete t.s.cards[missing==='source'?top:dest];assert.throws(()=>cleanupUnderRelease(t.s,[],token,actual.move),NotYet);results.push({p,missing});
}
console.log(`under-release-5: ${results.length} cases PASS`);
