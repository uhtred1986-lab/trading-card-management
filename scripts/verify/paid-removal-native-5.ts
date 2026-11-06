import assert from 'node:assert/strict';
import fixture from './fixtures/paid-removal-contract-5.json';
import {card,fifty} from './harness';
import {skillRecords} from '../../src/lib/arena/draft';
import {rulesFromRows,type RuleRow} from '../../src/lib/arena/rules-store';
import {RULES} from '../../src/lib/arena/vm';
import {rulesetFor} from '../../src/lib/arena/rulesets';
import {moveCard,findCard,isTokenCard} from '../../src/lib/arena/vm/zones';
import {vmHost} from '../../src/lib/arena/vm/host';
import {withTokens} from '../../src/lib/arena/vm/cards';
import {attrsNow} from '../../src/lib/arena/vm/program';
import {invokedMainLines,resolveActivation} from '../../src/lib/arena/vm/activate';
import {skillsShowing} from '../../src/lib/arena/vm/triggers';
import {IllegalAction} from '../../src/lib/arena/vm/illegal-action';
import {stepScript} from '../../src/lib/arena/vm/script';
import type {CardDef,EngineContext,PlayerId,Action,GameEvent} from '../../src/lib/arena/types';
import type {VmState} from '../../src/lib/arena/vm/state';
const clone=<T,>(x:T):T=>JSON.parse(JSON.stringify(x));
const source=fixture['BT17-131'];
const defs:Record<string,CardDef>={L:card('L',{type:'LEADER',colors:['Black'],skill:null,power:10000}),F:card('F',{colors:['Black'],skill:null,power:5000}), 'BT17-131':card('BT17-131',{type:'EXTRA',name:source.card.name,colors:['Black'],energyCost:1,skill:source.card.skill})};
const rows=Object.values(defs).flatMap(skillRecords),ctx:EngineContext=withTokens({defs,scripts:rulesFromRows(rows.map((r,id)=>({...r,id,status:r.unread.length?'open':'confirmed',source:'compiler'})as RuleRow),defs)});
const loaded=rulesetFor('dbs');assert.ok(loaded.ok);const game=loaded.definition;const other=(p:PlayerId):PlayerId=>p==='p1'?'p2':'p1';
let cases=0;
function cardsInView(value:unknown,id:string):Record<string,unknown>[] {if(!value||typeof value!=='object')return [];if(Array.isArray(value))return value.flatMap(v=>cardsInView(v,id));const o=value as Record<string,unknown>;return [...(o.id===id?[o]:[]),...Object.values(o).flatMap(v=>cardsInView(v,id))];}
function setup(p:PlayerId){const q=other(p);let s=RULES.createGame(ctx,{seed:514,p1:{name:'One',leader:'L',main:fifty('F'),z:[]},p2:{name:'Two',leader:'L',main:fifty('F'),z:[]}}).state as VmState;const events:GameEvent[]=[];
 const take=(a:Action)=>{const saved=clone(s),before=JSON.stringify(saved);for(const viewer of [p,q]){const view=JSON.stringify(RULES.boardView(ctx,saved,viewer,{}));assert.ok(!view.includes('paidRemoval'));assert.ok(!view.includes('paidCardInfo'));assert.ok(!view.includes('canonicalSource'));if(viewer===q)for(const id of saved.sides[p].zones.hand)assert.ok(cardsInView(JSON.parse(view),id).every(c=>!c.cardId));}const result=RULES.apply(ctx,saved,a);assert.equal(JSON.stringify(saved),before);s=result.state as VmState;events.push(...result.events);assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));};
 for(const a of [{type:'chooseFirst',player:s.chooser,first:p},{type:'mulligan',player:p,redraw:false},{type:'mulligan',player:q,redraw:false},{type:'charge',player:p,card:null}] as Action[])take(a);
 s.sides[p].attrs.energyMarkers=0;s.sides[q].attrs.energyMarkers=0; // explicit resource setup
 const stage=(owner:PlayerId,zone:string,id='F',host?:string)=>{const key=s.sides[owner].zones.deck.at(-1)!;s.cards[key].cardId=id;assert.ok(moveCard(s,game,key,zone,{owner,...(host?{under:host}:{})}).ok);return key;};
 const actions=()=>RULES.legalActions(ctx,s).map(x=>x.action);
 const settle=(pick?:(state:VmState)=>Action|undefined)=>{for(let i=0;i<30&&!['main','combo'].includes(s.prompt.kind);i++){const pr=s.prompt;let a=pick?.(s);if(!a&&pr.kind==='chooseCards')a={type:'choose',player:pr.player,cards:pr.choice.candidates.slice(0,pr.choice.min??0)};if(!a&&pr.kind==='chooseMode')a={type:'chooseMode',player:pr.player,index:pr.options.length-1};if(!a&&pr.kind==='payCost')a={type:'payCost',player:pr.player,option:0};if(!a&&pr.kind==='orderPending')a={type:'orderPending',player:pr.player,index:s.pendingOrder!.candidates[0]};a??=actions().find(x=>x.type==='counter'&&x.card===null);assert.ok(a,JSON.stringify(pr));take(a);}};
 return {get s(){return s;},set s(v:VmState){s=v;},events,take,stage,actions,settle,p,q};
}

