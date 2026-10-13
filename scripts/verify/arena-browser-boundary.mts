/**
 * #641: the browser-safe rules entry (`src/lib/arena/browser.ts`), without a browser.
 *
 *   1. Import graph. The transitive value-import graph of `browser.ts` (and of the
 *      engine-neutral cores it stands on) reaches no legacy engine — no `src/lib/arena/engine/*`
 *      and no `engines.ts`, whose switch imports it — and none of #640's forbidden kinds
 *      (database, Drizzle, Node builtins, packages, provider SDKs, auth, AI, cache, CardTrader,
 *      `@/app`, `process.env`). The same walker (`scripts/lib/import-graph.ts`) is first run on
 *      a deliberately bad virtual graph, and on a copy of the real `browser.ts` with a legacy
 *      import added, to prove the rule catches it.
 *   2. Scenario. The fixed-seed create → apply → project scenario
 *      (`arena-browser-scenario.ts`) runs twice and agrees with itself step for step, and every
 *      step's portable snapshot equals the online `buildSnapshot` (bound to `engineFor`) for
 *      the same state — the seam moved no behaviour. A legacy engine id is refused by name.
 *
 * The browser half is `arena-browser-engine-browser.mts`. Run from the repo root:
 *   npx tsx scripts/verify/arena-browser-boundary.mts      (part of `npm test`)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { checkImportGraph, diskRead, legacyEngineRule } from "../lib/import-graph.ts";
import { fixtureBundle, FIXTURE_REVISION, FIXTURE_SEED } from "./arena-browser-fixture.ts";
import { runBrowserScenario } from "./arena-browser-scenario.ts";
import { createPinnedMatch, applyMove, legalMoves, projectSnapshot, rulesOnly, LegacyEngineUnavailable } from "../../src/lib/arena/browser.ts";
import { buildSnapshot } from "../../src/lib/arena/snapshot.ts";
import { replayHash } from "../../src/lib/arena/replay-core.ts";

const ROOT = process.cwd();
// #644: the policy boundary (and through it the policy layer) is browser-safe too.
const ENTRIES = ["src/lib/arena/browser.ts", "src/lib/arena/snapshot-core.ts", "src/lib/arena/view-core.ts", "src/lib/arena/beats-core.ts", "src/lib/arena/engine-ids.ts", "src/lib/arena/vm/index.ts", "src/lib/arena/policy/boundary.ts"];

/** The rule #641 adds on top of #640's: no file of the legacy engine, nor the switch that loads it. */
const legacyRule = legacyEngineRule;

// 1a. The rule catches each kind on a virtual graph.
const fakeRoot = path.join(ROOT, "__virtual641__");
const virtual: Record<string, string> = {
  [path.join(fakeRoot, "src/lib/arena/browser.ts")]: [
    `import type { GameState } from "./engine/state";`,
    `import { ok } from "./ok";`,
    `import { engineFor } from "./engines";`,
    `export { ok, engineFor };`,
  ].join("\n"),
  [path.join(fakeRoot, "src/lib/arena/ok.ts")]: `import { apply } from "./engine";\nexport const ok = 1;`,
  [path.join(fakeRoot, "src/lib/arena/engines.ts")]: `export const engineFor = 1;`,
  [path.join(fakeRoot, "src/lib/arena/engine/index.ts")]: `export const apply = 1;`,
};
const bad = checkImportGraph(path.join(fakeRoot, "src/lib/arena/browser.ts"), fakeRoot, (f) => virtual[f] ?? null, { forbidFile: legacyRule });
const reasons = bad.violations.map((v) => `${v.file}: ${v.reason}`);
for (const expected of [
  "src/lib/arena/ok.ts: legacy engine import src/lib/arena/engine/index.ts",
  "src/lib/arena/browser.ts: engine switch import (loads the legacy engine) src/lib/arena/engines.ts",
]) assert.ok(reasons.includes(expected), `the legacy rule catches "${expected}" (got ${JSON.stringify(reasons)})`);
assert.equal(reasons.length, 2, "a type-only import of the legacy engine is allowed, and nothing else is reported");
assert.ok(!bad.files.some((f) => f.includes("/engine/")), "a refused legacy file is not walked");

