#!/usr/bin/env node
/** O5-03 paired search-versus-frozen-heuristic evaluation. No database/network.
 * npm run arena:search-eval -- --seeds 2 --seed-set dev --depth 2 --out FILE
 * Each deal is played in both seats. All unfinished/failed games remain in the
 * report; a negative experiment exits 0, a legality/privacy failure exits 1.
 * Long runs: --checkpoint /tmp/run.json; after a crash use --resume /tmp/run.json
 * with identical evaluation arguments. Completed game attempts are never rerun.
 */
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { loadAuditFixtures, loadFixtures } from "./verify/arena-policy-fixtures.mts";
import { playDuel, quantile, wilson, type DuelResult } from "./verify/arena-policy-duel.ts";
import { gameSeed, verifySeedSets } from "./verify/arena-policy-seeds.ts";
import { SEARCH_EVAL_SETS, SEARCH_STRENGTH_GATE } from "./verify/arena-search-protocol.ts";
import { SEARCH_FRONTIER_DEV_PROTOCOL } from "./verify/arena-search-frontier-protocol.ts";
import { recordSearchTelemetry, searchTelemetry, mergeSearchTelemetry } from "./lib/arena-search-telemetry.ts";
import { evaluationRunnerPin } from "./lib/evaluation-provenance.ts";
import { evidenceHash, fixturePin, policyPin, assertManifest, writeEvidenceFile } from "./lib/policy-evaluation-manifest.ts";
import type { PolicyEvalManifest } from "../src/lib/arena/testing/run-manifest.ts";
import { permutedFor } from "./verify/arena-policy-permute.ts";
import { policyTurn, applyDecision } from "../src/lib/arena/policy/boundary.ts";
import { localPolicy, COMBAT_POLICY_VERSION } from "../src/lib/arena/policy/combat.ts";
import { MAIN_POLICY_VERSION } from "../src/lib/arena/policy/main.ts";
import { CHOICE_POLICY_VERSION } from "../src/lib/arena/policy/choices.ts";
import { policyRng } from "../src/lib/arena/policy/rng.ts";
import { searchPolicy, searchDecision, SEARCH_LIMITS, SEARCH_VERSION, SEARCH_PROTOCOL_REVISION, type SearchReport } from "../src/lib/arena/policy/search.ts";
import { externalCheckpointPath, loadEvaluationCheckpoint, saveEvaluationCheckpoint, checkpointChecks, type EvaluationJob, type EvaluationPins, type EvaluationRecord } from "./lib/arena-search-checkpoint.ts";

