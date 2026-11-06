import {moved} from '../../src/lib/arena/vm/flow';
import {attrsNow} from '../../src/lib/arena/vm/program';
import {projectEnergyEntryCleanup} from '../../src/lib/arena/vm/energy-entry-runtime';
/** R514: complete original sources, native activation/payment, explicitly staged setup. */
import {capturePileRelease,requirePileReleaseCapture,cleanupReleasedPile} from '../../src/lib/arena/vm/pile-release-cleanup';
import type {ScriptFrame} from '../../src/lib/arena/vm/script';
import {cleanupScriptPlacement} from '../../src/lib/arena/vm/script-placement-cleanup';
import {vmHost} from '../../src/lib/arena/vm/host';
import {addEffect} from '../../src/lib/arena/vm/effects';
import {freshAppliedEffectRoot,recordAppliedEffect,captureAppliedEffectMove} from '../../src/lib/arena/vm/applied-effect-receipt';
import {NotYet} from '../../src/lib/arena/vm/errors';
import assert from 'node:assert/strict';
import fixture from './fixtures/pile-release-5.json';
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
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),base=t.stage(p,'hand','BT1-016'),top=t.stage(p,'hand','BT1-016');
 const energy=Array.from({length:6},()=>t.stage(p,'energy'));
 const play=t.actions().find(a=>a.type==='play'&&a.card===base);assert.ok(play);t.take(play);t.settle();
 assert.equal(findCard(t.s,base)?.zone,'battle');
 const evolve=t.actions().find(a=>a.type==='activate'&&a.card===top);assert.ok(evolve);t.take(evolve);
 t.settle(state=>state.prompt.kind==='chooseCards'&&state.prompt.choice.candidates.includes(base)?{type:'choose',player:p,cards:[base]}:undefined);
 assert.equal(findCard(t.s,top)?.zone,'battle');assert.deepEqual(t.s.cards[top].under,[base]);
 const attack=t.actions().find(a=>a.type==='attack'&&a.attacker===t.s.sides[p].zones.leader[0]);assert.ok(attack);t.take(attack);t.settle();
 const combo=t.actions().find(a=>a.type==='combo'&&a.card===top);assert.ok(combo);const before=t.events.length;t.take(combo);
 assert.equal(findCard(t.s,base)?.zone,'drop');assert.deepEqual(t.s.cards[top].under,[]);assert.equal(energy.filter(id=>t.s.cards[id].mode==='rest').length,5);
 results.push({p,source:'full BT1-016 normal paid play + paid Evolve; later-turn/resources staged; absent frozen combo fields use explicit harness 0/5000',paidEnergy:energy.filter(id=>t.s.cards[id].mode==='rest').length,top:findCard(t.s,top),base:findCard(t.s,base),pile:t.s.cards[top].under,events:t.events.slice(before),outcome:t.s.outcome});
}