// 1b. A deliberately introduced forbidden import in the real entry is caught.
const browserPath = path.join(ROOT, "src/lib/arena/browser.ts");
const sabotaged = (extra: string) => (file: string) => file === browserPath ? `${fs.readFileSync(browserPath, "utf8")}\n${extra}\n` : diskRead(file);
for (const [extra, expected] of [
  [`import { apply as legacyApply } from "./engine";`, "legacy engine import src/lib/arena/engine/index.ts"],
  [`export { engineFor } from "./engines";`, "engine switch import (loads the legacy engine) src/lib/arena/engines.ts"],
  [`import { db } from "@/db";`, "server-only import @/db"],
  [`import { createHash } from "node:crypto";`, "package or builtin import node:crypto"],
  [`export const rev = process.env.VERCEL_GIT_COMMIT_SHA;`, "process.env lookup"],
] as const) {
  const caught = checkImportGraph(browserPath, ROOT, sabotaged(extra), { forbidFile: legacyRule });
  assert.ok(caught.violations.some((v) => v.file === "src/lib/arena/browser.ts" && v.reason === expected), `adding \`${extra}\` to browser.ts is caught as "${expected}" (got ${JSON.stringify(caught.violations)})`);
}

// 1c. The real graphs are clean.
const walked = new Set<string>();
for (const entry of ENTRIES) {
  const real = checkImportGraph(path.join(ROOT, entry), ROOT, diskRead, { forbidFile: legacyRule });
  for (const v of real.violations) console.error(`  forbidden from ${entry}: ${v.file}: ${v.reason}`);
  assert.equal(real.violations.length, 0, `${entry} reaches ${real.violations.length} forbidden import(s)`);
  for (const f of real.files) walked.add(f);
}
for (const needed of ["src/lib/arena/vm/index.ts", "src/lib/arena/replay-core.ts", "src/lib/arena/snapshot-core.ts", "src/lib/arena/rulesets/load.ts", "src/lib/arena/policy/contract.ts", "src/lib/arena/policy/observation.ts", "src/lib/arena/policy/rng.ts"]) {
  assert.ok(walked.has(needed), `the walker followed browser.ts into ${needed}`);
}
// The online modules are unchanged in what they reach: the switch still loads the legacy engine.
const online = checkImportGraph(path.join(ROOT, "src/lib/arena/snapshot.ts"), ROOT, diskRead, { forbidFile: legacyRule });
assert.ok(online.violations.some((v) => v.reason.startsWith("engine switch import")), "snapshot.ts (online) still binds engineFor");

// 2. The scenario, twice, and against the online snapshot.
const bundle = await fixtureBundle();
const first = await runBrowserScenario({ bundle, seed: FIXTURE_SEED, interpreterRevision: FIXTURE_REVISION, maxSteps: 120 });
const second = await runBrowserScenario({ bundle: JSON.parse(JSON.stringify(bundle)), seed: FIXTURE_SEED, interpreterRevision: FIXTURE_REVISION, maxSteps: 120 });
assert.ok(first.steps.length >= 40, `the scenario played a real game (${first.steps.length} steps)`);
assert.ok(first.turn >= 3, `the scenario got past the opening turns (turn ${first.turn})`);
assert.deepEqual(second.steps, first.steps, "two Node runs agree on every step");
assert.equal(second.finalHash, first.finalHash, "two Node runs agree on the final record");

// Every step's portable projection equals the online snapshot for the same state.
{
  let { match } = await createPinnedMatch({ bundle, seed: FIXTURE_SEED, interpreterRevision: FIXTURE_REVISION });
  for (const step of first.steps) {
    if (step.action) match = applyMove(match, step.action).match;
    for (const viewer of ["p1", "p2"] as const) {
      const portable = projectSnapshot(match, viewer);
      const over = match.state.phase === "over";
      const viaServer = buildSnapshot({
        id: 0, revision: 0, mode: "versus", engine: "rules", game: match.state.game, status: over ? "over" : "playing",
        p1Name: match.names.p1, p2Name: match.names.p2, ctx: match.ctx, state: match.state, legal: over ? [] : legalMoves(match),
        log: [], beats: match.beats, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: match.art,
      });
      assert.deepEqual(portable, viaServer, `step ${step.n}: ${viewer}'s portable snapshot equals the online one`);
      assert.equal(await replayHash(portable), step[viewer], `step ${step.n}: ${viewer}'s snapshot hash is the scenario's`);
    }
  }
}

// The legacy engine is refused by name, never silently read.
assert.throws(() => rulesOnly("legacy"), LegacyEngineUnavailable);
await assert.rejects(createPinnedMatch({ bundle, seed: FIXTURE_SEED, interpreterRevision: null }), /interpreter provenance/, "an unknown interpreter revision refuses a pinned match");
const tampered = JSON.parse(JSON.stringify(bundle));
tampered.payload.defs["O1-V"].power = 99999;
await assert.rejects(createPinnedMatch({ bundle: tampered, seed: FIXTURE_SEED, interpreterRevision: FIXTURE_REVISION }), /content hash/, "a tampered bundle is refused");

console.log(`arena-browser-boundary: ${walked.size} portable modules, no legacy/server/builtin import; scenario ${first.steps.length} steps to turn ${first.turn} (${first.phase}), final ${first.finalHash}`);
console.log(`  checks: ${first.checks.join("; ")}`);
