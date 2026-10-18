/** arena:refresh-ids (scripts/lib/refresh-ids.ts): id parsing, classification, every exclusion, apply and the 0-pending re-check.
 * Real migrations on PGlite; no network, no DATABASE_URL. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import * as schema from "../../src/db/schema.ts";
import type { Db } from "../../src/db/index.ts";
import { rows } from "../../src/db/rows.ts";
import { cardDefFrom } from "../../src/lib/arena/load.ts";
import { skillRecords } from "../../src/lib/arena/draft.ts";
import { applyPending, classifyIds, idsFromPrBody, parseIdList, parseSpec, summarize, type Verdict } from "../lib/refresh-ids.ts";

// ── parsing ──────────────────────────────────────────────────────────────────
assert.deepEqual(parseSpec("BT12-003#10"), { cardId: "BT12-003", side: null, skill: 10, raw: "BT12-003#10" });
assert.equal(parseSpec("BT12-003#10b")?.side, "back");
assert.equal(parseSpec("P-274#0#back")?.side, "back");
assert.equal(parseSpec("P-274#back#0")?.side, "back");
assert.equal(parseSpec("P-274/front/0")?.side, "front");
assert.equal(parseSpec("nonsense"), null);
const list = parseIdList("BT12-003#10, P-274#0\nBT12-003#10 x#");
assert.deepEqual(list.specs.map((s) => s.raw), ["BT12-003#10", "P-274#0"]);
assert.deepEqual(list.bad, ["x#"]);
const pr = idsFromPrBody("## Summary\nBT1-001#0 is in the summary, not the list.\n## Production refresh\n- BT12-003#10\n- P-274#0b and EX19-01#10\n## Test plan\nBT2-002#0");
assert.deepEqual(pr.specs.map((s) => s.raw), ["BT12-003#10", "P-274#0b", "EX19-01#10"]);
assert.equal(idsFromPrBody("nothing here BT1-001#0").specs.length, 0);

// ── database ─────────────────────────────────────────────────────────────────
const client = new PGlite();
const db = drizzle(client, { schema }) as unknown as Db;
const dir = path.resolve("drizzle");
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort())
  for (const stmt of fs.readFileSync(path.join(dir, file), "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await client.exec(stmt.trim());
await db.insert(schema.cardSets).values([
  { code: "BT1", name: "Test", line: "legacy", sortKey: 1, game: "dbs" },
  { code: "FS01", name: "Fusion", line: "fusion", sortKey: 2, game: "fusion" },
]);
const DRAW = "[Auto] When this card is played, draw 1 card.";
const UNREAD = "[Auto] When this card is played, frobnicate the wibble.";
const card = (id: string, skill: string, extra: Record<string, unknown> = {}) =>
  ({ id, setCode: id.startsWith("FS") ? "FS01" : "BT1", game: id.startsWith("FS") ? "fusion" : "dbs", name: id, cardType: "BATTLE", rarity: "C", rarityCode: "C", searchText: id.toLowerCase(), skill, ...extra });
await db.insert(schema.cards).values([
  card("T-CLEAN", DRAW), card("T-UTD", DRAW), card("T-CONF", DRAW), card("T-OWNED", DRAW), card("T-CONFAT", DRAW),
  card("T-PRINTED", DRAW), card("BT2-015", DRAW), card("T-UNREAD", UNREAD), card("T-NOROW", DRAW), card("P-616", DRAW),
  card("FS-FUSION", DRAW), card("T-BACK", DRAW, { backName: "Back", backPower: 5000, backSkill: DRAW }),
] as never);

const defs = new Map((await db.select().from(schema.cards)).map((c) => [c.id, cardDefFrom(c)]));
const rec = (id: string, side: "front" | "back" = "front") => skillRecords(defs.get(id)!).find((r) => r.side === side)!;
async function put(id: string, over: Record<string, unknown> = {}, side: "front" | "back" = "front") {
  const r = rec(id, side);
  const row = { cardId: id, side, skillIndex: r.skillIndex, printed: r.printed, kind: r.kind, trigger: r.trigger, cost: r.cost, cond: r.cond, ops: r.ops,
    unread: r.unread, pattern: r.pattern, reads: r.reads, status: "draft", source: "compiler", explanation: "keep", ...over };
  await db.insert(schema.cardRules).values(row as never);
}
const STALE = { reads: "an older reading", ops: [] };
await put("T-CLEAN", STALE);                                   // pending, clean
await put("T-UTD");                                            // up to date
await put("T-CONF", { ...STALE, status: "confirmed", confirmedAt: new Date() });
await put("T-OWNED", { ...STALE, status: "corrected", source: "user" });
await put("T-CONFAT", { ...STALE, confirmedAt: new Date() }); // draft status but confirmed_at set
await put("T-PRINTED", { ...STALE, printed: "an earlier printing" });
await put("BT2-015", { ...STALE, printed: "pre-erratum text" }); // draft + official erratum
await put("T-UNREAD", { reads: "an older reading", ops: [], unread: [], status: "draft" });
await put("P-616", STALE);
await put("FS-FUSION", STALE);
await put("T-BACK", STALE, "back");
await put("T-BACK", { ...STALE, status: "open" }, "front");

const snapshot = async () => rows<{ record: Record<string, unknown> }>(await db.execute(sql`select to_jsonb(r) as record from card_rules r order by id`)).map((r) => r.record);
const specs = parseIdList("T-CLEAN#0 T-UTD#0 T-CONF#0 T-OWNED#0 T-CONFAT#0 T-PRINTED#0 BT2-015#0 T-UNREAD#0 T-NOROW#0 P-616#0 FS-FUSION#0 T-BACK#0b T-BACK#0 T-GHOST#0 T-CLEAN#7").specs;
const before = await snapshot();
const byId = (v: Verdict[], raw: string) => v.find((x) => x.spec.raw === raw)!;

let v = await classifyIds(db, specs);
assert.equal(byId(v, "T-CLEAN#0").status, "pending");
assert.equal(byId(v, "T-CLEAN#0").writer, "clean");
assert.match(byId(v, "T-CLEAN#0").old!, /older reading/);
assert.equal(byId(v, "T-UTD#0").status, "up-to-date");
assert.match(byId(v, "T-CONF#0").reason!, /status is confirmed/);
assert.match(byId(v, "T-OWNED#0").reason!, /source is user/);
assert.match(byId(v, "T-CONFAT#0").reason!, /confirmed_at/);
assert.match(byId(v, "T-PRINTED#0").reason!, /printed text changed/);
assert.equal(byId(v, "BT2-015#0").status, "pending", "a draft row changed by an erratum is refreshable");
assert.match(byId(v, "BT2-015#0").note!, /erratum/);
assert.match(byId(v, "T-UNREAD#0").reason!, /unread/);
assert.match(byId(v, "T-NOROW#0").reason!, /no stored/);
assert.match(byId(v, "P-616#0").reason!, /907/);
assert.match(byId(v, "FS-FUSION#0").reason!, /dbs only/);
assert.equal(byId(v, "T-BACK#0b").status, "pending", "the back face resolves by its suffix");
assert.equal(byId(v, "T-BACK#0b").key, "T-BACK/back/0");
assert.equal(byId(v, "T-BACK#0").key, "T-BACK/front/0");
assert.match(byId(v, "T-GHOST#0").reason!, /no such card/);
assert.match(byId(v, "T-CLEAN#7").reason!, /no such skill/);
assert.deepEqual(await snapshot(), before, "classification writes nothing");

// --unread-ok: the unread card is pending on the unread writer only when the row differs. Its fresh compile leaves text unread.
v = await classifyIds(db, specs, { unreadOk: true });
assert.equal(byId(v, "T-UNREAD#0").status, "pending");
assert.equal(byId(v, "T-UNREAD#0").writer, "unread");
assert.match(byId(v, "T-UNREAD#0").new!, /UNREAD/);

// Apply (clean + unread writers), then the re-check has 0 pending and owned/excluded rows are byte-identical.
const written = await applyPending(db, v);
assert.equal(written.unread.length, 1);
assert.ok(written.clean.length >= 3);
const again = await classifyIds(db, specs, { unreadOk: true });
assert.equal(summarize(again).pending, 0, "re-run after apply has nothing pending");
const after = await snapshot();
for (const id of ["T-CONF", "T-OWNED", "T-CONFAT", "T-PRINTED", "P-616", "FS-FUSION"]) {
  const a = after.find((r) => r.card_id === id)!, b = before.find((r) => r.card_id === id)!;
  assert.deepEqual(a, b, `${id} untouched`);
}
const unreadRow = after.find((r) => r.card_id === "T-UNREAD")!;
assert.equal(unreadRow.status, "open");
assert.equal((unreadRow.unread as string[]).length, 1);
assert.equal(after.find((r) => r.card_id === "T-CLEAN")!.status, "draft");
assert.equal(after.find((r) => r.card_id === "T-CLEAN")!.explanation, "keep");
assert.equal(after.find((r) => r.card_id === "T-CLEAN")!.version, 2);

await client.close();
console.log("refresh-ids: id parsing, classification, every exclusion, apply and the 0-pending re-check passed");