for(const p of ['p1','p2'] as PlayerId[])for(const turn of ['own','opponent'])for(const kind of ['token','ordinary','zero'] as const){
 const t=setup(p),maker=t.stage(p,'drop','BT17-131'),energy=t.stage(p,'energy'),extra=t.stage(p,'hand','BT17-131');
 const main=t.actions().find(a=>a.type==='activate'&&a.card===maker&&a.skill===0);assert.ok(main);t.take(main);t.settle(s=>s.prompt.kind==='chooseMode'?{type:'chooseMode',player:s.prompt.player,index:0}:undefined);
 const token=t.s.sides[p].zones.battle.find(id=>isTokenCard(t.s.cards[id].cardId))!;assert.ok(token);assert.equal(findCard(t.s,maker)?.zone,'warp');
 t.take({type:'endMain',player:p});t.take({type:'charge',player:t.q,card:null});
 if(turn==='own'){t.take({type:'endMain',player:t.q});t.take({type:'charge',player:p,card:null});}else t.stage(p,'energy');
 const attacker=turn==='own'?p:t.q,defender=other(attacker);
 t.take({type:'attack',player:attacker,attacker:t.s.sides[attacker].zones.leader[0],target:t.s.sides[defender].zones.leader[0]});t.settle();
 if(turn==='opponent'){t.take({type:'pass',player:t.q});t.settle();}
 const ordinary=t.stage(p,'battle'),payer=kind==='ordinary'?ordinary:token,recipient=kind==='ordinary'?token:ordinary;
 const action=t.actions().find(a=>a.type==='activate'&&a.card===extra&&a.skill===10);assert.ok(action,JSON.stringify(t.s.prompt));
 const hand=t.s.sides[p].zones.hand.length,deck=t.s.sides[p].zones.deck.length,active=t.s.sides[p].zones.energy.filter(id=>t.s.cards[id].mode==='active').length;
 const power=attrsNow(ctx,game,t.s,recipient).power;
 t.take(action);t.settle(s=>s.prompt.kind==='chooseCards'?{type:'choose',player:s.prompt.player,cards:s.programs.some(f=>f.saveVarsAs)?[payer]:kind==='zero'?[]:[recipient]}:undefined);
 assert.equal(findCard(t.s,payer)?.zone,'removed');assert.equal(findCard(t.s,extra)?.zone,'drop');assert.equal(t.s.sides[p].zones.hand.length,hand-1+(kind==='ordinary'?0:1));assert.equal(t.s.sides[p].zones.deck.length,deck-(kind==='ordinary'?0:1));
 assert.equal(t.s.cards[energy].mode,'rest');assert.equal(t.s.sides[p].zones.energy.filter(id=>t.s.cards[id].mode==='active').length,active-1);assert.equal(attrsNow(ctx,game,t.s,recipient).power,Number(power)+(kind==='zero'?0:10000));cases++;
}

