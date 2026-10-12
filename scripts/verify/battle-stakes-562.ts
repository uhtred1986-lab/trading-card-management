import assert from 'node:assert/strict';
import { battleFixture,paymentFixture,snapshot562,apply562,fixtureContext,engine562 } from './battle-engine-fixture-562';
import { energySummary,stakesSummary } from '../../src/components/arena/stage/stakes-model';
import { reconcileSnapshot } from '../../src/lib/arena/snapshot';
import { moved } from '../../src/lib/arena/vm/flow';
import { fire } from '../../src/lib/arena/vm/events';
import { addEffect } from '../../src/lib/arena/vm/effects';
import { makeWhisFixture } from './ability-engine-fixture-561';
import { moveCard } from '../../src/lib/arena/vm/zones';
import { rulesetFor } from '../../src/lib/arena/rulesets';

for(const kind of ['tie','double','critical','lethal','victory'] as const){
 const {state}=battleFixture(kind);const before=snapshot562(state);
 const stakes=before.view.battle!.stakes!;
 assert(stakes.hit&&stakes.tied,'actual tied attack hits');
 assert.equal(stakes.lifeDamage,['double','lethal'].includes(kind)?2:1);
 assert.equal(stakes.critical,kind==='critical');
 assert.equal(stakes.potentialLethal,kind==='lethal'||kind==='victory');
 assert.match(stakes.assumption,/Pending skills and replacements/);
 assert.match(before.view.prompt.passConsequence!,/advances to damage/);
 const pass=before.legal.find(row=>row.action.type==='pass')!.action;
 const applied=apply562(state,pass);
 const damage=applied.events.find(e=>e.type==='damage');
 assert(damage?.type==='damage');assert.equal(damage.amount,stakes.lifeDamage);assert.equal(damage.critical,stakes.critical);
 assert(applied.events.some(e=>e.type==='powerCompare'&&e.hit),'actual tie comparison matches public conditional projection');
 if(kind==='critical')assert(damage.cards.every(id=>(applied.state as typeof state).sides.p1.zones.drop.includes(id)));
 if(kind==='lethal'||kind==='victory')assert.equal(applied.state.winner,'p2');
 const other=snapshot562(state,1,'p2');assert.deepEqual(other.view.battle!.stakes,stakes);
 assert.equal(before.view.them.hand,null);assert.equal(other.view.them.hand,null);
 assert(!JSON.stringify(stakes).includes('cardId'),'summary has no hidden card identity');
}
{
 const {state}=battleFixture();state.cards[state.battle!.guard].cardId='L-RED';state.cards[state.battle!.guard].flipped=true;
 const snapshot=snapshot562(state);assert.equal(snapshot.view.battle!.stakes!.hit,false);assert.equal(snapshot.view.battle!.stakes!.lifeDamage,0);
 const applied=apply562(state,snapshot.legal.find(l=>l.action.type==='pass')!.action);assert(!applied.events.some(e=>e.type==='damage'),'held attack does no damage');
}
for(const invalid of ['negated','removed','ended'] as const){
 const {state}=battleFixture();
 if(invalid==='negated')state.battle!.negated=true;
 if(invalid==='ended')state.battle!.step='battleEnd';
 if(invalid==='removed'){const loaded=rulesetFor('dbs');assert(loaded.ok);moveCard(state,loaded.definition,state.battle!.attacker,'drop',{owner:'p2'});}
 assert.equal(snapshot562(state).view.battle!.stakes,undefined,`${invalid} battle has no fresh damage projection`);
}
{
 const {state}=paymentFixture();const snapshot=snapshot562(state);assert(snapshot.view.prompt.payments!.length>1);
 assert.equal(snapshot562(state,1,'p2').view.prompt.payments,undefined,'other viewer sees no payment options');
 const previews=snapshot.view.prompt.payments!.map(payment=>energySummary(snapshot.view.you,payment.energyRest));
 assert(new Set(previews).size>1,'Blue vs Red payment changes remaining coloured energy');
 for(const row of snapshot.legal){assert.equal(row.action.type,'payCost');if(row.action.type!=='payCost')continue;
  const payment=snapshot.view.prompt.payments!.find(p=>p.option===(row.action as {option:number}).option)!;
  const result=apply562(state,row.action);const after=snapshot562(result.state as typeof state,2);
  assert.equal(energySummary(after.view.you),energySummary(snapshot.view.you,payment.energyRest));
  assert.equal(after.view.you.activeEnergy,snapshot.view.you.activeEnergy-payment.energyRest.length);
  assert((result.state as typeof state).sides.p1.zones.combo.includes(state.prompt.kind === 'payCost' && state.prompt.action.type === 'combo' ? state.prompt.action.card : ''),'exact payment proceeds to combo');
  assert(result.events.some(e=>e.type==='move' && e.to==='combo'),'payment emits actual move to combo');
 }
}
{
 const {state}=battleFixture();const old=snapshot562(state,1);const fresh=snapshot562(state,2);
 assert.equal(reconcileSnapshot(fresh,old),fresh,'stale reload cannot replace latest summary');
 assert.deepEqual(JSON.parse(JSON.stringify(fresh)).view.battle.stakes,fresh.view.battle!.stakes,'reload serialization preserves facts');
 const legacy={...old.view.battle!};delete legacy.stakes;assert.match(stakesSummary(legacy),/unavailable/);
}


