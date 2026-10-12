/**
 * Read-only profile of repeated Arena projections from one immutable revision.
 * Run with `DATABASE_URL='' npx tsx scripts/arena-revision-cache-audit-569.mts`.
 * The harness constructs local rules-engine state; no database or provider is used.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { performance } from "node:perf_hooks";
import inspector from "node:inspector";
import { arenaG, addEffectG, CTX, ENGINE, IMPL } from "./verify/harness";
import { buildSnapshot, type SnapshotInput } from "../src/lib/arena/snapshot";
import { rulesetFor } from "../src/lib/arena/rulesets";
import { attrsNow } from "../src/lib/arena/vm/program";
import { zoneOf } from "../src/lib/arena/engine-state";
import type { VmState } from "../src/lib/arena/vm/state";

const WARMUP = 5;
const SAMPLES = 30;
const PROFILE_ITERATIONS = 24;
interface ArenaOpts {
  hand?: string[];
  energy?: string[];
  battle?: string[];
  oppHand?: string[];
  oppBattle?: string[];
  oppEnergy?: string[];
}
function runtimeFiles(): string[] {
  const files: string[] = ["scripts/verify/harness.ts"];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  visit("src/lib/arena");
  return files.sort();
}

const RUNTIME_FILES = runtimeFiles();

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function containsExactString(value: unknown, target: string): boolean {
  if (value === target) return true;
  if (Array.isArray(value)) return value.some((item) => containsExactString(item, target));
  if (value && typeof value === "object") return Object.values(value).some((item) => containsExactString(item, target));
  return false;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function measure(fn: () => unknown) {
  for (let i = 0; i < WARMUP; i++) fn();
  const ms: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const started = performance.now();
    fn();
    ms.push(performance.now() - started);
  }
  const sorted = [...ms].sort((a, b) => a - b);
  return { warmup: WARMUP, samples: SAMPLES, p50Ms: round(percentile(sorted, 0.5)), p95Ms: round(percentile(sorted, 0.95)) };
}

function snapshotInput(state: VmState, revision: number, viewer: "p1" | "p2", legal: ReturnType<typeof IMPL.legalActions>): SnapshotInput {
  return {
    id: 569,
    revision,
    mode: "versus",
    engine: "rules",
    status: "playing",
    p1Name: "You",
    p2Name: "Other",
    ctx: CTX,
    state,
    legal,
    log: [],
    beats: null,
    spotlight: null,
    spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
    ai: null,
    viewer,
    images: {},
  };
}

async function profileCpu(fn: () => void) {
  const session = new inspector.Session();
  session.connect();
  const post = (method: string, params?: object) => new Promise<unknown>((resolve, reject) => {
    session.post(method, params ?? {}, (error, result) => error ? reject(error) : resolve(result));
  });
  await post("Profiler.enable");
  await post("Profiler.start");
  fn();
  const { profile } = await post("Profiler.stop") as { profile: { nodes: Array<{ id: number; callFrame: { functionName: string }; hitCount?: number }>; samples: number[]; timeDeltas: number[] } };
  session.disconnect();
  const nodes = new Map<number, { name: string; self: number; hits: number }>();
  for (const node of profile.nodes as Array<{ id: number; callFrame: { functionName: string }; hitCount?: number; children?: number[] }>) {
    nodes.set(node.id, { name: node.callFrame.functionName || "(anonymous)", self: 0, hits: node.hitCount ?? 0 });
  }
  // Inspector samples align with timeDeltas; aggregate directly without retaining stacks/source.
  for (let i = 0; i < profile.samples.length; i++) {
    const item = nodes.get(profile.samples[i]);
    if (item) item.self += profile.timeDeltas[i] ?? 0;
  }
  const totals = new Map<string, { self: number; hits: number }>();
  for (const item of nodes.values()) {
    if (!item.self || item.name === "post" || item.name === "(garbage collector)") continue;
    const total = totals.get(item.name) ?? { self: 0, hits: 0 };
    total.self += item.self;
    total.hits += item.hits;
    totals.set(item.name, total);
  }
  const top = [...totals.entries()].sort((a, b) => b[1].self - a[1].self).slice(0, 16)
    .map(([name, value]) => ({ function: name, selfMs: round(value.self / 1000), nodeHitCount: value.hits }));
  return { iterations: PROFILE_ITERATIONS, sampling: "Inspector CPU samples; nodeHitCount is a profiler node field, not an exact call counter", topFunctionsBySampledSelfTime: top };
}

assert.equal(ENGINE, "rules", "run with --engine rules");
assert.equal(process.env.DATABASE_URL ?? "", "", "refusing any configured database URL");

const smallOptions: ArenaOpts = { hand: ["V1"], energy: ["V1"], battle: ["V1"], oppBattle: ["V-BLUE"] };
const crowdedOptions: ArenaOpts = {
  hand: ["V1", "V1"], energy: ["V1", "V1"],
  battle: ["AURA", "AURA", "AURA", "AURA", "AURA", "AURA", "AURA", "AURA", "V1", "V1", "V1", "V1"],
  oppBattle: ["V-BLUE", "V-BLUE", "V-BLUE", "V-BLUE", "V-BLUE", "V-BLUE"],
};

async function auditFixture(name: string, options: ArenaOpts, checkpoint: boolean) {
  const state = arenaG(options) as VmState;
  if (checkpoint) {
    for (const id of zoneOf(state, "p2", "battle")) {
      addEffectG(state, [], { target: id, kind: "power", value: -15000, until: "turn", ownerTurn: "p1", master: "p1", createdTurn: state.turn } as Parameters<typeof addEffectG>[2]);
    }
    const dbs = rulesetFor("dbs");
    assert.ok(dbs.ok);
    assert.ok(zoneOf(state, "p2", "battle").every((id) => Number(attrsNow(CTX, dbs.definition, state, id).power) <= 0));
  }
  const frozenState = structuredClone(state);
  const stateHash = hash(frozenState);
  const revision = 1;
  const legal = IMPL.legalActions(CTX, state);
  const rejected = IMPL.rejectedActions(CTX, state, legal);
  const inputP1 = snapshotInput(state, revision, "p1", legal);
  const inputP2 = snapshotInput(state, revision, "p2", legal);
  const firstP1 = buildSnapshot(inputP1);
  const firstP2 = buildSnapshot(inputP2);
  const p1Hand = zoneOf(state, "p1", "hand");
  const p2Hand = zoneOf(state, "p2", "hand");
  assert.ok(p1Hand.length > 0 && p2Hand.length > 0, `${name}: privacy fixture needs both hands`);
  assert.deepEqual(firstP1.view.you.hand?.map((card) => card.id), p1Hand, `${name}: p1 sees only its own hand cards`);
  assert.equal(firstP1.view.them.hand, null, `${name}: p1 opponent hand projection is hidden`);
  assert.deepEqual(firstP2.view.you.hand?.map((card) => card.id), p2Hand, `${name}: p2 sees only its own hand cards`);
  assert.equal(firstP2.view.them.hand, null, `${name}: p2 opponent hand projection is hidden`);
  for (const id of p2Hand) assert.equal(containsExactString(firstP1, id), false, `${name}: p1 projection leaked an opposing hand id`);
  for (const id of p1Hand) assert.equal(containsExactString(firstP2, id), false, `${name}: p2 projection leaked an opposing hand id`);
  const p1HiddenLife = zoneOf(state, "p1", "life").filter((id) => !state.cards[id].faceUp);
  const p2HiddenLife = zoneOf(state, "p2", "life").filter((id) => !state.cards[id].faceUp);
  for (const id of p2HiddenLife) assert.equal(containsExactString(firstP1, id), false, `${name}: p1 projection leaked hidden opposing life id`);
  for (const id of p1HiddenLife) assert.equal(containsExactString(firstP2, id), false, `${name}: p2 projection leaked hidden opposing life id`);
  assert.notEqual(hash(firstP1), hash(firstP2), `${name}: seat projections must remain viewer-specific`);
  assert.equal(hash(state), stateHash, `${name}: projection must not mutate the immutable revision`);

  const counts = { legalActions: 0, rejectedActions: 0, boardView: 0, abilityAvailability: 0 };
  const engine = IMPL as unknown as Record<string, (...args: never[]) => unknown>;
  const originals = Object.fromEntries(Object.keys(counts).map((key) => [key, engine[key]]));
  const clearCounts = () => { for (const key of Object.keys(counts)) counts[key as keyof typeof counts] = 0; };
  try {
    for (const key of Object.keys(counts)) engine[key] = (...args: never[]) => { counts[key as keyof typeof counts]++; return originals[key](...args); };
    const projectionPair = () => [buildSnapshot(inputP1), buildSnapshot(inputP2)];
    const legalOnly = measure(() => IMPL.legalActions(CTX, state));
    const legalOnlyCounts = { ...counts };
    clearCounts();
    const rejectedOnly = measure(() => IMPL.rejectedActions(CTX, state, legal));
    const rejectedOnlyCounts = { ...counts };
    clearCounts();
    const twoViewerSnapshotsSameRevision = measure(projectionPair);
    const twoViewerSnapshotCounts = { ...counts };
    clearCounts();
    const legalThenTwoViewerSnapshotsSameRevision = measure(() => { const currentLegal = IMPL.legalActions(CTX, state); buildSnapshot({ ...inputP1, legal: currentLegal }); buildSnapshot({ ...inputP2, legal: currentLegal }); });
    const combinedCounts = { ...counts };
    clearCounts();
    const timings = {
      legalOnly,
      rejectedOnly,
      twoViewerSnapshotsSameRevision,
      legalThenTwoViewerSnapshotsSameRevision,
    };
    for (const key of Object.keys(counts)) engine[key] = originals[key];
    const cpuProfile = await profileCpu(() => {
      for (let i = 0; i < PROFILE_ITERATIONS; i++) {
        const currentLegal = IMPL.legalActions(CTX, state);
        buildSnapshot({ ...inputP1, legal: currentLegal });
        buildSnapshot({ ...inputP2, legal: currentLegal });
      }
    });
    assert.equal(hash(state), stateHash, `${name}: repeated projections changed the measured state`);
    const repeatedHashes = [hash(buildSnapshot(inputP1)), hash(buildSnapshot(inputP2))];
    assert.deepEqual(repeatedHashes, [hash(firstP1), hash(firstP2)], `${name}: repeated same-revision outcome/view hashes changed`);
    return {
      fixture: name,
      engine: "rules",
      revision,
      stateHash,
      outcomeHash: hash({ turn: state.turn, phase: state.phase, prompt: state.prompt, winner: state.winner, overReason: state.overReason }),
      legalHash: hash(legal),
      rejectedHash: hash(rejected),
      viewerSnapshotHashes: { p1: hash(firstP1), p2: hash(firstP2) },
      viewerPrivacy: { p1OwnHandCardIds: p1Hand.length, p2OwnHandCardIds: p2Hand.length, hiddenOpposingLifeIds: { forP1: p2HiddenLife.length, forP2: p1HiddenLife.length }, handAndLifeMasksAssertedForBothViewers: true },
      callCountsPerSampledPhase: {
        executionsPerPhase: WARMUP + SAMPLES,
        aggregate: { legalOnly: legalOnlyCounts, rejectedOnly: rejectedOnlyCounts, twoViewerSnapshotsSameRevision: twoViewerSnapshotCounts, legalThenTwoViewerSnapshotsSameRevision: combinedCounts },
        perExecution: Object.fromEntries(Object.entries({ legalOnly: legalOnlyCounts, rejectedOnly: rejectedOnlyCounts, twoViewerSnapshotsSameRevision: twoViewerSnapshotCounts, legalThenTwoViewerSnapshotsSameRevision: combinedCounts }).map(([phase, phaseCounts]) => [phase, Object.fromEntries(Object.entries(phaseCounts).map(([method, count]) => [method, count / (WARMUP + SAMPLES)]))])),
      },
      timings,
      cpuProfile,
    };
  } finally {
    for (const key of Object.keys(counts)) engine[key] = originals[key];
  }
}

const outputs = [];
for (const [name, options, checkpoint] of [
  ["s01-small", smallOptions, false],
  ["s01-crowded-aura-12", crowdedOptions, false],
  ["s07-crowded-aura-zero-power-checkpoint", crowdedOptions, true],
] as const) outputs.push(await auditFixture(name, options, checkpoint));
const digest = createHash("sha256");
for (const file of RUNTIME_FILES) digest.update(file).update("\0").update(fs.readFileSync(file)).update("\0");
const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", ...RUNTIME_FILES], { encoding: "utf8" }).trim();
console.log(JSON.stringify({
  schema: 1,
  audit: "arena-revision-cache-audit-569",
  databaseFree: true,
  providerFree: true,
  engine: "rules",
  measuredHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  runtimeSourceFingerprint: { sha256: digest.digest("hex"), dirty: Boolean(status), files: RUNTIME_FILES },
  cpuModelLocalOnly: os.cpus()[0]?.model ?? "unknown",
  arch: process.arch,
  samples: { warmup: WARMUP, measured: SAMPLES, cpuProfileProjectionIterations: PROFILE_ITERATIONS },
  limits: ["local Node CPU only", "fixture timings do not establish hosted or device p95", "diagnostic profile does not prove a safe cache design"],
  fixtures: outputs,
}, null, 2));
