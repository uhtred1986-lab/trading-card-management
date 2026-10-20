/**
 * Records-only refresh for approved and corrected rules (scripts/lib/protected-records.ts), against PGlite
 * with the real migrations: a confirmed row gets usage, validity and payment markers and its program stays
 * byte-identical; an authored usage is never overwritten; flagged, unread, combo-gap and material-gap rows
 * are refused with reasons without blocking the others; a row that moved after the dry run makes apply
 * refuse with nothing written. No network and no real database.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import * as schema from "../../src/db/schema.ts";
import type { Db } from "../../src/db/index.ts";
import { rows } from "../../src/db/rows.ts";
import { applyProtectedRecords, writePlanned, loadProtectedCandidates, protectedRecordsPlan } from "../lib/protected-records.ts";
import { hashOf } from "../arena-corpus-provenance.mts";
import { recordContractGaps } from "../../src/lib/arena/rules-store.ts";
import { zeroCostRecord } from "../../src/lib/arena/vm/skill-payment.ts";

async function main() {
const client = new PGlite();
const db = drizzle(client, { schema }) as unknown as Db;
const dir = path.resolve("drizzle");
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort())
  for (const stmt of fs.readFileSync(path.join(dir, file), "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await client.exec(stmt.trim());

const A = "[Auto] When this card attacks, draw 1 card.";
const draw = [{ op: "draw", n: 1 }];
const { version: _v, readable: _r, ...oldBody } = zeroCostRecord() as unknown as Record<string, unknown>;
void _v; void _r;
await db.insert(schema.cardSets).values({ code: "BT1", name: "Set", line: "legacy", sortKey: 1 });
const ids = ["BT1-001", "BT1-002", "BT1-003", "BT1-004", "BT1-005", "BT1-006", "BT1-007", "BT1-008", "P-616"];
await db.insert(schema.cards).values(ids.map((id) => ({ id, setCode: "BT1", name: id, cardType: "BATTLE", rarity: "C", rarityCode: "C", searchText: id, skill: A })));
// Every row carries the old shape: no usage, no validity, a payment body with no version/readable marker.
const rule = (cardId: string, o: Partial<typeof schema.cardRules.$inferInsert> = {}) =>
  ({ cardId, side: "front", skillIndex: 0, printed: A, kind: "auto", trigger: ["attacks"], ops: draw, cost: oldBody, status: "confirmed", source: "user", unread: [] as string[], ...o });
await db.insert(schema.cardRules).values([
  rule("BT1-001"),                                                                          // plain: gets all three records
  rule("BT1-002", { status: "corrected", source: "claude", explanation: "owner wording" }), // corrected by claude
  rule("BT1-003", { usage: { version: 1, oncePerTurn: true, limit: 1 } as never }),         // authored usage differs from the printed skill
  rule("BT1-004", { reviewFlag: "suspect" }),                                               // flagged
  rule("BT1-005", { ops: [], unread: ["a clause"] }),                                       // unread
  rule("BT1-006", { trigger: ["comboUsed"], combo: null }),                                 // combo-qualification gap
  rule("BT1-007", { cost: { ...oldBody, fusion: { bogus: true } } as never }),              // material gap
  rule("BT1-008", { status: "draft", source: "compiler" }),                                 // compiler draft: not ours
  rule("P-616"),                                                                            // hard exclusion
]);
const [deck] = await db.insert(schema.decks).values([{ name: "Mine", owner: "pat" }]).returning();
await db.insert(schema.deckCards).values(ids.map((cardId) => ({ deckId: deck.id, cardId, zone: "main", quantity: 1 })));
const [other] = await db.insert(schema.decks).values([{ name: "Other", owner: "sam" }]).returning();
await db.insert(schema.deckCards).values([{ deckId: other.id, cardId: "BT1-001", zone: "main", quantity: 1 }]);

const snapshot = async () => rows<{ record: Record<string, unknown> }>(await db.execute(sql`select to_jsonb(r) as record from card_rules r order by id`)).map((r) => r.record);
const byCard = (all: Record<string, unknown>[], card: string) => all.find((r) => r.card_id === card)!;
const programOf = (r: Record<string, unknown>) => hashOf(Object.fromEntries(["printed", "kind", "trigger", "combo", "cond", "ops", "unread", "reads", "pattern", "source", "status", "review_flag", "confirmed_at", "explanation"].map((k) => [k, r[k] ?? null])));

const sel = { decks: "pat" };
const before = await snapshot();
const plan = protectedRecordsPlan(await loadProtectedCandidates(db, sel), sel);
assert.deepEqual(plan.rules.map((r) => r.before.card_id).sort(), ["BT1-001", "BT1-002"], "only the two clean protected rows are written");
const why = Object.fromEntries(plan.preview.needsReview.map((r) => [r.key.split("/")[0], r.reason]));
assert.match(why["BT1-003"], /authored usage/);
assert.match(why["BT1-004"], /review flag/);
assert.match(why["BT1-005"], /unread/);
assert.match(why["BT1-006"], /contract gaps remain.*combo/i);
assert.match(why["BT1-007"], /payment|fusion|material|contract gaps/i);
assert.match(why["P-616"], /P-616/);
assert.ok(plan.preview.skipped.some((s) => s.key.startsWith("BT1-008")), "a compiler draft is skipped, not refused");
assert.ok(!plan.preview.needsReview.some((r) => r.key.startsWith("BT1-008")));
assert.equal(plan.digest, protectedRecordsPlan(await loadProtectedCandidates(db, sel), sel).digest, "the digest is stable for the same rows");
// --ids reaches a row outside the owner's decks; a bare card id and the b suffix resolve like arena:refresh-ids.
const viaIds = await loadProtectedCandidates(db, { ids: ["BT1-001#0", "BT1-002"] });
assert.deepEqual(viaIds.map((r) => r.card_id).sort(), ["BT1-001", "BT1-002"]);

// Dry run wrote nothing; apply with a wrong digest is refused.
assert.deepEqual(await snapshot(), before, "planning writes nothing");
await assert.rejects(applyProtectedRecords(db, sel, "0".repeat(64)), /stale/);
assert.deepEqual(await snapshot(), before);

// A row that moved after the dry run: apply re-plans, the digest no longer matches, nothing is written.
await db.execute(sql`update card_rules set version = version + 1 where card_id = 'BT1-002'`);
await assert.rejects(applyProtectedRecords(db, sel, plan.digest), /stale/);
await db.execute(sql`update card_rules set version = version - 1 where card_id = 'BT1-002'`);
assert.deepEqual(await snapshot(), before, "a stale digest wrote nothing");
// Row-level compare-and-set: a change the digest cannot see (an explanation edit) is caught by the locked statement.
await db.execute(sql`update card_rules set explanation = 'edited meanwhile' where card_id = 'BT1-001'`);
await assert.rejects(writePlanned(db, plan.rules), /reviewed rows changed/);
await db.execute(sql`update card_rules set explanation = null where card_id = 'BT1-001'`);
assert.deepEqual(await snapshot(), before, "a stale row wrote nothing, not even the untouched one");

// Apply with the reviewed digest.
const written = await applyProtectedRecords(db, sel, plan.digest);
assert.equal(written.length, 2);
const after = await snapshot();
for (const card of ["BT1-001", "BT1-002"]) {
  const b = byCard(before, card), a = byCard(after, card);
  assert.equal(a.version as number, (b.version as number) + 1, "version + 1");
  assert.equal(programOf(a), programOf(b), "program, status, source, flag, confirmation untouched");
  assert.deepEqual(a.ops, b.ops);
  assert.equal(recordContractGaps(a as never).length, 0, "no contract gap remains");
  assert.deepEqual((a.cost as Record<string, unknown>).version, 1);
  assert.deepEqual((a.cost as Record<string, unknown>).readable, true);
  const { version: _a, readable: _b, ...body } = a.cost as Record<string, unknown>; void _a; void _b;
  assert.deepEqual(body, b.cost, "payment body unchanged");
  assert.ok(a.usage && a.validity);
}
for (const card of ["BT1-003", "BT1-004", "BT1-005", "BT1-006", "BT1-007", "BT1-008", "P-616"]) assert.deepEqual(byCard(after, card), byCard(before, card), `${card} untouched`);
// A second run finds nothing to write for the two done rows.
const again = protectedRecordsPlan(await loadProtectedCandidates(db, sel), sel);
assert.equal(again.rules.length, 0);
assert.ok(again.preview.skipped.some((s) => s.key.startsWith("BT1-001") && /no record contract gap/.test(s.reason)));

console.log("protected records OK");
}
main().catch((e) => { console.error(e); process.exit(1); });
