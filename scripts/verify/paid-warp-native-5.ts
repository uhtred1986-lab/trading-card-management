import type {VmPending} from '../../src/lib/arena/vm/triggers';
import {NotYet} from '../../src/lib/arena/vm/errors';
import {IllegalAction} from '../../src/lib/arena/vm/illegal-action';
import {paidWarpPrice,paidWarpBody} from '../../src/lib/arena/vm/paid-warp-contract';
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
const source=JSON.parse(fs.readFileSync(new URL('./fixtures/paid-warp-count-5.json',import.meta.url),'utf8')) as Record<string,{card:{name:string;type:CardDef['type'];colors:CardDef['colors'];cost:string|null;z:string|null;characters:string[];traits:string[];power:number|null;skill:string|null}}>;
const defs:Record<string,CardDef>={L:card('L',{type:'LEADER',colors:['Black'],skill:null,power:10000}),F:card('F',{colors:['Green'],skill:null,power:5000})};
for(const [id,v] of Object.entries(source)){const c=v.card;defs[id]=card(id,{name:c.name,type:c.type,colors:c.colors,energyCost:c.cost===null?null:Number(c.cost),zEnergyCost:c.z===null?null:Number(c.z),characters:c.characters,traits:c.traits,power:c.power,skill:c.skill});}
// Official P-764 image confirms one Green specified orb; frozen raw catalog stays null.
defs['P-764'].specifiedCost={Green:1};
defs.W=card('W',{colors:['Green'],skill:'[Auto] When one of your Battle Cards attacks, draw 1 card.'});
defs.TAX=card('TAX',{skill:"[Permanent] Your opponent can't activate skills unless they send 1 card from their hand to their Warp each time."});
defs.B=card('B',{colors:['Blue'],skill:null,power:5000});
const rows=Object.values(defs).flatMap(skillRecords);const original=rows.find(r=>r.cardId==='P-764'&&r.skillIndex===20)!;assert.deepEqual(original.unread,[]);assert.deepEqual(original.ops,paidWarpBody());assert.deepEqual(original.cost?.program,paidWarpPrice().ops);
const ctx:EngineContext=withTokens({defs,scripts:rulesFromRows(rows.map((r,id)=>({...r,id,status:r.unread.length?'open':'confirmed',source:'compiler'})as RuleRow),defs)});
const loaded=rulesetFor('dbs');assert.ok(loaded.ok);const game=loaded.definition;const other=(p:PlayerId):PlayerId=>p==='p1'?'p2':'p1';const results:unknown[]=[];let savedControls=0;
function setup(p:PlayerId,zCards:string[]=[]){const q=other(p);let s=RULES.createGame(ctx,{seed:514,p1:{name:'One',leader:'L',main:fifty('F'),z:zCards},p2:{name:'Two',leader:'L',main:fifty('F'),z:zCards}}).state as VmState;const events:GameEvent[]=[];
 const take=(a:Action)=>{const saved=clone(s),before=JSON.stringify(saved);for(const viewer of [p,q]){const view=JSON.stringify(RULES.boardView(ctx,saved,viewer,{}));assert.ok(!view.includes('paidWarp')&&!view.includes('warp_payers')&&!view.includes('paid_warp'));}const result=RULES.apply(ctx,saved,a);assert.equal(JSON.stringify(saved),before);s=result.state as VmState;events.push(...result.events);assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));};
 for(const a of [{type:'chooseFirst',player:s.chooser,first:p},{type:'mulligan',player:p,redraw:false},{type:'mulligan',player:q,redraw:false},{type:'charge',player:p,card:null}] as Action[])take(a);
 s.sides[p].attrs.energyMarkers=0;s.sides[q].attrs.energyMarkers=0; // explicit resource setup
 const stage=(owner:PlayerId,zone:string,id='F',host?:string)=>{const key=s.sides[owner].zones.deck.at(-1)!;s.cards[key].cardId=id;assert.ok(moveCard(s,game,key,zone,{owner,...(host?{under:host}:{})}).ok);return key;};
 const actions=()=>RULES.legalActions(ctx,s).map(x=>x.action);
 const settle=(pick?:(state:VmState)=>Action|undefined)=>{for(let i=0;i<30&&!['main','combo'].includes(s.prompt.kind);i++){const pr=s.prompt;let a=pick?.(s);if(!a&&pr.kind==='chooseCards')a={type:'choose',player:pr.player,cards:pr.choice.candidates.slice(0,pr.choice.min??0)};if(!a&&pr.kind==='chooseMode')a={type:'chooseMode',player:pr.player,index:pr.options.length-1};if(!a&&pr.kind==='payCost')a={type:'payCost',player:pr.player,option:0};if(!a&&pr.kind==='orderPending')a={type:'orderPending',player:pr.player,index:s.pendingOrder!.candidates[0]};a??=actions().find(x=>x.type==='counter'&&x.card===null);assert.ok(a,JSON.stringify(pr));take(a);}};
 return {get s(){return s;},set s(v:VmState){s=v;},events,take,stage,actions,settle,p,q};
}


