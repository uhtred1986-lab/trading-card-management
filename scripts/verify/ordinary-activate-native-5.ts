import assert from 'node:assert/strict';
import baseSource from './fixtures/ordinary-activate-cost-5.json';
import additionalSource from './fixtures/ordinary-activate-native-5.json';
const source={...baseSource,...additionalSource};
import {card,fifty} from './harness';
import {skillRecords} from '../../src/lib/arena/draft';
import {rulesFromRows,type RuleRow} from '../../src/lib/arena/rules-store';
import {RULES} from '../../src/lib/arena/vm';
import {rulesetFor} from '../../src/lib/arena/rulesets';
import {moveCard,findCard} from '../../src/lib/arena/vm/zones';
import {vmHost} from '../../src/lib/arena/vm/host';
import {withTokens} from '../../src/lib/arena/vm/cards';
import {stepScript} from '../../src/lib/arena/vm/script';
import type {CardDef,EngineContext,PlayerId,Action,GameEvent} from '../../src/lib/arena/types';
import {requireOrdinaryResourceDeclaration} from '../../src/lib/arena/vm/ordinary-activate-runtime';
import {IllegalAction} from '../../src/lib/arena/vm/illegal-action';
import type {VmState} from '../../src/lib/arena/vm/state';
const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));

const defs:Record<string,CardDef>={L:card('L',{type:'LEADER',colors:['Black'],skill:null,power:10000}),F:card('F',{colors:['Blue'],skill:null,power:5000}),Y:card('Y',{colors:['Yellow'],skill:null,power:5000})};
defs.YM=card('YM',{colors:['Yellow','Blue'],skill:null});
defs.UNISONLAST=card('UNISONLAST',{type:'UNISON',energyCost:null,skill:"[-1][Activate: Main][Limit 1] Choose 1 card in your hand and discard it: Draw 1 card."});
defs.UNISONPAY=card('UNISONPAY',{type:'UNISON',energyCost:null,skill:"[+1][Activate: Main] Choose 1 card in your hand and discard it: Draw 1 card."});
defs.LEADERPAY=card('LEADERPAY',{type:'LEADER',skill:"[Activate: Main][Once per turn] Choose 1 card in your hand and discard it: Draw 1 card.",back:{name:"Back",power:15000,skill:null}});
defs.SAC=card('SAC',{skill:"[Activate: Main][Once per turn] Place this card in its owner's Drop Area: Draw 1 card."});
defs.EXTRA_PAUSE=card('EXTRA_PAUSE',{type:'EXTRA',colors:['Blue'],energyCost:1,power:null,skill:"[Activate: Main][Limit 1] Choose 1 card in your hand and discard it: Choose up to 1 of your Battle Cards and it gets +5000 power for the turn."});
defs.EXTRA=card('EXTRA',{type:'EXTRA',colors:['Blue'],energyCost:1,power:null,skill:"[Activate: Main][Limit 1] Choose 1 card in your hand and discard it: Draw 1 card."});
for(const [id,v] of Object.entries(source)){const c=v.card;defs[id]=card(id,{name:c.name,type:c.type as CardDef["type"],colors:c.colors as CardDef["colors"],energyCost:c.cost===null?null:Number(c.cost),zEnergyCost:c.z===null?null:Number(c.z),characters:c.characters,traits:c.traits,power:c.power,skill:c.skill});}
for(const [id,v] of Object.entries(source))assert.deepEqual(clone(skillRecords(defs[id])),Object.values(v.records));
const rows=Object.values(defs).flatMap(skillRecords),ctx:EngineContext=withTokens({defs,scripts:rulesFromRows(rows.map((r,id)=>({...r,id,status:r.unread.length?'open':'confirmed',source:'compiler'})as RuleRow),defs)});
const loaded=rulesetFor('dbs');assert.ok(loaded.ok);const game=loaded.definition;const other=(p:PlayerId):PlayerId=>p==='p1'?'p2':'p1';const results:unknown[]=[];
function cardsInView(value:unknown,id:string):Record<string,unknown>[] {if(!value||typeof value!=='object')return [];if(Array.isArray(value))return value.flatMap(v=>cardsInView(v,id));const o=value as Record<string,unknown>;return [...(o.id===id?[o]:[]),...Object.values(o).flatMap(v=>cardsInView(v,id))];}
function setup(p:PlayerId){const q=other(p);let s=RULES.createGame(ctx,{seed:514,p1:{name:'One',leader:'L',main:fifty('F'),z:[]},p2:{name:'Two',leader:'L',main:fifty('F'),z:[]}}).state as VmState;const events:GameEvent[]=[];
 const take=(a:Action)=>{const saved=clone(s),before=JSON.stringify(saved);const own=RULES.boardView(ctx,saved,p,{}),opponent=RULES.boardView(ctx,saved,q,{});
 assert.ok(!JSON.stringify(own).includes('ordinaryUseGeneration'));assert.ok(!JSON.stringify(own).includes('ordinaryActivation'));assert.ok(!JSON.stringify(opponent).includes('ordinaryActivation'));assert.ok(!JSON.stringify(opponent).includes('ordinaryUseGeneration'));
 for(const id of saved.sides[p].zones.hand){assert.ok(cardsInView(opponent,id).every(c=>!c.cardId));}const result=RULES.apply(ctx,saved,a);assert.equal(JSON.stringify(saved),before);s=result.state as VmState;assert.ok(!JSON.stringify(result.events).includes('"ordinaryActivation"'));events.push(...result.events);assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));};
 for(const a of [{type:'chooseFirst',player:s.chooser,first:p},{type:'mulligan',player:p,redraw:false},{type:'mulligan',player:q,redraw:false},{type:'charge',player:p,card:null}] as Action[])take(a);
 s.sides[p].attrs.energyMarkers=0;s.sides[q].attrs.energyMarkers=0; // explicit resource setup
 const stage=(owner:PlayerId,zone:string,id='F',host?:string)=>{const key=s.sides[owner].zones.deck.at(-1)!;s.cards[key].cardId=id;assert.ok(moveCard(s,game,key,zone,{owner,...(host?{under:host}:{})}).ok);return key;};
 const actions=()=>RULES.legalActions(ctx,s).map(x=>x.action);
 const settle=(pick?:(state:VmState)=>Action|undefined)=>{for(let i=0;i<30&&!['main','combo'].includes(s.prompt.kind);i++){const pr=s.prompt;let a=pick?.(s);if(!a&&pr.kind==='chooseCards')a={type:'choose',player:pr.player,cards:pr.choice.candidates.slice(0,pr.choice.min??0)};if(!a&&pr.kind==='chooseMode')a={type:'chooseMode',player:pr.player,index:pr.options.length-1};if(!a&&pr.kind==='payCost')a={type:'payCost',player:pr.player,option:0};if(!a&&pr.kind==='orderPending')a={type:'orderPending',player:pr.player,index:s.pendingOrder!.candidates[0]};a??=actions().find(x=>x.type==='counter'&&x.card===null);assert.ok(a,JSON.stringify(pr));take(a);}};
 return {get s(){return s;},set s(v:VmState){s=v;},events,take,stage,actions,settle,p,q};
}
for(const p of ['p1','p2'] as PlayerId[])for(const route of ['sameDrop','away','lateBlock'] as const)for(const accept of route==='lateBlock'?[false]:[false,true]){
 const t=setup(p),one=t.stage(p,'hand','BT18-038'),two=t.stage(p,'hand','BT18-038');const payers=Array.from({length:4},()=>t.stage(p,'hand','BT5-050'));const energies=Array.from({length:4},()=>t.stage(p,'energy'));
 stepScript(vmHost(ctx,game,t.s,[]),{card:t.s.sides[p].zones.leader[0],master:p,ops:[{op:'replaceLeave',to:route==='away'?'warp':'drop',optional:true,until:'turn',target:{var:'payer'}}],ip:0,vars:{payer:[payers[1]]}});
 const ledgerBefore=clone(t.s.sides[p].limitUses??{}),a=t.actions().find(a=>a.type==='activate'&&a.card===one&&a.skill===30);assert.ok(a);t.take(a);
 if(t.s.prompt.kind==='payCost')t.take({type:'payCost',player:p,option:0});assert.equal((t.s as VmState).prompt.kind,'chooseCards');t.take({type:'choose',player:p,cards:[payers[0]]});assert.equal((t.s as VmState).prompt.kind,'chooseCards');t.take({type:'choose',player:p,cards:[payers[1]]});
 assert.equal(t.s.prompt.kind,'replaceMove');if((t.s as VmState).prompt.kind!=='replaceMove')throw Error('replace');
 if(route==='lateBlock')stepScript(vmHost(ctx,game,t.s,[]),{card:t.s.sides[p].zones.leader[0],master:p,ops:[{op:'forbid',what:'beMovedBySkill',fromArea:'hand',target:{var:'payer'},until:'turn'}],ip:0,vars:{payer:[payers[1]]}});
 const saved=clone(t.s),ledgerAtPause=clone(t.s.sides[p].limitUses??{}),reply:Action={type:'chooseMode',player:p,index:accept?0:1};
 const prior=t.events.length;t.take(reply);t.settle();const end=clone(t.s),announcements=t.events.filter(e=>e.type==='skill'&&e.card===one&&e.skill===30).length;
 const offered=t.actions().some(a=>a.type==='activate'&&a.card===two&&a.skill===30);const rejected=RULES.rejectedActions(ctx,t.s,RULES.legalActions(ctx,t.s)).filter(x=>x.action.type==='activate'&&x.action.card===two&&x.action.skill===30);
 const ledgerCleared=clone(t.s);delete ledgerCleared.sides[p].limitUses?.['BT18-038#30'];const offeredAfterOnlyLedgerClear=RULES.legalActions(ctx,ledgerCleared).some(x=>x.action.type==='activate'&&x.action.card===two&&x.action.skill===30);
 t.s=saved;t.events.splice(prior);t.take(reply);t.settle();assert.deepEqual(t.s,end);
 assert.equal(energies.filter(id=>t.s.cards[id].mode==='rest').length,2);assert.equal(findCard(t.s,payers[0])?.zone,'drop');assert.equal(findCard(t.s,payers[1])?.zone,route==='lateBlock'?'hand':route==='away'&&accept?'warp':'drop');const paid=route!=='lateBlock'&&!accept;assert.equal(announcements,paid?1:0);assert.equal(findCard(t.s,one)?.zone,paid?'battle':'hand');assert.deepEqual(ledgerAtPause,{});assert.equal(t.s.sides[p].limitUses?.['BT18-038#30']??0,paid?1:0);assert.equal(offered,!paid);
 if(!paid){
  const again=t.actions().find(a=>a.type==='activate'&&a.card===two&&a.skill===30);assert.ok(again);t.take(again);
  t.settle(state=>state.prompt.kind==='chooseCards'?{type:'choose',player:p,cards:[payers[2],payers[3]].filter(id=>state.prompt.kind==='chooseCards'&&state.prompt.choice.candidates.includes(id)).slice(0,1)}:undefined);
  assert.equal(findCard(t.s,two)?.zone,'battle');assert.equal(t.s.sides[p].limitUses?.['BT18-038#30'],1);assert.equal(t.events.filter(e=>e.type==='skill'&&e.card===two&&e.skill===30).length,1);
 }
 results.push({p,route,accept,options:saved.prompt,priceFrames:saved.programs,events:t.events,ledgerBefore,ledgerAtPause,ledgerAfter:t.s.sides[p].limitUses,sourceUsed:t.s.cards[one].usedThisTurn,announcements,sourceArea:findCard(t.s,one)?.zone,offered,offeredAfterOnlyLedgerClear,rejected,spareExtras:payers.slice(2).map(id=>findCard(t.s,id)),energyModes:energies.map(id=>t.s.cards[id].mode),savedReplayIdentical:true});
}
// Full printed Once and no-usage lines. Resources/positions are explicit setup;
// replacement/prohibition and source-lifetime changes are mechanism interventions.
for(const p of ['p1','p2'] as PlayerId[])for(const id of ['BT17-036','DB3-090'] as const)for(const paid of [false,true]){
 const t=setup(p),one=t.stage(p,'battle',id),payer=t.stage(p,id==='BT17-036'?'battle':'hand',id==='BT17-036'?id:'F');
 if(id==='DB3-090')t.stage(p,'energy','Y');else t.stage(p,'battle','BT17-036');
 stepScript(vmHost(ctx,game,t.s,[]),{card:t.s.sides[p].zones.leader[0],master:p,ops:[{op:'replaceLeave',to:'drop',optional:true,until:'turn',target:{var:'payer'}}],ip:0,vars:{payer:[payer]}});
 const a=t.actions().find(a=>a.type==='activate'&&a.card===one&&a.skill===10);assert.ok(a);t.take(a);
 t.settle(state=>state.prompt.kind==='chooseCards'&&state.prompt.choice.candidates.includes(payer)?{type:'choose',player:p,cards:[payer]}:state.prompt.kind==='replaceMove'?{type:'chooseMode',player:p,index:paid?1:0}:undefined);
 assert.equal(t.events.filter(e=>e.type==='skill'&&e.card===one&&e.skill===10).length,paid?1:0);
 assert.equal(t.s.cards[one].usedThisTurn.includes(10),id==='BT17-036'&&paid);assert.deepEqual(t.s.sides[p].limitUses??{},{});
 if(id==='BT17-036')assert.equal(t.actions().some(a=>a.type==='activate'&&a.card===one&&a.skill===10),!paid);
 results.push({p,id,paid});
}
for(const p of ['p1','p2'] as PlayerId[])for(const route of ["stay","retained","aba","transfer"] as const){
 const t=setup(p),one=t.stage(p,'battle','BT17-036'),payer=t.stage(p,'battle','BT17-036');t.stage(p,'battle','BT17-036');
 const a=t.actions().find(a=>a.type==='activate'&&a.card===one&&a.skill===10);assert.ok(a);t.take(a);assert.equal(t.s.prompt.kind,'chooseCards');
 const h=vmHost(ctx,game,t.s,t.events);
 if(route==='aba'){h.move(one,'hand',p);h.move(one,'battle',p);}
 if(route==='retained'){h.move(one,'combo',p);h.move(one,'battle',p);}
 if(route==='transfer')h.move(one,'battle',t.q);
 t.take({type:'choose',player:p,cards:[payer]});t.settle();
 assert.equal(t.events.filter(e=>e.type==='skill'&&e.card===one&&e.skill===10).length,1);assert.equal(t.s.cards[one].usedThisTurn.includes(10),route!=='aba');
 results.push({p,route,originalOnce:true});
}
// A denied unchosen candidate must never poison payment of the legal choice.
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),one=t.stage(p,'battle','BT17-036'),bad=t.stage(p,'battle','BT17-036'),good=t.stage(p,'battle','BT17-036');
 stepScript(vmHost(ctx,game,t.s,[]),{card:one,master:p,ops:[{op:'forbid',what:'beMovedBySkill',target:{var:'bad'},until:'turn'}],ip:0,vars:{bad:[bad]}});
 const a=t.actions().find(a=>a.type==='activate'&&a.card===one&&a.skill===10);assert.ok(a);t.take(a);t.settle(state=>state.prompt.kind==='chooseCards'&&state.prompt.choice.candidates.includes(good)?{type:'choose',player:p,cards:[good]}:undefined);
 assert.equal(findCard(t.s,good)?.zone,'drop');assert.equal(findCard(t.s,bad)?.zone,'battle');assert.ok(t.s.cards[one].usedThisTurn.includes(10));results.push({p,legalChosen:true});
}
// Actual prepared substitute program (mechanism effect) pauses on its own choice.
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),one=t.stage(p,'hand','BT18-038'),two=t.stage(p,'hand','BT18-038'),payers=Array.from({length:4},()=>t.stage(p,'hand','BT5-050'));
 for(let i=0;i<4;i++)t.stage(p,'energy');
 vmHost(ctx,game,t.s,[]).addEffect({source:payers[1],master:p,target:payers[1],kind:'replaceLeave',until:'turn',value:{optional:true,ops:[{op:'choose',sel:{side:'you',area:'hand',count:1,upTo:true},as:'child'},{op:'moveTo',target:{var:'child'},to:'warp'}],source:payers[1],master:p}});
 const a=t.actions().find(a=>a.type==='activate'&&a.card===one&&a.skill===30);assert.ok(a);t.take(a);if(t.s.prompt.kind==='payCost')t.take({type:'payCost',player:p,option:0});t.take({type:'choose',player:p,cards:[payers[0]]});t.take({type:'choose',player:p,cards:[payers[1]]});t.take({type:'chooseMode',player:p,index:0});
 assert.equal(t.s.prompt.kind,'chooseCards');assert.ok(t.s.programs.some(f=>f.replacing===payers[1]));const saved=clone(t.s),before=t.events.length;
 t.take({type:'choose',player:p,cards:[payers[1]]});t.settle();const end=clone(t.s);assert.equal(findCard(t.s,payers[1])?.zone,'warp');assert.equal(findCard(t.s,payers[0])?.zone,'drop');assert.equal(findCard(t.s,one)?.zone,'hand');assert.equal(t.events.filter(e=>e.type==='skill'&&e.card===one&&e.skill===30).length,0);assert.equal(t.s.sides[p].limitUses?.['BT18-038#30']??0,0);assert.ok(!t.s.programs.some(f=>f.saveVarsAs||f.pricedBy));
 t.s=saved;t.events.splice(before);t.take({type:'choose',player:p,cards:[payers[1]]});t.settle();assert.deepEqual(t.s,end);
 const retry=t.actions().find(a=>a.type==='activate'&&a.card===two&&a.skill===30);assert.ok(retry);t.take(retry);t.settle(state=>state.prompt.kind==='chooseCards'?{type:'choose',player:p,cards:payers.slice(2).filter(id=>state.prompt.kind==='chooseCards'&&state.prompt.choice.candidates.includes(id)).slice(0,1)}:undefined);assert.equal(findCard(t.s,two)?.zone,'battle');results.push({p,preparedSubstitute:true});
}
// Clearly synthetic full mechanism records: source sacrifice and Extra staging.
for(const p of ['p1','p2'] as PlayerId[])for(const id of ['SAC','EXTRA'] as const){
 const t=setup(p),one=t.stage(p,id==='SAC'?'battle':'hand',id);if(id==='EXTRA')t.stage(p,'energy');const hand=t.s.sides[p].zones.hand.length;
 const a=t.actions().find(a=>a.type==='activate'&&a.card===one&&a.skill===0);assert.ok(a);t.take(a);
 if(id==='EXTRA'){assert.equal(findCard(t.s,one)?.zone,'drop');assert.equal(t.s.prompt.kind,'chooseCards');assert.equal(t.s.sides[p].limitUses?.['EXTRA#0']??0,0);}
 t.settle();assert.equal(findCard(t.s,one)?.zone,'drop');assert.equal(t.events.filter(e=>e.type==='skill'&&e.card===one&&e.skill===0).length,1);
 assert.equal(t.s.sides[p].zones.hand.length,hand+(id==='SAC'?1:-1));assert.equal(t.s.cards[one].usedThisTurn.includes(0),false);
 if(id==='EXTRA')assert.equal(t.s.sides[p].limitUses?.['EXTRA#0'],1);
 results.push({p,id,mechanism:true});
}
// Malformed saved pairs refuse before any additional resources or movement.
for(const p of ['p1','p2'] as PlayerId[])for(const fault of ['missing','generation','generationMissing','generationFuture','source','body','nullVars','duplicate','phase','moment'] as const){
 const t=setup(p),one=t.stage(p,'hand','BT18-038');for(let i=0;i<4;i++)t.stage(p,'hand','BT5-050');for(let i=0;i<3;i++)t.stage(p,'energy');
 const a=t.actions().find(a=>a.type==='activate'&&a.card===one&&a.skill===30);assert.ok(a);t.take(a);if(t.s.prompt.kind==='payCost')t.take({type:'payCost',player:p,option:0});
 const saved=clone(t.s),price=saved.programs.find(f=>f.saveVarsAs)!,effect=saved.programs.find(f=>f.pricedBy)!;assert.ok(price.ordinaryActivation);
 if(fault==='missing')delete price.ordinaryActivation;if(fault==='generation')saved.cards[one].ordinaryUseGeneration=-1;if(fault==='generationMissing')delete saved.cards[one].ordinaryUseGeneration;if(fault==='generationFuture')price.ordinaryActivation!.useGeneration=999;if(fault==='source')price.ordinaryActivation!.cost.source.occurrence.cardId='DB3-090';if(fault==='body')effect.ops=[];if(fault==='nullVars')price.vars=null as never;if(fault==='duplicate')saved.programs.push(clone(effect));if(fault==='phase')price.ordinaryActivation!.cost.phase='committed';if(fault==='moment')price.ordinaryActivation!.moment.args.from='warp';
 assert.equal(saved.prompt.kind,'chooseCards');if(saved.prompt.kind!=='chooseCards')throw Error('prompt');const action:Action={type:'choose',player:p,cards:[saved.prompt.choice.candidates[0]]},before=JSON.stringify(saved);
 if(fault==='missing'){const refused=RULES.apply(ctx,saved,action);assert.ok((refused.state as VmState).outcome);}else assert.throws(()=>RULES.apply(ctx,saved,action),e=>e instanceof IllegalAction);
 assert.equal(JSON.stringify(saved),before);results.push({p,fault,savedGuard:true});
}
for(const p of ['p1','p2'] as PlayerId[])for(const id of ['BT31-016','BT10-086'] as const){
 const t=setup(p),one=t.stage(p,'battle',id),before=t.s.sides[p].zones.hand.length;
 const a=t.actions().find(a=>a.type==='activate'&&a.card===one&&a.skill===20);assert.ok(a,`${id} offered`);t.take(a);t.settle();
 assert.equal(t.events.filter(e=>e.type==='skill'&&e.card===one&&e.skill===20).length,1);
 assert.equal(findCard(t.s,one)?.zone,id==='BT31-016'?'battle':'drop');
 if(id==='BT31-016'){assert.equal(t.s.cards[one].mode,'rest');assert.equal(t.s.sides[p].zones.hand.length,before+1);assert.equal(t.s.sides[p].limitUses?.['BT31-016#20'],1);}
 results.push({p,id,actualSelfPrice:true});
}
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),one=t.s.sides[p].zones.leader[0];t.s.cards[one].cardId='LEADERPAY';
 const a=t.actions().find(a=>a.type==='activate'&&a.card===one&&a.skill===0);assert.ok(a);t.take(a);assert.equal(t.s.prompt.kind,'chooseCards');
 vmHost(ctx,game,t.s,t.events).flip(one);assert.equal(t.s.cards[one].flipped,true);t.settle();assert.ok(t.s.cards[one].usedThisTurn.includes(0));results.push({p,leaderFlip:true,mechanism:true});
}
// Full BT10-095 observes the existing skillActivated moment exactly once.
// Synthetic Extra supplies separate saved price/body prompts to inspect timing.
for(const p of ['p1','p2'] as PlayerId[])for(const pay of [false,true]){
 const t=setup(p),one=t.stage(p,'hand','EXTRA_PAUSE'),watch=t.stage(t.q,'unison','BT10-095'),payer=t.stage(p,'hand');t.s.cards[watch].markers=3;t.stage(p,'energy');t.stage(p,'battle');t.stage(p,'battle');
 stepScript(vmHost(ctx,game,t.s,[]),{card:watch,master:t.q,ops:[{op:'replaceLeave',to:'drop',optional:true,until:'turn',target:{var:'payer'}}],ip:0,vars:{payer:[payer]}});
 const a=t.actions().find(a=>a.type==='activate'&&a.card===one&&a.skill===0);assert.ok(a);t.take(a);assert.equal(t.s.pending.filter(x=>x.card===watch).length,0);assert.equal(t.s.cards[watch].markers,3);
 t.take({type:'choose',player:p,cards:[payer]});assert.equal(t.s.pending.filter(x=>x.card===watch).length,0);t.take({type:'chooseMode',player:p,index:pay?1:0});
 if(pay){assert.equal(t.s.prompt.kind,'chooseCards');assert.equal(t.s.pending.filter(x=>x.card===watch).length,1);assert.equal(t.s.cards[watch].markers,3);}else{assert.equal(t.s.pending.filter(x=>x.card===watch).length,0);assert.equal(t.s.cards[watch].markers,3);}
 t.settle();assert.equal(t.s.cards[watch].markers,pay?4:3);results.push({p,pay,activationMoment:true});
}
for(const p of ['p1','p2'] as PlayerId[])for(const pay of [false,true]){
 const t=setup(p),one=t.stage(p,'unison','UNISONPAY'),payer=t.stage(p,'hand');t.s.cards[one].markers=3;
 stepScript(vmHost(ctx,game,t.s,[]),{card:one,master:p,ops:[{op:'replaceLeave',to:'drop',optional:true,until:'turn',target:{var:'payer'}}],ip:0,vars:{payer:[payer]}});
 const a=t.actions().find(a=>a.type==='activate'&&a.card===one&&a.skill===0);assert.ok(a);t.take(a);assert.equal(t.s.cards[one].markers,4);assert.equal(t.s.cards[one].usedMarkerSkill,false);
 t.take({type:'choose',player:p,cards:[payer]});t.take({type:'chooseMode',player:p,index:pay?1:0});t.settle();assert.equal(t.s.cards[one].usedMarkerSkill,pay);assert.equal(t.s.cards[one].markers,4);results.push({p,pay,markerMechanism:true});
}
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),one=t.stage(p,'battle'),donor=t.stage(p,'battle','DB3-090');t.stage(p,'energy','Y');
 stepScript(vmHost(ctx,game,t.s,[]),{card:one,master:p,ops:[{op:'copySkills',target:{var:'target'},from:{var:'donor'},skill:10,until:'turn'}],ip:0,vars:{target:[one],donor:[donor]}});
 assert.ok(!t.actions().some(a=>a.type==='activate'&&a.card===one));const refused=RULES.rejectedActions(ctx,t.s,RULES.legalActions(ctx,t.s)).filter(x=>x.action.type==='activate'&&x.action.card===one);assert.ok(JSON.stringify(refused).includes('copied ordinary Activate'));
 assert.ok(t.s.sides[p].zones.energy.every(id=>t.s.cards[id].mode==='active'));results.push({p,copiedBoundary:true});
}
// Mechanism corruption/competition: usage is consumed while the cost is pending.
// Completion may finish payment, but cannot activate beyond the original ceiling.
for(const p of ['p1','p2'] as PlayerId[])for(const id of ['BT18-038','BT17-036'] as const){
 const t=setup(p),one=t.stage(p,id==='BT18-038'?'hand':'battle',id),skill=id==='BT18-038'?30:10;
 const payers=Array.from({length:3},()=>t.stage(p,id==='BT18-038'?'hand':'battle',id==='BT18-038'?'BT5-050':'BT17-036'));
 if(id==='BT18-038')for(let i=0;i<3;i++)t.stage(p,'energy');
 const a=t.actions().find(a=>a.type==='activate'&&a.card===one&&a.skill===skill);assert.ok(a);t.take(a);if(t.s.prompt.kind==='payCost')t.take({type:'payCost',player:p,option:0});
 if(id==='BT18-038')(t.s.sides[p].limitUses??={})['BT18-038#30']=1;else t.s.cards[one].usedThisTurn.push(10);
 t.settle(state=>state.prompt.kind==='chooseCards'?{type:'choose',player:p,cards:payers.filter(id=>state.prompt.kind==='chooseCards'&&state.prompt.choice.candidates.includes(id)).slice(0,1)}:undefined);
 assert.equal(t.events.filter(e=>e.type==='skill'&&e.card===one&&e.skill===skill).length,0);assert.equal(findCard(t.s,payers[0])?.zone,'drop');
 if(id==='BT18-038'){assert.equal(t.s.sides[p].limitUses?.['BT18-038#30'],1);assert.equal(findCard(t.s,one)?.zone,'hand');}else assert.deepEqual(t.s.cards[one].usedThisTurn,[10]);
 results.push({p,id,completionUsageGuard:true});
}
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),one=t.stage(p,'unison','UNISONPAY');t.s.cards[one].markers=3;
 const a=t.actions().find(a=>a.type==='activate'&&a.card===one&&a.skill===0);assert.ok(a);t.take(a);assert.equal(t.s.prompt.kind,'chooseCards');t.s.cards[one].usedMarkerSkill=true;
 t.settle();assert.equal(t.s.cards[one].markers,4);assert.equal(t.s.cards[one].usedMarkerSkill,true);assert.equal(t.events.filter(e=>e.type==='skill'&&e.card===one&&e.skill===0).length,0);results.push({p,completionMarkerGuard:true});
}
// Resource payment itself can end the source occurrence before its action price.
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),one=t.stage(p,'unison','UNISONLAST');t.s.cards[one].markers=1;const hand=t.s.sides[p].zones.hand.length;
 const a=t.actions().find(a=>a.type==='activate'&&a.card===one&&a.skill===0);assert.ok(a);t.take(a);assert.equal(findCard(t.s,one)?.zone,'drop');assert.equal(t.s.prompt.kind,'chooseCards');
 const price=t.s.programs.find(f=>f.saveVarsAs)!;assert.equal(price.ordinaryActivation?.cost.source.occurrence.area,'unison');assert.equal(price.ordinaryActivation?.useGeneration,0);assert.equal(t.s.cards[one].ordinaryUseGeneration,1);
 t.settle();assert.equal(t.s.sides[p].zones.hand.length,hand);assert.equal(t.s.sides[p].limitUses?.['UNISONLAST#0'],1);assert.equal(t.events.filter(e=>e.type==='skill'&&e.card===one&&e.skill===0).length,1);results.push({p,lastMarkerSource:true});
}
for(const p of ['p1','p2'] as PlayerId[])for(const fault of ['success','aba','missing','identity'] as const){
 const t=setup(p),one=t.stage(p,'battle','DB3-090');t.stage(p,'energy','Y');t.stage(p,'energy','YM');
 const a=t.actions().find(a=>a.type==='activate'&&a.card===one&&a.skill===10);assert.ok(a);t.take(a);assert.equal(t.s.prompt.kind,'payCost');
 const saved=clone(t.s);if(saved.prompt.kind!=='payCost')throw Error('resource prompt');assert.ok(saved.prompt.ordinaryActivation);
 if(fault==='aba'){const h=vmHost(ctx,game,saved,[]);h.move(one,'hand',p);h.move(one,'battle',p);}
 if(fault==='missing')delete saved.prompt.ordinaryActivation;if(fault==='identity')saved.prompt.ordinaryActivation!.cost.source.skill.index=0;
 const reply:Action={type:'payCost',player:p,option:0},before=JSON.stringify(saved);
 if(fault!=='success'){assert.throws(()=>RULES.apply(ctx,saved,reply),e=>e instanceof IllegalAction);assert.equal(JSON.stringify(saved),before);}
 else{t.s=saved;t.take(reply);assert.equal(t.s.ordinaryResourceResume,undefined);t.settle();const end=clone(t.s);t.s=saved;t.take(reply);t.settle();assert.deepEqual(t.s,end);assert.equal(t.events.filter(e=>e.type==='skill'&&e.card===one&&e.skill===10).length,2);}
 results.push({p,fault,resourcePrompt:true});
}
// Direct pooled-resource mechanism guard: ordinary DBS lines bind Z-Energy to0,
// so these prove source validation, not a fabricated printed pooled activation.
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),one=t.stage(p,'battle','DB3-090');t.stage(p,'energy','Y');t.stage(p,'energy','YM');const pool=t.stage(p,'zEnergy');
 const a=t.actions().find(a=>a.type==='activate'&&a.card===one&&a.skill===10);assert.ok(a);t.take(a);const s=clone(t.s);if(s.prompt.kind!=='payCost')throw Error('resource');const saved=s.prompt;
 requireOrdinaryResourceDeclaration(ctx,s,saved.ordinaryActivation,saved.action);results.push({p,poolSourceValidation:true,mechanism:true});
 for(const fault of ['missing','aba'] as const){const bad=clone(s);bad.prompt={kind:'chooseCards',player:p,choice:{reason:'mechanism pool',candidates:[pool],min:1,max:1,continuation:'pooledPayment'},pooledPayment:{action:saved.action,ordinaryActivation:clone(saved.ordinaryActivation),cost:'zEnergy',n:1,source:{card:one,epoch:bad.cards[one].zoneEpoch??0},candidates:[{card:pool,epoch:bad.cards[pool].zoneEpoch??0}]}};
 if(fault==='missing')delete bad.prompt.pooledPayment!.ordinaryActivation;else{const h=vmHost(ctx,game,bad,[]);h.move(one,'hand',p);h.move(one,'battle',p);}
 const before=JSON.stringify(bad);assert.throws(()=>RULES.apply(ctx,bad,{type:'choose',player:p,cards:[pool]}),e=>e instanceof IllegalAction);assert.equal(JSON.stringify(bad),before);results.push({p,fault,poolPromptGuard:true,mechanism:true});}
}
console.log(`ordinary-activate-native-5: ${results.length} native/continuation/mechanism cases PASS`);
