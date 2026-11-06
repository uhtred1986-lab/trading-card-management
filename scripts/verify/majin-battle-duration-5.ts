/** R512: exact duration body; full printed sources, staged authentic back-side base. */
import assert from 'node:assert/strict';
import fixture from './fixtures/majin-battle-duration-5.json';
import {card,fifty} from './harness';
import {skillRecords} from '../../src/lib/arena/draft';
import {rulesFromRows,type RuleRow} from '../../src/lib/arena/rules-store';
import {RULES} from '../../src/lib/arena/vm';
import {rulesetFor} from '../../src/lib/arena/rulesets';
import {correctSkillText} from '../../src/lib/catalog/errata';
import {hasKeyword} from '../../src/lib/arena/vm/program';
import {vmHost} from '../../src/lib/arena/vm/host';
import {parseRule,printRule,type Rule} from '../../src/lib/arena/lang';
import type {Action,CardDef,EngineContext,GameEvent,PlayerId,Area} from '../../src/lib/arena/types';
import type {VmState} from '../../src/lib/arena/vm/state';
const copy=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const defs:Record<string,CardDef>={F:card('F',{colors:['Yellow'],skill:null,comboCost:0}),L:card('L',{type:'LEADER',skill:null,power:10000})};
for(const [id,item] of Object.entries(fixture)){const c=item.card;defs[id]=card(id,{name:c.name,type:c.type as CardDef['type'],colors:c.colors as CardDef['colors'],energyCost:c.cost===null?null:Number(c.cost),zEnergyCost:c.z?Number(c.z):null,power:c.power,characters:c.characters,traits:c.traits,skill:correctSkillText(id,c.skill),back:c.backSkill?{name:c.backName!,power:15000,skill:correctSkillText(id,c.backSkill)}:undefined});}
// Frozen source has no back power. 15000 is an irrelevant fixture placeholder:
// that back is never a combatant; the genuine Z-Leader's printed power is used.
const records=Object.values(defs).flatMap(skillRecords);
for(const item of Object.values(fixture))for(const old of Object.values(item.records)){
 const actual=records.find(r=>r.cardId===old.cardId&&r.side===old.side&&r.skillIndex===old.skillIndex)!;
 const expected=copy(old);
 if(old.cardId==='BT20-086'&&old.skillIndex===30){expected.unread=[];expected.pattern='if:all[grant:Strike→delay:battleEnd[moveTo]]';}
 assert.deepEqual(copy(actual),expected,'only the reviewed unread/pattern fields change');
}
const row=records.find(r=>r.cardId==='BT20-086'&&r.skillIndex===30)!;
const rule=copy({kind:row.kind,trigger:row.trigger,cost:row.cost,usage:row.usage,validity:row.validity,cond:row.cond,ops:row.ops}) as Rule;
const parsed=parseRule(printRule(rule));assert.ok(parsed.ok);assert.deepEqual(copy(parsed.value),rule);
const effect='For the battle, this card gains [double strike], and at the end of the battle, remove this card from the game.';
for(const text of [`[Activate: Battle] If an unrepresented condition holds: ${effect}`,`[Activate: Battle] ${effect.replace('this card gains','your Leader gains')}`,`[Activate: Main] ${effect}`,`[Auto] When this card attacks, ${effect}`,`[Permanent] ${effect}`,`[Activate: Battle] ${effect.replace('For the battle','For the turn')}`,`[Activate: Battle] ${effect.replace('double strike','critical')}`,`[Activate: Battle] ${effect.replace('at the end of the battle','at the end of the turn')}`,`[Activate: Battle] ${effect.replace('remove this card from the game','draw 1 card')}`,`[Activate: Battle] ${effect} Unrepresented trailing instruction.`,`[Activate: Battle] Choose one—\n・${effect}\n・Draw 1 card.`])assert.ok(skillRecords(card('NEAR',{skill:text})).some(r=>r.unread.length),text);
const ctx:EngineContext={defs,scripts:rulesFromRows(records.map((r,id)=>({...r,id,status:r.unread.length?'open':'confirmed',source:'compiler'}) as RuleRow),defs)};
assert.equal(ctx.scripts!['BT20-086'].bySkill[10].unsupported.length,0,'R513 now admits the exact conditional Combo Permanent');
const loaded=rulesetFor('dbs');assert.ok(loaded.ok);const game=loaded.definition,other=(p:PlayerId):PlayerId=>p==='p1'?'p2':'p1';
let cases=0;
for(const p of ['p1','p2'] as PlayerId[])for(const role of ['attack','defend'] as const)for(const variant of ['activate','decline','sourceLost','missingUnder','wrongUnder','negated','otherBattle','mixedCounts'] as const){
 if(variant==='otherBattle'&&role!=='attack'||variant==='mixedCounts'&&role!=='defend')continue;
 const q=other(p);let s=RULES.createGame(ctx,{seed:512,p1:{name:'One',leader:p==='p1'?'BT20-084':'L',main:fifty('F'),z:['BT20-086']},p2:{name:'Two',leader:p==='p2'?'BT20-084':'L',main:fifty('F'),z:['BT20-086']}}).state as VmState;const events:GameEvent[]=[];
 const take=(a:Action)=>{const saved=copy(s),before=JSON.stringify(saved);for(const viewer of ['p1','p2'] as const)RULES.boardView(ctx,saved,viewer,{});const r=RULES.apply(ctx,saved,a);assert.equal(JSON.stringify(saved),before);s=r.state as VmState;events.push(...r.events);assert.equal(s.outcome,undefined,JSON.stringify(s.outcome));};
 const actions=()=>RULES.legalActions(ctx,s).map(x=>x.action);
 const advance=()=>{for(let i=0;i<40&&!['main','charge','combo'].includes(s.prompt.kind);i++){const pr=s.prompt;let a:Action|undefined;if(pr.kind==='zEnergyFromCombo')a={type:'zEnergyFromCombo',player:pr.player,card:null};else if(pr.kind==='chooseCards')a={type:'choose',player:pr.player,cards:pr.choice.candidates.slice(0,pr.choice.min??0)};else if(pr.kind==='orderPending')a={type:'orderPending',player:pr.player,index:s.pendingOrder!.candidates[0]};else a=actions().find(a=>a.type==='counter'&&a.card===null);assert.ok(a,JSON.stringify(pr));take(a);}};
 for(const a of [{type:'chooseFirst',player:s.chooser,first:p},{type:'mulligan',player:p,redraw:false},{type:'mulligan',player:q,redraw:false},{type:'charge',player:p,card:null}] as Action[])take(a);
 // Resources/ordinary cards are staged; ZA, attack, Combo and skill actions are native.
 const stage=(owner:PlayerId,zone:Area)=>{const id=s.sides[owner].zones.deck.at(-1)!;assert.ok(vmHost(ctx,game,s,events).move(id,zone,owner));return id;};
 for(let i=0;i<4;i++){stage(p,'energy');stage(p,'zEnergy');}
 take({type:'endMain',player:p});take({type:'charge',player:q,card:null});advance();take({type:'endMain',player:q});take({type:'charge',player:p,card:null});advance();
 const base=s.sides[p].zones.leader[0];assert.equal(s.cards[base].flipped,false,'base front Auto remains unsupported');vmHost(ctx,game,s,events).flip(base,true);
 const z=s.sides[p].zones.zDeck[0];let a=actions().find(a=>a.type==='activate'&&a.card===z&&a.skill===0);assert.ok(a);take(a);advance();assert.equal(s.sides[p].zones.leader[0],z);assert.equal(s.sides[p].zones.zEnergy.length,0);assert.equal(s.sides[p].zones.energy.filter(id=>s.cards[id].mode==='rest').length,4);assert.ok(s.cards[z].under.includes(base));assert.ok(!actions().some(a=>a.type==='activate'&&a.card===z&&a.skill===30),'no battle');
 if(role==='defend'){take({type:'endMain',player:p});take({type:'charge',player:q,card:null});advance();}
 const attacker=role==='defend'?s.sides[q].zones.leader[0]:variant==='otherBattle'?stage(p,'battle'):z;
 const hand=s.sides[p].zones.hand.length;a=actions().find(a=>a.type==='attack'&&a.attacker===attacker&&a.target===(role==='defend'?z:s.sides[q].zones.leader[0]));assert.ok(a);take(a);advance();assert.equal(s.sides[p].zones.hand.length,hand+(attacker===z?1:0));
 const combo=(owner:PlayerId)=>{const id=stage(owner,'hand'),a=actions().find(a=>a.type==='combo'&&a.card===id);assert.ok(a);take(a);advance();};
 if(role==='defend'){if(variant==='mixedCounts')combo(q);const pass=actions().find(a=>a.type==='pass');assert.ok(pass);take(pass);advance();}
 for(let i=0;i<(variant==='mixedCounts'?6:7);i++){combo(p);if(i===5)assert.ok(!actions().some(a=>a.type==='activate'&&a.card===z&&a.skill===30),'six own Combo cards are insufficient');}
 if(variant==='missingUnder')s.cards[z].under=[]; // isolated condition perturbation after valid paid ZA
 if(variant==='wrongUnder')s.cards[base].cardId='L'; // same isolated name condition control
 if(variant==='negated')vmHost(ctx,game,s,events).negateAll(z);
 a=actions().find(a=>a.type==='activate'&&a.card===z&&a.skill===30);
 if(['missingUnder','wrongUnder','negated','otherBattle','mixedCounts'].includes(variant)){assert.equal(a,undefined,variant);cases++;continue;}
 assert.ok(a);assert.equal(s.sides[q].zones.combo.length,0,'R512 duration proof does not require an opposing Combo target');
 if(variant!=='decline'){take(a);advance();assert.equal(hasKeyword(ctx,game,s,z,'Strike'),true);assert.ok(s.sides[p].zones.leader.includes(z),'no immediate removal');}
 else assert.equal(hasKeyword(ctx,game,s,z,'Strike'),false);
 if(variant==='sourceLost'){vmHost(ctx,game,s,events).move(z,'removed',p);assert.equal(s.sides[p].zones.leader[0],base);}
 const saved=copy(s),life=s.sides[q].zones.life.length;
 const finish=()=>{for(let i=0;i<40&&s.prompt.kind!=='main';i++){const a=actions().find(a=>a.type==='pass')??actions().find(a=>a.type==='counter'&&a.card===null);assert.ok(a,JSON.stringify(s.prompt));take(a);advance();}};
 finish();const finished=copy(s);s=copy(saved);finish();assert.deepEqual(s,finished,'saved battle-end replay is deterministic');
 if(variant==='decline'){assert.equal(s.sides[p].zones.leader[0],z);if(role==='attack')assert.equal(s.sides[q].zones.life.length,life-1);}
 else {assert.ok(s.sides[p].zones.removed.includes(z));assert.equal(s.sides[p].zones.leader[0],base);assert.equal(s.effects.some(e=>e.target===z&&e.kind==='keyword'),false);if(role==='attack'&&variant!=='sourceLost')assert.equal(s.sides[q].zones.life.length,life-2);}
 if(variant==='sourceLost'){
  assert.deepEqual(s.cards[z],saved.cards[z],'delayed removal leaves the departed occurrence unchanged');
  assert.deepEqual(s.cards[base],saved.cards[base],'delayed removal leaves the restored base unchanged');
  assert.equal(events.filter(e=>e.type==='move'&&e.card===z&&e.to==='removed'&&e.from!=='removed').length,1,'only the original departure changes area');
 }
 cases++;
}
console.log(`majin-battle-duration-5: ${cases} native/condition scenarios PASS; full records and DSL preserved`);
