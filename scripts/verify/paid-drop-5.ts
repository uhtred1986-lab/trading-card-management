import {captureOrdinaryActivation} from '../../src/lib/arena/vm/ordinary-activate-runtime';
import {invokedMainLines,resolveActivation} from '../../src/lib/arena/vm/activate';
import {skillsShowing} from '../../src/lib/arena/vm/triggers';
import {IllegalAction} from '../../src/lib/arena/vm/illegal-action';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
import type {VmState} from '../../src/lib/arena/vm/state';
const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const source=JSON.parse(fs.readFileSync(new URL('./fixtures/paid-drop-5.json',import.meta.url),'utf8')) as Record<string,{card:{name:string;type:CardDef['type'];colors:CardDef['colors'];cost:string|null;z:string|null;characters:string[];traits:string[];power:number|null;skill:string|null}}>;
const defs:Record<string,CardDef>={L:card('L',{type:'LEADER',colors:['Black'],skill:null,power:10000}),F:card('F',{colors:['Blue'],skill:null,power:5000})};
for(const [id,v] of Object.entries(source)){const c=v.card;defs[id]=card(id,{name:c.name,type:c.type,colors:c.colors,energyCost:c.cost===null?null:Number(c.cost),zEnergyCost:c.z===null?null:Number(c.z),characters:c.characters,traits:c.traits,power:c.power,skill:c.skill});}
defs.U=card('U',{type:'UNISON',energyCost:1,traits:['Red Ribbon Army'],characters:['General Blue'],skill:null});
defs.E=card('E',{type:'EXTRA',energyCost:1,traits:['Red Ribbon Army'],characters:['General Blue'],skill:'[Field]'});
defs.R=card('R',{colors:['Red'],skill:null,power:5000});
defs.B=card('B',{colors:['Black'],skill:null,power:5000});
const rows=Object.values(defs).flatMap(skillRecords),ctx:EngineContext=withTokens({defs,scripts:rulesFromRows(rows.map((r,id)=>({...r,id,status:r.unread.length?'open':'confirmed',source:'compiler'})as RuleRow),defs)});
const loaded=rulesetFor('dbs');assert.ok(loaded.ok);const game=loaded.definition;const other=(p:PlayerId):PlayerId=>p==='p1'?'p2':'p1';const results:unknown[]=[];let savedControls=0;
function setup(p:PlayerId,zCards:string[]=[]){const q=other(p);let s=RULES.createGame(ctx,{seed:514,p1:{name:'One',leader:'L',main:fifty('F'),z:zCards},p2:{name:'Two',leader:'L',main:fifty('F'),z:zCards}}).state as VmState;const events:GameEvent[]=[];
 const take=(a:Action)=>{const saved=clone(s),before=JSON.stringify(saved);RULES.boardView(ctx,saved,p,{});RULES.boardView(ctx,saved,q,{});const result=RULES.apply(ctx,saved,a);assert.equal(JSON.stringify(saved),before);s=result.state as VmState;events.push(...result.events);assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));};
 for(const a of [{type:'chooseFirst',player:s.chooser,first:p},{type:'mulligan',player:p,redraw:false},{type:'mulligan',player:q,redraw:false},{type:'charge',player:p,card:null}] as Action[])take(a);
 s.sides[p].attrs.energyMarkers=0;s.sides[q].attrs.energyMarkers=0; // explicit resource setup
 const stage=(owner:PlayerId,zone:string,id='F',host?:string)=>{const key=s.sides[owner].zones.deck.at(-1)!;s.cards[key].cardId=id;assert.ok(moveCard(s,game,key,zone,{owner,...(host?{under:host}:{})}).ok);return key;};
 const actions=()=>RULES.legalActions(ctx,s).map(x=>x.action);
 const settle=(pick?:(state:VmState)=>Action|undefined)=>{for(let i=0;i<30&&!['main','combo'].includes(s.prompt.kind);i++){const pr=s.prompt;let a=pick?.(s);if(!a&&pr.kind==='chooseCards')a={type:'choose',player:pr.player,cards:pr.choice.candidates.slice(0,pr.choice.min??0)};if(!a&&pr.kind==='chooseMode')a={type:'chooseMode',player:pr.player,index:pr.options.length-1};if(!a&&pr.kind==='payCost')a={type:'payCost',player:pr.player,option:0};if(!a&&pr.kind==='orderPending')a={type:'orderPending',player:pr.player,index:s.pendingOrder!.candidates[0]};a??=actions().find(x=>x.type==='counter'&&x.card===null);assert.ok(a,JSON.stringify(pr));take(a);}};
 return {get s(){return s;},set s(v:VmState){s=v;},events,take,stage,actions,settle,p,q};
}

