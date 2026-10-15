/** Complete resource-frontier memoization: equivalence, boundedness, privacy and stops. */
import assert from "node:assert/strict";
import { canonicalJson } from "../../src/lib/arena/replay-core.ts";
import { localPolicy } from "../../src/lib/arena/policy/combat.ts";
import { policyTurn, localStep } from "../../src/lib/arena/policy/boundary.ts";
import { localMemory } from "../../src/lib/arena/policy/main.ts";
import { policyRng } from "../../src/lib/arena/policy/rng.ts";
import { searchDecision, SEARCH_CACHE_LIMITS, SEARCH_LIMITS, type SearchResult } from "../../src/lib/arena/policy/search.ts";
import { strategyCases } from "./arena-policy-strategy.ts";
import { mergeSearchTelemetry, recordSearchTelemetry, searchTelemetry, telemetryStatuses, validSearchTelemetry } from "../lib/arena-search-telemetry.ts";
import { permutedFor } from "./arena-policy-permute.ts";
import { policyPin } from "../lib/policy-evaluation-manifest.ts";

const {cases}=await strategyCases();
const telemetry=searchTelemetry();
let completed=0,hits=0,stops=0,stoppedAfterHit=false;
const chosen=(r:SearchResult)=>({answer:r.answer,rng:r.rng});
for(const c of cases) {
  let match=c.match;
  // The defensive fixture initially asks the attacker to pass its combo window.
  if(c.seat==="p2") {
    const next=localStep(match,"p1",0,localMemory(policyRng(7)),localPolicy());
    assert.ok(next.ok);if(next.ok) match=next.match;
  }
  const input=policyTurn(match,c.seat,0).input;
  const initial=canonicalJson(input);
  for(let seed=0;seed<24;seed++) {
    const rng=policyRng(83400+seed);
    const off=searchDecision(input,rng,{frontierCache:false});
    assert.deepEqual(searchDecision(input,rng),off,"default remains uncached");
    const on=searchDecision(input,rng,{frontierCache:true});
    recordSearchTelemetry(telemetry,on);
    if(off.status==="searched" && on.status==="searched") {assert.deepEqual(chosen(on),chosen(off),c.key);completed++;}
    hits+=on.cache.hits;
    assert.ok(on.cache.entries<=SEARCH_CACHE_LIMITS.entries && on.cache.retainedBytes<=SEARCH_CACHE_LIMITS.bytes);
    assert.ok(on.reservedBytes<=SEARCH_LIMITS.bytes);
    assert.deepEqual(searchDecision(JSON.parse(JSON.stringify(input)),JSON.parse(JSON.stringify(rng)),{frontierCache:true}),on,"JSON reload retains cache answer and RNG");
  }
  const rng=policyRng(9),fallback=localPolicy()(input,rng);
  for(const nodes of [0,1,2,4,8,16,32,64,128,256]) {
    const r=searchDecision(input,rng,{frontierCache:true,nodes});
    if(r.status==="nodes") {assert.deepEqual(chosen(r),fallback);stops++;}
    if(nodes<=2) assert.equal(r.cache.entries,0,"incomplete traversal is never cached");
  }
  for(const stop of ["cancelled","deadline","memory"] as const) {
    let polls=0;
    const r=searchDecision(input,rng,{frontierCache:true,stop:()=>++polls>8?stop:null});
    if(r.status===stop) {assert.deepEqual(chosen(r),fallback);stops++;}
  }
  const full=searchDecision(input,rng,{frontierCache:true});
  if(full.status==="searched" && full.cache.hits>0) {
    let polls=0;
    const late=searchDecision(input,rng,{frontierCache:true,stop:()=>++polls>Math.floor(full.nodes*.8)?"cancelled":null});
    assert.equal(late.status,"cancelled");assert.deepEqual(chosen(late),fallback);
    stoppedAfterHit ||= late.cache.hits>0;
  }
  for(const frontierCacheBytes of [0,255,256,480,1024]) {
    const r=searchDecision(input,rng,{frontierCache:true,frontierCacheBytes});
    assert.ok(r.cache.retainedBytes<=frontierCacheBytes);
    const off=searchDecision(input,rng);
    if(r.status==="searched" && off.status==="searched") assert.deepEqual(chosen(r),chosen(off),"capacity skip changes no score");
  }
  for(let salt=1;salt<=4;salt++) {
    const twin=policyTurn(permutedFor(match,c.seat,salt),c.seat,0).input;
    assert.deepEqual(twin,input,"hidden identity permutations leave input unchanged");
    assert.deepEqual(searchDecision(twin,rng,{frontierCache:true}),searchDecision(input,rng,{frontierCache:true}),"cache never keys on hidden state");
  }
  const unmapped=structuredClone(input);unmapped.decisions.window="private-arbitrary-window";
  const unknown=searchDecision(unmapped,rng,{frontierCache:true},()=>fallback);
  assert.equal(unknown.window,"other");assert.equal(unknown.phase,"other");assert.equal(unknown.reason,"not_search_window");
  recordSearchTelemetry(telemetry,unknown);
  assert.equal(canonicalJson(input),initial,"cache does not mutate the restricted observation");
}
assert.ok(stoppedAfterHit,"cache-hit paths still poll cancellation and discard sampled RNG");
// Eight distinct resources exercise exact energy/spent/excluded masks at the model ceiling.
const large=policyTurn(cases[0].match,"p1",0).input;
const card=large.observation.you.hand![0];
for(const energy of [0,1,2,4]) {
  const input=structuredClone(large);input.observation.you.activeEnergy=energy;
  input.observation.you.hand=Array.from({length:7},(_,i)=>({...card,id:`resource-${i}`,comboCost:i%2,comboPower:(1+i%3)*5000}));
  const rng=policyRng(47),off=searchDecision(input,rng,{depth:1,samples:1}),on=searchDecision(input,rng,{depth:1,samples:1,frontierCache:true});
  assert.equal(off.status,"searched");assert.equal(on.status,"searched");assert.deepEqual(chosen(on),chosen(off));
  assert.ok(on.cache.retainedBytes<=SEARCH_CACHE_LIMITS.bytes && on.reservedBytes<=SEARCH_LIMITS.bytes);
  const tiny=searchDecision(input,rng,{frontierCache:true,bytes:1});
  assert.equal(tiny.status,"memory");assert.equal(tiny.reason,"memory_budget");assert.deepEqual(chosen(tiny),localPolicy()(input,rng));
}
assert.ok(completed>=72);assert.ok(hits>0,"repeated exact frontiers are reused");assert.ok(stops>0);
assert.ok(validSearchTelemetry(telemetry));
const copy=structuredClone(telemetry),merged=mergeSearchTelemetry([telemetry,copy]);
assert.ok(validSearchTelemetry(merged));assert.equal(merged.decisions,2*telemetry.decisions);
assert.equal(merged.cache.hits,2*telemetry.cache.hits);assert.equal(merged.cache.maxRetainedBytes,telemetry.cache.maxRetainedBytes);
assert.deepEqual(telemetry,copy,"aggregate merge never mutates the source");
assert.equal(Object.values(telemetryStatuses(telemetry)).reduce((a,b)=>a+b,0),telemetry.decisions);
for(const mutate of [
  (x:Record<string,unknown>)=>{x.privateState="forbidden";},
  (x:Record<string,unknown>)=>{x.decisions=99999;},
  (x:Record<string,unknown>)=>{(x.byWindow as Record<string,unknown>)["card-private/main"]={};},
  (x:Record<string,unknown>)=>{(x.cache as Record<string,unknown>).maxEntries=65;},
]) {const x=structuredClone(telemetry) as unknown as Record<string,unknown>;mutate(x);assert.equal(validSearchTelemetry(x),false);}
assert.notEqual(policyPin("candidate",2,true).sha256,policyPin("candidate",2,false).sha256,"policy pin includes cache configuration");
console.log(`arena-policy-frontier-cache: ${completed} completed cache-on/off answer+RNG pairs; ${hits} hits; ${stops} exact budget/host fallbacks; capacity/JSON/purity/hash and telemetry conservation/privacy checks passed`);
