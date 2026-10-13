/** DB-free repeatable apply benchmark for the 21-6 checkpoint board snapshot. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { arenaG, addEffectG, CTX, IMPL, zoneOf, buildSnapshot } from "../verify/harness";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { attrsNow } from "../../src/lib/arena/vm/program";
import type { VmState } from "../../src/lib/arena/vm/state";

const RUNTIME_FILES = [
  "src/lib/arena/vm/actions.ts",
  "src/lib/arena/vm/battle.ts",
  "src/lib/arena/vm/cards.ts",
  "src/lib/arena/vm/effects.ts",
  "src/lib/arena/vm/events.ts",
  "src/lib/arena/vm/flow.ts",
  "src/lib/arena/vm/index.ts",
  "src/lib/arena/vm/play.ts",
  "src/lib/arena/vm/program.ts",
  "src/lib/arena/vm/replace.ts",
  "src/lib/arena/vm/script.ts",
  "src/lib/arena/vm/state.ts",
  "src/lib/arena/vm/triggers.ts",
  "src/lib/arena/vm/zones.ts",
  "src/lib/arena/engines.ts",
  "src/lib/arena/snapshot.ts",
  "src/lib/arena/view.ts",
  "src/lib/arena/rulesets/dbs/actions.rules",
  "src/lib/arena/rulesets/dbs/attributes.rules",
  "src/lib/arena/rulesets/dbs/battle.rules",
  "src/lib/arena/rulesets/dbs/costs.rules",
  "src/lib/arena/rulesets/dbs/files.ts",
  "src/lib/arena/rulesets/dbs/game.rules",
  "src/lib/arena/rulesets/dbs/index.ts",
  "src/lib/arena/rulesets/dbs/keywords.rules",
  "src/lib/arena/rulesets/dbs/ops.rules",
  "src/lib/arena/rulesets/dbs/prompts.rules",
  "src/lib/arena/rulesets/dbs/triggers.rules",
  "src/lib/arena/rulesets/dbs/words.rules",
  "src/lib/arena/rulesets/dbs/zones.rules",
  "src/lib/arena/rulesets/expand.ts",
  "src/lib/arena/rulesets/hooks.ts",
  "src/lib/arena/rulesets/index.ts",
  "src/lib/arena/rulesets/load.ts",
  "src/lib/arena/rulesets/types.ts",
  "scripts/verify/harness.ts",
] as const;

function numericFlag(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  if (!arg) return fallback;
  const value = Number(arg.slice(prefix.length));
  assert.ok(Number.isInteger(value) && value >= 1, `${name} must be a positive integer`);
  return value;
}

function stringFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function runtimeFingerprint(): { files: readonly string[]; sha256: string; dirty: boolean } {
  const hash = createHash("sha256");
  for (const file of RUNTIME_FILES) {
    hash.update(file).update("\0").update(readFileSync(resolve(file))).update("\0");
  }
  const changed = execFileSync("git", ["diff", "HEAD", "--name-only", "--", ...RUNTIME_FILES], { encoding: "utf8" }).trim();
  return { files: RUNTIME_FILES, sha256: hash.digest("hex"), dirty: Boolean(changed) };
}

assert.ok(!process.env.DATABASE_URL, "this benchmark must use no database");

const warmup = numericFlag("warmup", 5);
const samples = numericFlag("samples", 30);
const label = stringFlag("label", "working-tree");
const sourceRef = stringFlag("source-ref", execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
const beforeSourceFingerprint = runtimeFingerprint();

// 12 Battle Cards with eight AURA sources, six opponents each reduced by
// 15,000 power. At the p1 end-main checkpoint all six opposing Battle Cards
// are zero-power rule moves, exercising the crowded aura evaluation path.
const base = arenaG({
  hand: ["V1", "V1"],
  energy: ["V1", "V1"],
  battle: ["AURA", "AURA", "AURA", "AURA", "AURA", "AURA", "AURA", "AURA", "V1", "V1", "V1", "V1"],
  oppBattle: ["V-BLUE", "V-BLUE", "V-BLUE", "V-BLUE", "V-BLUE", "V-BLUE"],
}) as VmState;
for (const id of zoneOf(base, "p2", "battle")) {
  addEffectG(base, [], { target: id, kind: "power", value: -15000, until: "turn", ownerTurn: "p1", master: "p1", createdTurn: base.turn } as Parameters<typeof addEffectG>[2]);
}

const beforeLegal = IMPL.legalActions(CTX, base);
const beforeRejected = IMPL.rejectedActions(CTX, base, beforeLegal);
const dbs = rulesetFor("dbs");
assert.ok(dbs.ok, "the DBS ruleset is needed for its 21-6 checkpoint");
const targetPowerBefore = zoneOf(base, "p2", "battle").map((id) => attrsNow(CTX, dbs.definition, base, id).power);
assert.ok(targetPowerBefore.every((power) => typeof power === "number" && power <= 0), "all six opposing Battle Cards must actually enter the zero-power checkpoint");
const run = () => IMPL.apply(CTX, structuredClone(base), { type: "endMain", player: "p1" });
for (let index = 0; index < warmup; index++) run();

const elapsed: number[] = [];
let measured: ReturnType<typeof run> | undefined;
for (let index = 0; index < samples; index++) {
  const started = performance.now();
  const result = run();
  elapsed.push(performance.now() - started);
  measured ??= result;
}
assert.ok(measured, "at least one measured application is required");

const after = measured.state as VmState;
const afterLegal = IMPL.legalActions(CTX, after);
const afterRejected = IMPL.rejectedActions(CTX, after, afterLegal);
const snapshot = (viewer: "p1" | "p2") => buildSnapshot({
  id: 607,
  revision: 1,
  mode: "versus",
  status: "playing",
  p1Name: "You",
  p2Name: "Other",
  ctx: CTX,
  state: after,
  legal: afterLegal,
  log: [],
  beats: null,
  spotlight: null,
  spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
  ai: null,
  viewer,
  images: {},
});
const snapshots = [snapshot("p1"), snapshot("p2")];
const ordered = [...elapsed].sort((a, b) => a - b);
const quantile = (p: number) => Number(ordered[Math.ceil(p * ordered.length) - 1].toFixed(3));
const source = runtimeFingerprint();
const eventSequence = measured.events.map((event) => event.type === "move"
  ? [event.type, event.card, event.from, event.to, event.owner, (event as typeof event & { reason?: string }).reason ?? null]
  : [event.type, "player" in event ? event.player : null, "phase" in event ? event.phase : null, "turn" in event ? event.turn : null]);

console.log(JSON.stringify({
  schema: 1,
  label,
  sourceRef,
  measuredHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  engine: "rules",
  databaseFree: true,
  runtimeSourceFingerprint: source,
  fingerprintBeforeMeasurement: beforeSourceFingerprint.sha256,
  cpuModelLocalOnly: os.cpus()[0]?.model ?? "unknown",
  arch: process.arch,
  fixture: {
    cards: Object.keys(base.cards).length,
    p1Battle: zoneOf(base, "p1", "battle").length,
    p2Battle: zoneOf(base, "p2", "battle").length,
    timedPowerEffects: base.effects.length,
    targetPowerBefore,
  },
  phase: "apply endMain including the 21-6 checkpoint",
  warmup,
  samples,
  p50Ms: quantile(0.5),
  p95Ms: quantile(0.95),
  outputHashes: {
    inputState: hash(base),
    beforeLegalActions: hash(beforeLegal),
    beforeRejectedActions: hash(beforeRejected),
    finalState: hash(after),
    events: hash(measured.events),
    eventSequence: hash(eventSequence),
    afterLegalActions: hash(afterLegal),
    afterRejectedActions: hash(afterRejected),
    maskedSnapshotP1: hash(snapshots[0]),
    maskedSnapshotP2: hash(snapshots[1]),
  },
  result: {
    targetBattleCountAfter: zoneOf(after, "p2", "battle").length,
    emittedEvents: measured.events.length,
    legalBefore: beforeLegal.length,
    rejectedBefore: beforeRejected.length,
    legalAfter: afterLegal.length,
    rejectedAfter: afterRejected.length,
  },
}, null, 2));
