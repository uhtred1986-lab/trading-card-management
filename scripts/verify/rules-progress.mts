/** Deck-weighted rules progress (`/arena/rules/progress`): the query against PGlite with the real migrations. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../src/db/schema.ts";
import type { Db } from "../../src/db/index.ts";
import { computeProgress, loadProgress, recordAndReadSnapshots } from "../../src/lib/arena/rules-progress.ts";

const client = new PGlite();
const db = drizzle(client, { schema }) as unknown as Db;
const dir = path.resolve("drizzle");
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort())
  for (const stmt of fs.readFileSync(path.join(dir, file), "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await client.exec(stmt.trim());

await db.insert(schema.cardSets).values({ code: "BT1", name: "Set", line: "legacy", sortKey: 1 });
const card = (id: string, skill: string | null) => ({ id, setCode: "BT1", name: `Card ${id}`, cardType: "BATTLE", rarity: "C", rarityCode: "C", searchText: id, skill });
await db.insert(schema.cards).values([
  card("BT1-001", "[Auto] a"), card("BT1-002", "[Auto] b"), card("BT1-003", "[Auto] c"), card("BT1-004", "[Auto] d"),
  card("BT1-005", "[Auto] e"), card("BT1-006", null), card("BT1-007", "[Auto] g"), card("BT1-008", "[Auto] h"),
]);
const rule = (cardId: string, skillIndex: number, o: Partial<typeof schema.cardRules.$inferInsert>) =>
  ({ cardId, side: "front", skillIndex, printed: "x", kind: "Auto", status: "draft", source: "compiler", unread: [] as string[], ...o });
await db.insert(schema.cardRules).values([
  rule("BT1-001", 0, { status: "confirmed", confirmedAt: new Date() }),
  rule("BT1-002", 0, { status: "confirmed", confirmedAt: new Date() }),
  rule("BT1-002", 10, { status: "corrected", source: "user" }),
  rule("BT1-003", 0, { status: "confirmed", confirmedAt: new Date() }),
  rule("BT1-003", 10, { status: "draft" }), // one skill only read: card not confirmed
  rule("BT1-004", 0, { status: "open", unread: ["clause"] }),
  rule("BT1-005", 0, { status: "confirmed", confirmedAt: new Date(), reviewFlag: "suspect" }),
  rule("BT1-008", 0, { status: "confirmed", confirmedAt: new Date() }), // only in a testing deck
]);
const [mine, other, testing, fusion] = await db.insert(schema.decks).values([
  { name: "Mine", owner: "pat" }, { name: "Other", owner: "sam" }, { name: "Testing", owner: "pat", isTesting: true }, { name: "Fusion", owner: "pat", game: "fusion" },
]).returning();
const dc = (deckId: number, cardId: string, zone = "main", quantity = 1) => ({ deckId, cardId, zone, quantity });
await db.insert(schema.deckCards).values([
  dc(mine.id, "BT1-001", "leader"), dc(mine.id, "BT1-002", "main", 4), dc(mine.id, "BT1-003", "z"), dc(mine.id, "BT1-004"), dc(mine.id, "BT1-005"),
  dc(mine.id, "BT1-006"), dc(mine.id, "BT1-007"), dc(mine.id, "BT1-003", "main"), dc(mine.id, "BT1-001", "side"),
  dc(other.id, "BT1-001"), dc(other.id, "BT1-002"),
  dc(testing.id, "BT1-008"), dc(fusion.id, "BT1-008"),
]);

const all = await loadProgress(db, undefined);
assert.equal(all.total, 6, "no-skill card, testing and fusion decks are out");
assert.equal(all.confirmed, 2, "BT1-001 and BT1-002 only: read, unread, flagged and missing do not count");
const byId = Object.fromEntries(all.cards.map((c) => [c.cardId, c]));
assert.equal(byId["BT1-001"].appearances, 2);
assert.equal(byId["BT1-002"].bucket, "confirmed");
assert.equal(byId["BT1-002"].copies, 5);
assert.equal(byId["BT1-003"].bucket, "read");
assert.equal(byId["BT1-003"].appearances, 1);
assert.equal(byId["BT1-004"].bucket, "unread");
assert.equal(byId["BT1-005"].bucket, "flagged");
assert.equal(byId["BT1-007"].bucket, "missing");
assert.equal(byId["BT1-006"], undefined);
assert.deepEqual(all.skills, { confirmed: 3, owner: 1, read: 1, unread: 1, flagged: 1 });
assert.equal(all.cards[0].appearances, 2, "sorted by deck appearances");
const d = all.decks.find((x) => x.name === "Mine")!;
assert.deepEqual([d.total, d.confirmed, d.read, d.unread, d.flagged, d.missing], [6, 2, 1, 1, 1, 1]);

const scoped = await loadProgress(db, "sam");
assert.deepEqual([scoped.total, scoped.confirmed], [2, 2]);
assert.equal((await loadProgress(db, "nobody")).total, 0);
assert.equal(computeProgress([], []).total, 0);

assert.equal((await recordAndReadSnapshots(db, all, "2026-10-17")).length, 1);
const hist = await recordAndReadSnapshots(db, scoped, "2026-10-17"); // a second write the same day is ignored
assert.equal(hist.length, 1);
assert.equal(hist[0].confirmedCards, 2);
assert.equal(hist[0].totalCards, 6);
assert.equal((await recordAndReadSnapshots(db, all, "2026-10-18")).length, 2);
console.log("rules progress OK");
