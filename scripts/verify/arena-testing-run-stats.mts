import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scoreImportedRun } from '../../src/lib/arena/testing/run-stats';
import { validateEvaluationManifest, type PolicyEvalManifest } from '../../src/lib/arena/testing/run-manifest';
const input = JSON.parse(fs.readFileSync('docs/arena-backlog/evidence/826/holdout-30m-manifest.json','utf8'));
assert.equal(validateEvaluationManifest(input).ok,true);
const run = input as PolicyEvalManifest;
const actual = scoreImportedRun(run);
assert.equal(actual.games,320);
assert.equal(actual.policies.length,2);
assert.deepEqual(actual.policies.map(r => [r.games,r.appearances,r.wins,r.losses]).sort((a,b)=>a[2]-b[2]),[[320,320,142,178],[320,320,178,142]]);
assert.equal(actual.decks.reduce((n,r)=>n+r.appearances,0),640);
// One same-policy/same-composition mirror must expose two appearances but one game.
const mirror = structuredClone(run);
mirror.results = [structuredClone(run.results[0])];
mirror.fixtures = [structuredClone(run.fixtures.find(f=>f.key===mirror.results[0].fixtureKey)!)];
mirror.results[0].baselinePolicyKey = mirror.results[0].candidatePolicyKey;
mirror.results[0].winner = 'p2';
mirror.results[0].candidateSeat = 'p1';
mirror.results[0].outcome = 'loss';
mirror.fixtures[0].p1DeckSha256 = mirror.fixtures[0].p2DeckSha256 = 'f'.repeat(64);
let scores=scoreImportedRun(mirror);
assert.deepEqual([scores.policies[0].games,scores.policies[0].appearances,scores.policies[0].wins,scores.policies[0].losses],[1,2,1,1]);
assert.equal(scores.decks.length,1);assert.equal(scores.decks[0].games,1);assert.equal(scores.decks[0].appearances,2);
// Missing composition hashes never merge two seats, even with a matching recipe.
mirror.fixtures[0].p1DeckSha256 = mirror.fixtures[0].p2DeckSha256 = null;
assert.equal(scoreImportedRun(mirror).decks.length,2);
for (const outcome of ['draw','interrupted','limit','illegal'] as const) {
  mirror.results[0].outcome=outcome;mirror.results[0].winner=null;
  scores=scoreImportedRun(mirror);
  const row=scores.policies[0];
  assert.equal(row.winRate,null);assert.equal(row.wins+row.losses,0);
  assert.equal(row[outcome==='draw'?'draws':outcome==='limit'?'limited':outcome],2);
}
// Same friendly version with different source hashes remains a separate policy.
mirror.results[0].baselinePolicyKey=run.results[0].baselinePolicyKey;
mirror.policies.forEach(p=>p.version='same-name');
assert.equal(scoreImportedRun(mirror).policies.length,2);
const scenario=JSON.parse(fs.readFileSync('docs/arena-backlog/evidence/827/scenario-manifest.json','utf8'));
assert.deepEqual(scoreImportedRun(scenario),{games:0,policies:[],decks:[]});
console.log('imported run scores: frozen 320-game totals, both seats, mirror denominators, unknown composition, policy pins and unfinished outcomes pass');
