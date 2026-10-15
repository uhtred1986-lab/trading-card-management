/** Private, durable completed-game journal. It is NOT a portal import artifact. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { canonicalJson } from "../../src/lib/arena/replay-core";
import type { ManifestFixture, ManifestPolicy, ManifestRunner } from "../../src/lib/arena/testing/run-manifest";
import type { PolicyRng } from "../../src/lib/arena/policy/rng";
import type { DuelResult } from "../verify/arena-policy-duel";

export interface EvaluationJob {
  fixture:string; k:number; seat:"p1"|"p2"; gameSeed:number; policySeed:number;
  initialPolicyRng:{p1:PolicyRng;p2:PolicyRng};
}
export interface EvaluationChecks {privacyChecks:number;nontrivialTwins:number;executionFailures:number}
export interface EvaluationRecord {
  fixture:string;k:number;seat:"p1"|"p2";result:DuelResult;policyMs:number[];search:Record<string,number>;
  maxNodes:number;maxReservationBytes:number;nodeHeapAfterBytes:number;checks:EvaluationChecks;
}
export interface EvaluationPins {
  runner:ManifestRunner;configuration:unknown;fixtures:ManifestFixture[];policies:ManifestPolicy[];jobs:EvaluationJob[];
}
export interface EvaluationCheckpoint {
  format:"arena-search-checkpoint-v1";requestId:string;pins:EvaluationPins;records:EvaluationRecord[];checks:EvaluationChecks;integritySha256:string;
}
const hash=(value:unknown)=>createHash("sha256").update(canonicalJson(value)).digest("hex");
const integer=(value:unknown)=>typeof value==="number" && Number.isSafeInteger(value) && value>=0;
const finite=(value:unknown)=>typeof value==="number" && Number.isFinite(value) && value>=0;
const exact=(value:object,keys:string[])=>Object.keys(value).length===keys.length && keys.every((key)=>Object.hasOwn(value,key));
export const checkpointChecks=(records:EvaluationRecord[]):EvaluationChecks=>records.reduce((sum,row)=>({
  privacyChecks:sum.privacyChecks+row.checks.privacyChecks,nontrivialTwins:sum.nontrivialTwins+row.checks.nontrivialTwins,
  executionFailures:sum.executionFailures+row.checks.executionFailures,
}),{privacyChecks:0,nontrivialTwins:0,executionFailures:0});

/** Refuse every registered checkout, including ignored paths and symlinked parents. */
export function externalCheckpointPath(path:string,cwd=process.cwd()):string {
  const absolute=resolve(path);
  assert.ok(!existsSync(absolute) || !lstatSync(absolute).isSymbolicLink(),"checkpoint cannot be a symlink");
  const target=resolve(realpathSync(dirname(absolute)),absolute.slice(dirname(absolute).length+1));
  const roots=execFileSync("git",["worktree","list","--porcelain","-z"],{cwd}).toString().split("\0").filter((part)=>part.startsWith("worktree ")).map((part)=>realpathSync(part.slice(9)));
  for(const root of roots) {
    const rel=relative(root,target);
    assert.ok(rel!=="" && (rel===".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)),"checkpoint must be outside every repository checkout (use /tmp or another private directory)");
  }
  return target;
}

function validateRecords(records:EvaluationRecord[],pins:EvaluationPins):void {
  assert.ok(Array.isArray(records) && records.length<=pins.jobs.length,"checkpoint has too many games");
  const planned=pins.jobs.map((job)=>`${job.fixture}/${job.k}/${job.seat}`);
  assert.equal(new Set(planned).size,planned.length,"expected schedule repeats a seed/seat");
  for(const [i,row] of records.entries()) {
    assert.ok(row && exact(row,["fixture","k","seat","result","policyMs","search","maxNodes","maxReservationBytes","nodeHeapAfterBytes","checks"]),"malformed checkpoint record");
    assert.equal(`${row.fixture}/${row.k}/${row.seat}`,planned[i],"checkpoint must be a unique completed prefix of the expected seed/seat schedule");
    assert.ok(row.checks && exact(row.checks,["privacyChecks","nontrivialTwins","executionFailures"]) && Object.values(row.checks).every(integer),"invalid checkpoint counters");
    assert.ok([row.maxNodes,row.maxReservationBytes,row.nodeHeapAfterBytes].every(integer),"invalid checkpoint resource counts");
    assert.ok(Array.isArray(row.policyMs) && row.policyMs.every(finite),"invalid checkpoint policy timings");
    assert.ok(row.search && typeof row.search==="object" && Object.entries(row.search).every(([key,n])=>["searched","unsupported","nodes","memory","deadline","cancelled"].includes(key) && integer(n)),"invalid checkpoint search counts");
    const r=row.result;
    assert.ok(r && exact(r,["over","winner","reason","moves","turn","damageDealt","damageTaken","guards","stopped","stopKind","stepMs","steps","trace"]),"malformed checkpoint result");
    assert.ok(typeof r.over==="boolean" && [r.moves,r.turn,r.damageDealt,r.damageTaken,r.guards?.test,r.guards?.baseline].every(integer),"invalid checkpoint game counts");
    assert.ok(r.reason===null || typeof r.reason==="string");assert.ok(r.stopped===null || typeof r.stopped==="string");
    assert.ok(r.over ? ["test","baseline","draw"].includes(r.winner!) && r.stopKind===null && r.stopped===null
      : r.winner===null && ["illegal","interrupted","notAsked","limit","noSeat"].includes(r.stopKind!),"inconsistent checkpoint outcome");
    assert.ok(Array.isArray(r.stepMs) && r.stepMs.every(finite) && Array.isArray(r.steps) && r.steps.every((step)=>finite(step.ms) && typeof step.window==="string" && ["test","baseline"].includes(step.role)),"invalid checkpoint step timings");
    assert.match(r.trace,/^[a-f0-9]{8}$/);
  }
}
export function loadEvaluationCheckpoint(path:string,pins:EvaluationPins):EvaluationCheckpoint {
  assert.ok(lstatSync(path).size<=128*1024*1024,"checkpoint exceeds128MiB");
  const value=JSON.parse(readFileSync(path,"utf8")) as EvaluationCheckpoint;
  assert.ok(value && exact(value,["format","requestId","pins","records","checks","integritySha256"]) && value.format==="arena-search-checkpoint-v1","unsupported checkpoint format");
  const {integritySha256,...body}=value;
  assert.equal(integritySha256,hash(body),"checkpoint integrity mismatch; file is corrupt or edited");
  assert.equal(canonicalJson(value.pins),canonicalJson(pins),"checkpoint pin mismatch: source, protocol, fixture, policy, seed schedule or configuration changed");
  assert.match(value.requestId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
  validateRecords(value.records,pins);
  assert.deepEqual(value.checks,checkpointChecks(value.records),"checkpoint counter totals mismatch");
  return value;
}

/** Write+fsync a private temporary file, atomically replace, then fsync its
 * directory. A killed writer leaves either the previous or next complete file.
 * Orphan temporary files are never considered completed games on resume. */
export function saveEvaluationCheckpoint(path:string,pins:EvaluationPins,requestId:string,records:EvaluationRecord[]):EvaluationCheckpoint {
  validateRecords(records,pins);
  const body={format:"arena-search-checkpoint-v1" as const,requestId,pins,records,checks:checkpointChecks(records)};
  const value={...body,integritySha256:hash(body)};
  const temporary=`${path}.tmp-${randomUUID()}`;
  let fd:number|null=null;
  try {
    fd=openSync(temporary,"wx",0o600);
    writeFileSync(fd,`${JSON.stringify(value)}\n`);fsyncSync(fd);closeSync(fd);fd=null;
    renameSync(temporary,path);
    const directory=openSync(dirname(path),"r");try {fsyncSync(directory);}finally {closeSync(directory);}
  } finally {
    if(fd!==null) closeSync(fd);
    if(existsSync(temporary)) unlinkSync(temporary);
  }
  return value;
}
