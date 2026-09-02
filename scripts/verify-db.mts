/**
 * Applies the generated migrations to an in-memory Postgres (PGlite) and
 * exercises the reservation rules the deck feature depends on. No network,
 * no DATABASE_URL.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../src/db/schema.ts";
import type { Db } from "../src/db/index.ts";
import { allocationForCards, buildConflicts } from "../src/lib/decks/reservations.ts";
import { pricesForPrints, priceForFinish } from "../src/lib/pricing/queries.ts";

const client = new PGlite();
const db = drizzle(client, { schema }) as unknown as Db;

// Apply every migration in order, statement by statement.
const dir = path.resolve("drizzle");
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  const sqlText = fs.readFileSync(path.join(dir, file), "utf8");
  for (const stmt of sqlText.split("--> statement-breakpoint")) {
    const s = stmt.trim();
    if (s) await client.exec(s);
  }
}

// Seed a tiny catalog.
await db.insert(schema.cardSets).values({ code: "BT18", name: "Dawn of the Z-Legends", line: "legacy", sortKey: 18 });
const card = (id: string, name: string) => ({ id, setCode: "BT18", name, cardType: "BATTLE", rarity: "Common[C]", rarityCode: "C", searchText: `${id} ${name}`.toLowerCase() });
await db.insert(schema.cards).values([card("BT18-020", "Omega Shenron"), card("BT18-021", "Goku"), card("BT18-022", "Vegeta")]);
await db.insert(schema.cardPrints).values([
  { id: "BT18-020", cardId: "BT18-020", suffix: "", label: "Standard", rarity: "C", isBase: true },
  { id: "BT18-020_SPR", cardId: "BT18-020", suffix: "SPR", label: "Special Rare", rarity: "SPR", isBase: false },
  { id: "BT18-021", cardId: "BT18-021", suffix: "", label: "Standard", rarity: "C", isBase: true },
  { id: "BT18-022", cardId: "BT18-022", suffix: "", label: "Standard", rarity: "C", isBase: true },
]);

// Own 4 Omega (3 standard + 1 SPR) and 2 Goku, no Vegeta.
await db.insert(schema.ownedCards).values([
  { printId: "BT18-020", cardId: "BT18-020", quantity: 3 },
  { printId: "BT18-020_SPR", cardId: "BT18-020", quantity: 1, finish: "foil" },
  { printId: "BT18-021", cardId: "BT18-021", quantity: 2 },
]);

const alloc0 = await allocationForCards(db, ["BT18-020", "BT18-021", "BT18-022"]);
assert.deepEqual(alloc0.get("BT18-020"), { owned: 4, reserved: 0, available: 4 }, "prints of one card pool together");
assert.deepEqual(alloc0.get("BT18-022"), { owned: 0, reserved: 0, available: 0 });

// Deck A (built): 4 Omega + 2 Goku. Deck B (virtual): 2 Omega + 1 Vegeta.
const [a] = await db.insert(schema.decks).values({ name: "A", isBuilt: true }).returning({ id: schema.decks.id });
const [b] = await db.insert(schema.decks).values({ name: "B" }).returning({ id: schema.decks.id });
await db.insert(schema.deckCards).values([
  { deckId: a.id, cardId: "BT18-020", zone: "main", quantity: 4 },
  { deckId: a.id, cardId: "BT18-021", zone: "main", quantity: 2 },
  { deckId: b.id, cardId: "BT18-020", zone: "main", quantity: 2 },
  { deckId: b.id, cardId: "BT18-022", zone: "main", quantity: 1 },
]);

const alloc1 = await allocationForCards(db, ["BT18-020", "BT18-021"]);
assert.deepEqual(alloc1.get("BT18-020"), { owned: 4, reserved: 4, available: 0 }, "built deck reserves");
assert.deepEqual(alloc1.get("BT18-021"), { owned: 2, reserved: 2, available: 0 });

assert.deepEqual(await buildConflicts(db, a.id), [], "an already-built deck re-checks clean (its own reservations are excluded)");

const conflicts = await buildConflicts(db, b.id);
assert.deepEqual(
  conflicts.map((c) => ({ cardId: c.cardId, needed: c.needed, owned: c.owned, reservedElsewhere: c.reservedElsewhere, short: c.short })),
  [
    { cardId: "BT18-020", needed: 2, owned: 4, reservedElsewhere: 4, short: 2 },
    { cardId: "BT18-022", needed: 1, owned: 0, reservedElsewhere: 0, short: 1 },
  ],
  "B is blocked: Omega fully reserved by A, Vegeta not owned",
);

// Un-build A → B only lacks Vegeta.
await db.update(schema.decks).set({ isBuilt: false });
const after = await buildConflicts(db, b.id);
assert.deepEqual(after.map((c) => c.cardId), ["BT18-022"], "un-building releases reservations");

// Deleting a deck cascades its cards; deleting a card with lots is refused (restrict on print).
await db.delete(schema.decks).where((await import("drizzle-orm")).eq(schema.decks.id, a.id));
const left = await db.select().from(schema.deckCards);
assert.equal(left.filter((r) => r.deckId === a.id).length, 0, "deck_cards cascade");
await assert.rejects(db.delete(schema.cardPrints).where((await import("drizzle-orm")).eq(schema.cardPrints.id, "BT18-020")), /Failed query|violates foreign key|restrict/i, "print with owned lots cannot be deleted");

// Price reduction: foil-only SR still yields a "normal" price; SPR product maps to its print.
await db.insert(schema.tcgGroups).values({ id: 1, name: "BT18" });
await db.insert(schema.tcgProducts).values([
  { id: 10, groupId: 1, name: "Omega Shenron", number: "BT18-020", cardId: "BT18-020", printId: "BT18-020" },
  { id: 11, groupId: 1, name: "Omega Shenron (SPR)", number: "BT18-020", marker: "spr", cardId: "BT18-020", printId: "BT18-020_SPR" },
]);
await db.insert(schema.tcgPrices).values([
  { productId: 10, subType: "Foil", capturedOn: "2026-09-01", marketCents: 36 },
  { productId: 10, subType: "Foil", capturedOn: "2026-09-02", marketCents: 40 },
  { productId: 11, subType: "Foil", capturedOn: "2026-09-02", marketCents: 199 },
]);
const prices = await pricesForPrints(db, ["BT18-020", "BT18-020_SPR"]);
assert.equal(prices.get("BT18-020")?.normalCents, null);
assert.equal(prices.get("BT18-020")?.foilCents, 40, "newest snapshot wins");
assert.equal(priceForFinish(prices.get("BT18-020"), "normal"), 40, "falls back to foil when that's the only print");
assert.equal(priceForFinish(prices.get("BT18-020_SPR"), "foil"), 199);

// Scan batches: photo bytes round-trip, completing writes lots and drops the photo.
{
  const { completeBatch, createBatch, getBatch, listOpenBatches, photoBytes, replaceItems, storePhoto, updateItem } = await import("../src/lib/scan/batches.ts");
  const batchId = await createBatch(db, "batch");
  const photoId = await storePhoto(db, batchId, 0, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), 100, 140);
  assert.deepEqual([...(await photoBytes(db, photoId))!.data], [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3], "bytea round-trips");
  const cand = { id: "BT18-020", name: "Omega Shenron", setCode: "BT18", imageUrl: null, cardType: "BATTLE", colors: ["Red"], rarityCode: "C", prints: [{ id: "BT18-020", label: "Standard" }, { id: "BT18-020_SPR", label: "Special Rare" }] };
  const det = (i: number, list: typeof cand[], conf: number) => ({ index: i, seen: { name: "x", number: null, confidence: 0.9, position: "a", box: null, notes: null }, candidates: list, exact: list.length > 0, matchedBy: list.length ? ("number" as const) : null, matchConfidence: conf });
  const items = await replaceItems(db, batchId, photoId, [det(0, [cand], 0.95), det(1, [], 0)]);
  assert.equal(items.length, 2);
  assert.equal(items[0].printId, "BT18-020", "best candidate's standard print is preselected");
  assert.equal(items[1].include, false, "unmatched rows start excluded");
  const [summary] = await listOpenBatches(db);
  assert.deepEqual({ photos: summary.photos, items: summary.items, needsReview: summary.needsReview, ready: summary.ready }, { photos: 1, items: 2, needsReview: 1, ready: 1 });
  await updateItem(db, items[0].id, { printId: "BT18-020_SPR", quantity: 2, finish: "foil" });
  await updateItem(db, items[1].id, { chosen: cand, manual: true, printId: "BT18-020", include: true });
  const before = (await db.select().from(schema.ownedCards)).length;
  const { added } = await completeBatch(db, batchId);
  assert.equal(added, 3, "2 foil SPR + 1 standard");
  const lots = (await db.select().from(schema.ownedCards)).slice(before);
  assert.deepEqual(lots.map((l) => [l.printId, l.quantity, l.finish]).sort(), [["BT18-020", 1, "normal"], ["BT18-020_SPR", 2, "foil"]]);
  assert.equal(await photoBytes(db, photoId), null, "photo bytes are dropped on completion");
  assert.equal((await getBatch(db, batchId))!.items.length, 0, "items are dropped on completion");
  assert.equal((await listOpenBatches(db)).length, 0, "completed batch is no longer open");
}

await client.close();
console.log("verify-db: all checks passed");
