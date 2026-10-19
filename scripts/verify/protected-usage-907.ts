/** #907: preserve and execute the owner's existing BT6-001 correction with new metadata. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { protectedMetadataPlan, PROTECTED_KEYS } from "../lib/protected-metadata-907";
import { normalizeRows } from "../arena-corpus-provenance.mts";
import { cardDefFrom } from "../../src/lib/arena/load";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow, forbids, hasKeyword } from "../../src/lib/arena/vm/program";
import { CTX, DEFS, card, fifty } from "./harness";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";
const root="docs/arena-backlog/evidence/897/selected-pair-inputs-2026-10-19/";
const frozen=JSON.parse(readFileSync(root+"catalog.json","utf8")).cards;
const physical:Record<string,unknown>[]=JSON.parse(readFileSync(root+"stored-rules.json","utf8"));
const ownerRows=physical.filter(r=>PROTECTED_KEYS.includes(`${r.card_id}/${r.side}/${r.skill_index}`));
const proposal=protectedMetadataPlan(ownerRows);
const prepared=proposal.rules.map(r=>({...r.before,cost:r.cost,usage:r.usage,validity:r.validity}));
const actualFlag=process.argv.indexOf('--stored-rules'),actualPath=actualFlag<0?null:process.argv[actualFlag+1];
if(actualFlag>=0)assert.ok(actualPath&&!actualPath.startsWith('--'));
const readback:Record<string,unknown>[]=actualPath?JSON.parse(readFileSync(actualPath,'utf8')):prepared;
const normalized=normalizeRows(readback.filter(r=>PROTECTED_KEYS.includes(`${r.card_id??r.cardId}/${r.side}/${r.skill_index??r.skillIndex}`)));
assert.deepEqual(normalized.malformed,[]);assert.equal(normalized.rows.length,4);
const defs:Record<string,CardDef>={...DEFS,
 GOK907:card('GOK907',{characters:['Son Goku: Br']}),VEG907:card('VEG907',{characters:['Vegeta: Br']}),
 C1907:card('C1907',{type:'EXTRA',energyCost:1,skill:'[Counter: Attack] Negate the attack.'}),
 C2907:card('C2907',{type:'EXTRA',energyCost:2,skill:'[Counter: Attack] Negate the attack.'})};
for(const id of ['BT6-001','BT6-012','BT6-013','BT6-015'])defs[id]=cardDefFrom(frozen.find((c:CardDef)=>c.id===id));
const rows=Object.values(defs).flatMap(d=>skillRecords(d).map(r=>({...r,status:r.unread.length?'open':'draft',source:'compiler'} as RuleRow)));
for(const r of normalized.rows)rows[rows.findIndex(f=>f.cardId===r.cardId&&f.side===r.side&&f.skillIndex===r.skillIndex)]=r;
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const ctx:EngineContext=clone({...CTX,defs,scripts:rulesFromRows(rows,defs)});
const loaded=rulesetFor('dbs');assert.ok(loaded.ok);const game=loaded.definition;
interface Saved{ctx:EngineContext;state:VmState}
function take(s:Saved,a:Action):Saved{const x=clone(s),y=clone(s),one=RULES.apply(x.ctx,x.state,clone(a)),two=RULES.apply(y.ctx,y.state,clone(a));assert.deepEqual(one,two);return clone({ctx:x.ctx,state:one.state as VmState});}
function settle(start:Saved,terminal:'main'|'combo',wanted?:string){let s=clone(start);for(let n=0;n<30&&s.state.prompt.kind!==terminal;n++){
 const q=s.state.prompt;const a:Action=q.kind==='chooseCards'?{type:'choose',player:q.player,cards:wanted&&q.choice.candidates.includes(wanted)?[wanted]:q.choice.candidates.slice(0,q.choice.min)}
 :q.kind==='counter'?{type:'counter',player:q.player,card:null}:q.kind==='chooseMode'?{type:'chooseMode',player:q.player,index:0}:q.kind==='orderPending'?{type:'orderPending',player:q.player,index:q.candidates[0]}:(()=>{throw Error(`unexpected ${q.kind}`)})();s=take(s,a);
 }assert.equal(s.state.prompt.kind,terminal);return s;}
const checks:string[]=[];
for(const owner of ['p1','p2'] as const)for(const scenario of ['post-payment-true','opponent-turn-false','missing-count-false'] as const){
 const other:PlayerId=owner==='p1'?'p2':'p1',turn=scenario==='opponent-turn-false'?other:owner,first:PlayerId=turn==='p1'?'p2':'p1';
 let s:Saved={ctx:clone(ctx),state:RULES.createGame(ctx,{seed:907,p1:{name:'One',leader:owner==='p1'?'BT6-001':'L-RED',main:fifty('V1')},p2:{name:'Two',leader:owner==='p2'?'BT6-001':'L-RED',main:fifty('V1')}}).state as VmState};
 for(const a of [{type:'chooseFirst',player:s.state.chooser,first},{type:'mulligan',player:first,redraw:false},{type:'mulligan',player:turn,redraw:false},{type:'charge',player:first,card:null},{type:'endMain',player:first},{type:'charge',player:turn,card:null}] as Action[])s=take(s,a);
 const source=s.state.sides[owner].zones.leader[0];s.state.cards[source].flipped=true;
 const stage=(p:PlayerId,d:string,area:string)=>{const id=s.state.sides[p].zones.deck[0];s.state.cards[id].cardId=d;assert.ok(moveCard(s.state,game,id,area,{owner:p}).ok);return id;};
 if(scenario!=='missing-count-false')for(let n=0;n<2;n++)stage(owner,'GOK907','drop');stage(owner,'VEG907','drop');const payment=stage(owner,'VEG907','hand');
 const c1=stage(other,'C1907','hand'),c2=stage(other,'C2907','hand');
 s=settle(take(s,{type:'attack',player:turn,attacker:s.state.sides[turn].zones.leader[0],target:s.state.sides[first].zones.leader[0]}),'combo');
 if(s.state.prompt.kind==='combo'&&s.state.prompt.player!==owner)s=take(s,{type:'pass',player:s.state.prompt.player});
 const action=RULES.legalActions(s.ctx,s.state).find(a=>a.action.type==='activate'&&a.action.card===source&&a.action.skill===10);assert.ok(action,'post-colon condition is not a price');
 s=settle(take(s,action.action),'combo',payment);
 assert.ok(s.state.sides[owner].zones.drop.includes(payment),'red discard is paid even if effect IF fails');
 assert.ok(s.state.cards[source].usedThisTurn.includes(10));
 const succeeds=scenario==='post-payment-true';assert.equal(attrsNow(s.ctx,game,s.state,source).power,succeeds?20000:15000);
 assert.equal(hasKeyword(s.ctx,game,s.state,source,'Strike'),succeeds);
 assert.equal(forbids(s.ctx,game,s.state,'activateCounter',{player:other,card:c1,skillKind:'counter:attack'}),false);
 assert.equal(forbids(s.ctx,game,s.state,'activateCounter',{player:other,card:c2,skillKind:'counter:attack'}),succeeds);
 assert.ok(!RULES.legalActions(s.ctx,s.state).some(a=>a.action.type==='activate'&&a.action.card===source&&a.action.skill===10));
 checks.push(`${owner}/${scenario}`);
}
const out=process.argv.indexOf('--out');if(out>=0)writeFileSync(process.argv[out+1],JSON.stringify({recordMode:actualPath?'actual-stored-readback':'approved-metadata-preview',previewDigest:proposal.digest,targets:['BT6-001/back/10'],checks,qualified:false,pairGames:0},null,2)+'\n');
console.log('protected-usage-907: six both-seat existing-owner-program post-payment/turn/count/Once/Counter-bound scenarios passed');
