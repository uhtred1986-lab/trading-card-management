/**
 * `npm run rules:batch`, `rules:snapshot` and `scripts/card-db-env.mjs` on PGlite and a stubbed fetch: the selection order,
 * skipping, which rows are left alone, the receipt skeleton, the snapshot diff, the to_regclass refusal and the env-file
 * parsing/quoting. No network, no DATABASE_URL. Part of `npm test`.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../src/db/schema.ts";
import type { Db } from "../../src/db/index.ts";
import { zeroCostRecord } from "../../src/lib/arena/vm/skill-payment.ts";
import { unlimitedUsage } from "../../src/lib/arena/vm/usage.ts";
import { noSparking } from "../../src/lib/arena/vm/validity.ts";
import { assertThisAppsDb, listedIds, renderReceipt, selectBatch } from "../lib/rules-batch.mts";
import { diffSnapshots, takeSnapshot, unexpectedFields } from "../lib/rules-snapshot.mts";
import { checkHost, fetchDatabaseUrl, shellQuote, writeEnvFile } from "../card-db-env.mjs";

const mk = async () => {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  return { client, db };
};
const { client, db } = await mk();
const dir = path.resolve("drizzle");
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  for (const stmt of fs.readFileSync(path.join(dir, file), "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await client.exec(stmt.trim());
}

// ── seed ──────────────────────────────────────────────────────────────────
const ATTACK = "[Auto] When this card attacks, draw 1 card.";
const ids = (n: number) => `BT1-${String(n).padStart(3, "0")}`;
await db.insert(schema.cardSets).values({ code: "BT1", name: "Galactic Battle", game: "dbs", line: "legacy" });
await db.insert(schema.cards).values(
  Array.from({ length: 12 }, (_, i) => ({ id: ids(i + 1), setCode: "BT1", game: "dbs", name: `Card ${i + 1} | pipe`, cardType: "BATTLE", colors: ["Red"], rarity: "C", rarityCode: "C", searchText: `card ${i + 1}`, skill: ATTACK })) as never,
);
const rule = (cardId: string, over: Record<string, unknown> = {}) => ({
  cardId, side: "front", skillIndex: 0, printed: ATTACK, kind: "auto", trigger: ["attacks"], cost: zeroCostRecord(), usage: unlimitedUsage(), validity: noSparking(),
  ops: [{ op: "draw", n: 1 }], reads: "draw 1 card", status: "draft", source: "compiler", ...over,
});
// 1: three decks (owner, ownerless, owner). 2: two decks. 3, 4, 5: one deck each (5 is listed in an earlier receipt).
// 6: only in another owner's deck. 7: only in a testing deck. 8: confirmed. 9: a corrected row and a draft row. 10: only in a fusion deck. 11: a Claude draft. 12: a flagged row (incomplete).
await db.insert(schema.cardRules).values([
  ...[1, 2, 3, 4, 5, 6, 7, 10].map((n) => rule(ids(n))),
  rule(ids(8), { status: "confirmed", confirmedAt: new Date() }),
  rule(ids(9), { status: "corrected", source: "user" }),
  rule(ids(11), { source: "claude", explanation: "owner words" }),
  rule(ids(12), { reviewFlag: "wrong" }),
] as never);
await db.update(schema.cards).set({ skill: `${ATTACK}\n[Auto] When this card attacks, draw 1 card.` }).where(eq(schema.cards.id, ids(9)));
await db.insert(schema.cardRules).values(rule(ids(9), { skillIndex: 10, printed: "[Auto] When this card attacks, draw 1 card." }) as never);
const deck = async (name: string, over: Record<string, unknown>, cardIds: number[]) => {
  const [d] = await db.insert(schema.decks).values({ name, game: "dbs", ...over } as never).returning({ id: schema.decks.id });
  await db.insert(schema.deckCards).values(cardIds.map((n) => ({ deckId: d.id, cardId: ids(n), zone: "main", quantity: 1 })));
};
await deck("A", { owner: "patvolny" }, [1, 2, 3, 8, 9, 11, 12]);
await deck("B", { owner: null }, [1, 2, 4]);
await deck("C", { owner: "patvolny" }, [1, 5]);
await deck("Other", { owner: "someone" }, [6]);
await deck("Testing", { owner: "patvolny", isTesting: true }, [7]);
await deck("Fusion", { owner: "patvolny", game: "fusion" }, [10]);

// ── selection ─────────────────────────────────────────────────────────────
const sel = await selectBatch(db, { owner: "patvolny", next: 30 });
assert.deepEqual(sel.cardIds, [1, 2, 3, 4, 5, 9, 11].map(ids), "deck count first (3, 2), then id; other owner, testing, fusion, confirmed and flagged cards are out");
assert.equal(sel.decks, 3, "owner decks + ownerless, not testing, game dbs");
assert.equal(sel.unchecked, 7);
await assert.rejects(() => selectBatch(db, { next: 2 }), /pass --owner/, "two named owners: the script will not guess");
assert.deepEqual((await selectBatch(db, { owner: "patvolny", next: 3 })).cardIds, [1, 2, 3].map(ids), "next N");

const skipped = await selectBatch(db, { owner: "patvolny", next: 30, skip: [ids(2).toLowerCase(), "nonsense"] });
assert.deepEqual(skipped.skippedByHand, [ids(2)]);
assert.ok(!skipped.cardIds.includes(ids(2)));

const evid = fs.mkdtempSync(path.join(os.tmpdir(), "rules-evid-"));
fs.mkdirSync(path.join(evid, "sub"));
fs.writeFileSync(path.join(evid, "sub", "batch-1.md"), `| ${ids(5)} Card five | f0 | ok |\nnot a card: scripts/verify/u1a-757.ts, P-616 and ${ids(3)}\n`);
fs.writeFileSync(path.join(evid, "new.md"), `${ids(4)}\n`);
const listed = listedIds(evid, path.join(evid, "new.md"));
assert.deepEqual([...listed.keys()].sort(), [ids(3), ids(5), "P-616"].sort(), "ids named in earlier receipts; the output file itself is ignored");
const withListed = await selectBatch(db, { owner: "patvolny", next: 30, listed });
assert.deepEqual(withListed.cardIds, [1, 2, 4, 9, 11].map(ids));
assert.deepEqual(withListed.skippedListed, [{ id: ids(3), file: "batch-1.md" }, { id: ids(5), file: "batch-1.md" }]);
assert.deepEqual((await selectBatch(db, { owner: "patvolny", next: 30, listed, includeListed: new Set([ids(3)]) })).cardIds, [1, 2, 3, 4, 9, 11].map(ids), "--include-listed ID takes one back");
assert.equal((await selectBatch(db, { owner: "patvolny", next: 30, listed, includeListed: true })).cardIds.length, 7, "--include-listed takes all back");

// rows: a corrected row stays out of the table, a Claude row is shown with its blocker
const byKey = (k: string) => sel.rows.find((r) => `${r.cardId}:${r.side}:${r.skillIndex}` === k)!;
assert.equal(byKey(`${ids(9)}:front:0`).state, "done", "owner-corrected: left alone");
assert.equal(byKey(`${ids(9)}:front:10`).state, "review");
assert.equal(byKey(`${ids(11)}:front:0`).state, "blocked");
assert.match(byKey(`${ids(11)}:front:0`).blocker ?? "", /source is claude/);
assert.equal(byKey(`${ids(1)}:front:0`).state, "review");

// ── receipt skeleton ──────────────────────────────────────────────────────
const text = renderReceipt(withListed, { date: "2026-10-20", batch: "batch 6", next: 30 });
assert.ok(text.startsWith("# Rules review, 2026-10-20, batch 6: next 30 deck cards\n"));
for (const part of ["Authorization: <", "## Selection", "Owner `patvolny` plus ownerless decks", "Skipped as already listed in the receipts: BT1-003 (batch-1.md), BT1-005 (batch-1.md)", "The first 5 of the remaining 5:", `${[1, 2, 4, 9, 11].map(ids).join(", ")}.`, "Basis order:", "## Totals", "| Card | Skill | Printed (short) | Verdict | Basis |", "## Left alone", "## Not done / caveats"]) {
  assert.ok(text.includes(part), `receipt has: ${part}`);
}
const tableRows = text.split("\n").filter((l) => /^\| BT1-/.test(l));
assert.equal(tableRows.length, 5 + 0, "one table row per row to review (the corrected one is listed under Left alone)");
assert.ok(tableRows.every((l) => /\|  \|  \|$/.test(l)), "Verdict and Basis start empty");
assert.ok(tableRows.some((l) => l.includes("Card 1 \\| pipe")), "pipes in names are escaped");
assert.ok(text.includes(`- ${ids(9)} f0: corrected/user`));
assert.match(tableRows.find((l) => l.startsWith(`| ${ids(11)}`))!, /f0 \[source is claude/);

// ── the database proof ────────────────────────────────────────────────────
await assertThisAppsDb(db);
const other = await mk();
await assert.rejects(() => assertThisAppsDb(other.db), /not the trading-card-management database/, "a database without card_rules is refused");
await other.client.close();

// ── snapshot ──────────────────────────────────────────────────────────────
const before = await takeSnapshot(db, [ids(1), ids(2)]);
assert.equal(Object.keys(before.rows).length, 2);
const frozen = JSON.parse(JSON.stringify(before));
assert.deepEqual(diffSnapshots(frozen, await takeSnapshot(db, [ids(1), ids(2)])).changed, [], "no change reads as no difference, also after a trip through JSON");
await db.update(schema.cardRules).set({ ops: [{ op: "draw", n: 2 }] as never, reads: "draw 2", source: "claude", explanation: "x", version: sql`${schema.cardRules.version} + 1`, updatedAt: new Date(Date.now() + 5000) }).where(eq(schema.cardRules.cardId, ids(1)));
let diff = diffSnapshots(frozen, await takeSnapshot(db, [ids(1), ids(2)]));
assert.deepEqual(diff.changed, [{ key: `${ids(1)}:front:0`, fields: ["explanation", "ops", "reads", "source", "updatedAt", "version"] }]);
assert.deepEqual(unexpectedFields(diff, ["ops", "reads", "source", "version", "explanation"]), [], "only the expected fields (updatedAt is always allowed)");
await db.update(schema.cardRules).set({ cond: { if: "x" } as never }).where(eq(schema.cardRules.cardId, ids(1)));
diff = diffSnapshots(frozen, await takeSnapshot(db, [ids(1), ids(2)]));
assert.deepEqual(unexpectedFields(diff, ["ops", "reads", "source", "version", "explanation"]), [{ key: `${ids(1)}:front:0`, fields: ["cond"] }], "a dropped or added cond is reported");
await db.delete(schema.cardRules).where(eq(schema.cardRules.cardId, ids(2)));
assert.deepEqual(diffSnapshots(frozen, await takeSnapshot(db, [ids(1), ids(2)])).removed, [`${ids(2)}:front:0`]);
await client.close();

// ── card-db-env.mjs, stubbed fetch ────────────────────────────────────────
const URL_VALUE = "postgresql://user:pa'ss&word@ep-cool-name-123-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
assert.equal(shellQuote("a'b&c"), `'a'\\''b&c'`);
assert.equal(checkHost(URL_VALUE), "ep-cool-name-123-pooler.eu-central-1.aws.neon.tech");
for (const bad of ["postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/db", "postgresql://u:p@ep-x-pooler.us-east-2.aws.neon.tech/db", "not a url secret-pw"]) {
  assert.throws(() => checkHost(bad), (e: Error) => !e.message.includes("secret-pw") && !e.message.includes("u:p"), "refused, and the message never carries the value");
}
const calls: string[] = [];
let flaky = 1;
const stub = (async (url: string, init: { headers: { Authorization: string } }) => {
  calls.push(url);
  assert.equal(init.headers.Authorization, "Bearer tok");
  const json = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b });
  if (url.includes("/v9/projects")) return flaky-- > 0 ? json({}, 502) : json({ projects: [{ name: "other", id: "p0", accountId: "t0" }, { name: "trading-card-management", id: "p1", accountId: "t1" }] });
  if (url.includes("/v10/projects/p1/env?teamId=t1")) return json({ envs: [{ key: "X", id: "e0" }, { key: "DATABASE_URL", id: "e1", target: ["preview"] }, { key: "DATABASE_URL", id: "e2", target: ["production"] }] });
  if (url.includes("/v1/projects/p1/env/e2?teamId=t1")) return json({ value: URL_VALUE });
  return json({}, 404);
}) as unknown as typeof fetch;
assert.equal(await fetchDatabaseUrl({ token: "tok", fetchFn: stub, sleep: async () => {} }), URL_VALUE, "the production entry's value, after one retried 502");
assert.equal(calls.length, 4);
await assert.rejects(() => fetchDatabaseUrl({ token: "", fetchFn: stub }), /VERCEL_TOKEN/);
await assert.rejects(() => fetchDatabaseUrl({ token: "tok", fetchFn: (async () => ({ ok: false, status: 403, json: async () => ({}) })) as unknown as typeof fetch, sleep: async () => {} }), /HTTP 403/);
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "card-db-env-")), "card-db.env");
writeEnvFile(out, URL_VALUE);
assert.equal(fs.statSync(out).mode & 0o777, 0o600);
assert.equal(execFileSync("sh", ["-c", `. '${out}'; printf %s "$DATABASE_URL"`]).toString(), URL_VALUE, "the quoted file sources back to the exact value");
assert.throws(() => writeEnvFile(path.join(process.cwd(), "leak.env"), URL_VALUE), /inside the repo/);
assert.ok(!fs.existsSync(path.join(process.cwd(), "leak.env")));

console.log("rules-batch: ok");
process.exit(0);
