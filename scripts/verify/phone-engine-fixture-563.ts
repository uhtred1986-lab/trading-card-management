/** Phone layout setup only; every offer, cost and resulting snapshot is EngineAPI output. */
import assert from 'node:assert/strict';
import { DEFS } from './harness';
import { battleFixture, snapshot562, apply562, engine562, fixtureContext } from './battle-engine-fixture-562';
import { rulesetFor } from '../../src/lib/arena/rulesets';
import { moveCard } from '../../src/lib/arena/vm/zones';
import type { VmState } from '../../src/lib/arena/vm/state';

// Synthetic definitions have no catalog artwork and visibly say what they are.
for (const def of Object.values(DEFS)) if (!['BT11-053', 'BT1-055'].includes(def.id)) {
 def.name = `Synthetic ${def.id}`;
 if (def.back) def.back.name = `Synthetic ${def.id} awakened`;
}
export function phoneFixture(count: 12 | 20 = 20) {
 const { state } = battleFixture();
 const loaded = rulesetFor('dbs'); assert(loaded.ok);
 const side = state.sides.p1;
 const stage = (zone: string, definition: string) => {
  const id = side.zones.deck.at(-1)!; state.cards[id].cardId = definition;
  assert(moveCard(state, loaded.definition, id, zone, { owner: 'p1' }).ok);
  return id;
 };
 stage('unison', 'U1'); stage('battle', 'ZB'); stage('zDeck', 'ZB');
 stage('zEnergy', 'V1'); stage('drop', 'BT11-053'); stage('warp', 'BT1-055');
 while (side.zones.hand.length < count) stage('hand', side.zones.hand.length % 3 ? 'V1' : 'BT11-053');
 assert.equal(side.zones.hand.length, count);
 return { state, snapshot: snapshot562(state, 2, 'p1', 563) };
}
/** A real rules-engine Charge prompt for checking touch drag and its landing cue. */
export function chargeFixture() {
 let state=engine562.createGame(fixtureContext(),{
  seed:7,
  p1:{name:'You',leader:'L-RED',main:Array(50).fill('V1')},
  p2:{name:'Opponent',leader:'L-BLUE',main:Array(50).fill('V-BLUE')},
 }).state as VmState;
 state=apply562(state,{type:'chooseFirst',player:state.chooser,first:'p1'}).state as VmState;
 state=apply562(state,{type:'mulligan',player:'p1',redraw:false}).state as VmState;
 state=apply562(state,{type:'mulligan',player:'p2',redraw:false}).state as VmState;
 assert.equal(state.prompt.kind,'charge');
 return {state,snapshot:snapshot562(state,10,'p1',563)};
}
export { snapshot562 as snapshot563, apply562 as apply563 };
