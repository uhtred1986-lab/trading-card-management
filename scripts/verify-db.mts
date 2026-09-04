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
import { expand } from "../src/lib/collection/lots.ts";

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

// Own 4 Omega (3 standard + 1 SPR) and 2 Goku, no Vegeta — one row per card.
await db.insert(schema.ownedCards).values([
  ...expand({ printId: "BT18-020", cardId: "BT18-020" }, 3),
  { printId: "BT18-020_SPR", cardId: "BT18-020", finish: "foil" },
  ...expand({ printId: "BT18-021", cardId: "BT18-021" }, 2),
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

// Adding acquired cards to a deck: zones by type, accumulate, cap at the copy limit, one leader.
{
  const { addCardsToDeck } = await import("../src/lib/decks/add.ts");
  await db.insert(schema.cards).values([
    { id: "BT18-001", setCode: "BT18", name: "Leader One", cardType: "LEADER", rarity: "L", rarityCode: "L", searchText: "bt18-001" },
    { id: "BT18-002", setCode: "BT18", name: "Leader Two", cardType: "LEADER", rarity: "L", rarityCode: "L", searchText: "bt18-002" },
    { id: "BT18-116", setCode: "BT18", name: "Z Battle", cardType: "Z-BATTLE", rarity: "SR", rarityCode: "SR", searchText: "bt18-116" },
  ]);
  const [d] = await db.insert(schema.decks).values({ name: "Acquisitions" }).returning({ id: schema.decks.id });
  await addCardsToDeck(db, d.id, [{ cardId: "BT18-020", quantity: 3 }, { cardId: "BT18-001", quantity: 1 }, { cardId: "BT18-116", quantity: 1 }]);
  await addCardsToDeck(db, d.id, [{ cardId: "BT18-020", quantity: 3 }, { cardId: "BT18-002", quantity: 1 }]);
  const rowsInDeck = (await db.select().from(schema.deckCards).where((await import("drizzle-orm")).eq(schema.deckCards.deckId, d.id))).map((r) => [r.zone, r.cardId, r.quantity]).sort();
  assert.deepEqual(
    rowsInDeck,
    [
      ["leader", "BT18-001", 1],
      ["leader", "BT18-002", 1], // a second leader is added, not silently swapped in
      ["main", "BT18-020", 6], // 3 + 3, not capped at the 4-copy limit
      ["z", "BT18-116", 1],
    ],
    "nothing scanned into a deck is dropped or replaced",
  );
  // …and the deck is flagged for exactly those two things.
  const { legalityForDecks } = await import("../src/lib/decks/legality.ts");
  const flagged = (await legalityForDecks(db, [d.id])).get(d.id)!;
  assert.equal(flagged.status, "illegal");
  assert.ok(flagged.issues.some((i) => /2 leaders/.test(i.message)));
  assert.equal(flagged.flags["main:BT18-020"]?.label, "6 copies, limit 4");
}

// A bulk row of "3 non-foil + 1 foil" is one row on screen and four cards stored.
{
  const before = (await db.select().from(schema.ownedCards)).length;
  const inputs = [
    { printId: "BT18-022", quantity: 3, finish: "normal" },
    { printId: "BT18-022", quantity: 1, finish: "foil" },
  ];
  await db.insert(schema.ownedCards).values(inputs.flatMap((i) => expand({ printId: i.printId, cardId: "BT18-022", finish: i.finish }, i.quantity)));
  const added = (await db.select().from(schema.ownedCards)).slice(before);
  assert.equal(added.length, 4, "one screen row becomes four physical cards");
  assert.equal(added.filter((l) => l.finish === "foil").length, 1);
  assert.equal(added.filter((l) => l.finish === "normal").length, 3);
  const { eq: eqOp } = await import("drizzle-orm");
  await db.delete(schema.ownedCards).where(eqOp(schema.ownedCards.cardId, "BT18-022"));
}

// Swap suggestions: stored, deduped on re-run, grouped by the card they replace,
// and swept once they age out.
{
  const { saveSuggestions, suggestionsForDeck, markSuggestion, addWant, listWants } = await import("../src/lib/decks/swaps.ts");
  const { eq: eqOp } = await import("drizzle-orm");
  const [d] = await db.insert(schema.decks).values({ name: "Advice" }).returning({ id: schema.decks.id });
  const swap = (out: string, inn: string, rationale: string) => ({ outCardId: out, inCardId: inn, outQuantity: 1, inQuantity: 1, rationale, priority: "medium" });

  await saveSuggestions(db, d.id, null, "first pass", [swap("BT18-020", "BT18-021", "original"), swap("BT18-020", "BT18-022", "second option")]);
  let byCard = await suggestionsForDeck(db, d.id);
  assert.equal(byCard.get("BT18-020")?.length, 2, "two options for the same card are kept side by side");

  // The same advice again refreshes it rather than creating a duplicate.
  await saveSuggestions(db, d.id, null, "second pass", [swap("BT18-020", "BT18-021", "reworded")]);
  byCard = await suggestionsForDeck(db, d.id);
  assert.equal(byCard.get("BT18-020")?.length, 2, "a repeated suggestion does not pile up");
  assert.equal(byCard.get("BT18-020")?.find((s) => s.inCardId === "BT18-021")?.rationale, "reworded");

  // Ownership is resolved for the incoming card, so the UI knows which button to show.
  const owned = byCard.get("BT18-020")!.find((s) => s.inCardId === "BT18-021")!;
  assert.equal(typeof owned.inAvailable, "number");
  assert.equal(owned.wanted, false);
  await addWant(db, "BT18-021", 1, null, d.id);
  assert.equal((await suggestionsForDeck(db, d.id)).get("BT18-020")!.find((s) => s.inCardId === "BT18-021")!.wanted, true, "already on the shopping list");
  assert.equal((await listWants(db)).length, 1);

  // Applying or dismissing takes it out of the open set.
  await markSuggestion(db, byCard.get("BT18-020")![0].id, "applied");
  assert.equal((await suggestionsForDeck(db, d.id)).get("BT18-020")?.length, 1);

  // Anything past its expiry is swept on the next read.
  await db.update(schema.deckSwaps).set({ expiresAt: new Date(Date.now() - 1000) }).where(eqOp(schema.deckSwaps.deckId, d.id));
  assert.equal((await suggestionsForDeck(db, d.id)).size, 0, "expired suggestions are deleted, not just hidden");
  assert.equal((await db.select().from(schema.deckSwaps)).length, 0);

  await db.delete(schema.wantList);
  await db.delete(schema.decks).where(eqOp(schema.decks.id, d.id));
}

// Scan batches: photo bytes round-trip, completing writes lots and drops the photo.
{
  const { completeBatch, createBatch, getBatch, listOpenBatches, photoBytes, replaceItems, storePhoto, updateItem } = await import("../src/lib/scan/batches.ts");
  const [target] = await db.insert(schema.decks).values({ name: "Scan target" }).returning({ id: schema.decks.id });
  const batchId = await createBatch(db, "batch", target.id);
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
  const { added, deckAdded, deckId } = await completeBatch(db, batchId, "patvolny");
  assert.equal(added, 3, "2 foil SPR + 1 standard");
  assert.equal(deckId, target.id);
  assert.equal(deckAdded, 3, "both lots of the same card land in the deck's main zone");
  const inDeck = await db.select().from(schema.deckCards).where((await import("drizzle-orm")).eq(schema.deckCards.deckId, target.id));
  assert.deepEqual(inDeck.map((r) => [r.zone, r.cardId, r.quantity]), [["main", "BT18-020", 3]]);
  const lots = (await db.select().from(schema.ownedCards)).slice(before);
  assert.deepEqual(lots.map((l) => [l.printId, l.finish, l.owner]).sort(), [
    ["BT18-020", "normal", "patvolny"],
    ["BT18-020_SPR", "foil", "patvolny"],
    ["BT18-020_SPR", "foil", "patvolny"],
  ], "a reviewed quantity of 2 becomes two rows");
  assert.equal(await photoBytes(db, photoId), null, "photo bytes are dropped on completion");
  assert.equal((await getBatch(db, batchId))!.items.length, 0, "items are dropped on completion");
  assert.equal((await listOpenBatches(db)).length, 0, "completed batch is no longer open");
}

// ── Fusion World alongside the original game ───────────────────────────────
// The two games share every table and are told apart by one column. What is
// checked here is that they stay apart: legality reads the deck's own rules,
// and the collection can be narrowed to one game.
{
  const { eq } = await import("drizzle-orm");
  const { legalityForDecks } = await import("../src/lib/decks/legality.ts");
  const { collectionCopies, valuedLots } = await import("../src/lib/collection/queries.ts");
  const { zoneForType } = await import("../src/lib/decks/add.ts");

  await db.insert(schema.cardSets).values({ code: "FB07", name: "Wish For Shenron (FB07)", game: "fusion", line: "fusion", sortKey: 7 });
  const fwCard = (id: string, name: string, cardType = "BATTLE", colors = ["Red"]) => ({
    id,
    setCode: "FB07",
    game: "fusion",
    name,
    cardType,
    colors,
    rarity: "Super Rare[SR]",
    rarityCode: "SR",
    searchText: `${id} ${name}`.toLowerCase(),
  });
  await db.insert(schema.cards).values([
    fwCard("FB07-025", "Omega Shenron", "LEADER"),
    fwCard("FB07-021", "Vegeta : DA"),
    fwCard("FB07-050", "Blue Card", "BATTLE", ["Blue"]),
  ]);
  await db.insert(schema.cardPrints).values([
    { id: "FB07-025", cardId: "FB07-025", suffix: "", label: "Standard", rarity: "SR", isBase: true },
    { id: "FB07-021", cardId: "FB07-021", suffix: "", label: "Standard", rarity: "SR", isBase: true },
  ]);

  // Existing rows kept the default, which is the game the app started with.
  const bt = await db.query.cards.findFirst({ where: eq(schema.cards.id, "BT18-020") });
  assert.equal(bt!.game, "dbs", "the migration defaults every existing card to the original game");

  const [fwDeck] = await db.insert(schema.decks).values({ name: "Shenron FW", game: "fusion" }).returning({ id: schema.decks.id });
  await db.insert(schema.deckCards).values([
    { deckId: fwDeck.id, cardId: "FB07-025", zone: "leader", quantity: 1 },
    { deckId: fwDeck.id, cardId: "FB07-050", zone: "main", quantity: 4 },
    { deckId: fwDeck.id, cardId: "BT18-020", zone: "main", quantity: 4 },
  ]);
  const fwLegality = (await legalityForDecks(db, [fwDeck.id])).get(fwDeck.id)!;
  assert.equal(fwLegality.status, "illegal");
  assert.equal(fwLegality.flags["main:FB07-050"]?.severity, "illegal", "off-colour is a rule break in Fusion World");
  assert.match(fwLegality.flags["main:BT18-020"]!.label, /Super card in a Fusion World deck/);

  // `legalityForDecks` reads each deck's own game: switching this one over
  // makes the Fusion World cards the foreign ones and clears the Masters card.
  await db.update(schema.decks).set({ game: "dbs" }).where(eq(schema.decks.id, fwDeck.id));
  const asDbs = (await legalityForDecks(db, [fwDeck.id])).get(fwDeck.id)!;
  assert.equal(asDbs.flags["main:BT18-020"], undefined, "the Masters card now belongs");
  assert.match(asDbs.flags["main:FB07-050"]!.label, /Fusion World card in a Super deck/);
  await db.update(schema.decks).set({ game: "fusion" }).where(eq(schema.decks.id, fwDeck.id));

  // A Z- card has nowhere to go in a game with no Z-Deck, so it goes to main.
  assert.equal(zoneForType("Z-BATTLE", "dbs"), "z");
  assert.equal(zoneForType("Z-BATTLE", "fusion"), "main");
  assert.equal(zoneForType("LEADER", "fusion"), "leader");

  // Owning one card of each game, the collection filter separates them.
  await db.insert(schema.ownedCards).values([{ printId: "FB07-021", cardId: "FB07-021" }]);
  const both = await valuedLots(db);
  const onlyFw = await valuedLots(db, { game: "fusion" });
  assert.equal(onlyFw.lots.length, 1);
  assert.ok(both.lots.length > onlyFw.lots.length, "unfiltered still shows both games");
  assert.deepEqual((await collectionCopies(db, { game: "fusion" })).rows.map((r) => r.cardId), ["FB07-021"]);
  assert.ok((await collectionCopies(db, { game: "dbs" })).rows.every((r) => r.game === "dbs"));
}

await client.close();
console.log("verify-db: all checks passed");
