#!/usr/bin/env node
/** #923 default dry-run; offline snapshots never connect. --apply requires an exact reviewed digest. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { inArray, sql } from "drizzle-orm";
import { metadata923Plan, applyMetadata923, metadata923Hash, METADATA_923_REFERENCE, METADATA_923_TARGETS, type Metadata923Row } from "./lib/metadata-923";
import { externalCheckpointPath } from "./lib/arena-search-checkpoint";
import { rows } from "../src/db/rows";
import { cardDefFrom } from "../src/lib/arena/load";
import type { CardDef } from "../src/lib/arena/types";
const options = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i]; assert.ok(["--snapshot", "--out", "--payload-out", "--approved-digest", "--apply"].includes(flag), `unknown flag ${flag}`); assert.ok(!options.has(flag), "duplicate flag");
  if (flag === "--apply") options.set(flag, "true");
  else { const value = process.argv[++i]; assert.ok(value && !value.startsWith("--"), `${flag} needs a value`); options.set(flag, value); }
}
const offline = options.get("--snapshot"), apply = options.has("--apply"), approved = options.get("--approved-digest");
assert.ok(!apply || !offline && approved && /^[a-f0-9]{64}$/.test(approved), "--apply needs live readback and explicit --approved-digest; offline mode is dry-run only");
const catalog: CardDef[] = JSON.parse(readFileSync(`${METADATA_923_REFERENCE}/cards.json`, "utf8"));
const sorted = (cards: CardDef[]) => cards.slice().sort((a, b) => a.id.localeCompare(b.id));
const assertCatalog = (current: CardDef[]) => assert.equal(metadata923Hash(sorted(current)), metadata923Hash(sorted(catalog)), "current catalog engine source changed; review again");
let before: Metadata923Row[], liveDb: Awaited<typeof import("../src/db")>["db"] | undefined;
if (offline) {
  const snapshot = JSON.parse(readFileSync(offline, "utf8"));
  if (Array.isArray(snapshot)) before = snapshot;
  else { assert.ok(snapshot && Array.isArray(snapshot.raw) && Array.isArray(snapshot.catalog), "snapshot must contain full raw rows and current catalog"); assertCatalog(snapshot.catalog); before = snapshot.raw; }
} else {
  assert.ok(process.env.DATABASE_URL, "provide the privately verified app pooled database URL, or use --snapshot");
  const host = new URL(process.env.DATABASE_URL).hostname;
  assert.ok(host.includes("pooler") && host.includes("eu-central-1") && host.endsWith(".neon.tech"), "expected app pooled region");
  const { db } = await import("../src/db"); liveDb = db;
  const identity = rows<{ rules: string; catalog: string; metadata: boolean }>(await db.execute(sql`select to_regclass('public.card_rules')::text rules, to_regclass('public.cards')::text catalog,
    (select count(*)=2 from information_schema.columns where table_schema='public' and table_name='card_rules' and column_name in ('usage','validity')) metadata`))[0];
  assert.ok(identity?.rules && identity.catalog && identity.metadata, "deployed app tables and metadata columns required");
  const { cards } = await import("../src/db/schema");
  const ids = catalog.map(c => c.id), actual = await db.select().from(cards).where(inArray(cards.id, ids)); assertCatalog(actual.map(cardDefFrom));
  before = rows<{ record: Metadata923Row }>(await db.execute(sql`select to_jsonb(r) record from card_rules r where r.id in (${sql.join(METADATA_923_TARGETS.map(t => sql`${t.id}`), sql`, `)}) order by r.id`)).map(r => r.record);
}
const plan = metadata923Plan(before);
const receipt = { digest: plan.digest, ...plan.preview, mode: apply ? "apply" : "dry-run", pending: plan.rules.length };
const output = options.get("--out"), payload = options.get("--payload-out");
for (const path of [output, payload].filter((v): v is string => !!v)) assert.ok(!offline || resolve(path) !== resolve(offline), "output cannot overwrite the input snapshot");
assert.ok(!output || !payload || resolve(output) !== resolve(payload), "public preview and private payload need separate paths");
if (output) writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
if (payload) { const privatePath = externalCheckpointPath(payload); writeFileSync(privatePath, `${JSON.stringify({ format: "metadata-923-private-payload-v1", digest: plan.digest, before, metadata: plan.entries.map(p => ({ id: p.before.id, usage: p.usage, validity: p.validity })) }, null, 2)}\n`, { mode: 0o600 }); chmodSync(privatePath, 0o600); }
console.log(JSON.stringify(receipt, null, 2));
if (apply) { assert.ok(liveDb && approved); const written = await applyMetadata923(liveDb, before, approved); console.log(JSON.stringify({ written, programsReplaced: 0, statusesChanged: 0, humanConfirmationsAdded: 0 })); }
process.exit(0);