// Effective grants share the resolver's query; larger Strike wins without client parsing.
{
 const {state}=battleFixture('double');
 addEffect(state,[],{target:state.battle!.attacker,kind:'keyword',value:{name:'Strike',x:3},until:'turn',master:'p2'});
 addEffect(state,[],{target:state.battle!.attacker,kind:'keyword',value:{name:'Critical'},until:'turn',master:'p2'});
 const before=snapshot562(state);assert.equal(before.view.battle!.stakes!.strikeDamage,3);
 const result=apply562(state,before.legal.find(l=>l.action.type==='pass')!.action);
 assert(result.events.some(e=>e.type==='damage'&&e.amount===3&&e.critical));
}
// A real optional life replacement pauses damage and can change its destination.
{
 const {state}=battleFixture('critical');const loaded=rulesetFor('dbs');assert(loaded.ok);
 const source=state.sides.p1.zones.hand.find(id=>state.cards[id].cardId==='V1')!;
 state.cards[source].cardId='U05_REVEALER';moveCard(state,loaded.definition,source,'battle',{owner:'p1'});
 const before=snapshot562(state);assert.match(before.view.battle!.stakes!.assumption,/replacements can change/);
 const result=apply562(state,before.legal.find(l=>l.action.type==='pass')!.action);
 assert.equal(result.state.prompt.kind,'replaceMove');assert(!result.events.some(e=>e.type==='damage'),'Pass has not guaranteed a completed damage event');
 const life=state.sides.p1.zones.life[0]!;
 const accepted=apply562(result.state as typeof state,{type:'chooseMode',player:'p1',index:0});
 assert((accepted.state as typeof state).sides.p1.zones.hand.includes(life),'replacement changes Critical destination');
}
// Actual Counter: Attack and offense windows describe distinct consequences.
{
 const {state}=makeWhisFixture('http://arena-561-art.local/BT1-055.webp');
 assert.match(snapshot562(state).view.prompt.passConsequence!,/Counter: Attack/);
 const next=apply562(state,{type:'counter',player:'p1',card:null}).state as typeof state;
 const offense=snapshot562(next,2,'p2');assert.match(offense.view.prompt.passConsequence!,/defender can respond next/);
 assert.equal(offense.view.battle!.step,'offense');
 const defense=apply562(next,offense.legal.find(l=>l.action.type==='pass')!.action).state as typeof state;
 assert.equal(snapshot562(defense,3).view.battle!.step,'defense');
}
// Target facts distinguish Unison marker loss and protected Battle Card KO.
for(const target of ['U05_UNISON','U05_INDESTRUCT'] as const){
 const {state}=battleFixture('double');const loaded=rulesetFor('dbs');assert(loaded.ok);
 const guard=state.sides.p1.zones.hand.find(id=>state.cards[id].cardId==='V1')!;
 state.cards[guard].cardId=target;moveCard(state,loaded.definition,guard,target==='U05_UNISON'?'unison':'battle',{owner:'p1'});
 state.cards[guard].markers=3;state.battle!.guard=guard;
 const snapshot=snapshot562(state);const stakes=snapshot.view.battle!.stakes!;
 assert.equal(stakes.lifeDamage,0);
 const result=apply562(state,snapshot.legal.find(l=>l.action.type==='pass')!.action);
 if(target==='U05_UNISON'){assert.equal(stakes.markerLoss,2);assert.equal(result.state.cards[guard].markers,1);}
 else {assert.equal(stakes.koPrevented,true);assert((result.state as typeof state).sides.p1.zones.battle.includes(guard));}
}

