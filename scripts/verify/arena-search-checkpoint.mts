/** Kill/restart the actual evaluator, plus strict checkpoint pin/integrity tests. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { externalCheckpointPath, loadEvaluationCheckpoint, saveEvaluationCheckpoint, syncCheckpointDirectory, checkpointChecks, type EvaluationPins, type EvaluationRecord } from "../lib/arena-search-checkpoint.ts";

import { mergeSearchTelemetry, recordSearchTelemetry, searchTelemetry } from "../lib/arena-search-telemetry.ts";
import { SEARCH_VERSION } from "../../src/lib/arena/policy/search.ts";

const telemetry=searchTelemetry();
recordSearchTelemetry(telemetry,{version:SEARCH_VERSION,status:"searched",window:"main",phase:"main",reason:"complete",cache:{enabled:true,hits:2,misses:1,entries:1,retainedBytes:480,skipped:0},nodes:4,reservedBytes:2048,samples:1});
const folder=mkdtempSync(join(tmpdir(),"arena-checkpoint-proof-"));
const checkpoint=join(folder,"unit.json"),hash="a".repeat(64),rng={v:1 as const,seed:1,n:0};
const pins:EvaluationPins={runner:{id:"arena-policy-eval",version:"2",gitCommit:"b".repeat(40),dirtyTreeSha256:null},configuration:{depth:2,maxMoves:3000,seedBase:30_000_000,frontierCache:true},
  fixtures:[{key:"fixture-a",sourceId:"a",runtimeRevision:"abc1234",bundleSha256:hash,rulesSha256:hash,catalogSha256:hash,programsSha256:hash,p1DeckSha256:hash,p2DeckSha256:hash,p1RecipeId:null,p2RecipeId:null}],
  policies:[{key:"search-v2-d2",version:"2",sha256:hash}],jobs:(["p1","p2"] as const).map((seat)=>({fixture:"a",k:0,seat,gameSeed:30_649_000,policySeed:1,initialPolicyRng:{p1:rng,p2:rng}}))};
const row:EvaluationRecord={fixture:"a",k:0,seat:"p1",result:{over:false,winner:null,reason:null,moves:1,turn:1,damageDealt:0,damageTaken:0,guards:{test:0,baseline:0},stopped:"declared limit",stopKind:"limit",stepMs:[1],steps:[{ms:1,window:"main",role:"test"}],trace:"00000000"},
  policyMs:[.1],search:{searched:1},telemetry,maxNodes:1,maxReservationBytes:2048,nodeHeapAfterBytes:1,checks:{privacyChecks:2,nontrivialTwins:2,executionFailures:0}};
const requestId=randomUUID();
try {
  const calls:string[]=[];
  const io={open:()=>{calls.push("open");return 7;},sync:(fd:number)=>{assert.equal(fd,7);calls.push("sync");},close:(fd:number)=>{assert.equal(fd,7);calls.push("close");}};
  syncCheckpointDirectory(checkpoint,"win32",io);assert.deepEqual([...calls],[],"Windows skips only unsupported parent-directory sync");
  syncCheckpointDirectory(checkpoint,"linux",io);assert.deepEqual([...calls],["open","sync","close"],"Linux still opens, fsyncs and closes the directory");
  const openError=Object.assign(new Error("permission denied"),{code:"EACCES"});
  assert.throws(()=>syncCheckpointDirectory(checkpoint,"linux",{...io,open:()=>{throw openError;}}),(error)=>error===openError,"genuine Linux open failure propagates");
  const syncError=Object.assign(new Error("IO failure"),{code:"EIO"});calls.length=0;
  assert.throws(()=>syncCheckpointDirectory(checkpoint,"linux",{...io,sync:()=>{calls.push("sync");throw syncError;}}),(error)=>error===syncError,"genuine Linux fsync failure propagates");
  assert.deepEqual([...calls],["open","sync","close"],"directory closes even after fsync fails");
  const closeError=Object.assign(new Error("close IO failure"),{code:"EIO"});
  assert.throws(()=>syncCheckpointDirectory(checkpoint,"linux",{...io,close:()=>{throw closeError;}}),(error)=>error===closeError,"genuine close failure propagates");
  assert.equal(externalCheckpointPath(checkpoint),checkpoint);
  assert.throws(()=>externalCheckpointPath(resolve(".arena-checkpoint.json")),/outside every repository checkout/);
  { // A registered worktree whose folder is gone is skipped, not a crash.
    const repo=join(folder,"gone-repo"),gone=join(folder,"gone-worktree"),git=(cwd:string,...a:string[])=>execFileSync("git",["-c","user.name=t","-c","user.email=t@t",...a],{cwd,stdio:"pipe"});
    mkdirSync(repo);git(repo,"init","-q");git(repo,"commit","-q","--allow-empty","-m","x");git(repo,"worktree","add","-q","-b","gone",gone);
    rmSync(gone,{recursive:true,force:true});
    assert.equal(externalCheckpointPath(checkpoint,repo),checkpoint,"a missing worktree root is skipped");
    assert.throws(()=>externalCheckpointPath(join(repo,"in.json"),repo),/outside every repository checkout/,"the live checkout is still refused");
  }
  symlinkSync(process.cwd(),join(folder,"checkout"),process.platform==="win32"?"junction":"dir");
  assert.throws(()=>externalCheckpointPath(join(folder,"checkout","ignored.json")),/outside every repository checkout/);
  saveEvaluationCheckpoint(checkpoint,pins,requestId,[row]);
  if(process.platform!=="win32") assert.equal(statSync(checkpoint).mode&0o777,0o600);
  const saved=loadEvaluationCheckpoint(checkpoint,pins);
  assert.equal(saved.requestId,requestId);assert.deepEqual(saved.records,[row]);
  writeFileSync(`${checkpoint}.tmp-abandoned`,"{partial");
  assert.deepEqual(loadEvaluationCheckpoint(checkpoint,pins),saved,"orphan partial write does not replace last durable checkpoint");
  for(const change of [
    (p:EvaluationPins)=>{p.runner.gitCommit="c".repeat(40);},
    (p:EvaluationPins)=>{p.runner.dirtyTreeSha256=hash;},
    (p:EvaluationPins)=>{p.configuration={depth:3};},
    (p:EvaluationPins)=>{p.configuration={...(p.configuration as Record<string,unknown>),frontierCache:false};},
    (p:EvaluationPins)=>{p.fixtures[0].p2DeckSha256="c".repeat(64);},
    (p:EvaluationPins)=>{p.fixtures[0].runtimeRevision="different";},
    (p:EvaluationPins)=>{p.fixtures[0].rulesSha256="d".repeat(64);},
    (p:EvaluationPins)=>{p.policies[0].sha256="d".repeat(64);},
    (p:EvaluationPins)=>{p.jobs[0].gameSeed++;},
    (p:EvaluationPins)=>{p.jobs[0].initialPolicyRng.p1.n++;},
  ]) {const changed=structuredClone(pins);change(changed);assert.throws(()=>loadEvaluationCheckpoint(checkpoint,changed),/pin mismatch/);}
  assert.throws(()=>saveEvaluationCheckpoint(checkpoint,pins,requestId,[row,row]),/unique completed prefix/);
  assert.throws(()=>saveEvaluationCheckpoint(checkpoint,pins,requestId,[{...row,seat:"p2"}]),/unique completed prefix/);
  const invalid=structuredClone(row);invalid.result.over=true;
  assert.throws(()=>saveEvaluationCheckpoint(checkpoint,pins,requestId,[invalid]),/inconsistent checkpoint outcome/);
  const badTelemetry=structuredClone(row);badTelemetry.telemetry.decisions++;
  assert.throws(()=>saveEvaluationCheckpoint(checkpoint,pins,requestId,[badTelemetry]),/telemetry/);
  const legacy=JSON.parse(readFileSync(checkpoint,"utf8"));legacy.format="arena-search-checkpoint-v1";writeFileSync(checkpoint,JSON.stringify(legacy));
  assert.throws(()=>loadEvaluationCheckpoint(checkpoint,pins),/v2 telemetry required/);
  saveEvaluationCheckpoint(checkpoint,pins,requestId,[row]);
  const corrupt=JSON.parse(readFileSync(checkpoint,"utf8"));corrupt.records[0].result.moves++;
  writeFileSync(checkpoint,JSON.stringify(corrupt));assert.throws(()=>loadEvaluationCheckpoint(checkpoint,pins),/integrity mismatch/);
  const errorRow={...structuredClone(row),seat:"p2" as const,checks:{privacyChecks:1,nontrivialTwins:1,executionFailures:1}};
  errorRow.result.stopKind="interrupted";errorRow.result.stopped="execution failure: preserved diagnostic";
  chmodSync(checkpoint,0o644);saveEvaluationCheckpoint(checkpoint,pins,requestId,[row,errorRow]);
  if(process.platform!=="win32") assert.equal(statSync(checkpoint).mode&0o777,0o600);
  assert.deepEqual(loadEvaluationCheckpoint(checkpoint,pins).checks,{privacyChecks:3,nontrivialTwins:3,executionFailures:1},"error attempts and counters survive reload");

  const path=join(folder,"evaluation.json"),report=join(folder,"report.json"),manifest=join(folder,"manifest.json");
  const args=["scripts/arena-search-eval.mts","--synthetic","--fixtures","641,644","--seeds","2","--depth","2","--max-moves","25","--frontier-cache","on"];
  const run=(extra:string[],killAfterFirst=false)=>new Promise<{code:number|null;signal:NodeJS.Signals|null;output:string}>((resolveRun,reject)=>{
    const child=spawn(process.execPath,["--import","tsx",...args,...extra],{cwd:process.cwd(),stdio:["ignore","pipe","pipe"]});
    let output="",killed=false;
    const timer=setTimeout(()=>{child.kill("SIGKILL");reject(new Error(`evaluator proof timeout: ${output.slice(-2000)}`));},180000);
    child.stdout.on("data",(data)=>{output+=String(data);if(killAfterFirst && !killed && output.includes("641 dev[0] p1:")) {killed=true;child.kill("SIGKILL");}});
    child.stderr.on("data",(data)=>{output+=String(data);});
    child.once("error",(error)=>{clearTimeout(timer);reject(error);});
    child.once("exit",(code,signal)=>{clearTimeout(timer);resolveRun({code,signal,output});});
  });
  const interrupted=await run(["--checkpoint",path],true);
  assert.equal(interrupted.signal,"SIGKILL",interrupted.output);
  const partial=JSON.parse(readFileSync(path,"utf8"));
  assert.ok(partial.records.length>=1 && partial.records.length<8,"actual killed evaluator left a durable partial run");
  const originalPrefix=structuredClone(partial.records);
  const finished=await run(["--resume",path,"--out",report,"--manifest",manifest]);
  assert.equal(finished.code,0,finished.output);
  const complete=JSON.parse(readFileSync(path,"utf8")),receipt=JSON.parse(readFileSync(report,"utf8")),firstManifest=JSON.parse(readFileSync(manifest,"utf8"));
  assert.equal(complete.records.length,8);assert.deepEqual(complete.records.slice(0,originalPrefix.length),originalPrefix,"resume never replays or replaces completed attempts");
  assert.deepEqual(complete.checks,checkpointChecks(complete.records));assert.equal(receipt.resumedGames,originalPrefix.length);
  assert.deepEqual(receipt.telemetry,mergeSearchTelemetry(complete.records.map((r:EvaluationRecord)=>r.telemetry)),"resume conserves every telemetry bucket and cache counter");
  assert.equal(firstManifest.requestId,partial.requestId);assert.equal(firstManifest.results.length,8);
  assert.equal(new Set(firstManifest.results.map((r:{key:string})=>r.key)).size,8);
  const rerun=await run(["--resume",path,"--out",report,"--manifest",manifest]);assert.equal(rerun.code,0,rerun.output);
  assert.deepEqual(JSON.parse(readFileSync(manifest,"utf8")),firstManifest,"completed resume emits identical idempotent import content");
  assert.ok(!/641 dev\[/.test(rerun.output),"completed resume executes zero games");
  const refused=await run(["--checkpoint",path]);assert.notEqual(refused.code,0);assert.match(refused.output,/checkpoint already exists/);
  assert.deepEqual(JSON.parse(readFileSync(path,"utf8")),complete,"refused overwrite leaves saved games intact");
  console.log(`arena-search-checkpoint: actual SIGKILL after${originalPrefix.length}/8 attempts; resumed to8 unique rows with identical prefix/RNG pins/counters/requestId, complete resume executes0 games; 10 pin mismatches, corruption, malformed outcomes, ordering, POSIX modes where supported and checkout/link refusal; Windows sync branch and strict Linux IO-error propagation passed`);
} finally {rmSync(folder,{recursive:true,force:true});}