for(const p of ['p1','p2'] as PlayerId[])for(const route of ['three','four','five','zeroSearch','replaceAccept','replaceDecline','burstCompletesMinimum','sourceBeforePay','sourceDuringPay','payerLeaves','noSearch','child','away','negatedBurst','lateProhibit'] as const){const n=route==='five'?5:route==='four'?4:3;
 const t=setup(p,['P-764']);t.take({type:'endMain',player:p});t.take({type:'charge',player:t.q,card:null});t.take({type:'endMain',player:t.q});t.take({type:'charge',player:p,card:null});for(let i=0;i<6;i++)t.stage(p,'energy');t.stage(p,'zEnergy');
 const payers=(route==='burstCompletesMinimum'?['DB3-060','BT15-087']:route==='five'?['DB3-060','BT15-087','BT24-071','BT20-062','DB2-084']:['DB3-060','BT15-087','BT24-071','BT20-062']).map(id=>t.stage(p,'drop',id));
 const search=t.stage(p,'drop',route==='noSearch'?'BT15-087':n===5?'BT26-083':n===4?'BT20-062':'BT24-071');
 const z=t.s.sides[p].zones.zDeck[0];t.take(t.actions().find(a=>a.type==='playZ'&&a.card===z)!);t.settle();assert.equal(findCard(t.s,z)?.zone,'battle');assert.equal(t.s.sides[p].zones.energy.filter(id=>t.s.cards[id].mode==='rest').length,6);
 if(route.startsWith('replace')||route==='away'||route==='lateProhibit')stepScript(vmHost(ctx,game,t.s,[]),{card:t.s.sides[p].zones.leader[0],master:p,ops:[{op:'replaceLeave',target:{var:'payer'},to:route==='away'?'hand':'warp',optional:true,until:'turn'}],ip:0,vars:{payer:[payers[2]]}});
 if(route==='negatedBurst')stepScript(vmHost(ctx,game,t.s,[]),{card:t.s.sides[p].zones.leader[0],master:p,ops:[{op:'negate',target:{var:'source'},what:'kind',kind:'keyword',until:'turn'}],ip:0,vars:{source:[z]}});
 const childPayer=route==='child'?t.stage(p,'hand'):undefined;if(route==='child')vmHost(ctx,game,t.s,[]).addEffect({source:payers[2],master:p,target:payers[2],kind:'replaceLeave',until:'turn',value:{optional:true,ops:[{op:'choose',sel:{side:'you',area:'hand',count:1,upTo:true},as:'child'},{op:'moveTo',target:{var:'child'},to:'warp'}],source:payers[2],master:p}});
 const before=t.s.sides[p].zones.deck.length;t.take(t.actions().find(a=>a.type==='attack'&&a.attacker===z)!);
 let paid=0,sourceLeft=false,payerLeft=false;const checked=new Set<string>();const trace:unknown[]=[];
 for(let i=0;i<40&&!['combo','main'].includes(t.s.prompt.kind);i++){
  const pr=t.s.prompt;if(route==='payerLeaves'&&!payerLeft&&pr.kind==='chooseCards'&&pr.choice.continuation==='recovered'){vmHost(ctx,game,t.s,[]).move(payers[0],'hand',p);payerLeft=true;}if(!sourceLeft&&(route==='sourceBeforePay'&&pr.kind==='chooseMode'||route==='sourceDuringPay'&&pr.kind==='chooseCards'&&paid===1)){vmHost(ctx,game,t.s,[]).move(z,'removed',p);sourceLeft=true;}trace.push({kind:pr.kind,frame:clone(t.s.programs.find(f=>f.card===z&&f.autoCost)??null)});
  let a:Action|undefined;
  if(route==='three'&&!checked.has(pr.kind==='chooseCards'?pr.choice.continuation:pr.kind)){
   checked.add(pr.kind==='chooseCards'?pr.choice.continuation:pr.kind);
   const original=t.s.programs.find(f=>f.card===z&&f.paidWarp);assert.ok(original);
   const faultNames=pr.kind==='chooseMode'?['missing','source','binding','waived','arrivalResume','arrivalBatchResume','retainedResume']:pr.kind==='chooseCards'&&pr.choice.continuation==='recovered'?['missing','outcomes','alias','source']:['missing','binding'];
   for(const fault of faultNames){
    const bad=clone(t.s),frame=bad.programs.find(f=>f.card===z&&f.paidWarp)!;
    if(fault==='missing')delete frame.paidWarp;if(fault==='source')frame.paidWarp!.source.epoch--;if(fault==='binding')frame.paidWarp!.binding+='tampered';if(fault==='outcomes')delete frame.movementResults!.warp_payers;if(fault==='alias')frame.vars.paid_warp=[];
    const reply:Action=pr.kind==='chooseMode'?{type:'chooseMode',player:p,index:0}:{type:'choose',player:p,cards:pr.kind==='chooseCards'&&pr.choice.continuation==='recovered'?[search]:[payers[0]]};
    if(fault==='waived'){frame.ops=clone(frame.paidWarp!.source.script.ops);delete frame.autoCost;}
    if(['arrivalResume','arrivalBatchResume','retainedResume'].includes(fault)){const inner=clone(frame);delete inner.paidWarp;delete frame.paidWarp;delete frame.autoCost;frame.ops=[];(frame as unknown as Record<string,unknown>)[fault]={frame:inner,cards:[],kind:'play',options:{}};}
    const before=JSON.stringify(bad);assert.throws(()=>RULES.apply(ctx,bad,reply),e=>e instanceof IllegalAction&&e.message.includes('R522'));assert.equal(JSON.stringify(bad),before);savedControls++;
   }
  }

  if(pr.kind==='replaceMove'){if(route==='replaceDecline'){for(const selection of [null,{}, {selected:null}, {selected:[null]}]){const malformed=clone(t.s),f=malformed.programs.find(f=>f.paidWarp)!;f.paidWarp!.selection=selection as never;const before=JSON.stringify(malformed);assert.throws(()=>RULES.apply(ctx,malformed,{type:'chooseMode',player:p,index:pr.options.length-1}),e=>e instanceof IllegalAction&&e.message.includes('R522'));assert.equal(JSON.stringify(malformed),before);savedControls++;}const bad=clone(t.s);stepScript(vmHost(ctx,game,bad,[]),{card:bad.sides[p].zones.leader[0],master:p,ops:[{op:'modifyAttr',target:{var:'payer'},attr:'alsoNames',values:['Shared additional name'],until:'turn'}],ip:0,vars:{payer:[payers[2]]}});const before=JSON.stringify(bad),out=RULES.apply(ctx,bad,{type:'chooseMode',player:p,index:pr.options.length-1});assert.equal(JSON.stringify(bad),before);assert.equal(out.state.outcome?.kind,'interrupted');assert.equal(out.state.outcome?.privateContext?.issue,'R522');assert.equal((out.state as VmState).sides[p].zones.warp.length,2);assert.equal((out.state as VmState).sides[p].zones.deck.length,bad.sides[p].zones.deck.length);savedControls++;}if(route==='lateProhibit')stepScript(vmHost(ctx,game,t.s,[]),{card:t.s.sides[p].zones.leader[0],master:p,ops:[{op:'forbid',what:'beMovedBySkill',fromArea:'drop',target:{var:'payer'},until:'turn'}],ip:0,vars:{payer:[payers[2]]}});a={type:'chooseMode',player:pr.player,index:route==='replaceDecline'||route==='lateProhibit'?pr.options.length-1:0};}
  if(pr.kind==='chooseMode')a={type:'chooseMode',player:pr.player,index:0};
  if(pr.kind==='chooseCards'&&pr.choice.continuation==='recovered'){assert.deepEqual(pr.choice.candidates,[search]);a={type:'choose',player:p,cards:route==='zeroSearch'?[]:[search]};}
  else if(pr.kind==='chooseCards'&&pr.choice.continuation==='child'){a={type:'choose',player:p,cards:[childPayer!]};const replay=RULES.apply(ctx,clone(t.s),a);const replay2=RULES.apply(ctx,clone(t.s),a);assert.deepEqual(replay,replay2);}
  else if(pr.kind==='chooseCards'){const id=payers.find(x=>pr.choice.candidates.includes(x)&&findCard(t.s,x)?.zone==='drop')??(route==='burstCompletesMinimum'?pr.choice.candidates.find(x=>t.s.cards[x].cardId==='F'):undefined);a={type:'choose',player:pr.player,cards:paid<n&&id?[id]:[]};if(a.cards.length)paid++;}
  a??=t.actions().find(a=>a.type==='counter'&&a.card===null);assert.ok(a,JSON.stringify(pr));if(route==='lateProhibit'&&pr.kind==='replaceMove'){const saved=clone(t.s),before=JSON.stringify(saved);assert.throws(()=>RULES.apply(ctx,saved,a!),e=>e instanceof IllegalAction&&e.message.includes('cost cannot be paid in its entirety'));assert.equal(JSON.stringify(saved),before);break;}t.take(a);
 }
 const failed=['replaceAccept','away','child','lateProhibit'].includes(route);assert.equal(t.events.filter(e=>e.type==='skill'&&e.card===z&&e.skill===20).length,failed?0:1);assert.equal(t.s.sides[p].zones.warp.length,route==='away'||route==='payerLeaves'||route==='lateProhibit'?n-1:n,JSON.stringify({route,payerLeft,trace:trace.map(x=>(x as {kind:string}).kind)}));if(route==='child'){assert.equal(findCard(t.s,payers[2])?.zone,'drop');assert.equal(findCard(t.s,childPayer!)?.zone,'warp');}if(route!=='lateProhibit')assert.ok(!t.s.programs.some(f=>f.autoCost&&f.card===z));assert.equal(t.s.sides[p].zones.deck.length,before-(route==='negatedBurst'?0:1));assert.equal(findCard(t.s,search)?.zone,failed||route==='zeroSearch'||route==='noSearch'?'drop':'hand');
 results.push({p,n,route,trace,actualCompiledFullSource:true});
}
// A staged printed watcher holds both Autos at the native ordering checkpoint.
for(const p of ['p1','p2'] as PlayerId[])for(const route of ['missing','departed','negated','control','tax','aliasDrop','aliasTop'] as const){
 const t=setup(p,['P-764']);t.take({type:'endMain',player:p});t.take({type:'charge',player:t.q,card:null});t.take({type:'endMain',player:t.q});t.take({type:'charge',player:p,card:null});
 for(let i=0;i<6;i++)t.stage(p,'energy');t.stage(p,'zEnergy');for(const id of ['DB3-060','BT15-087','BT24-071'])t.stage(p,'drop',id);t.stage(p,'battle','W');
 const z=t.s.sides[p].zones.zDeck[0];t.take(t.actions().find(a=>a.type==='playZ'&&a.card===z)!);t.settle();t.take(t.actions().find(a=>a.type==='attack'&&a.attacker===z)!);assert.equal(t.s.prompt.kind,'orderPending');
 const index=t.s.pendingOrder!.candidates.find(i=>t.s.pending[i].card===z)!;assert.notEqual(index,undefined);const pending=t.s.pending[index] as VmPending;assert.ok(pending.paidWarpSource);const beforeDeck=t.s.sides[p].zones.deck.length,beforeDrop=t.s.sides[p].zones.drop.length;
 if(route==='missing'){delete pending.paidWarpSource;delete (t.s.pendingOrder!.queue[index] as typeof pending).paidWarpSource;}
 if(route==='aliasDrop')t.stage(p,'drop','P-422');if(route==='aliasTop')t.s.cards[t.s.sides[p].zones.deck[0]].cardId='P-422';
 if(route==='tax')t.stage(t.q,'battle','TAX');
 if(route==='departed')vmHost(ctx,game,t.s,[]).move(z,'removed',p);
 if(route==='negated')stepScript(vmHost(ctx,game,t.s,[]),{card:t.s.sides[p].zones.leader[0],master:p,ops:[{op:'negate',target:{var:'source'},what:'kind',kind:'auto',until:'turn'}],ip:0,vars:{source:[z]}});
 if(route==='control')stepScript(vmHost(ctx,game,t.s,[]),{card:t.s.sides[p].zones.leader[0],master:p,ops:[{op:'control',target:{var:'source'},to:'opponent',until:'turn'}],ip:0,vars:{source:[z]}});
 const saved=clone(t.s),reply:Action={type:'orderPending',player:p,index};
 if(route==='missing'){const before=JSON.stringify(saved);assert.throws(()=>RULES.apply(ctx,saved,reply),e=>e instanceof IllegalAction&&e.message.includes('R522'));assert.equal(JSON.stringify(saved),before);}
 else if(route==='tax'){const before=JSON.stringify(saved),out=RULES.apply(ctx,saved,reply);assert.equal(JSON.stringify(saved),before);assert.equal(out.state.outcome?.kind,'interrupted');assert.equal(out.state.outcome?.privateContext?.issue,'R522');assert.equal((out.state as VmState).sides[p].zones.deck.length,beforeDeck);assert.deepEqual((out.state as VmState).sides[p].zones.hand,saved.sides[p].zones.hand);}
 else if(route==='departed'||route==='aliasDrop'||route==='aliasTop'){const before=JSON.stringify(saved);assert.throws(()=>RULES.apply(ctx,saved,reply),e=>e instanceof NotYet&&e.issue==='R522');assert.equal(JSON.stringify(saved),before);assert.equal(saved.sides[p].zones.deck.length,t.s.sides[p].zones.deck.length);}
 else{t.take(reply);if(route==='negated'){assert.ok(!t.s.programs.some(f=>f.card===z&&f.autoCost));assert.equal(t.s.sides[p].zones.deck.length,beforeDeck-1);assert.equal(t.s.sides[p].zones.drop.length,beforeDrop);}
  else{assert.equal(findCard(t.s,z)?.owner,t.q);const prompt=(t.s as VmState).prompt;assert.equal(prompt.kind,'chooseMode');assert.equal(prompt.player,p);assert.equal(t.s.programs.find(f=>f.card===z&&f.autoCost)?.master,p);}}
 results.push({p,preactivation:route});
}
// Mechanism copy of the complete original Auto is explicitly unsupported before price payment.
for(const p of ['p1','p2'] as PlayerId[]){
 const t=setup(p,['P-764']);t.take({type:'endMain',player:p});t.take({type:'charge',player:t.q,card:null});t.take({type:'endMain',player:t.q});t.take({type:'charge',player:p,card:null});
 for(let i=0;i<6;i++)t.stage(p,'energy');t.stage(p,'zEnergy');const donor=t.s.sides[p].zones.zDeck[0];t.take(t.actions().find(a=>a.type==='playZ'&&a.card===donor)!);t.settle();const receiver=t.stage(p,'battle');for(const id of ['DB3-060','BT15-087','BT24-071'])t.stage(p,'drop',id);
 stepScript(vmHost(ctx,game,t.s,[]),{card:t.s.sides[p].zones.leader[0],master:p,ops:[{op:'copySkills',target:{var:'receiver'},from:{var:'donor'},skill:20,until:'turn'}],ip:0,vars:{receiver:[receiver],donor:[donor]}});
 const saved=clone(t.s),before=JSON.stringify(saved);const out=RULES.apply(ctx,saved,{type:'attack',player:p,attacker:receiver,target:saved.sides[t.q].zones.leader[0]});assert.equal(out.state.outcome?.kind,'interrupted');assert.equal(out.state.outcome?.privateContext?.issue,'R522');assert.equal((out.state as VmState).sides[p].zones.deck.length,saved.sides[p].zones.deck.length);assert.deepEqual((out.state as VmState).sides[p].zones.drop,saved.sides[p].zones.drop);assert.equal(JSON.stringify(saved),before);results.push({p,copiedRefusal:true});
}
// Full original price cannot activate with fewer than three distinct names, even after Burst.
for(const p of ['p1','p2'] as PlayerId[])for(const route of ['twoNames','duplicates'] as const){
 const t=setup(p,['P-764']);t.take({type:'endMain',player:p});t.take({type:'charge',player:t.q,card:null});t.take({type:'endMain',player:t.q});t.take({type:'charge',player:p,card:null});
 for(let i=0;i<6;i++)t.stage(p,'energy');t.stage(p,'zEnergy','DB3-060');t.stage(p,'drop','DB3-060');t.stage(p,'drop',route==='twoNames'?'BT15-087':'DB3-060');
 const z=t.s.sides[p].zones.zDeck[0];t.take(t.actions().find(a=>a.type==='playZ'&&a.card===z)!);t.settle();t.s.cards[t.s.sides[p].zones.deck[0]].cardId='DB3-060';const deck=t.s.sides[p].zones.deck.length;
 t.take(t.actions().find(a=>a.type==='attack'&&a.attacker===z)!);t.settle();assert.equal(t.s.sides[p].zones.deck.length,deck);assert.equal(t.s.sides[p].zones.warp.length,0);assert.equal(t.events.filter(e=>e.type==='skill'&&e.card===z&&e.skill===20).length,0);results.push({p,unpayable:route});
}
// Full printed reduction sibling: real distinct Green cards, with explicit staged Drop setup.
const greenNames=['DB3-060','BT15-087','BT24-071','DB2-084','BT8-052','BT4-066','TB3-044','DB3-054','BT6-073','BT7-061','BT17-071','BT5-074','BT18-074','BT2-077','BT12-065'];
for(const p of ['p1','p2'] as PlayerId[])for(const route of ['fifteen','fourteen','duplicate','nonGreen'] as const){
 const t=setup(p,['P-764']);for(const id of greenNames.slice(0,14))t.stage(p,'drop',id);
 if(route!=='fourteen')t.stage(p,'drop',route==='duplicate'?greenNames[0]:route==='nonGreen'?'B':greenNames[14]);
 t.stage(p,'energy');t.stage(p,'zEnergy');const z=t.s.sides[p].zones.zDeck[0];let play=t.actions().find(a=>a.type==='playZ'&&a.card===z);
 if(route==='fifteen')assert.ok(play);else{assert.equal(play,undefined);for(let i=0;i<5;i++)t.stage(p,'energy');play=t.actions().find(a=>a.type==='playZ'&&a.card===z);assert.ok(play);}
 t.take(play!);t.settle();assert.equal(findCard(t.s,z)?.zone,'battle');assert.equal(t.s.sides[p].zones.energy.filter(id=>t.s.cards[id].mode==='rest').length,route==='fifteen'?1:6);assert.equal(t.s.sides[p].zones.zEnergy.length,0);results.push({p,reduction:route});
}
console.log(`paid-warp-native-5: ${results.length} full-record native + ${savedControls} saved controls PASS`);
