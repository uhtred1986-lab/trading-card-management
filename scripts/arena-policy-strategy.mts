#!/usr/bin/env node
/** Engine-backed declared strategic subcases, never automatic benchmark qualification. */
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { runStrategyCases } from "./verify/arena-policy-strategy.ts";
import { evaluationRunnerPin } from "./lib/evaluation-provenance.ts";
import { evidenceHash, policyPin, fixturePin, assertManifest, writeEvidenceFile } from "./lib/policy-evaluation-manifest.ts";
import type { DecisionManifest } from "../src/lib/arena/testing/run-manifest.ts";
import { SEARCH_PROTOCOL_REVISION } from "../src/lib/arena/policy/search.ts";

const args=process.argv.slice(2);
if(args.length%2 || args.some((arg,i)=>i%2===0 && !["--out","--manifest"].includes(arg))) throw new Error("usage: tsx scripts/arena-policy-strategy.mts [--out FILE] [--manifest FILE]");
const flag=(name:string)=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const runner=evaluationRunnerPin("arena-policy-strategy","1");
const {bundle,records}=await runStrategyCases();
const manifest:DecisionManifest={version:1,requestId:randomUUID(),source:"decision_cases",runner,
  protocol:{id:"resource-search-826-strategy",revision:SEARCH_PROTOCOL_REVISION},
  fixtures:[fixturePin("826-numeric-keywords",bundle,bundle.runtimeRevision)],
  policies:[policyPin("heuristic-v1"),policyPin("search-v2-d2",2),policyPin("search-v2-d3",3)],
  results:records.map((row)=>({key:`${row.key}-${row.policyKey}`,kind:"decision_case",fixtureKey:"826-numeric-keywords",sourceScenarioId:row.key,
    portalScenarioId:row.portalScenarioId,policyKey:row.policyKey,seed:row.seed,seat:row.seat,
    initialPolicyRng:{p1:{mode:"seeded",...row.initialPolicyRng.p1},p2:{mode:"seeded",...row.initialPolicyRng.p2}},
    assertion:"acceptable_action",outcome:row.outcome,horizonSteps:row.horizonSteps,evidenceSha256:evidenceHash(row)}))};
assertManifest(manifest);
assert.deepEqual(evaluationRunnerPin("arena-policy-strategy","1"),runner,"source changed during strategy run; discard evidence and rerun");
const report={runner,protocol:manifest.protocol,scope:"Declared synthetic subcases only; not whole AI benchmark passes.",records};
const out=flag("--out"), target=flag("--manifest");
if(out) writeEvidenceFile(out,`${JSON.stringify(report,null,2)}\n`);
if(target) writeEvidenceFile(target,`${JSON.stringify(manifest,null,2)}\n`);
for(const row of records) console.log(`${row.key} ${row.policyKey}: ${row.outcome}; ${row.horizonSteps} decisions; energy ${row.detail.energySpent}; combo cards ${row.detail.comboCards}`);
if(records.some((row)=>row.outcome==="error" || row.outcome==="interrupted")) process.exitCode=1;
