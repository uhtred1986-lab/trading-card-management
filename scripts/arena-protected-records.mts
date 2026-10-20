/** Records-only refresh for approved and corrected rules (#907 generalised). Default is a read-only dry run;
 * --apply requires the exact reviewed digest and re-plans from a fresh live readback.
 *   npm run arena:protected-records -- --decks <owner> [--ids "BT6-012#30,..."] [--out receipt.json]
 *   npm run arena:protected-records -- --decks <owner> --apply --approved-digest <hex> */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { rows } from "../src/db/rows";
import { applyProtectedRecords, loadProtectedCandidates, protectedRecordsPlan, type Selection } from "./lib/protected-records";
const args = process.argv.slice(2), value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const apply = args.includes("--apply"), approved = value("--approved-digest");
assert.ok(!apply || (approved && /^[a-f0-9]{64}$/.test(approved)), "apply requires --approved-digest <64 hex> from the reviewed dry run");
const ids = value("--ids"), decks = value("--decks");
assert.ok(ids || decks !== undefined, "name rows: --ids \"CARD#SKILL[b],...\" and/or --decks <owner> (the literal null means unowned)");
const selection: Selection = { ids: ids ? ids.split(/[\s,;]+/).filter(Boolean) : undefined, decks: decks === undefined ? undefined : decks === "null" ? null : decks };
assert.ok(process.env.DATABASE_URL, "use this app's privately verified pooled database URL");
const host = new URL(process.env.DATABASE_URL).hostname;
assert.ok(host.includes("pooler") && host.includes("eu-central-1") && host.endsWith(".neon.tech"), "expected app pooled region");
const { db } = await import("../src/db");
const identity = rows<{ rules: string; metadata: boolean }>(await db.execute(sql`select to_regclass('public.card_rules')::text rules, (select count(*)=2 from information_schema.columns where table_schema='public' and table_name='card_rules' and column_name in ('usage','validity')) metadata`))[0];
assert.ok(identity?.rules && identity.metadata, "deployed app rules table and metadata columns required");
const plan = protectedRecordsPlan(await loadProtectedCandidates(db, selection), selection);
const receipt = { digest: plan.digest, ...plan.preview, mode: apply ? "apply" : "dry-run", pending: plan.rules.length, refused: plan.preview.needsReview.length };
if (value("--out")) writeFileSync(value("--out")!, JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt, null, 2));
if (apply) {
  assert.ok(approved);
  const written = await applyProtectedRecords(db, selection, approved);
  console.log(JSON.stringify({ written, programsReplaced: 0, statusesChanged: 0, humanConfirmationsAdded: 0 }));
}
process.exit(0);
