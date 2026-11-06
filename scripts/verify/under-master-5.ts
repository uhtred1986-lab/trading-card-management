import {capturePlacedUnderRelation,placedUnderMaster} from "../../src/lib/arena/vm/placed-under-master";
import type {Moment} from "../../src/lib/arena/vm/events";
/** R520: full printed sources, paid Potara, explicit staged Z materials/control. */
import {vmHost} from '../../src/lib/arena/vm/host';
import {addEffect} from '../../src/lib/arena/vm/effects';
import {NotYet} from '../../src/lib/arena/vm/errors';
import assert from 'node:assert/strict';
import fixture from './fixtures/under-master-5.json';
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
 const take=(a:Action)=>{const saved=clone(s),before=JSON.stringify(saved);for(const viewer of [p,q]){const view=JSON.stringify(RULES.boardView(ctx,saved,viewer,{}));assert.equal(view.includes('placedUnderRelation'),false);if(viewer===q)assert.equal(view.includes('private selected card'),false);}const result=RULES.apply(ctx,saved,a);assert.equal(JSON.stringify(saved),before);s=result.state as VmState;events.push(...result.events);assert.equal(JSON.stringify(result.events).includes("placedUnderRelation"),false);assert.equal(JSON.stringify(s).includes("placedUnderRelation"),false);assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));};
 for(const a of [{type:'chooseFirst',player:s.chooser,first:p},{type:'mulligan',player:p,redraw:false},{type:'mulligan',player:q,redraw:false},{type:'charge',player:p,card:null}] as Action[])take(a);
 s.turn=3; // explicit later-turn staging; action sequence below is native
 s.sides[p].attrs.energyMarkers=0;s.sides[q].attrs.energyMarkers=0; // explicit resource setup
 const stage=(owner:PlayerId,zone:string,id='F',host?:string)=>{const key=s.sides[owner].zones.deck.at(-1)!;s.cards[key].cardId=id;assert.ok(moveCard(s,game,key,zone,{owner,...(host?{under:host}:{})}).ok);return key;};
 const actions=()=>RULES.legalActions(ctx,s).map(x=>x.action);
 const settle=(pick?:(state:VmState)=>Action|undefined)=>{for(let i=0;i<30&&!['main','combo'].includes(s.prompt.kind);i++){const pr=s.prompt;let a=pick?.(s);if(!a&&pr.kind==='chooseCards')a={type:'choose',player:pr.player,cards:pr.choice.candidates.slice(0,pr.choice.min??0)};if(!a&&pr.kind==='chooseMode')a={type:'chooseMode',player:pr.player,index:pr.options.length-1};if(!a&&pr.kind==='payCost')a={type:'payCost',player:pr.player,option:0};if(!a&&pr.kind==='orderPending')a={type:'orderPending',player:pr.player,index:s.pendingOrder!.candidates[0]};a??=actions().find(x=>x.type==='counter'&&x.card===null);assert.ok(a,JSON.stringify(pr));take(a);}};
 return {get s(){return s;},set s(v:VmState){s=v;},events,take,stage,actions,settle,p,q};
}


