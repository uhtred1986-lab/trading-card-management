/** Focused CLI contract checks for arena:replay. Run with `npx tsx scripts/verify/arena-replay-cli.mts`. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Action } from "../../src/lib/arena/types.ts";
import { fixtureBundle, FIXTURE_REVISION } from "./arena-browser-fixture.ts";
import { runScenario } from "./arena-scenarios.ts";

const root = process.cwd();
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "arena-replay-cli-"));
const input = path.join(scratch, "export.json");
const fullOutput = path.join(scratch, "replay.json");
const summaryOutput = path.join(scratch, "summary-replay.json");

try {
  const bundle = await fixtureBundle();
  const actions: Action[] = [];
  const evidence = await runScenario("battle", {
    bundle,
    interpreterRevision: FIXTURE_REVISION,
    observe: (_match, action) => { if (action) actions.push(action); },
  });
  assert.equal(evidence.pass, true);
  assert.equal(actions.length, 10);
  fs.writeFileSync(input, JSON.stringify({ exact: true, seed: 641, engine: "rules", actions, decks: bundle.decks, bundle }));

  const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/arena-replay.mts", input, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "" },
  });
  const revision = ["--runtime-revision", FIXTURE_REVISION];
  const full = cli(...revision);
  assert.equal(full.status, 0, full.stderr);
  const fullRecord = JSON.parse(full.stdout) as { state: { phase: string }; events: unknown[]; legalActions: unknown[] };
  assert.equal(fullRecord.state.phase, "main");
  assert.ok(fullRecord.events.length > 0);
  assert.ok(fullRecord.legalActions.length > 0);

  const compact = cli(...revision, "--summary");
  assert.equal(compact.status, 0, compact.stderr);
  const summary = JSON.parse(compact.stdout) as {
    actionCount: number;
    eventCount: number;
    legalActionCount: number;
    hashes: Record<string, string>;
  };
  assert.equal(summary.actionCount, 10);
  assert.equal(summary.eventCount, fullRecord.events.length);
  assert.equal(summary.legalActionCount, fullRecord.legalActions.length);
  for (const hash of Object.values(summary.hashes)) assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(Buffer.byteLength(compact.stdout) < Buffer.byteLength(full.stdout) / 10, "summary materially reduces stdout");

  const artifact = cli(...revision, "--output", fullOutput);
  assert.equal(artifact.status, 0, artifact.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(fullOutput, "utf8")), fullRecord);
  assert.deepEqual(JSON.parse(artifact.stdout), { output: fullOutput });

  const compactArtifact = cli(...revision, "--summary", "--output", summaryOutput);
  assert.equal(compactArtifact.status, 0, compactArtifact.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(summaryOutput, "utf8")), fullRecord);
  assert.equal(JSON.parse(compactArtifact.stdout).actionCount, 10);

  const badFlag = cli(...revision, "--unknown");
  assert.equal(badFlag.status, 2);
  assert.match(badFlag.stderr, /Usage:/);
  console.log(`arena-replay-cli: default payload, compact summary (${Buffer.byteLength(full.stdout)} → ${Buffer.byteLength(compact.stdout)} bytes), file output and usage error pass`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