// Declared before the first O5 holdout run. Browser and memory evidence are
// mandatory external gates; Node latency alone cannot enable a difficulty.
export const STRENGTH_GATE = SEARCH_STRENGTH_GATE;
const args = process.argv.slice(2);
const valued = new Set(["--seeds", "--seed-set", "--fixtures", "--max-moves", "--out", "--depth", "--manifest", "--checkpoint", "--resume", "--frontier-cache"]);
for (const a of args) if (a.startsWith("--") && !valued.has(a) && !["--allow-holdout", "--synthetic"].includes(a)) throw new Error(`unknown flag ${a}`);
const flag = (name: string, fallback: string) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const seeds = Number(flag("--seeds", "2"));
const maxMoves = Number(flag("--max-moves", "3000"));
const depth=Number(flag("--depth","2"));
if(depth!==2 && depth!==3) throw new Error("depth must be 2 or 3");
const cacheMode=flag("--frontier-cache","off");
if(cacheMode!=="off" && cacheMode!=="on") throw new Error("--frontier-cache must be off or on");
const frontierCache=cacheMode==="on";
const runner=evaluationRunnerPin("arena-policy-eval","3");
const checkpointArg=flag("--checkpoint",""),resumeArg=flag("--resume","");
if(checkpointArg && resumeArg) throw new Error("choose --checkpoint FILE for a new run or --resume FILE for an existing one");
const checkpointPath=checkpointArg || resumeArg ? externalCheckpointPath(checkpointArg || resumeArg) : null;
if(checkpointArg && fs.existsSync(checkpointPath!)) throw new Error("checkpoint already exists; use --resume to keep completed attempts, or choose a fresh path");
if(checkpointPath) for(const name of ["--out","--manifest"]) {
  const file=flag(name,"");
  if(file && externalCheckpointPath(file)===checkpointPath) throw new Error("report/manifest cannot overwrite the checkpoint");
}
const setName = flag("--seed-set", "dev") as keyof typeof SEARCH_EVAL_SETS;
const set = SEARCH_EVAL_SETS[setName];
if (!set || !Number.isInteger(seeds) || seeds < 1 || seeds > set.size || !Number.isInteger(maxMoves) || maxMoves < 1) throw new Error("invalid seed set, seed count or move cap");
if(set.reserved) throw new Error("This frontier-cache batch is development-only. +10M/+20M/+30M are consumed; a new reviewed holdout protocol is required.");
const fixtures = args.includes("--synthetic") ? await loadFixtures() : await loadAuditFixtures();
const wanted = flag("--fixtures", fixtures.map((f) => f.name).join(",")).split(",");
assert.ok(wanted.every((name) => fixtures.some((f) => f.name === name)), "unknown fixture");
const selected = fixtures.filter((f) => wanted.includes(f.name));
verifySeedSets(selected.map((f) => f.seed));
const baseline = localPolicy();
const candidatePolicyKey=`search-v3-d${depth}-cache-${cacheMode}`;
// A/B are exact audited amended SD15 / SD5 lists, not generic synthetic recipes.
const recipe=(key:string)=>key==="A"?"sd15-01-pride-of-the-saiyans-starter-control":key==="B"?"sd5-01-crimson-saiyan-starter-control":null;
const fixturePins=selected.map((f)=>fixturePin(`fixture-${f.name.toLowerCase()}`,f.bundle,f.revision,args.includes("--synthetic")?{p1:null,p2:null}:{p1:recipe(f.name.split("v")[0]),p2:recipe(f.name.split("v")[1])}));
const policyPins=[policyPin(candidatePolicyKey,depth,frontierCache),policyPin("heuristic-v1")];
const schedule:EvaluationJob[]=selected.flatMap((fixture)=>Array.from({length:seeds},(_,k)=>(["p1","p2"] as const).map((seat)=>{
  const policySeed=7919+k*2+(seat==="p2"?1:0);
  return {fixture:fixture.name,k,seat,gameSeed:gameSeed(set,fixture.seed,k),policySeed,initialPolicyRng:{p1:policyRng(policySeed*2+1),p2:policyRng(policySeed*2+2)}};
})).flat());
const pins:EvaluationPins={runner,fixtures:fixturePins,policies:policyPins,jobs:schedule,configuration:{
  protocolRevision:SEARCH_PROTOCOL_REVISION,seedSet:set,seeds,depth,frontierCache,maxMoves,synthetic:args.includes("--synthetic"),limits:SEARCH_LIMITS,gate:STRENGTH_GATE,developmentProtocol:SEARCH_FRONTIER_DEV_PROTOCOL,
}};
const resumed=resumeArg?loadEvaluationCheckpoint(checkpointPath!,pins):null;
const requestId=resumed?.requestId ?? randomUUID();
const records:EvaluationRecord[]=[...(resumed?.records ?? [])];
const resumedGames=records.length;
let {privacyChecks,nontrivialTwins,executionFailures}=checkpointChecks(records);
if(checkpointPath && !resumed) saveEvaluationCheckpoint(checkpointPath,pins,requestId,records);
if(resumed) console.log(`Resuming ${resumedGames}/${schedule.length} saved game attempts; saved outcomes and counters are retained.`);
for (const [jobIndex,job] of schedule.entries()) {
  if(jobIndex<resumedGames) continue;
  const fixture=selected.find((f)=>f.name===job.fixture)!;
  const {k,seat}=job;
  const beforeChecks={privacyChecks,nontrivialTwins,executionFailures};
  const timings: number[] = [];
  const statuses: Record<string, number> = {};
  const telemetry=searchTelemetry();
  let maxNodes = 0;
  let maxReservationBytes = 0;
  const candidate = searchPolicy({depth,frontierCache}, (r: SearchReport) => {
    statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    recordSearchTelemetry(telemetry,r);
    maxNodes = Math.max(maxNodes, r.nodes);
    maxReservationBytes = Math.max(maxReservationBytes, r.reservedBytes);
  });
  const measured: typeof candidate = (input, rng) => {
    const start = performance.now();
    const answer = candidate(input, rng);
    timings.push(performance.now() - start);
    return answer;
  };
  let result: DuelResult;
  try { result = await playDuel({ bundle: fixture.bundle, interpreterRevision: fixture.revision,
    gameSeed:job.gameSeed, policySeed:job.policySeed,
    testSeat: seat, test: measured, baseline, maxMoves,
    observe: (match, actor, revision) => {
      if (actor !== seat || revision % 20) return;
      const twin = permutedFor(match, actor, revision + 663);
      if (JSON.stringify(match.state) !== JSON.stringify(twin.state)) nontrivialTwins++;
      const turn = policyTurn(match, actor, revision);
      const twinTurn = policyTurn(twin, actor, revision);
      assert.deepEqual(twinTurn.input, turn.input, "restricted observation invariant");
      const r = policyRng(revision + 663);
      const choice = searchDecision(turn.input, r,{depth,frontierCache});
      assert.deepEqual(searchDecision(twinTurn.input, r,{depth,frontierCache}), choice, "sample/answer/node-count invariant");
      assert.ok(applyDecision(twin, twinTurn.key, choice.answer).ok, "answer plays on the twin");
      privacyChecks++;
    },
  }); } catch(error) {
    executionFailures++;
    // Preserve an attempted game even if a privacy assertion or runtime fails.
    // Raw diagnostics remain in the local report; portal receives their digest.
    result={over:false,winner:null,reason:null,moves:0,turn:0,damageDealt:0,damageTaken:0,guards:{test:0,baseline:0},
      stopped:`execution failure: ${String(error)}`,stopKind:"interrupted",stepMs:[],steps:[],trace:"00000000"};
  }
  records.push({ fixture: fixture.name, k, seat, result, policyMs: timings, search: statuses,telemetry,maxNodes, maxReservationBytes, nodeHeapAfterBytes: process.memoryUsage().heapUsed,
    checks:{privacyChecks:privacyChecks-beforeChecks.privacyChecks,nontrivialTwins:nontrivialTwins-beforeChecks.nontrivialTwins,executionFailures:executionFailures-beforeChecks.executionFailures} });
  assert.deepEqual(evaluationRunnerPin("arena-policy-eval","3"),runner,"source changed during evaluation; last completed game was not checkpointed");
  if(checkpointPath) saveEvaluationCheckpoint(checkpointPath,pins,requestId,records);
  console.log(`${fixture.name} ${setName}[${k}] ${seat}: ${result.winner ?? `UNFINISHED ${result.stopKind}: ${result.stopped}`} ${result.moves} moves; searched ${statuses.searched ?? 0}, node fallback ${statuses.nodes ?? 0}`);
}
const dist = (xs: number[]) => ({ n: xs.length, p50: quantile(xs, .5), p95: quantile(xs, .95), max: xs.length ? Math.max(...xs) : null });
const rows = selected.map((f) => {
  const rs = records.filter((r) => r.fixture === f.name);
  const pairs = { wonBoth: 0, split: 0, lostBoth: 0, incomplete: 0 };
  for (let k = 0; k < seeds; k++) {
    const outcomes = rs.filter((r) => r.k === k).map((r) => r.result.winner);
    if (outcomes.some((r) => r === null || r === "draw")) pairs.incomplete++;
    else if (outcomes.every((r) => r === "test")) pairs.wonBoth++;
    else if (outcomes.every((r) => r === "baseline")) pairs.lostBoth++;
    else pairs.split++;
  }
  const bySeat = Object.fromEntries((["p1", "p2"] as const).map((seat) => {
    const s = rs.filter((r) => r.seat === seat);
    const wins = s.filter((r) => r.result.winner === "test").length;
    const losses = s.filter((r) => r.result.winner === "baseline").length;
    const complete = s.filter((r) => r.result.over).length;
    const illegal = s.filter((r) => r.result.stopKind === "illegal").length;
    return [seat, { games: s.length, wins, losses, draws: s.filter((r) => r.result.winner === "draw").length, complete, completionRate: complete / s.length,
      completionCi95: wilson(complete, s.length), illegal, illegalRate: illegal / s.length, illegalCi95: wilson(illegal, s.length), winCi95: wilson(wins, wins + losses) }];
  }));
  const decisivePairs=pairs.wonBoth+pairs.lostBoth;
  return { fixture: f.name, games: rs.length, bySeat, pairs, decisivePairs, insufficientPower:decisivePairs<STRENGTH_GATE.perFixturePowerMarkerPairs,decisivePairCi95: wilson(pairs.wonBoth, decisivePairs),
    telemetry:mergeSearchTelemetry(rs.map((r)=>r.telemetry)),
    policyMs: dist(rs.flatMap((r) => r.policyMs)), stepMs: dist(rs.flatMap((r) => r.result.steps.filter((s) => s.role === "test").map((s) => s.ms))),
    maxReservationBytes: Math.max(...rs.map((r) => r.maxReservationBytes)), nodeHeapAfterBytes: dist(rs.map((r) => r.nodeHeapAfterBytes)) };
});
const paired = rows.reduce((s, r) => ({ wonBoth: s.wonBoth + r.pairs.wonBoth, lostBoth: s.lostBoth + r.pairs.lostBoth }), { wonBoth: 0, lostBoth: 0 });
const decisive = paired.wonBoth + paired.lostBoth;
const strengthEligible = false; // Development comparison is never a promotion gate.
const report = {
  experiment: "Resource frontier cache development",requestId,runner,resumedGames,protocolRevision:SEARCH_PROTOCOL_REVISION,depth,frontierCache,candidateVersion: SEARCH_VERSION,limits: SEARCH_LIMITS,
  developmentProtocol:SEARCH_FRONTIER_DEV_PROTOCOL,matchesDevelopmentProtocol:!args.includes("--synthetic") && setName==="dev" && seeds===4 && depth===2 && maxMoves===3000 && selected.map((f)=>f.name).join(",")==="AvA,AvB,BvA,BvB",telemetry:mergeSearchTelemetry(records.map((r)=>r.telemetry)),
  candidateSourceSha256: createHash("sha256").update(fs.readFileSync("src/lib/arena/policy/search.ts")).digest("hex"),
  frozenBaseline: { main: MAIN_POLICY_VERSION, combat: COMBAT_POLICY_VERSION, choices: CHOICE_POLICY_VERSION },
  seedSet: setName, seedsPerFixture: seeds, synthetic: args.includes("--synthetic"), gate: STRENGTH_GATE,
  privacyChecks, nontrivialTwins, executionFailures, insufficientPower:decisive<STRENGTH_GATE.decisivePairs,rows, strengthEligible,
  difficultyEnabled:false,promotion:"Development only. This report cannot enable a difficulty or claim strength.",
  memoryMethod: "Node heapUsed immediately after each game includes the engine, bundle and accumulated report; not peak search memory or browser retained heap. Search reservation is a structural estimate.",
  // Complete records preserve failed runs and their exact stop detail.
  records: records.map(({ result, policyMs, ...record }) => ({
    ...record,
    gameSeed: gameSeed(set, selected.find((f) => f.name === record.fixture)!.seed, record.k),
    policySeed: 7919 + record.k * 2 + (record.seat === "p2" ? 1 : 0),
    result: { ...result, stepMs: dist(result.stepMs), steps: Object.fromEntries([...new Set(result.steps.map((s) => `${s.role}/${s.window}`))].sort().map((key) =>
      [key, dist(result.steps.filter((s) => `${s.role}/${s.window}` === key).map((s) => s.ms))])) },
    policyMs: dist(policyMs),
  })),
};
const out = flag("--out", "");
const manifest:PolicyEvalManifest={version:1,requestId,source:"policy_eval",runner,seedSet:setName,
  protocol:{id:SEARCH_FRONTIER_DEV_PROTOCOL.id,revision:SEARCH_PROTOCOL_REVISION},
  fixtures:fixturePins,policies:policyPins,
  results:records.map(({fixture,k,seat,result})=>{
    const policySeed=7919+k*2+(seat==="p2"?1:0), opposite=seat==="p1"?"p2":"p1";
    return {key:`${fixture.toLowerCase()}-${k}-${seat}`,kind:"policy_game",fixtureKey:`fixture-${fixture.toLowerCase()}`,candidatePolicyKey,baselinePolicyKey:"heuristic-v1",
      seedIndex:k,seed:gameSeed(set,selected.find((f)=>f.name===fixture)!.seed,k),candidateSeat:seat,
      initialPolicyRng:{p1:{mode:"seeded",...policyRng(policySeed*2+1)},p2:{mode:"seeded",...policyRng(policySeed*2+2)}},
      outcome:result.winner==="test"?"win":result.winner==="baseline"?"loss":result.winner==="draw"?"draw":result.stopKind==="illegal"?"illegal":result.stopKind==="limit"?"limit":"interrupted",
      winner:result.winner==="test"?seat:result.winner==="baseline"?opposite:null,moves:result.moves,turn:result.turn,damageDealt:result.damageDealt,damageTaken:result.damageTaken,
      guardTrips:result.guards.test+result.guards.baseline,stopKind:result.stopKind,reportedCostMicros:0,evidenceSha256:evidenceHash(result)};
  })};
assertManifest(manifest);
assert.deepEqual(evaluationRunnerPin("arena-policy-eval","3"),runner,"source changed during evaluation; discard evidence and rerun");
const manifestFile=flag("--manifest","");
if(manifestFile) writeEvidenceFile(manifestFile,`${JSON.stringify(manifest,null,2)}\n`);
if (out) {
  const { records: gameRecords, ...summary } = report;
  // Keep summary reviewable and one game outcome/trace/timing summary per line.
  // Every failed game remains present; raw individual timing samples are not
  // needed to review strength, legality or a per-window distribution.
  const head = JSON.stringify(summary, null, 2).slice(0, -2);
  writeEvidenceFile(out, `${head},\n  "records": [\n${gameRecords.map((r) => `    ${JSON.stringify(r)}`).join(",\n")}\n  ]\n}\n`);
}
console.log(JSON.stringify({ rows, privacyChecks, nontrivialTwins, strengthEligible, difficultyEnabled: false }, null, 2));
process.exit(executionFailures || records.some((r) => r.result.stopKind === "illegal") ? 1 : 0);