function ready(p:PlayerId){
 const t=setup(p),maker=t.stage(p,'drop','BT17-131'),energy=t.stage(p,'energy'),extra=t.stage(p,'hand','BT17-131');
 const a=t.actions().find(a=>a.type==='activate'&&a.card===maker&&a.skill===0);assert.ok(a);t.take(a);t.settle(s=>s.prompt.kind==='chooseMode'?{type:'chooseMode',player:p,index:0}:undefined);
 const token=t.s.sides[p].zones.battle.find(id=>isTokenCard(t.s.cards[id].cardId))!;
 t.take({type:'endMain',player:p});t.take({type:'charge',player:t.q,card:null});t.take({type:'endMain',player:t.q});t.take({type:'charge',player:p,card:null});
 t.take({type:'attack',player:p,attacker:t.s.sides[p].zones.leader[0],target:t.s.sides[t.q].zones.leader[0]});t.settle();
 const recipient=t.stage(p,'battle');
 const begin=()=>{const a=t.actions().find(a=>a.type==='activate'&&a.card===extra&&a.skill===10);assert.ok(a);t.take(a);assert.equal(t.s.prompt.kind,'chooseCards');};
 return {...t,get s(){return t.s;},set s(v:VmState){t.s=v;},extra,energy,token,recipient,begin};
}
for(const p of ['p1','p2'] as PlayerId[])for(const kind of ['sameAccept','sameDecline','away','lateProhibit','protectedOther','granted','negated'] as const){
 const t=ready(p),h=vmHost(ctx,game,t.s,t.events),source=t.s.sides[p].zones.leader[0];
 const apply=(ops:Parameters<typeof stepScript>[1]['ops'])=>stepScript(vmHost(ctx,game,t.s,t.events),{card:source,master:p,ops,ip:0,vars:{payer:[t.token]}});
 if(kind==='sameAccept'||kind==='sameDecline'||kind==='away')apply([{op:'replaceLeave',to:kind==='away'?'warp':'removed',optional:true,target:{var:'payer'},until:'turn'}]);
 if(kind==='protectedOther')apply([{op:'forbid',what:'beMovedBySkill',target:{var:'payer'},until:'turn'}]);
 if(kind==='granted'||kind==='negated'){apply([{op:'grant',keyword:{name:'Barrier'},target:{var:'payer'},until:'turn'}]);if(kind==='negated')h.negateAll(t.token);}
 const active=t.s.sides[p].zones.energy.filter(id=>t.s.cards[id].mode==='active').length;
 t.begin();
 if(kind==='lateProhibit')apply([{op:'forbid',what:'beMovedBySkill',target:{var:'payer'},until:'turn'}]);
 const useOrdinary=kind==='protectedOther'||kind==='granted';
 if(useOrdinary&&t.s.programs.some(f=>f.saveVarsAs)&&kind==='granted'&&t.s.prompt.kind==='chooseCards')assert.ok(!t.s.prompt.choice.candidates.includes(t.token));
 const deck=t.s.sides[p].zones.deck.length;
 t.take({type:'choose',player:p,cards:useOrdinary&&!t.s.programs.some(f=>f.saveVarsAs)?[]:[useOrdinary?t.recipient:t.token]});
 if(['sameAccept','sameDecline','away'].includes(kind)){assert.equal(t.s.prompt.kind,'replaceMove');t.take({type:'chooseMode',player:p,index:kind==='sameDecline'?1:0});}
 t.settle(s=>s.prompt.kind==='chooseCards'?{type:'choose',player:p,cards:[]}:undefined);
 const draw=kind==='sameDecline'||kind==='negated';assert.equal(t.s.sides[p].zones.deck.length,deck-(draw?1:0),kind);assert.equal(t.s.cards[t.energy].mode,'rest');assert.equal(t.s.sides[p].zones.energy.filter(id=>t.s.cards[id].mode==='active').length,active-1);
 const success=draw||useOrdinary;assert.equal(t.events.filter(e=>e.type==='skill'&&e.card===t.extra&&e.skill===10).length,success?1:0);cases++;
}
for(const p of ['p1','p2'] as PlayerId[]){
 const t=ready(p);stepScript(vmHost(ctx,game,t.s,[]),{card:t.s.sides[p].zones.leader[0],master:p,ops:[{op:'replaceLeave',to:'removed',optional:true,target:{var:'payer'},until:'turn'}],ip:0,vars:{payer:[t.token]}});
 t.begin();t.take({type:'choose',player:p,cards:[t.token]});assert.equal(t.s.prompt.kind,'replaceMove');
 const pending=clone(t.s);assert.ok(pending.programs.find(f=>f.saveVarsAs)?.paidRemoval);
 for(const fault of ['missing','sourceEpoch','payerEpoch','payerAttrs','missingBinding','stalePayer'] as const){
  const bad=clone(pending),price=bad.programs.find(f=>f.saveVarsAs)!;
  if(fault==='missing')delete price.paidRemoval;
  if(fault==='sourceEpoch')price.paidRemoval!.capture.source.epoch--;
  if(fault==='payerEpoch')price.paidRemoval!.capture.payer.epoch++;
  if(fault==='payerAttrs')price.paidRemoval!.capture.payer.attributes={...price.paidRemoval!.capture.payer.attributes,power:999};
  if(fault==='missingBinding')delete price.ordinaryActivation;
  if(fault==='stalePayer'){moveCard(bad,game,t.token,'hand',{owner:p});moveCard(bad,game,t.token,'battle',{owner:p});}
  const before=JSON.stringify(bad);if(fault==='missingBinding'){const o=(RULES.apply(ctx,bad,{type:'chooseMode',player:p,index:1}).state as VmState).outcome;assert.equal(o?.kind,'interrupted');assert.equal(o?.privateContext?.issue,'R515');assert.match(o?.privateContext?.detail??'',/rebuild the saved ordinary Activate payment source/);}else assert.throws(()=>RULES.apply(ctx,bad,{type:'chooseMode',player:p,index:1}),e=>e instanceof IllegalAction,fault);assert.equal(JSON.stringify(bad),before);cases++;
 }
 t.take({type:'chooseMode',player:p,index:1});assert.equal(t.s.prompt.kind,'chooseCards');
 const body=clone(t.s),effect=body.programs.find(f=>f.pricedBy)!;assert.ok(effect.paidRemoval?.outcome?.completed);assert.deepEqual(effect.vars.paid_removed,[t.token]);assert.equal(effect.paidCardInfo?.paid_removed[t.token].type,'TOKEN');
 for(const fault of ['missing','sourceEpoch','map','alias','outcome','body','null'] as const){
  const bad=clone(body),f=bad.programs.find(f=>f.pricedBy)!;
  if(fault==='missing')delete f.paidRemoval;if(fault==='sourceEpoch')f.paidRemoval!.capture.source.epoch--;if(fault==='map')delete f.paidCardInfo;if(fault==='alias')f.vars.paid_removed=[t.recipient];if(fault==='outcome')f.paidRemoval!.outcome!.completed=false;if(fault==='body')f.ops=[{op:'draw',n:99}];if(fault==='null')f.paidRemoval=null as never;
  const before=JSON.stringify(bad);assert.throws(()=>RULES.apply(ctx,bad,{type:'choose',player:p,cards:[t.recipient]}),e=>e instanceof IllegalAction,fault);assert.equal(JSON.stringify(bad),before);cases++;
 }
 const a:Action={type:'choose',player:p,cards:[t.recipient]},one=RULES.apply(ctx,clone(body),a),two=RULES.apply(ctx,clone(body),a);assert.deepEqual(one,two);cases++;
 t.s=body;const deck=t.s.sides[p].zones.deck.length;vmHost(ctx,game,t.s,[]).move(t.extra,'warp',p);t.take(a);t.settle();assert.equal(t.s.sides[p].zones.deck.length,deck-1);assert.equal(attrsNow(ctx,game,t.s,t.recipient).power,15000);cases++;
}