// Pending Autos are actual engine queue entries; the preview promises no resolution.
{
 const {state}=battleFixture();const loaded=rulesetFor('dbs');assert(loaded.ok);
 const source=state.sides.p1.zones.hand.find(id=>state.cards[id].cardId==='V1')!;
 state.cards[source].cardId='U05_PENDING';moveCard(state,loaded.definition,source,'battle',{owner:'p1'});
 fire(fixtureContext(),loaded.definition,state,{event:'moved',card:source,controller:'p1',args:{asPlay:true,to:'battle',from:'hand'}});
 assert(state.pending.length>0,'real trigger enters pending queue');
 const before=snapshot562(state);assert.match(before.view.battle!.stakes!.assumption,/Pending skills/);
 const result=apply562(state,before.legal.find(l=>l.action.type==='pass')!.action);
 assert(result.events.some(e=>e.type==='draw'),'pending Auto resolves during continuation');
}
// Changing hidden identities without changing public counts cannot change the stakes.
{
 const {state}=battleFixture('double');const before=snapshot562(state);
 for(const id of [...state.sides.p2.zones.hand,...state.sides.p1.zones.life])state.cards[id].cardId='U05_CRITICAL';
 const changed=snapshot562(state);assert.deepEqual(changed.view.battle!.stakes,before.view.battle!.stakes);
 assert.equal(changed.view.them.hand,null);
 state.sides.p1.zones.life=[];assert.equal(snapshot562(state).view.battle!.stakes!.potentialLethal,false,'zero damage cannot promise Victory or lethal');
}

// Printed colour is preserved for card review; effective public energy colours match payment.
{
 const {state}=paymentFixture();const loaded=rulesetFor('dbs');assert(loaded.ok);
 const red=state.sides.p1.zones.energy.find(id=>state.cards[id].cardId==='U05_RED_ENERGY')!;
 const source=state.sides.p1.zones.hand.find(id=>state.cards[id].cardId==='V1')!;
 state.cards[source].cardId='U05_PENDING';moveCard(state,loaded.definition,source,'battle',{owner:'p1'});
 const gain={names:[],characters:[],traits:[],colors:['Blue' as const]};
 addEffect(state,[],{kind:'gains',target:red,value:gain,source,master:'p1',until:'whileSourceInPlay'});
 const before=snapshot562(state);assert.deepEqual(before.view.you.energy.find(c=>c.id===red)!.colors,['Red']);
 assert(before.view.you.energyColors!.find(c=>c.card===red)!.colors.includes('Blue'),'effective Blue grant is public');
 assert.match(energySummary(before.view.you,[],'effective'),/Blue 2\/2/);
 const payment=before.view.prompt.payments!.find(row=>row.energyRest.includes(red))!;
 const applied=apply562(state,before.legal.find(row=>row.action.type==='payCost'&&row.action.option===payment.option)!.action);
 assert.equal(energySummary(snapshot562(applied.state as typeof state).view.you),energySummary(before.view.you,payment.energyRest));
 const removed=structuredClone(state);moved(fixtureContext(),loaded.definition,removed,[],source,'drop',{owner:'p1'});
 assert.deepEqual(snapshot562(removed).view.you.energyColors!.find(c=>c.card===red)!.colors,['Red'],'source departure removes its colour grant');
 const timed=structuredClone(state);timed.effects=[];addEffect(timed,[],{kind:'gains',target:red,value:gain,source,master:'p1',until:'turn'});
 let continuation=apply562(timed,snapshot562(timed).legal.find(row=>row.action.type==='payCost')!.action).state as typeof state;
 for(let n=0;n<10&&continuation.prompt.kind!=='main';n++) {
  const legal=snapshot562(continuation,1,('player' in continuation.prompt ? continuation.prompt.player : 'p1')!).legal;
  const decline=legal.find(row=>row.action.type==='pass'||(row.action.type==='zEnergyFromCombo'&&row.action.card===null))!;
  assert(decline);continuation=apply562(continuation,decline.action).state as typeof state;
 }
 assert.equal(continuation.prompt.kind,'main');continuation=apply562(continuation,{type:'endMain',player:'p2'}).state as typeof state;
 assert.deepEqual(snapshot562(continuation).view.you.energyColors!.find(c=>c.card===red)!.colors,['Red'],'turn expiry removes colour grant');
 const hidden=structuredClone(state);hidden.cards[red].hidden=true;hidden.effects=[];
 assert.deepEqual(snapshot562(hidden).view.you.energyColors!.find(c=>c.card===red)!.colors,[],'hidden printed colours stay hidden');
 for(const viewer of ['p1','p2'] as const){const snapshot=snapshot562(state,1,viewer);for(const side of [snapshot.view.you,snapshot.view.them])assert(side.energyColors!.every(row=>side.energy.some(card=>card.id===row.card)),'rows name only public energy cards');}
}