const prefixCtx=ctx; // Full stored Tao record, including its paid-history tail.
for(const p of ['p1','p2'] as PlayerId[])for(const route of ['blue39','blue40','violet','foreignBlue','sameDrop','declineSameDrop','protected','unison','field'] as const){
 const t=setup(p),tao=t.stage(p,'hand','BT17-035');let payer:string;
 if(route==='foreignBlue'){
  t.take({type:'endMain',player:p});t.take({type:'charge',player:t.q,card:null});payer=t.stage(t.q,'hand','BT17-040');t.stage(t.q,'energy');
  const play=t.actions().find(a=>a.type==='play'&&a.card===payer);assert.ok(play);t.take(play);t.settle();
  t.take({type:'endMain',player:t.q});t.take({type:'charge',player:p,card:null});
  const towa=t.stage(p,'hand','BT4-111');for(let i=0;i<4;i++)t.stage(p,'energy','B');
  const steal=t.actions().find(a=>a.type==='play'&&a.card===towa);assert.ok(steal);t.take(steal);t.settle(s=>s.prompt.kind==='chooseCards'?{type:'choose',player:p,cards:[payer]}:undefined);
  assert.equal(findCard(t.s,payer)?.owner,p);assert.equal(t.s.cards[payer].owner,t.q);
 }else if(route==='unison'||route==='field'){
  // Synthetic non-Battle payer definitions exercise the printed any-card payment, not additional product cards.
  payer=t.stage(p,route==='unison'?'unison':'battle',route==='unison'?'U':'E');if(route==='unison')t.s.cards[payer].markers=2;
 }else{
  payer=t.stage(p,'hand',route==='blue39'?'BT17-039':route==='violet'?'BT17-042':'BT17-040');t.stage(p,'energy');t.stage(p,'energy');
  const play=t.actions().find(a=>a.type==='play'&&a.card===payer);assert.ok(play);t.take(play);t.settle();
 }
 assert.ok(t.actions().some(a=>a.type==='activate'&&a.card===tao));
 if(route==='sameDrop'||route==='declineSameDrop')stepScript(vmHost(ctx,game,t.s,[]),{card:t.s.sides[p].zones.leader[0],master:p,ops:[{op:'replaceLeave',to:'drop',optional:true,until:'turn',target:{var:'payer'}}],ip:0,vars:{payer:[payer]}});
 let s=clone(t.s);const events:GameEvent[]=[];const apply=(a:Action)=>{const saved=clone(s),before=JSON.stringify(saved),r=RULES.apply(prefixCtx,saved,a);assert.equal(JSON.stringify(saved),before);assert.deepEqual(RULES.apply(prefixCtx,clone(saved),a),r);for(const viewer of [p,t.q]){const view=JSON.stringify(RULES.boardView(prefixCtx,saved,viewer,{}));assert.ok(!view.includes('paid_own_drop'));assert.ok(!view.includes('paidDrop'));}s=r.state as VmState;events.push(...r.events);assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));};
 if(route==='protected'){const spare=t.stage(p,'battle','BT17-042');s=clone(t.s);assert.ok(spare);}
 const a=RULES.legalActions(prefixCtx,s).map(x=>x.action).find(a=>a.type==='activate'&&a.card===tao);assert.ok(a);apply(a);
 if(route==='protected')stepScript(vmHost(ctx,game,s,[]),{card:s.sides[p].zones.leader[0],master:p,ops:[{op:'forbid',what:'beMovedBySkill',target:{var:'payer'},until:'turn'}],ip:0,vars:{payer:[payer]}});
 const windows:unknown[]=[];
 for(let i=0;i<40&&s.prompt.kind!=='main';i++){
  const pr=s.prompt;windows.push({kind:pr.kind,tao:findCard(s,tao),epoch:s.cards[tao].zoneEpoch,scope:clone(s.skillPlayScopes??[]),paid:clone(s.programs.find(f=>f.card===tao&&f.pricedBy)?.paidCardInfo??null)});
  if(pr.kind==='replaceMove'){const price=s.programs.find(f=>f.card===tao&&f.saveVarsAs);assert.ok(price?.paidDrop?.capture);assert.equal(price.paidDrop.capture.payer.card,payer);assert.equal(price.paidDrop.outcome,undefined);
   for(const fault of ['missing','capture','source','epoch','alias'] as const){
    const bad=clone(s),f=bad.programs.find(x=>x.card===tao&&x.saveVarsAs)!;
    if(fault==='missing')delete f.paidDrop;if(fault==='capture')f.paidDrop!.capture=null as never;
    if(fault==='source')f.paidDrop!.capture.declaration+='tampered';if(fault==='epoch')f.paidDrop!.capture.payer.epoch++;
    if(fault==='alias')f.vars.c0=[];
    const before=JSON.stringify(bad);assert.throws(()=>RULES.apply(ctx,bad,{type:'chooseMode',player:pr.player,index:pr.options.length-1}),e=>e instanceof IllegalAction&&e.message.includes('R518'));assert.equal(JSON.stringify(bad),before);savedControls++;
   }
  }
  let answer:Action|undefined=pr.kind==='chooseCards'?{type:'choose',player:pr.player,cards:pr.choice.candidates.includes(payer)?[payer]:pr.choice.candidates.slice(0,pr.choice.min??0)}:pr.kind==='replaceMove'?{type:'chooseMode',player:pr.player,index:route==='declineSameDrop'?pr.options.length-1:0}:undefined;
  answer??=RULES.legalActions(prefixCtx,s).map(x=>x.action).find(a=>a.type==='counter'&&a.card===null);assert.ok(answer,JSON.stringify(pr));apply(answer);
 }
 const failed=route==='sameDrop'||route==='protected';assert.equal(s.sides[p].limitUses?.['BT17-035#0']??0,failed?0:1);assert.equal(findCard(s,tao)?.zone,failed?'hand':'battle');assert.equal(findCard(s,payer)?.zone,route==='protected'?'battle':'drop');if(route==='foreignBlue')assert.equal(findCard(s,payer)?.owner,t.q);
 assert.equal(vmHost(ctx,game,s,[]).cardInfo(tao).power,failed||route==='foreignBlue'||route==='violet'?10000:15000);
 results.push({p,route,payerWasActualPaidNormalPlay:true,foreignControl:route==='foreignBlue'?'actual paid Towa play and full played Auto':null,fullTaoStored:true,payerFinal:findCard(s,payer),taoFinal:findCard(s,tao),limit:s.sides[p].limitUses??{},windows,announcements:events.filter(e=>e.type==='skill'&&e.card===tao)});
}
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p,['BT22-004']),tao=t.stage(p,'hand','BT17-035');for(let i=0;i<2;i++){t.stage(p,'energy','R');t.stage(p,'zEnergy');}
 const gamma=t.s.sides[p].zones.zDeck.find(id=>t.s.cards[id].cardId==='BT22-004')!;assert.ok(gamma);
 const a=t.actions().find(a=>a.type==='playZ'&&a.card===gamma);assert.ok(a);t.take(a);t.settle();assert.equal(findCard(t.s,gamma)?.zone,'battle');assert.equal(t.s.cards[gamma].zCard,true);assert.equal(t.s.sides[p].zones.zEnergy.length,0);assert.equal(t.s.sides[p].zones.energy.filter(id=>t.s.cards[id].mode==='rest').length,2);
 const offered=RULES.legalActions(ctx,t.s).map(x=>x.action).find(x=>x.type==='activate'&&x.card===tao);assert.equal(offered,undefined);assert.equal(findCard(t.s,gamma)?.zone,'battle');
 results.push({p,actualPaidZGamma:true,unpayableOriginalDropNotOffered:true});
}
// Full source Counter control; ABA/departure perturbations are labeled mechanism cases.
for(const p of ['p1','p2'] as PlayerId[])for(const route of ['pass','counterSameHand','handABA','departWarp','paidBlueLeavesDrop'] as const){
 const t=setup(p),payer=t.stage(p,'battle','BT17-040'),tao=t.stage(p,'hand','BT17-035'),counter=t.stage(t.q,'hand','BT17-055');t.stage(t.q,'energy');t.stage(t.q,'energy');
 let s=clone(t.s);const originalEpoch=s.cards[tao].zoneEpoch,events:GameEvent[]=[];
 const apply=(a:Action)=>{const old=JSON.stringify(s),r=RULES.apply(prefixCtx,s,a);assert.equal(JSON.stringify(s),old);s=r.state as VmState;events.push(...r.events);assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));};
 const start=RULES.legalActions(prefixCtx,s).map(x=>x.action).find(a=>a.type==='activate'&&a.card===tao);assert.ok(start);apply(start);
 let changed=false,countered=false,resumeChecked=false;const windows:unknown[]=[];
 for(let i=0;i<30&&s.prompt.kind!=='main';i++){
  const actions=RULES.legalActions(prefixCtx,s).map(x=>x.action);windows.push({prompt:s.prompt.kind,area:findCard(s,tao),epoch:s.cards[tao].zoneEpoch,scopes:clone(s.skillPlayScopes??[])});
  if(!changed&&actions.some(a=>a.type==='counter')){changed=true;if(route==='paidBlueLeavesDrop'){assert.equal(findCard(s,payer)?.zone,'drop');moveCard(s,game,payer,'warp',{owner:p});}if(route==='handABA'||route==='departWarp'){moveCard(s,game,tao,'warp',{owner:p});if(route==='handABA')moveCard(s,game,tao,'hand',{owner:p});}}
  if(route==='pass'&&!resumeChecked&&actions.some(a=>a.type==='counter')){
   resumeChecked=true;
   for(const removeSource of [false,true]){
    const bad=clone(s);let removed=0;
    const strip=(v:unknown):void=>{if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(strip);return;}const o=v as Record<string,unknown>;if('paidDrop' in o){delete o.paidDrop;if(removeSource)delete o.ordinaryActivation;removed++;}Object.values(o).forEach(strip);};strip(bad);assert.ok(removed>0);
    const reply=actions.find(a=>a.type==='counter'&&a.card===null)!;const before=JSON.stringify(bad);if(removeSource){const rejected=RULES.apply(ctx,bad,reply);assert.equal(rejected.state.outcome?.kind,'interrupted');assert.equal(rejected.state.outcome?.privateContext?.issue,'R515');assert.match(rejected.state.outcome?.privateContext?.detail??'',/rebuild the saved ordinary Activate payment source/);assert.equal(findCard(rejected.state as VmState,tao)?.zone,'hand');assert.equal((rejected.state as VmState).cards[tao].zoneEpoch,originalEpoch);}else assert.throws(()=>RULES.apply(ctx,bad,reply),e=>e instanceof IllegalAction&&e.message.includes('R518'));assert.equal(JSON.stringify(bad),before);savedControls++;
   }
  }
  let a=route==='counterSameHand'&&!countered?actions.find(a=>a.type==='counter'&&a.card===counter):undefined;if(a)countered=true;
  a??=actions.find(a=>a.type==='counter'&&a.card===null);if(!a&&s.prompt.kind==='chooseCards')a={type:'choose',player:p,cards:[payer]};assert.ok(a);apply(a);
 }
 const final=findCard(s,tao);assert.equal(final?.zone,route==='counterSameHand'||route==='handABA'?'hand':route==='departWarp'?'warp':'battle');assert.equal(s.sides[p].limitUses?.['BT17-035#0'],1);
 assert.equal(vmHost(ctx,game,s,[]).cardInfo(tao).power,route==='pass'||route==='counterSameHand'||route==='paidBlueLeavesDrop'?15000:10000);
 results.push({p,route,fullStoredSource:true,originalEpoch,finalEpoch:s.cards[tao].zoneEpoch,final,countered,windows,diagnostic:route==='handABA'?'saved-window mechanism ABA does not play or boost the fresh occurrence':null});
}
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),tao=t.stage(p,'hand','BT17-035');t.stage(p,'battle','BT17-040');
 const showing=skillsShowing(ctx,t.s,tao),skill=showing.skills.find(s=>s.index===0)!;
 const line={card:tao,kind:skill.kind,skill,skillIndex:0,script:showing.scripts.bySkill[0]},before=JSON.stringify(t.s);
 assert.deepEqual(invokedMainLines(ctx,game,t.s,p,tao,{op:'invokeSkill',sel:{side:'you',area:'hand',count:1},skillKind:'activate:any',from:'hand'}),[]);
 assert.throws(()=>resolveActivation(ctx,game,t.s,[],p,line,undefined,undefined,undefined,true,'hand'),e=>e instanceof IllegalAction&&e.message.includes('R518'));assert.equal(JSON.stringify(t.s),before);savedControls++;
 const recipient=t.stage(p,'hand');stepScript(vmHost(ctx,game,t.s,[]),{card:t.s.sides[p].zones.leader[0],master:p,ops:[{op:'copySkills',target:{var:'target'},from:{var:'donor'},skill:0,until:'turn'}],ip:0,vars:{target:[recipient],donor:[tao]}});
 const copied=skillsShowing(ctx,t.s,recipient),copy=copied.skills.find(s=>s.kind==='activate:main')!;const unchanged=JSON.stringify(t.s);assert.throws(()=>captureOrdinaryActivation(ctx,game,t.s,p,{card:recipient,kind:copy.kind,skill:copy,skillIndex:copy.index,script:copied.scripts.bySkill[copy.index]}),e=>e instanceof IllegalAction);assert.equal(JSON.stringify(t.s),unchanged);savedControls++;
}
// Mechanism replacement program: its own saved choice completes, original payment does not.
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p),tao=t.stage(p,'hand','BT17-035'),payer=t.stage(p,'battle','BT17-040'),child=t.stage(p,'hand');
 vmHost(ctx,game,t.s,[]).addEffect({source:payer,master:p,target:payer,kind:'replaceLeave',until:'turn',value:{optional:true,ops:[{op:'choose',sel:{side:'you',area:'hand',count:1,upTo:true},as:'child'},{op:'moveTo',target:{var:'child'},to:'warp'}],source:payer,master:p}});
 t.take(t.actions().find(a=>a.type==='activate'&&a.card===tao)!);
 if(t.s.prompt.kind==='chooseCards')t.take({type:'choose',player:p,cards:[payer]});
 assert.equal(t.s.prompt.kind,'replaceMove');t.take({type:'chooseMode',player:p,index:0});assert.equal(t.s.prompt.kind,'chooseCards');
 const saved=clone(t.s),reply:Action={type:'choose',player:p,cards:[child]};t.take(reply);t.settle();const done=clone(t.s);
 assert.equal(findCard(t.s,child)?.zone,'warp');assert.equal(findCard(t.s,payer)?.zone,'battle');assert.equal(findCard(t.s,tao)?.zone,'hand');assert.equal(t.s.sides[p].limitUses?.['BT17-035#0']??0,0);assert.ok(!t.s.programs.some(f=>f.pricedBy||f.saveVarsAs));
 t.s=saved;t.take(reply);t.settle();assert.deepEqual(t.s,done);results.push({p,replacementChild:true});
}
console.log(`paid-drop-5: ${results.length} native and source-occurrence cases + ${savedControls} saved-boundary controls PASS`);