// Constructed primitive/helper cases: staged effects and identities are NOT printed card routes.
for(const p of ['p1','p2'] as PlayerId[])for(const route of ['battleCombo','comboBattle','unisonBattle','control','zExit','materialZ','leaderExit','hostDrop'] as const){
 const t=setup(p),top=t.stage(p,route==='comboBattle'?'combo':route==='unisonBattle'?'unison':'battle','BT1-016');
 const base=t.stage(p,'under','BT1-016',top),otherCard=t.stage(p,'battle','F');
 if(route==='zExit')t.s.cards[top].zCard=true;
 if(route==='materialZ')t.s.cards[base].zCard=true;
 if(route==='leaderExit'){
  const leader=t.s.sides[p].zones.leader[0];assert.ok(moveCard(t.s,game,leader,'drop',{under:top}).ok);
  assert.ok(moveCard(t.s,game,top,'leader',{owner:p}).ok);
  // Correct cross-area release removed the earlier material; attach it to the staged Leader pile now.
  assert.ok(moveCard(t.s,game,base,'drop',{under:top}).ok);
  assert.ok(moveCard(t.s,game,leader,'drop',{under:top}).ok);
  t.s.cards[top].zCard=true;t.s.cards[top].leaderBase={card:leader,epoch:t.s.cards[leader].zoneEpoch??0};t.s.cards[top].leaderStackVersion=1;
 }
 const events:GameEvent[]=[];
 const root:ScriptFrame=freshAppliedEffectRoot(t.s,{card:otherCard,master:p,skillIndex:0,ops:[],ip:0,vars:{}},'activate');
 const effect=recordAppliedEffect(t.s,root,base,()=>addEffect(t.s,events,{source:otherCard,master:p,target:base,kind:'power',value:5000,until:'turn'}))!;
 const sourceEffect=addEffect(t.s,events,{source:base,master:p,target:otherCard,kind:'power',value:1000,until:'whileSourceInPlay'});
 const unrelated=addEffect(t.s,events,{source:otherCard,master:p,target:otherCard,kind:'power',value:2000,until:'turn'});
 const retainedBefore=JSON.stringify({effects:t.s.effects,ownership:t.s.appliedEffectOwnership});
 const capture=capturePileRelease(t.s,top,{carry:route==='control'});requirePileReleaseCapture(t.s,capture);
 const moved=moveCard(t.s,game,top,route==='battleCombo'?'combo':route==='comboBattle'||route==='unisonBattle'||route==='control'?'battle':'drop',{owner:route==='control'?t.q:p,...(route==='control'?{carry:true}:{})});assert.ok(moved.ok,JSON.stringify({route,moved}));
 const before=events.length, released=cleanupReleasedPile(t.s,events,capture,moved.move);
 const keeps=route==='control'||route==='leaderExit';
 if(route==='control')assert.equal(JSON.stringify({effects:t.s.effects,ownership:t.s.appliedEffectOwnership}),retainedBefore);
 assert.equal(released.length,keeps?0:1);assert.equal(t.s.effects.some(e=>e.id===effect.id),keeps);
 assert.equal(t.s.effects.some(e=>e.id===unrelated.id),true);
 assert.equal(t.s.effects.some(e=>e.id===sourceEffect.id),keeps||route==='comboBattle'||route==='unisonBattle');
 if(!keeps){assert.equal(t.s.appliedEffectOwnership?.[effect.id],undefined);assert.doesNotThrow(()=>captureAppliedEffectMove(t.s,base,root.appliedEffects));}
 assert.ok(events.slice(before).every(e=>e.type!=='move'&&e.type!=='skill'));assert.equal(t.s.pending.length,0);
 assert.throws(()=>cleanupReleasedPile(t.s,events,capture,moved.move),NotYet);
 results.push({p,route,constructed:true});
}
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),top=t.stage(p,'battle','BT1-016'),base=t.stage(p,'under','BT1-016',top);
 t.stage(p,'hand','SECRET');
 const token=capturePileRelease(t.s,top),original=JSON.stringify(t.s),projected=clone(t.s);
 const publicView=JSON.stringify(RULES.boardView(ctx,t.s,t.q,{}));assert.equal(publicView.includes('private selected card'),false);assert.equal(publicView.includes('appliedEffectOwnership'),false);assert.equal(publicView.includes('pileReleaseCapture'),false);
 assert.throws(()=>requirePileReleaseCapture(projected,token),NotYet);
 const fresh=capturePileRelease(projected,top),moved=moveCard(projected,game,top,'combo',{owner:p});assert.ok(moved.ok);
 const events:GameEvent[]=[];const broken=clone(moved.move);broken.released!.push(clone(broken.released![0]));
 const before=JSON.stringify(projected);assert.throws(()=>cleanupReleasedPile(projected,events,fresh,broken),NotYet);assert.equal(JSON.stringify(projected),before);assert.deepEqual(events,[]);
 cleanupReleasedPile(projected,events,fresh,moved.move);assert.equal(JSON.stringify(t.s),original);
 t.s.cards[base].zoneEpoch=(t.s.cards[base].zoneEpoch??0)+1;assert.throws(()=>requirePileReleaseCapture(t.s,token),NotYet);
 results.push({p,cloneIsolation:true,staleAndDuplicate:true});
}
// Full Broly departure Auto: top pends once, released under material does not.
for(const p of ['p1','p2'] as PlayerId[])for(const to of ['combo','drop'] as const)for(const writer of ['host','flow'] as const){
 const t=setup(p);t.s.cards[t.s.sides[p].zones.leader[0]].cardId='LF';
 const top=t.stage(p,'battle','BT6-063'),base=t.stage(p,'under','BT6-063',top),otherCard=t.stage(p,'battle','F');
 const events:GameEvent[]=[];
 const frame:ScriptFrame=freshAppliedEffectRoot(t.s,{card:otherCard,master:p,skillIndex:0,ops:[],ip:0,vars:{}},'activate');
 const effect=recordAppliedEffect(t.s,frame,base,()=>addEffect(t.s,events,{source:otherCard,master:p,target:base,kind:'power',value:5000,until:'turn'}))!;
 const duration=addEffect(t.s,events,{source:base,master:p,target:otherCard,kind:'power',value:1000,until:'whileSourceInPlay'});
 if(writer==='host')vmHost(ctx,game,t.s,events).move(top,to,p,{reason:'effect',actor:p,source:otherCard});
 else moved(ctx,game,t.s,events,top,to,{owner:p,reason:'effect',actor:p,by:'skill',byCard:otherCard});
 assert.equal(findCard(t.s,base)?.zone,'drop');assert.equal(t.s.effects.some(e=>e.id===effect.id||e.id===duration.id),false);
 assert.equal(t.s.appliedEffectOwnership?.[effect.id],undefined);assert.doesNotThrow(()=>captureAppliedEffectMove(t.s,base,frame.appliedEffects));
 const moves=events.filter(e=>e.type==='move');assert.deepEqual(moves.map(e=>e.type==='move'?e.card:null),[base,top]);
 assert.equal(t.s.pending.filter(pending=>pending.card===base).length,0);assert.equal(t.s.pending.filter(pending=>pending.card===top&&pending.skillIndex===10).length,1);
 results.push({p,to,constructedWriter:writer,fullBrolyAuto:true});
}
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),top=t.stage(p,'battle','BT1-016'),base=t.stage(t.q,'under','BT1-016',top);
 const frame:ScriptFrame=freshAppliedEffectRoot(t.s,{card:top,master:p,skillIndex:0,ops:[],ip:0,vars:{}},'activate');
 recordAppliedEffect(t.s,frame,base,()=>addEffect(t.s,[],{source:top,master:p,target:base,kind:'power',value:5000,until:'turn'}));
 const projected=clone(t.s),capture=capturePileRelease(projected,top),moved=moveCard(projected,game,top,'drop',{owner:p});assert.ok(moved.ok);
 const projectedEvents:GameEvent[]=[];cleanupScriptPlacement(projected,projectedEvents,moved.move,'battle',false);cleanupReleasedPile(projected,projectedEvents,capture,moved.move);
 const liveEvents:GameEvent[]=[];vmHost(ctx,game,t.s,liveEvents).move(top,'drop',p);
 assert.equal(findCard(t.s,base)?.owner,t.q);assert.equal(findCard(t.s,base)?.zone,'drop');
 assert.deepEqual(t.s.cards,projected.cards);assert.deepEqual(t.s.effects,projected.effects);assert.deepEqual(t.s.appliedEffectOwnership,projected.appliedEffectOwnership);
 assert.equal(liveEvents.filter(e=>e.type==='move'&&e.card===base&&e.owner===t.q).length,1);
 results.push({p,foreignMaterial:true,projectedEqualsLive:true});
}
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),top=t.stage(p,'battle','BT1-016'),base=t.stage(t.q,'under','BT1-016',top);
 const frame:ScriptFrame=freshAppliedEffectRoot(t.s,{card:top,master:p,skillIndex:0,ops:[],ip:0,vars:{}},'activate');
 const effect=recordAppliedEffect(t.s,frame,base,()=>addEffect(t.s,[],{source:top,master:p,target:base,kind:'power',value:5000,until:'turn'}))!;
 const before=JSON.stringify(t.s),projected=projectEnergyEntryCleanup(ctx,game,t.s,top,p,'active');
 assert.equal(JSON.stringify(t.s),before);assert.equal(findCard(projected,base)?.zone,'drop');assert.equal(findCard(projected,base)?.owner,t.q);
 assert.equal(projected.effects.some(e=>e.id===effect.id),false);assert.equal(projected.appliedEffectOwnership?.[effect.id],undefined);
 assert.doesNotThrow(()=>captureAppliedEffectMove(projected,base,frame.appliedEffects));
 results.push({p,energyClone:true});
}
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),top=t.stage(p,'battle','BT1-016'),base=t.stage(p,'under','BT1-016',top),events:GameEvent[]=[];
 assert.throws(()=>moved(ctx,game,t.s,events,top,'combo',{owner:p,movementAuto:{also:{event:'koed',card:top,controller:p,args:{}},beforeMutation:()=>{t.s.cards[base].zoneEpoch=(t.s.cards[base].zoneEpoch??0)+1;}}}),NotYet);
 assert.equal(findCard(t.s,top)?.zone,'battle');assert.deepEqual(t.s.cards[top].under,[base]);assert.equal(events.some(e=>e.type==='move'),false);
 results.push({p,callbackInvalidatesCapture:true});
}
// Constructed generic Combo-to-Drop watcher exposes battle.ts's private projected subject.
// The native battle/combo/end sequence is real; the pile and resolved effects are staged mechanisms.
for(const p of ['p1','p2'] as PlayerId[]){
 const c=clone(ctx);c.defs.L.skill='[Auto] When a card in your Combo Area is placed in your Drop Area, draw 1 card.';
 const compiled=rulesFromRows([c.defs.L].flatMap(skillRecords).map((r,id)=>({...r,id,status:'draft',source:'compiler'}) as RuleRow),c.defs);
 c.scripts!.L=compiled.L;
 c.scripts!.L.bySkill[0].ops=[{op:'choose',sel:{area:'combo',side:'you',count:1},as:'target'},{op:'draw',n:1}];
 const t=setup(p,c),top=t.stage(p,'hand','BT1-016'),spare=t.stage(p,'hand','F');
 const attack=t.actions().find(a=>a.type==='attack'&&a.attacker===t.s.sides[p].zones.leader[0]);assert.ok(attack);t.take(attack);t.settle();
 const combo=t.actions().find(a=>a.type==='combo'&&a.card===top);assert.ok(combo);t.take(combo);t.settle();
 const extra=t.actions().find(a=>a.type==='combo'&&a.card===spare);assert.ok(extra);t.take(extra);t.settle();
 const base=t.stage(p,'under','BT1-016',top),frame:ScriptFrame=freshAppliedEffectRoot(t.s,{card:top,master:p,skillIndex:0,ops:[],ip:0,vars:{}},'activate');
 const effect=recordAppliedEffect(t.s,frame,base,()=>addEffect(t.s,[],{source:top,master:p,target:base,kind:'power',value:5000,until:'turn'}))!;
 addEffect(t.s,[],{source:top,master:p,target:top,kind:'power',value:7000,until:'game'});
 assert.equal(attrsNow(c,game,t.s,top).power,22000);
 t.take({type:'pass',player:p});
 for(let i=0;i<60&&t.s.prompt.kind!=='chooseCards';i++){
  const action=t.actions().find(a=>a.type==='counter'&&a.card===null||a.type==='pass'||a.type==='block'&&a.card===null||a.type==='payCost'||a.type==='zEnergyFromCombo'&&a.card===null||a.type==='orderPending');assert.ok(action,JSON.stringify(t.s.prompt));t.take(action);
 }
 assert.equal(t.s.prompt.kind,'chooseCards');assert.equal(t.s.battle?.endCombo?.stage,'preDropCheckpoint');
 const projected=t.s.programs.find(f=>f.subject===top&&f.subjectInfo);assert.ok(projected);assert.equal(projected.subjectInfo!.power,15000);
 assert.deepEqual(t.s.cards[top].under,[base]);assert.equal(findCard(t.s,base),null);assert.ok(t.s.effects.some(e=>e.id===effect.id));assert.ok(t.s.appliedEffectOwnership?.[effect.id]);
 assert.equal(t.events.some(e=>e.type==='move'&&e.card===base&&e.to==='drop'),false);
 results.push({p,nativeComboSubjectProjection:true,constructedPile:true});
}
// Pending destination ruling: refuse the affected native route before any live write.
for(const p of ['p1','p2'] as PlayerId[])for(const from of ['battle','combo'])for(const writer of ['host','flow']){
 const t=setup(p),top=t.stage(p,from,'BT1-016'),base=t.stage(p,'under','BT1-016',top),source=t.stage(p,'battle','F');
 t.s.cards[base].zCard=true; // constructed Z-material identity, not a printed Frost property
 const events:GameEvent[]=[];
 const h=writer==='host'?vmHost(ctx,game,t.s,events):undefined;
 const before=JSON.stringify(t.s),to=from==='battle'?'combo':'battle';
 assert.throws(()=>h?h.move(top,to,p,{reason:'effect',actor:p,source}):moved(ctx,game,t.s,events,top,to,{owner:p,reason:'effect',actor:p,by:'skill',byCard:source}),NotYet);
 assert.equal(JSON.stringify(t.s),before);assert.deepEqual(events,[]);
 assert.equal(findCard(t.s,top)?.zone,from);assert.equal(findCard(t.s,base),null);assert.deepEqual(t.s.cards[top].under,[base]);
 results.push({p,from,writer,pendingZMaterialDestination:true});
}
console.log(`pile-release-5: ${results.length} cases PASS (2 native paid routes; 42 constructed helper/writer controls)`);
