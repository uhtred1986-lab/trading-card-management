/**
 * Deck-weighted rules progress (`/arena/rules/progress`): the query against PGlite with the real migrations.
 * The buckets are `ruleHealth`'s (text-only, incomplete, unchecked, done); the classifier itself is
 * proved in `rule-health.ts`, this proves the page reads it.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../src/db/schema.ts";
import type { Db } from "../../src/db/index.ts";
import { computeProgress, loadProgress, recordAndReadSnapshots } from "../../src/lib/arena/rules-progress.ts";
import { zeroCostRecord } from "../../src/lib/arena/vm/skill-payment.ts";
import { unlimitedUsage } from "../../src/lib/arena/vm/usage.ts";
import { noSparking } from "../../src/lib/arena/vm/validity.ts";

const client = new PGlite();
const db = drizzle(client, { schema }) as unknown as Db;
const dir = path.resolve("drizzle");
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort())
  for (const stmt of fs.readFileSync(path.join(dir, file), "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await client.exec(stmt.trim());

const A = "[Auto] When this card attacks, draw 1 card.";
const B = "[Auto] When this card is played, draw 1 card.";
const lines = (...l: string[]) => l.join("<br>");
await db.insert(schema.cardSets).values({ code: "BT1", name: "Set", line: "legacy", sortKey: 1 });
const card = (id: string, skill: string | null) => ({ id, setCode: "BT1", name: `Card ${id}`, cardType: "BATTLE", rarity: "C", rarityCode: "C", searchText: id, skill });
await db.insert(schema.cards).values([
  card("BT1-001", A), card("BT1-002", lines(A, B)), card("BT1-003", lines(A, B)), card("BT1-004", A),
  card("BT1-005", A), card("BT1-006", null), card("BT1-007", A), card("BT1-008", A), card("BT1-009", "[Blocker]"),
]);
const draw = [{ op: "draw", n: 1 }];
const rule = (cardId: string, skillIndex: number, o: Partial<typeof schema.cardRules.$inferInsert>) =>
  ({ cardId, side: "front", skillIndex, printed: skillIndex === 10 ? B : A, kind: "auto", trigger: ["attacks"], ops: draw, cost: zeroCostRecord(), usage: unlimitedUsage(), validity: noSparking(), status: "draft", source: "compiler", unread: [] as string[], ...o });
await db.insert(schema.cardRules).values([
  rule("BT1-001", 0, { status: "confirmed", confirmedAt: new Date() }),
  rule("BT1-002", 0, { status: "confirmed", confirmedAt: new Date() }),
  rule("BT1-002", 10, { status: "corrected", source: "user" }),
  rule("BT1-003", 0, { status: "confirmed", confirmedAt: new Date() }),
  rule("BT1-003", 10, { status: "draft" }), // one skill only read: card not done
  rule("BT1-004", 0, { status: "open", ops: [], unread: ["clause"] }),
  rule("BT1-005", 0, { status: "confirmed", confirmedAt: new Date(), reviewFlag: "suspect" }), // flagged: incomplete
  rule("BT1-008", 0, { status: "confirmed", confirmedAt: new Date() }), // only in a testing deck
  { ...rule("BT1-009", 0, { status: "draft", ops: [], trigger: [], printed: "[Blocker]", kind: "keyword" }) }, // a keyword line: nothing to check
]);
const [mine, other, testing, fusion] = await db.insert(schema.decks).values([
  { name: "Mine", owner: "pat" }, { name: "Other", owner: "sam" }, { name: "Testing", owner: "pat", isTesting: true }, { name: "Fusion", owner: "pat", game: "fusion" },
]).returning();
const dc = (deckId: number, cardId: string, zone = "main", quantity = 1) => ({ deckId, cardId, zone, quantity });
await db.insert(schema.deckCards).values([
  dc(mine.id, "BT1-001", "leader"), dc(mine.id, "BT1-002", "main", 4), dc(mine.id, "BT1-003", "z"), dc(mine.id, "BT1-004"), dc(mine.id, "BT1-005"),
  dc(mine.id, "BT1-006"), dc(mine.id, "BT1-007"), dc(mine.id, "BT1-003", "main"), dc(mine.id, "BT1-001", "side"), dc(mine.id, "BT1-009"),
  dc(other.id, "BT1-001"), dc(other.id, "BT1-002"),
  dc(testing.id, "BT1-008"), dc(fusion.id, "BT1-008"),
]);

const all = await loadProgress(db, undefined);
assert.equal(all.total, 6, "no-skill card, keyword-only card, testing and fusion decks are out");
assert.equal(all.done, 2, "BT1-001 and BT1-002 only: unchecked, open, flagged and missing do not count");
const byId = Object.fromEntries(all.cards.map((c) => [c.cardId, c]));
assert.equal(byId["BT1-001"].appearances, 2);
assert.equal(byId["BT1-002"].bucket, "done");
assert.equal(byId["BT1-002"].copies, 5);
assert.equal(byId["BT1-003"].bucket, "unchecked");
assert.equal(byId["BT1-003"].appearances, 1);
assert.equal(byId["BT1-004"].bucket, "text-only", "an open rule is text only");
assert.equal(byId["BT1-005"].bucket, "incomplete", "a flagged rule is incomplete, however it was approved");
assert.equal(byId["BT1-007"].bucket, "text-only", "printed text and no rule row at all");
assert.equal(byId["BT1-006"], undefined);
assert.equal(byId["BT1-009"], undefined, "a keyword line needs no row: nothing to check");
assert.deepEqual(all.skills, { "text-only": 2, incomplete: 1, unchecked: 1, done: 4 });
assert.equal(all.cards[0].appearances, 2, "sorted by deck appearances");
const d = all.decks.find((x) => x.name === "Mine")!;
assert.deepEqual([d.total, d.done, d.unchecked, d.incomplete, d["text-only"]], [6, 2, 1, 1, 2]);

// A rule edited back to a draft is no longer approved (the saveRule bug): its stamp is gone, so it is unchecked.
const { saveRule } = await import("../../src/lib/arena/rules-store.ts");
const edited = await saveRule(db, { cardId: "BT1-001", side: "front", skillIndex: 0, ops: draw as never, source: "user", status: "draft" });
assert.equal(edited.confirmedAt, null, "writing a draft clears confirmed_at");
assert.equal((await loadProgress(db, undefined)).done, 1, "…so Progress no longer counts BT1-001 as done");
const reconfirmed = await saveRule(db, { cardId: "BT1-001", side: "front", skillIndex: 0, ops: draw as never, source: "user", status: "confirmed" });
assert.ok(reconfirmed.confirmedAt, "confirming stamps it again");
assert.equal((await loadProgress(db, undefined)).done, 2);

const scoped = await loadProgress(db, "sam");
assert.deepEqual([scoped.total, scoped.done], [2, 2]);
assert.equal((await loadProgress(db, "nobody")).total, 0);
assert.equal(computeProgress([], []).total, 0);

const now = await loadProgress(db, undefined);
assert.equal((await recordAndReadSnapshots(db, now, "2026-10-17")).length, 1);
const hist = await recordAndReadSnapshots(db, scoped, "2026-10-17"); // a second write the same day is ignored
assert.equal(hist.length, 1);
assert.equal(hist[0].confirmedCards, 2);
assert.equal(hist[0].totalCards, 6);
assert.deepEqual([hist[0].readSkills, hist[0].unreadSkills, hist[0].flagged], [1, 2, 1], "unchecked, text-only, incomplete skills");
assert.equal((await recordAndReadSnapshots(db, now, "2026-10-18")).length, 2);

// computeProgress is pure: it takes each skill's health, and the count of printed skills with no row.
const cards = [{ deckId: 1, deckName: "D", cardId: "K-1", cardName: "Draft card", zone: "main", quantity: 1, hasSkill: true }, { deckId: 1, deckName: "D", cardId: "K-2", cardName: "Done card", zone: "main", quantity: 1, hasSkill: true }, { deckId: 1, deckName: "D", cardId: "K-3", cardName: "Stale card", zone: "main", quantity: 1, hasSkill: true, missingSkills: 1 }];
const kw = computeProgress(cards, [{ id: 1, cardId: "K-1", health: "unchecked" }, { id: 2, cardId: "K-2", health: "done" }, { id: 3, cardId: "K-3", health: "done" }]);
assert.deepEqual([kw.total, kw.done], [3, 1], "an unchecked draft is not done");
assert.equal(kw.cards.find((c) => c.cardId === "K-1")!.bucket, "unchecked");
assert.equal(kw.cards.find((c) => c.cardId === "K-2")!.bucket, "done");
assert.equal(kw.cards.find((c) => c.cardId === "K-3")!.bucket, "text-only", "a done skill beside a stale one: the card takes its worst");
console.log("rules progress OK");
