/**
 * #640: the portable replay core, without a database.
 *
 *   1. Fixed hash vectors (`arena-replay-vectors.ts`) give exactly the frozen format-1
 *      bundle/catalog/program/ruleset hashes under Node's Web Crypto, and the core's hash of the
 *      shipped ruleset equals `node:crypto` over the same canonical JSON.
 *   2. The static import graph of `src/lib/arena/replay-core.ts` reaches no database, Drizzle,
 *      Node builtin, provider SDK, auth, cache or `process.env`. Type-only imports are erased at
 *      build time and are not followed. The walker is first run on a deliberately bad virtual
 *      graph to prove it catches each forbidden kind.
 *
 * Run from the repo root: `npx tsx scripts/verify/arena-replay-core.ts` (part of `npm test`).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { checkImportGraph, diskRead, scanSource } from "../lib/import-graph.ts";
import { runReplayVectors } from "./arena-replay-vectors.ts";
import { canonicalJson, makeReplayBundle, pinnedDefinition, replayHash, validateReplayBundle } from "../../src/lib/arena/replay-core.ts";
import { DBS_FILES } from "../../src/lib/arena/rulesets/dbs/index.ts";
import { FUSION_FILES } from "../../src/lib/arena/rulesets/fusion/index.ts";

const ROOT = process.cwd();
const ENTRY = path.join(ROOT, "src/lib/arena/replay-core.ts");

async function main() {
  // 1. Vectors.
  const results = await runReplayVectors();
  const failed = results.filter((r) => !r.ok);
  for (const r of failed) console.error(`  vector failed: ${r.name}: expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`);
  assert.equal(failed.length, 0, `${failed.length} replay hash vector(s) failed`);
  assert.ok(results.length >= 25, "the vector suite ran");
  const nodeHash = createHash("sha256").update(canonicalJson(DBS_FILES)).digest("hex");
  assert.equal(await replayHash(DBS_FILES), nodeHash, "Web Crypto and node:crypto agree on the shipped DBS ruleset");

  // 1b. The bundle carries its game. No game field is dbs, hashed exactly as before; fusion pins its own files under its own id.
  const rev = "a640000000000000000000000000000000000001";
  const base = { defs: {}, scripts: {}, art: {}, runtime: rev };
  const dbsBundle = await makeReplayBundle({ ...base, rulesetFiles: DBS_FILES });
  const dbsExplicit = await makeReplayBundle({ ...base, rulesetFiles: DBS_FILES, game: "dbs" });
  assert.equal("game" in dbsBundle.payload, false, "a dbs bundle writes no game field");
  assert.equal(dbsExplicit.hash, dbsBundle.hash, "naming dbs changes nothing: the hash is the one a bundle with no game has");
  assert.equal(pinnedDefinition(dbsBundle).id, "dbs", "a bundle with no game loads as dbs");
  const fusionBundle = await makeReplayBundle({ ...base, rulesetFiles: FUSION_FILES, game: "fusion" });
  assert.equal(fusionBundle.payload.game, "fusion");
  assert.ok(await validateReplayBundle(fusionBundle), "a fusion bundle validates");
  assert.equal(pinnedDefinition(fusionBundle).id, "fusion", "a fusion bundle loads its files under the fusion id, not dbs");
  const relabelled = structuredClone(fusionBundle);
  delete relabelled.payload.game;
  assert.equal(await validateReplayBundle(relabelled), false, "dropping the game from a fusion bundle breaks its hash");
  assert.equal(await validateReplayBundle({ ...fusionBundle, payload: { ...fusionBundle.payload, game: "chess" as "dbs" } }), false, "an unknown game is refused");

  // 2. The walker catches each forbidden kind on a virtual graph.
  const fakeRoot = path.join(ROOT, "__virtual__");
  const virtual: Record<string, string> = {
    [path.join(fakeRoot, "src/core.ts")]: [
      `import type { Db } from "@/db";`,
      `import { type Only } from "./types-only";`,
      `export type { X } from "./types-only";`,
      `import { helper } from "./helper";`,
      `export { helper };`,
    ].join("\n"),
    [path.join(fakeRoot, "src/types-only.ts")]: `import { createHash } from "node:crypto";\nexport type Only = 1;`,
    [path.join(fakeRoot, "src/helper.ts")]: [
      `import { createHash } from "node:crypto";`,
      `import fs from "fs";`,
      `import { eq } from "drizzle-orm";`,
      `import Anthropic from "@anthropic-ai/sdk";`,
      `import { db } from "@/db";`,
      `export * from "@/lib/auth";`,
      `export const rev = process.env.VERCEL_GIT_COMMIT_SHA;`,
      `export const lazy = () => import("./missing");`,
    ].join("\n"),
  };
  const bad = checkImportGraph(path.join(fakeRoot, "src/core.ts"), fakeRoot, (f) => virtual[f] ?? null);
  const reasons = bad.violations.map((v) => `${v.file}: ${v.reason}`);
  for (const expected of [
    "src/helper.ts: package or builtin import node:crypto",
    "src/helper.ts: package or builtin import fs",
    "src/helper.ts: package or builtin import drizzle-orm",
    "src/helper.ts: package or builtin import @anthropic-ai/sdk",
    "src/helper.ts: server-only import @/db",
    "src/helper.ts: server-only import @/lib/auth",
    "src/helper.ts: process.env lookup",
    "src/helper.ts: unresolved import ./missing",
  ]) assert.ok(reasons.includes(expected), `the import-graph check catches "${expected}" (got ${JSON.stringify(reasons)})`);
  assert.ok(!bad.files.includes("src/types-only.ts"), "type-only imports are not followed");
  assert.equal(reasons.filter((r) => r.startsWith("src/core.ts")).length, 0, "type-only imports of server modules are allowed");

  // 3. The real portable graph is clean.
  const real = checkImportGraph(ENTRY, ROOT, diskRead);
  for (const v of real.violations) console.error(`  forbidden: ${v.file}: ${v.reason}`);
  assert.equal(real.violations.length, 0, `replay-core.ts reaches ${real.violations.length} forbidden import(s)`);
  assert.ok(real.files.includes("src/lib/arena/rulesets/load.ts"), "the walker followed the core's value imports");
  for (const serverOnly of ["src/lib/arena/replay-bundle.ts", "src/db/index.ts", "src/db/schema.ts"]) {
    assert.ok(!real.files.includes(serverOnly), `${serverOnly} is outside the portable graph`);
  }
  // offline-replay.ts must take its bundle logic from the core, not the server module.
  const offline = scanSource("offline-replay.ts", fs.readFileSync(path.join(ROOT, "src/lib/arena/offline-replay.ts"), "utf8"));
  assert.ok(!offline.specifiers.some((s) => /replay-bundle/.test(s)), "offline-replay.ts does not import the server replay module");
  assert.equal(offline.violations.length, 0, "offline-replay.ts reads no environment");

  console.log(`arena-replay-core: ${results.length} vectors, ${real.files.length} portable modules, import graph clean`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