const results=[];
for(const p of ['p1','p2'] as PlayerId[])for(const foreign of [false,true]){
 const t=setup(p),a=t.stage(foreign?t.q:p,'battle','BT29-140'),b=t.stage(foreign?t.q:p,'battle','BT29-140'),arrival=t.stage(p,'hand','BT2-013');
 if(foreign)for(const id of [a,b])assert.ok(moveCard(t.s,game,id,'battle',{owner:p,carry:true}).ok);
 t.stage(p,'hand','SECRET');
 t.s.cards[a].zCard=true;t.s.cards[b].zCard=true; // staged full Z-Battle materials; no Z-play cost claimed
 const energy=Array.from({length:3},()=>t.stage(p,'energy')),own=t.stage(p,'battle','F'),opponent=t.stage(t.q,'battle','F');
 vmHost(ctx,game,t.s,[]).setHidden(own,true);vmHost(ctx,game,t.s,[]).setHidden(opponent,true);
 const action=t.actions().find(x=>x.type==='activate'&&x.card===arrival);assert.ok(action);t.take(action);
 let sawPending=false,sawTarget=false;
 for(let n=0;n<20&&t.s.prompt.kind!=='main';n++){
  const pr=t.s.prompt;let next:Action|undefined;
  if(pr.kind==='chooseCards'){
   let cards=pr.choice.candidates.slice(0,pr.choice.min??0);
   if(pr.choice.candidates.includes(own)){assert.equal(pr.player,p);assert.equal(pr.choice.candidates.includes(opponent),false);cards=[own];sawTarget=true;}
   next={type:'choose',player:pr.player,cards};
  }else if(pr.kind==='orderPending'){
   assert.equal(pr.player,p);assert.ok(t.s.pending.filter(x=>x.card===a||x.card===b).every(x=>x.master===p));sawPending=true;
   next={type:'orderPending',player:pr.player,index:t.s.pendingOrder!.candidates[0]};
  }else next=t.actions().find(x=>x.type==='counter'&&x.card===null);
  assert.ok(next,JSON.stringify(pr));t.take(next);
 }
 assert.equal(findCard(t.s,arrival)?.zone,'battle');assert.deepEqual(t.s.cards[arrival].under,[a,b]);assert.equal(energy.filter(x=>t.s.cards[x].mode==='rest').length,3);
 assert.equal(sawPending,true);assert.equal(sawTarget,true);assert.equal(!!t.s.cards[own].hidden,false);assert.equal(t.s.cards[opponent].hidden,true);
 const autos=t.events.filter(e=>e.type==='skill'&&(e.card===a||e.card===b));assert.equal(autos.length,1);assert.ok(autos.every(e=>e.type==='skill'&&e.master===p));
 assert.ok(Object.keys(t.s.sides[p].limitUses??{}).some(k=>k.includes('BT29-140')));assert.equal(Object.keys(t.s.sides[t.q].limitUses??{}).some(k=>k.includes('BT29-140')),false);
 results.push({p,foreign,actualPaidPotara:true});
}
for(const p of ['p1','p2'] as PlayerId[])for(const emitter of ['under','onTop'])for(const foreign of [false,true]){
 const t=setup(p),source=t.stage(foreign?t.q:p,'battle','BT29-140');if(foreign)assert.ok(moveCard(t.s,game,source,'battle',{owner:p,carry:true}).ok);t.s.cards[source].zCard=true;
 const dest=t.stage(p,emitter==='under'?'battle':'under','BT2-013',emitter==='onTop'?source:undefined),ev:GameEvent[]=[];
 const h=vmHost(ctx,game,t.s,ev);assert.equal(emitter==='under'?h.placeUnder(source,dest):h.placeOnTop(dest,source),true);
 assert.equal(t.s.pending.filter(x=>x.card===source).length,1);assert.equal(t.s.pending.find(x=>x.card===source)?.master,p);
 assert.equal(JSON.stringify(ev).includes('placedUnderRelation'),false);results.push({p,emitter,foreign});
}
for(const p of ['p1','p2'] as PlayerId[])for(const negation of ['whole','line']){
 const t=setup(p),source=t.stage(t.q,'battle','BT29-140');assert.ok(moveCard(t.s,game,source,'battle',{owner:p,carry:true}).ok);t.s.cards[source].zCard=true;const dest=t.stage(p,'battle','BT2-013');
 addEffect(t.s,[],{source:dest,master:p,target:source,kind:negation==='whole'?'negateSkills':'negateSkill',value:negation==='whole'?1:30,until:'turn'});
 vmHost(ctx,game,t.s,[]).placeUnder(source,dest);assert.equal(t.s.pending.some(x=>x.card===source),false);results.push({p,negation});
}
for(const p of ['p1','p2'] as PlayerId[])for(const ownTurn of [true,false]){
 const t=setup(p),source=t.stage(t.q,'battle','BT29-140');assert.ok(moveCard(t.s,game,source,'battle',{owner:p,carry:true}).ok);t.s.cards[source].zCard=true;const dest=t.stage(p,'battle','BT2-013');t.s.turnPlayer=ownTurn?p:t.q;
 const narrow:typeof game={...game,triggers:{...game.triggers,placedUnder:{...game.triggers.placedUnder,where:{kind:'isTurnPlayer',who:'you'}}}};
 vmHost(ctx,narrow,t.s,[]).placeUnder(source,dest);assert.equal(t.s.pending.some(x=>x.card===source),ownTurn);results.push({p,ownTurn,constructedDeclarationWhere:true});
}
for(const p of ['p1','p2'] as PlayerId[])for(const fault of ['missing','epoch','face','holder','duplicate','wrongAlias']){
 const t=setup(p),source=t.stage(p,'battle','BT29-140'),dest=t.stage(p,'battle','BT2-013');t.s.cards[source].zCard=true;vmHost(ctx,game,t.s,[]).placeUnder(source,dest);
 const relation=capturePlacedUnderRelation(game,t.s,source,dest),moment:Moment={event:'placedUnder',card:source,controller:p,args:{from:'battle',to:'under'},placedUnderRelation:relation};
 assert.equal(placedUnderMaster(game,t.s,moment,'unrelated','placedUnder'),undefined);
 if(fault==='missing')delete moment.placedUnderRelation;
 if(fault==='epoch')t.s.cards[source].zoneEpoch=(t.s.cards[source].zoneEpoch??0)+1;
 if(fault==='face')t.s.cards[dest].flipped=!t.s.cards[dest].flipped;
 if(fault==='holder'){t.s.sides[p].zones.battle=t.s.sides[p].zones.battle.filter(x=>x!==dest);t.s.sides[t.q].zones.battle.push(dest);}
 if(fault==='duplicate')t.s.cards[dest].under.push(source);
 if(fault==='wrongAlias')assert.equal(placedUnderMaster(game,t.s,moment,source,'placedUnderFromHand'),undefined);else assert.throws(()=>placedUnderMaster(game,t.s,moment,source,'placedUnder'),NotYet);
 results.push({p,fault});
}
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),source=t.stage(p,'combo','BT29-140'),dest=t.stage(t.q,'combo','BT2-013');assert.ok(moveCard(t.s,game,dest,'combo',{owner:p,carry:true}).ok);t.s.cards[source].zCard=true;
 assert.equal(vmHost(ctx,game,t.s,[]).placeUnder(source,dest),true);assert.equal(capturePlacedUnderRelation(game,t.s,source,dest).master,p);assert.equal(t.s.pending.find(x=>x.card===source)?.master,p);results.push({p,foreignOwnedComboHost:true});
}
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),source=t.stage(p,'battle','BT29-140'),dest=t.stage(p,'battle','BT2-013');t.s.cards[source].zCard=true;
 const events:GameEvent[]=[],h=vmHost(ctx,game,t.s,events);t.s.cards[dest].under.push(source);const before=JSON.stringify(t.s);
 assert.throws(()=>h.placeUnder(source,dest),NotYet);assert.equal(JSON.stringify(t.s),before);assert.deepEqual(events,[]);results.push({p,nativeDuplicateRefusal:true});
}
for(const p of ['p1','p2'] as PlayerId[])for(const invalid of ['self','piledSelf','missing']){
 const t=setup(p),source=t.stage(p,'battle','BT29-140');if(invalid==='piledSelf')t.stage(p,'under','F',source);const events:GameEvent[]=[],h=vmHost(ctx,game,t.s,events),before=JSON.stringify(t.s);let completed:boolean|undefined;
 assert.equal(h.placeUnder(source,invalid==='missing'?'missing':source,undefined,result=>{completed=result.completed;}),false);assert.equal(completed,false);assert.equal(JSON.stringify(t.s),before);assert.deepEqual(events,[]);results.push({p,invalid});
}
console.log(`under-master-5: ${results.length} cases PASS`);
