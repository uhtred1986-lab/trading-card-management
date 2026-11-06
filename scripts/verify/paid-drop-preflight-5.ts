import {NotYet} from '../../src/lib/arena/vm/errors';
/** Fixed-candidate native projection only; projection assertions are separate from gameplay. */
import assert from 'node:assert/strict';
import fixture from './fixtures/paid-drop-5.json';
import {card,fifty} from './harness';
import {skillRecords} from '../../src/lib/arena/draft';
import {rulesFromRows,type RuleRow} from '../../src/lib/arena/rules-store';
import {RULES} from '../../src/lib/arena/vm';
import {rulesetFor} from '../../src/lib/arena/rulesets';
import {moveCard,findCard} from '../../src/lib/arena/vm/zones';
import {vmHost} from '../../src/lib/arena/vm/host';
import {withTokens} from '../../src/lib/arena/vm/cards';
import {stepScript,type Script} from '../../src/lib/arena/vm/script';
import type {CardDef,EngineContext,PlayerId,Action} from '../../src/lib/arena/types';
import type {VmState} from '../../src/lib/arena/vm/state';
import {paidDropPayerPayable} from '../../src/lib/arena/vm/paid-drop-preflight';
import {paidDropTail} from '../../src/lib/arena/vm/paid-drop-contract';
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const defs:Record<string,CardDef>={L:card('L',{type:'LEADER',energyCost:null,colors:['Black'],skill:null}),F:card('F',{colors:['Blue'],skill:null}),R:card('R',{colors:['Red'],skill:null}),
 U:card('U',{type:'UNISON',energyCost:1,traits:['Red Ribbon Army'],characters:[],skill:null}),E:card('E',{type:'EXTRA',energyCost:1,traits:['Red Ribbon Army'],characters:[],skill:'[Field]'}),LC:card('LC',{type:'LEADER',energyCost:1,traits:['Red Ribbon Army'],characters:['General Blue'],skill:null})};
for(const [id,{card:c}]of Object.entries(fixture))defs[id]=card(id,{name:c.name,type:c.type as CardDef['type'],colors:c.colors as CardDef['colors'],energyCost:c.cost===null?null:Number(c.cost),zEnergyCost:c.z===null?null:Number(c.z),characters:c.characters,traits:c.traits,power:c.power,skill:c.skill});
const rows=Object.values(defs).flatMap(skillRecords),ctx:EngineContext=withTokens({defs,scripts:rulesFromRows(rows.map((r,id)=>({...r,id,status:r.unread.length?'open':'confirmed',source:'compiler'})as RuleRow),defs)});
const loaded=rulesetFor('dbs');assert.ok(loaded.ok);const game=loaded.definition;
const original=ctx.scripts!['BT17-035'].bySkill[0];const script:Script={...clone(original),unsupported:[],ops:[...clone(original.ops),paidDropTail()]};
function fresh(p:PlayerId){const q=p==='p1'?'p2':'p1';let s=RULES.createGame(ctx,{seed:518,p1:{name:'One',leader:'L',main:fifty('F'),z:['BT22-004']},p2:{name:'Two',leader:'L',main:fifty('F'),z:['BT22-004']}}).state as VmState;
 const take=(a:Action)=>{const before=JSON.stringify(s);const r=RULES.apply(ctx,s,a);assert.equal(JSON.stringify(s),before);s=r.state as VmState;assert.equal(s.outcome,undefined);};
 for(const a of [{type:'chooseFirst',player:s.chooser,first:p},{type:'mulligan',player:p,redraw:false},{type:'mulligan',player:q,redraw:false},{type:'charge',player:p,card:null}] as Action[])take(a);
 const stage=(id:string,area:string)=>{const key=s.sides[p].zones.deck.at(-1)!;s.cards[key].cardId=id;assert.ok(moveCard(s,game,key,area,{owner:p}).ok);return key;};
 const settle=()=>{for(let n=0;n<40&&s.prompt.kind!=='main';n++){const pr=s.prompt;let a:Action|undefined=pr.kind==='chooseCards'?{type:'choose',player:pr.player,cards:pr.choice.candidates.slice(0,pr.choice.min??0)}:pr.kind==='payCost'?{type:'payCost',player:pr.player,option:0}:undefined;a??=RULES.legalActions(ctx,s).map(x=>x.action).find(a=>a.type==='counter'&&a.card===null);assert.ok(a,JSON.stringify(pr));take(a);}};
 return {get s(){return s;},take,stage,settle,p,q};
}
let cases=0;
for(const p of ['p1','p2'] as PlayerId[])for(const route of ['blue','violet','foreign','mandatorySame','optionalSame','mandatoryAway','optionalAway','prohibited','changedCharacter','unchangedCharacter','leader','unison','field','zGamma'] as const){
 const t=fresh(p),source=t.stage('BT17-035','hand');let payer:string;
 if(route==='zGamma'){
  for(let i=0;i<2;i++){t.stage('R','energy');t.stage('F','zEnergy');}payer=t.s.sides[p].zones.zDeck[0];const a=RULES.legalActions(ctx,t.s).map(x=>x.action).find(a=>a.type==='playZ'&&a.card===payer);assert.ok(a);t.take(a);t.settle();assert.equal(findCard(t.s,payer)?.zone,'battle');assert.equal(t.s.cards[payer].zCard,true);
 }else if(route==='leader'){payer=t.s.sides[p].zones.leader[0];t.s.cards[payer].cardId='LC';}
 else payer=t.stage(route==='unison'?'U':route==='field'?'E':route==='violet'||route==='changedCharacter'?'BT17-042':'BT17-040',route==='unison'?'unison':'battle');
 if(route==='foreign')t.s.cards[payer].owner=t.q as PlayerId;
 const h=vmHost(ctx,game,t.s,[]),apply=(ops:Parameters<typeof stepScript>[1]['ops'])=>stepScript(h,{card:t.s.sides[p].zones.leader[0],master:p,ops,ip:0,vars:{payer:[payer]}});
 if(route.includes('Same')||route.includes('Away'))apply([{op:'replaceLeave',target:{var:'payer'},to:route.includes('Same')?'drop':'warp',optional:route.startsWith('optional'),until:'turn'}]);
 if(route==='prohibited')apply([{op:'forbid',what:'beMovedBySkill',target:{var:'payer'},until:'turn'}]);
 if(route==='changedCharacter'||route==='unchangedCharacter')apply([{op:'modifyAttr',attr:'characters',values:[route==='changedCharacter'?'General Blue':'Colonel Violet'],target:{var:'payer'},until:'turn'}]);
 const before=JSON.stringify(t.s),expected=!['mandatorySame','mandatoryAway','prohibited','changedCharacter','leader','zGamma'].includes(route);
 if(route==='changedCharacter'){assert.throws(()=>paidDropPayerPayable(ctx,game,t.s,{card:source,master:p},script,payer),e=>e instanceof NotYet&&e.issue==='R518');assert.equal(JSON.stringify(t.s),before);cases++;continue;}
 assert.equal(paidDropPayerPayable(ctx,game,t.s,{card:source,master:p},script,payer),expected,route);assert.equal(JSON.stringify(t.s),before);assert.equal(paidDropPayerPayable(ctx,game,clone(t.s),{card:source,master:p},script,payer),expected,route);assert.equal(JSON.stringify(t.s),before);cases++;
}
console.log(`paid-drop-preflight-5: ${cases} fixed-payer projection cases PASS; projection-only evidence`);
