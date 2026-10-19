/** One-row default dry-run. Live application requires the exact separately approved digest. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { rows } from "../src/db/rows";
import { externalCheckpointPath } from "./lib/arena-search-checkpoint";
import { absorbRecordPlan, applyAbsorbRecord, assertAbsorbCatalog, type RawAbsorbRow } from "./lib/absorb-record-907";
const options = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i];
  assert.ok(["--snapshot", "--out", "--private-out", "--apply", "--approved-digest"].includes(flag), `unknown flag: ${flag}`);
  assert.ok(!options.has(flag), "duplicate flag");
  if (flag === "--apply") options.set(flag, "true");
  else { const value = process.argv[++i]; assert.ok(value && !value.startsWith("--"), `missing ${flag} value`); options.set(flag, value); }
}
const offline = options.get("--snapshot"), apply = options.has("--apply"), approved = options.get("--approved-digest");
assert.ok(!apply || !offline && approved && /^[a-f0-9]{64}$/.test(approved), "apply requires a live read and exact approved digest; offline mode never writes");
const publicOut = options.get("--out"), privateOut = options.get("--private-out");
if (offline) for (const path of [publicOut, privateOut]) if (path) assert.notEqual(resolve(path), resolve(offline), "output must not overwrite the input snapshot");
if (publicOut && privateOut) assert.notEqual(resolve(publicOut), resolve(privateOut), "public and private outputs must differ");
const privatePath = privateOut ? externalCheckpointPath(privateOut) : undefined;
let before: RawAbsorbRow;
let liveDb: Awaited<typeof import("../src/db")>["db"] | undefined;
if (offline) {
  const input = JSON.parse(readFileSync(offline, "utf8"));
  const candidates = Array.isArray(input) ? input : input.raw;
  assert.ok(Array.isArray(candidates));
  const matches = candidates.filter((r: RawAbsorbRow) => r.id === 6416); assert.equal(matches.length, 1);
  before = matches[0];
} else {
  assert.ok(process.env.DATABASE_URL, "provide privately verified app pooled URL or --snapshot");
  const host = new URL(process.env.DATABASE_URL).hostname;
  assert.ok(host.includes("pooler") && host.includes("eu-central-1") && host.endsWith(".neon.tech"));
  const { db } = await import("../src/db"); liveDb = db;
  const identity = rows<{ rules: string; cards: string }>(await db.execute(sql`select to_regclass('public.card_rules')::text rules,to_regclass('public.cards')::text cards`))[0];
  assert.ok(identity?.rules && identity.cards, "app tables required");
  const catalog = rows<{ record: RawAbsorbRow }>(await db.execute(sql`select to_jsonb(c) record from cards c where id='BT3-070'`))[0]?.record;
  assert.ok(catalog); assertAbsorbCatalog(catalog);
  const found = rows<{ record: RawAbsorbRow }>(await db.execute(sql`select to_jsonb(r) record from card_rules r where id=6416`));
  assert.equal(found.length, 1); before = found[0].record;
}
const plan = absorbRecordPlan(before);
const receipt = { ...plan.preview, digest: plan.digest, mode: apply ? "apply" : "dry-run" };
if (publicOut) writeFileSync(publicOut, JSON.stringify(receipt, null, 2) + "\n");
if (privatePath) {
  writeFileSync(privatePath, JSON.stringify([before], null, 2) + "\n", { mode: 0o600 }); chmodSync(privatePath, 0o600);
}
console.log(JSON.stringify(receipt, null, 2));
if (apply) { assert.ok(liveDb && approved); console.log(JSON.stringify({ written: await applyAbsorbRecord(liveDb, before, approved), humanConfirmationsAdded: 0 })); }
process.exit(0);