// Existing planner limitation: granted Blue is effective but does not pay a Blue orb.
{
 const {state,card,energy}=battleFixture();const loaded=rulesetFor('dbs');assert(loaded.ok);
 state.cards[energy].cardId='U05_RED_ENERGY';
 const source=state.sides.p1.zones.hand.find(id=>state.cards[id].cardId==='V1')!;
 state.cards[source].cardId='U05_PENDING';moveCard(state,loaded.definition,source,'battle',{owner:'p1'});
 assert(!engine562.legalActions(fixtureContext(),state).some(row=>row.action.type==='activate'&&row.action.card===card),'printed Red alone cannot pay Blue cost');
 addEffect(state,[],{kind:'gains',target:energy,value:{names:[],characters:[],traits:[],colors:['Blue']},source,master:'p1',until:'turn'});
 const before=snapshot562(state);assert.match(energySummary(before.view.you,[],'effective'),/Blue 1\/1/);
 assert(!before.legal.some(row=>row.action.type==='activate'&&row.action.card===card),'existing limitation: gained Blue does not pay the Blue orb');
 assert.deepEqual(before.view.you.energyColors!.find(row=>row.card===energy)!.paymentColors,['Red']);
 assert.match(energySummary(before.view.you),/Payment colours: Red 1\/1/);
 assert.match(energySummary(before.view.you,[],'effective'),/Blue 1\/1/);
 const hidden=structuredClone(state);hidden.cards[energy].hidden=true;
 const hiddenSnapshot=snapshot562(hidden);const publiclyBlue=hiddenSnapshot.view.you.energyColors!.find(row=>row.card===energy)!.paymentColors.includes('Blue');
 assert.deepEqual(hiddenSnapshot.view.you.energyColors!.find(row=>row.card===energy)!.paymentColors,[],'Hidden Mode has no payment colour even with public grants');
 const offersBlue=engine562.legalActions(fixtureContext(),hidden).some(row=>row.action.type==='activate'&&row.action.card===card);
 assert.equal(publiclyBlue,offersBlue,'public hidden-energy grant and actual Blue-cost planner agree');
 assert.equal(hiddenSnapshot.view.you.energy.find(row=>row.id===energy)!.colors.length,0,'hidden printed face remains withheld');
}
console.log('Battle stakes #562: resolver outcomes, replacement/pending uncertainty, privacy, effective energy colours/payment/source expiry and stale reload passed');
