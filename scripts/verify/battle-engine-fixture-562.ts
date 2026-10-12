/** Staged public fixtures; windows, legal actions, costs and snapshots come from EngineAPI. */
import { CTX, DEFS, card, rulesFromCompiler } from './harness';
import { makeSenzuFixture } from './ability-engine-fixture-561';
import { engineFor } from '../../src/lib/arena/engines';
import { buildSnapshot } from '../../src/lib/arena/snapshot';
import type { Action, PlayerId } from '../../src/lib/arena/types';
import type { VmState } from '../../src/lib/arena/vm/state';
import { rulesetFor } from '../../src/lib/arena/rulesets';
import { moveCard } from '../../src/lib/arena/vm/zones';
import assert from 'node:assert/strict';
const leaderStats = { type: 'LEADER' as const, colors: ['Blue' as const], energyCost: null, comboCost: null, comboPower: null };
const definitions = {
 U05_DOUBLE: card('U05_DOUBLE',{...leaderStats,skill:'[Double Strike]'}),
 U05_CRITICAL: card('U05_CRITICAL',{...leaderStats,skill:'[Critical]'}),
 U05_VICTORY: card('U05_VICTORY',{...leaderStats,skill:'[Victory Strike]'}),
 U05_COST_COMBO: card('U05_COST_COMBO',{comboCost:1,comboPower:5000}),
 U05_PENDING: card('U05_PENDING',{skill:'[Auto] When this card is played, draw 1 card.'}),
 U05_REVEALER: card('U05_REVEALER',{skill:"[Permanent] During your opponent's turn, if you would add a card from your life to your hand or place it in your Drop Area, you may reveal it and add it to your hand instead."}),
 U05_UNISON: card('U05_UNISON',{type:'UNISON',power:10000,comboCost:null,comboPower:null}),
 U05_INDESTRUCT: card('U05_INDESTRUCT',{skill:'[Indestructible]'}),
 U05_RED_ENERGY: card('U05_RED_ENERGY',{colors:['Red'],skill:null}),
};
Object.assign(DEFS,definitions);
/** Staged fixtures must preserve the card types and statistics of their public areas. */
export function assertFixtureAreas(state: VmState): void {
 for (const side of Object.values(state.sides)) {
  for (const [area, type] of [['leader', 'LEADER'], ['unison', 'UNISON']] as const) {
   for (const id of side.zones[area] ?? []) {
    const definition = DEFS[state.cards[id].cardId];
    assert.equal(definition?.type, type, `${side.id} ${area} area requires a ${type} definition (${id})`);
    assert.equal(definition.comboCost, null, `${type} has no combo cost`);
    assert.equal(definition.comboPower, null, `${type} has no combo power`);
    if (type === 'LEADER') assert.equal(definition.energyCost, null, 'LEADER has no energy cost');
   }
  }
 }
}
export function battleFixture(kind:'tie'|'double'|'critical'|'lethal'|'victory'='tie') {
 const made=makeSenzuFixture('http://arena-561-art.local/BT11-053.jpg');
 const state=structuredClone(made.state);
 if(kind!=='tie') state.cards[state.battle!.attacker]!.cardId=kind==='critical'?'U05_CRITICAL':kind==='victory'?'U05_VICTORY':'U05_DOUBLE';
 if(kind==='lethal') {
  const loaded=rulesetFor('dbs');if(!loaded.ok)throw Error('DBS unavailable');
  while(state.sides.p1.zones.life.length>2) moveCard(state,loaded.definition,state.sides.p1.zones.life.at(-1)!,'deck',{owner:'p1'});
 }
 assertFixtureAreas(state);
 return {state,card:made.card,energy:made.energy};
}
export function fixtureContext(){return {...CTX,defs:DEFS,scripts:rulesFromCompiler(DEFS)};}
export const engine562=engineFor('rules');
export function apply562(state:VmState,action:Action){return engine562.apply(fixtureContext(),state,action);}
export function snapshot562(state:VmState,revision=1,viewer:PlayerId='p1',id=562) {
 assertFixtureAreas(state);
 const ctx=fixtureContext();return buildSnapshot({id,revision,engine:'rules',mode:'versus',status:'playing',p1Name:'You',p2Name:'Opponent',ctx,state,legal:engine562.legalActions(ctx,state),log:[],beats:null,spotlight:null,spend:{calls:0,input:0,output:0,cached:0,micros:0},ai:null,viewer,images:{'BT11-053':{front:'http://arena-561-art.local/BT11-053.jpg',back:null},'BT1-055':{front:'http://arena-561-art.local/BT1-055.webp',back:null}}});
}
export function paymentFixture(){
 const {state}=battleFixture();const loaded=rulesetFor('dbs');if(!loaded.ok)throw Error('DBS unavailable');
 const ids=state.sides.p1.zones.hand.filter(id=>!['BT11-053','BT1-055'].includes(state.cards[id].cardId));
 const red=ids[0]!;state.cards[red].cardId='U05_RED_ENERGY';moveCard(state,loaded.definition,red,'energy',{owner:'p1'});state.cards[red].mode='active';
 const combo=ids[1]!;state.cards[combo].cardId='U05_COST_COMBO';
 const result=apply562(state,{type:'combo',player:'p1',card:combo});
 if(result.state.prompt.kind!=='payCost')throw Error(`Expected real payCost, got ${result.state.prompt.kind}`);
 return {state:result.state as VmState,combo};
}

/** An occupied row must retain its ordinary card footprint during hand decisions. */
export function occupiedFixture() {
 const {state}=battleFixture();const loaded=rulesetFor('dbs');if(!loaded.ok)throw Error('DBS unavailable');
 const cardId=state.sides.p1.zones.hand.find(id=>state.cards[id].cardId==='V1')!;
 assert(cardId,'fixture has a public Battle Card to stage');
 const moved=moveCard(state,loaded.definition,cardId,'battle',{owner:'p1'});assert(moved.ok);
 assertFixtureAreas(state);return {state,card:cardId};
}