// Mechanism-created replacement child pauses independently of the original full-card price.
for(const p of ['p1','p2'] as PlayerId[]){
 const t=ready(p),childPayer=t.stage(p,'hand');
 vmHost(ctx,game,t.s,[]).addEffect({source:t.token,master:p,target:t.token,kind:'replaceLeave',until:'turn',value:{optional:true,ops:[{op:'choose',sel:{side:'you',area:'hand',count:1,upTo:true},as:'child'},{op:'moveTo',target:{var:'child'},to:'warp'}],source:t.token,master:p}});
 const deck=t.s.sides[p].zones.deck.length,active=t.s.sides[p].zones.energy.filter(id=>t.s.cards[id].mode==='active').length;
 t.begin();t.take({type:'choose',player:p,cards:[t.token]});t.take({type:'chooseMode',player:p,index:0});assert.equal(t.s.prompt.kind,'chooseCards');assert.ok(t.s.programs.some(f=>f.replacing===t.token));
 const saved=clone(t.s),reply:Action={type:'choose',player:p,cards:[childPayer]};t.take(reply);t.settle();const done=clone(t.s);
 assert.equal(findCard(t.s,childPayer)?.zone,'warp');assert.equal(findCard(t.s,t.token)?.zone,'battle');assert.equal(t.s.sides[p].zones.deck.length,deck);assert.equal(t.s.sides[p].zones.energy.filter(id=>t.s.cards[id].mode==='active').length,active-1);assert.equal(t.events.filter(e=>e.type==='skill'&&e.card===t.extra&&e.skill===10).length,0);assert.ok(!t.s.programs.some(f=>f.saveVarsAs||f.pricedBy));
 t.s=saved;t.take(reply);t.settle();assert.deepEqual(t.s,done);cases++;
}
for(const p of ['p1','p2'] as PlayerId[]){
 const t=ready(p),source=t.stage(p,'battle'),before=JSON.stringify(t.s);
 const showing=skillsShowing(ctx,t.s,t.extra),skill=showing.skills.find(s=>s.index===10)!;
 const line={card:t.extra,kind:skill.kind,skill,skillIndex:10,script:showing.scripts.bySkill[10]};
 assert.deepEqual(invokedMainLines(ctx,game,t.s,p,t.extra,{op:'invokeSkill',sel:{side:'you',area:'hand',count:1},skillKind:'activate:any',from:'hand'}).filter(l=>l.skillIndex===10),[]);
 assert.throws(()=>resolveActivation(ctx,game,t.s,[],p,line,undefined,undefined,undefined,true,'hand'),e=>e instanceof IllegalAction);assert.equal(JSON.stringify(t.s),before);cases++;
 stepScript(vmHost(ctx,game,t.s,[]),{card:source,master:p,ops:[{op:'copySkills',target:{var:'target'},from:{var:'donor'},skill:10,until:'turn'}],ip:0,vars:{target:[source],donor:[t.extra]}});
 assert.ok(!t.actions().some(a=>a.type==='activate'&&a.card===source));assert.ok(JSON.stringify(RULES.rejectedActions(ctx,t.s,RULES.legalActions(ctx,t.s))).includes('historical removal')||JSON.stringify(RULES.rejectedActions(ctx,t.s,RULES.legalActions(ctx,t.s))).includes('copied ordinary'));assert.equal(t.s.cards[t.energy].mode,'active');cases++;
}

for(const p of ['p1','p2'] as PlayerId[]){
 const t=ready(p);t.begin();t.take({type:'choose',player:p,cards:[t.token]});assert.equal(t.s.prompt.kind,'chooseCards');
 const deck=t.s.sides[p].zones.deck.length;
 // Saved-state mechanism: a removed Token instance is no longer retained by the host.
 for(const side of ['p1','p2'] as PlayerId[])for(const ids of Object.values(t.s.sides[side].zones)){const at=ids.indexOf(t.token);if(at>=0)ids.splice(at,1);}
 delete t.s.cards[t.token];t.take({type:'choose',player:p,cards:[]});t.settle();assert.equal(t.s.sides[p].zones.deck.length,deck-1);cases++;
}
for(const p of ['p1','p2'] as PlayerId[])for(const kind of ['none','grantedOnly']){
 const t=ready(p);moveCard(t.s,game,t.recipient,'removed',{owner:p});
 if(kind==='none')moveCard(t.s,game,t.token,'removed',{owner:p});else stepScript(vmHost(ctx,game,t.s,[]),{card:t.s.sides[p].zones.leader[0],master:p,ops:[{op:'grant',keyword:{name:'Barrier'},target:{var:'t'},until:'turn'}],ip:0,vars:{t:[t.token]}});
 const before=JSON.stringify(t.s);assert.ok(!t.actions().some(a=>a.type==='activate'&&a.card===t.extra&&a.skill===10));assert.equal(JSON.stringify(t.s),before);assert.equal(t.s.cards[t.energy].mode,'active');assert.equal(findCard(t.s,t.extra)?.zone,'hand');cases++;
}
console.log(`paid-removal-native-5: ${cases} native/continuation cases PASS`);
