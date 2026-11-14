/**
 * A Pokémon binder page as a persisted scan batch (src/lib/pokemon/scan-batch.ts), so a page started
 * on the phone can be finished on the PC. PGlite only: no network, no model call (the read and the
 * search are stubbed through the `deps` seam of `identifyPokemonCards`; the card read at save is
 * stubbed with the recorded fixtures).
 *
 * Covers: a photo stored before it is read, items from a canned detection (candidates as live hits),
 * edits (card, variant, language, quantity, skip), reopening as the same owner (same state), another
 * player refused on every path (an SL opens any), completing (lots stamped with the batch owner, the
 * variant and language on the lot, the deck, photo bytes dropped, batch closed, items saved), a
 * failed save that can be retried without adding a card twice, discard, the voice screen's deck
 * undo, and that a Dragon Ball batch is untouched by all of it.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import sharp from "sharp";
import * as schema from "../../src/db/schema.ts";
import { cardPrints, deckCards, decks, ownedCards, scanBatches, scanItems, scanPhotos } from "../../src/db/schema.ts";
import type { Db } from "../../src/db/index.ts";
import type { Viewer } from "../../src/lib/auth/index.ts";
import { addPokemonLots, undoPokemonDeckAdd } from "../../src/lib/pokemon/collection.ts";
import { createPokemonDeck } from "../../src/lib/pokemon/deck-data.ts";
import type { PokemonScanResult } from "../../src/lib/ai/scan-prompts.ts";
import {
  PokemonBatchNotFound,
  completePokemonBatch,
  discardPokemonBatch,
  ensurePokemonBatch,
  findOpenPokemonBatch,
  getPokemonBatch,
  handlePokemonBatchScan,
  itemState,
  pokemonBatchOffer,
  setPokemonBatchDeck,
  updatePokemonItem,
} from "../../src/lib/pokemon/scan-batch.ts";
import { ensurePokemonCard } from "../../src/lib/pokemon/store.ts";
import { recordFromTcgdex, type PokemonCardRecord, type TcgdexCard } from "../../src/lib/pokemon/tcgdex.ts";
import type { PokemonHit } from "../../src/lib/pokemon/types.ts";
import { completeBatch, createBatch, getBatch, listOpenBatches, replaceItems, storePhoto } from "../../src/lib/scan/batches.ts";

const FIX = path.resolve("scripts/verify/fixtures/pokemon");
const raw = (id: string, lang: "de" | "en") => JSON.parse(fs.readFileSync(path.join(FIX, `card-${id}.${lang}.json`), "utf8")) as TcgdexCard;
const record = (id: string): PokemonCardRecord => recordFromTcgdex(raw(id, "de"), raw(id, "en"));
const hitOf = (id: string): PokemonHit => record(id).hit;

const GLURAK = "sv03.5-006";
const GLUMANDA = "sv03.5-004";
const GLUTEXO = "sv03.5-005";
const FIRE = "sve-002";

const client = new PGlite();
const db = drizzle(client, { schema }) as unknown as Db;
for (const file of fs.readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort()) {
  for (const stmt of fs.readFileSync(path.join("drizzle", file), "utf8").split("--> statement-breakpoint")) {
    if (stmt.trim()) await client.exec(stmt.trim());
  }
}

const mia: Viewer = { kind: "player", via: "code", playerId: 1, deviceId: 1, name: "Mia", login: "mia", owner: "Mia", homeGame: "pokemon" };
const lena: Viewer = { kind: "player", via: "code", playerId: 2, deviceId: 2, name: "Lena", login: "lena", owner: "Lena", homeGame: "pokemon" };
const papa: Viewer = { kind: "sl", via: "google", email: "papa@example.com", login: null, owner: "Papa" };

const refused = async (what: string, run: () => Promise<unknown>) => {
  await assert.rejects(run, (e) => e instanceof PokemonBatchNotFound, `${what}: another player's id answers not found`);
};

// ── A Dragon Ball batch exists first, and must stay exactly as it is ─────────

const dbsId = await createBatch(db, "batch", null, "Mia");
const dbsPhoto = await storePhoto(db, dbsId, 0, Buffer.from("dbs-photo-bytes"), 10, 10);
await replaceItems(db, dbsId, dbsPhoto, [
  { index: 0, seen: { name: "Goku", number: "BT1-001", box: null, confidence: 0.9 }, candidates: [], exact: false, matchedBy: "none", matchConfidence: 0.2 } as never,
]);
const dbsSnapshot = async () => ({
  batch: (await db.select().from(scanBatches).where(eq(scanBatches.id, dbsId)))[0],
  photos: await db.select().from(scanPhotos).where(eq(scanPhotos.batchId, dbsId)).orderBy(asc(scanPhotos.id)),
  items: await db.select().from(scanItems).where(eq(scanItems.batchId, dbsId)).orderBy(asc(scanItems.id)),
});
const dbsBefore = JSON.stringify(await dbsSnapshot());
assert.equal((await dbsSnapshot()).batch.game, "dbs", "an existing kind of batch is a Dragon Ball one by default");

// ── The canned read: a page of four cards, the model stubbed ─────────────────

const read = (name: string, number: string | null, over: Partial<PokemonScanResult["cards"][number]> = {}): PokemonScanResult["cards"][number] => ({
  name,
  language: "DE",
  number,
  setCode: null,
  regulationMark: "G",
  finish: "normal",
  confidence: 0.95,
  position: "page",
  box: null,
  notes: null,
  ...over,
});
const hits: Record<string, PokemonHit> = { "6/165": hitOf(GLURAK), "4/165": hitOf(GLUMANDA), "5/165": hitOf(GLUTEXO) };
let reads = 0;
const stubs = (cards: PokemonScanResult["cards"]) => ({
  read: (async () => {
    reads++;
    return [{ model: "stub", res: { parsed: { cards, unreadable: 1 } } as never }];
  }) as never,
  search: async (q: string) => (hits[q] ? [hits[q]] : []),
  setIdsByCode: async () => [],
  record: (async (_db: unknown, _kind: string, _input: unknown, res: { parsed: unknown }) => ({ id: 1, output: res.parsed })) as never,
  available: () => true,
});
const page1 = [
  read("Glurak-ex", "006/165", { finish: "holo", box: { x: 0.02, y: 0.02, w: 0.3, h: 0.3 } }),
  read("Glumanda", "004/165", { box: { x: 0.35, y: 0.02, w: 0.3, h: 0.3 } }),
  read("Glutexo", "005/165", { box: { x: 0.68, y: 0.02, w: 0.3, h: 0.3 } }),
  read("???", null, { confidence: 0.1, box: { x: 0.02, y: 0.35, w: 0.3, h: 0.3 } }),
];
const jpeg = await sharp({ create: { width: 90, height: 64, channels: 3, background: "#777" } }).jpeg().toBuffer();
const upload = (extra: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.append("image", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "page.jpg");
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return new Request("http://x/api/pokemon/scan/batch", { method: "POST", body: fd });
};

// ── 1. The photo is stored first, the page is a batch ────────────────────────

assert.equal(await findOpenPokemonBatch(db, mia), null, "no open page yet");
assert.equal(await pokemonBatchOffer(db, mia), null);
type State = Awaited<ReturnType<typeof getPokemonBatch>>;
const retryOf = (photo: number, who: Viewer, deps: ReturnType<typeof stubs>) => {
  const fd = new FormData();
  fd.append("photoId", String(photo));
  return handlePokemonBatchScan(new Request("http://x/api/pokemon/scan/batch", { method: "POST", body: fd }), db, who, deps);
};
let bid = 0;
let photoId = 0;
reads = 0;
{
  const down = { ...stubs(page1), read: (async () => Promise.reject(new Error("model down"))) as never };
  const res = await handlePokemonBatchScan(upload(), db, mia, down);
  assert.equal(res.status, 200, "a failed read is not an error answer: the photo is stored and can be retried");
  const body = (await res.json()) as { batchId: number; photoId: number; state: State };
  bid = body.batchId;
  photoId = body.photoId;
  assert.equal(body.state.photos.length, 1);
  assert.equal(body.state.photos[0].status, "error", "the photo is marked failed");
  assert.equal(body.state.items.length, 0);
  const [stored] = await db.select({ data: scanPhotos.data }).from(scanPhotos).where(eq(scanPhotos.id, photoId));
  assert.ok(stored.data && stored.data.length > 100, "the photo was stored before it was read");
  const offer = await pokemonBatchOffer(db, mia);
  assert.deepEqual([offer?.id, offer?.photos, offer?.cards], [bid, 1, 0], "a stored photo makes the page worth continuing");
}
// The retry needs no phone: the stored photo is read again.
const s1 = ((await (await retryOf(photoId, mia, stubs(page1))).json()) as { state: State }).state;
assert.equal(reads, 1);
assert.deepEqual([s1.photos.length, s1.photos[0].status, s1.photos[0].found, s1.photos[0].unreadable], [1, "done", 4, 1]);
assert.equal(s1.batch.owner, "Mia", "the batch is the viewer's");
assert.equal(s1.items.length, 4);
const [bRow] = await db.select().from(scanBatches).where(eq(scanBatches.id, bid));
assert.deepEqual([bRow.game, bRow.mode, bRow.status], ["pokemon", "batch", "open"]);
const byName = (s: typeof s1, n: string) => s.items.find((i) => i.detection.seen.name === n)!;
const glurak = byName(s1, "Glurak-ex");
assert.equal(glurak.chosen?.tcgdexId, GLURAK, "the best candidate is preselected");
assert.equal(glurak.detection.candidates[0].image, hitOf(GLURAK).image, "the candidates carry what the review draws (image, name, set, number)");
assert.equal(glurak.detection.candidates[0].setName, hitOf(GLURAK).setName);
assert.equal(glurak.variant, "holo", "the finish the model saw is the first variant guess");
assert.equal(itemState(glurak), "confirmed");
assert.equal(itemState(byName(s1, "Glutexo")), "confirmed", "a clear read starts confirmed");
const unknown = byName(s1, "???");
assert.equal(unknown.chosen, null);
assert.equal(itemState(unknown), "check", "an unsure read waits for a tap");
assert.equal((await db.select().from(ownedCards)).length, 0, "nothing is written by the scan");

// ── 2. Edits, and the same state on any device of the owner ──────────────────

const glumanda = byName(s1, "Glumanda");
await updatePokemonItem(db, mia, glumanda.id, { variant: "reverse", language: "EN", quantity: 3 });
await updatePokemonItem(db, mia, glurak.id, { quantity: 2 });
const glutexel = byName(s1, "Glutexo");
const skipped = await updatePokemonItem(db, mia, glutexel.id, { include: false });
assert.equal(itemState(skipped), "skipped");
const picked = await updatePokemonItem(db, mia, unknown.id, { chosen: hitOf(FIRE) });
assert.deepEqual([itemState(picked), picked.manual, picked.variant], ["confirmed", true, null], "picking a card confirms the cell; its variants are read when it is opened");
await updatePokemonItem(db, mia, unknown.id, { variant: "normal" });
await assert.rejects(() => updatePokemonItem(db, mia, glumanda.id, { variant: "nonsense" as never }), /Variante/);
await assert.rejects(() => updatePokemonItem(db, mia, glumanda.id, { language: "FR" as never }), /Sprache/);
assert.equal((await updatePokemonItem(db, mia, glumanda.id, { quantity: 500 })).quantity, 99, "a number is held to 1..99");
await updatePokemonItem(db, mia, glumanda.id, { quantity: 3 });

{
  const again = await getPokemonBatch(db, mia, bid); // another device, same owner
  assert.deepEqual(again.items.map((i) => [i.id, i.variant, i.language, i.quantity, i.include, i.chosen?.tcgdexId ?? null]), [
    [glurak.id, "holo", "DE", 2, true, GLURAK],
    [glumanda.id, "reverse", "EN", 3, true, GLUMANDA],
    [glutexel.id, null, "DE", 1, false, GLUTEXO],
    [unknown.id, "normal", "DE", 1, true, FIRE],
  ]);
  const offer = await pokemonBatchOffer(db, mia);
  assert.deepEqual([offer?.id, offer?.cards, offer?.photos], [bid, 4, 1]);
  const sl = await getPokemonBatch(db, papa, bid);
  assert.equal(sl.items.length, 4, "an SL may open any page");
}

// A second photo joins the same batch.
{
  const two = [read("Glurak-ex", "006/165", { box: { x: 0.02, y: 0.02, w: 0.3, h: 0.3 } })];
  const res = await handlePokemonBatchScan(upload(), db, mia, stubs(two));
  const body = (await res.json()) as { batchId: number; state: Awaited<ReturnType<typeof getPokemonBatch>> };
  assert.equal(body.batchId, bid, "the viewer's open page continues");
  assert.equal(body.state.photos.length, 2);
  assert.equal(body.state.items.length, 5, "the first photo's items and their edits stay");
  assert.equal(body.state.items.find((i) => i.id === glumanda.id)?.quantity, 3);
  // Retrying the second photo replaces only that photo's items.
  const second = body.state.photos[1].id;
  const r = await retryOf(second, mia, stubs([read("Glumanda", "004/165")]));
  const rb = (await r.json()) as { state: Awaited<ReturnType<typeof getPokemonBatch>> };
  assert.deepEqual(rb.state.items.filter((i) => i.photoId === second).map((i) => i.chosen?.tcgdexId), [GLUMANDA]);
  assert.equal(rb.state.items.filter((i) => i.photoId !== second).length, 4);
  // That extra photo is not wanted: leave its cell out.
  for (const i of rb.state.items.filter((x) => x.photoId === second)) await updatePokemonItem(db, mia, i.id, { include: false });
}

// ── 3. Another player gets "not found" on every path; an SL does not ─────────

await refused("open", () => getPokemonBatch(db, lena, bid));
await refused("edit", () => updatePokemonItem(db, lena, glurak.id, { quantity: 9 }));
await refused("deck", () => setPokemonBatchDeck(db, lena, bid, null));
await refused("complete", () => completePokemonBatch(db, lena, bid));
await refused("discard", () => discardPokemonBatch(db, lena, bid));
await refused("no such batch", () => getPokemonBatch(db, mia, 999999));
await refused("no such item", () => updatePokemonItem(db, mia, 999999, { quantity: 2 }));
await refused("a Dragon Ball batch is not a Pokémon page", () => getPokemonBatch(db, mia, dbsId));
await refused("a Dragon Ball batch cannot be completed here", () => completePokemonBatch(db, mia, dbsId));
await refused("a Dragon Ball batch cannot be discarded here", () => discardPokemonBatch(db, papa, dbsId));
{
  const r = await retryOf(photoId, lena, stubs(page1));
  assert.equal(r.status, 404, "the route answers 404 for a photo that is not hers");
  const own = await handlePokemonBatchScan(upload({ batchId: String(bid) }), db, lena, stubs(page1));
  assert.equal(own.status, 404, "and for a batch that is not hers");
  const dbs = await handlePokemonBatchScan(upload({ batchId: String(dbsId) }), db, mia, stubs(page1));
  assert.equal(dbs.status, 404, "and for a Dragon Ball batch");
  assert.equal((await handlePokemonBatchScan(upload(), db, mia, { ...stubs(page1), available: () => false })).status, 503);
  assert.equal(await findOpenPokemonBatch(db, lena), null, "Lena has no page of her own, and sees none of Mia's");
  assert.equal(await pokemonBatchOffer(db, lena), null);
}
assert.equal((await getPokemonBatch(db, mia, bid)).items.find((i) => i.id === glurak.id)?.quantity, 2, "the refused edit changed nothing");

// ── 4. Completing ────────────────────────────────────────────────────────────

const deck = await createPokemonDeck(db, mia, { name: "Feuer" });
await ensurePokemonCard(db, GLUMANDA, { record: record(GLUMANDA), set: null, expire: false });
await db.insert(deckCards).values({ deckId: deck.id, cardId: `PKM-${GLUMANDA}`, zone: "main", quantity: 1 });
await setPokemonBatchDeck(db, mia, bid, deck.id);
const loads: string[] = [];
const load = (async (id: string) => {
  loads.push(id);
  return { record: record(id), set: null, expire: false };
}) as never;

{
  const r = await completePokemonBatch(db, mia, bid, { load });
  assert.deepEqual([r.done, r.failed.length], [true, 0]);
  assert.equal(r.added, 2 + 3 + 1, "Glurak x2, Glumanda x3, the picked Fire Energy x1; the skipped Glutexo and the left-out photo are not saved");
  assert.equal(r.deckAdded, 6);
  const lots = await db.select().from(ownedCards).orderBy(asc(ownedCards.id));
  assert.equal(lots.length, 6);
  assert.ok(lots.every((l) => l.owner === "Mia"), "stamped with the batch owner");
  const key = (l: (typeof lots)[number]) => `${l.cardId}|${l.printId}|${l.language}|${l.finish}`;
  const tally = new Map<string, number>();
  for (const l of lots) tally.set(key(l), (tally.get(key(l)) ?? 0) + 1);
  assert.deepEqual(
    [...tally].sort(),
    [
      [`PKM-${FIRE}|PKM-${FIRE}|DE|normal`, 1],
      [`PKM-${GLURAK}|PKM-${GLURAK}_holo|DE|foil`, 2],
      [`PKM-${GLUMANDA}|PKM-${GLUMANDA}_reverse|EN|foil`, 3],
    ].sort(),
    "variant and language are on the lot",
  );
  const [line] = await db.select().from(deckCards).where(and(eq(deckCards.deckId, deck.id), eq(deckCards.cardId, `PKM-${GLUMANDA}`)));
  assert.equal(line.quantity, 1 + 3, "the deck gains the copies and keeps what it had");
  assert.equal((await db.select().from(deckCards).where(and(eq(deckCards.deckId, deck.id), eq(deckCards.cardId, `PKM-${GLURAK}`))))[0].quantity, 2);

  const [b] = await db.select().from(scanBatches).where(eq(scanBatches.id, bid));
  assert.deepEqual([b.status, b.addedCount, b.completedAt !== null], ["done", 6, true]);
  const photos = await db.select().from(scanPhotos).where(eq(scanPhotos.batchId, bid));
  assert.ok(photos.length === 2 && photos.every((p) => p.data === null), "the photo bytes are deleted");
  const items = await db.select().from(scanItems).where(eq(scanItems.batchId, bid));
  assert.deepEqual(items.filter((i) => i.savedAt !== null).length, 3, "the saved items are marked saved");
  assert.equal(items.filter((i) => i.savedAt === null).length, items.length - 3, "the skipped ones are not");
  assert.equal(await findOpenPokemonBatch(db, mia), null);
  assert.equal(await pokemonBatchOffer(db, mia), null, "a finished page is not offered again");
  assert.equal(await ensurePokemonBatch(db, mia) !== bid, true, "the next photo starts a new page");
  // Not twice.
  await assert.rejects(() => completePokemonBatch(db, mia, bid, { load }), PokemonBatchNotFound);
  assert.equal((await db.select().from(ownedCards)).length, 6);
}
{
  const s = await getPokemonBatch(db, mia, bid);
  assert.equal(s.batch.status, "done");
  assert.deepEqual(s.items.filter((i) => i.saved).map((i) => itemState(i)), ["saved", "saved", "saved"]);
  await assert.rejects(() => updatePokemonItem(db, mia, s.items.find((i) => i.saved)!.id, { quantity: 4 }), PokemonBatchNotFound, "a saved item is fixed");
}
// The page opened for the next photo is empty and goes away with discard.
{
  const empty = await ensurePokemonBatch(db, mia);
  assert.equal(await pokemonBatchOffer(db, mia), null, "a page with nothing in it is not offered");
  await discardPokemonBatch(db, mia, empty);
}

// ── 5. A failed save is retried without adding a card twice; an SL completes a player's page ──

{
  const res = await handlePokemonBatchScan(upload(), db, mia, stubs(page1.slice(0, 2)));
  const { batchId: b2, state } = (await res.json()) as { batchId: number; state: Awaited<ReturnType<typeof getPokemonBatch>> };
  assert.equal(state.items.length, 2);
  const before = (await db.select().from(ownedCards)).length;
  const flaky = (async (id: string) => {
    if (id === GLUMANDA) throw new Error("Die Karte konnte nicht geladen werden.");
    return { record: record(id), set: null, expire: false };
  }) as never;
  // The SL finishes it: the copies are still Mia's.
  const r1 = await completePokemonBatch(db, papa, b2, { load: flaky });
  assert.equal(r1.done, false, "a card that failed keeps the page open");
  assert.deepEqual(r1.failed.map((f) => f.name), [hitOf(GLUMANDA).name]);
  assert.equal(r1.added, 1);
  assert.equal((await db.select().from(ownedCards)).length, before + 1);
  assert.equal((await db.select().from(ownedCards).where(eq(ownedCards.id, (await db.select().from(ownedCards).orderBy(asc(ownedCards.id))).at(-1)!.id)))[0].owner, "Mia", "the batch owner, not the SL");
  const r2 = await completePokemonBatch(db, mia, b2, { load });
  assert.deepEqual([r2.done, r2.added, r2.failed.length], [true, 1, 0], "the retry saves only what is left");
  assert.equal((await db.select().from(ownedCards)).length, before + 2, "Glurak was not added a second time");
}

// ── 6. Discard ───────────────────────────────────────────────────────────────

{
  const res = await handlePokemonBatchScan(upload(), db, lena, stubs(page1));
  const { batchId: b3 } = (await res.json()) as { batchId: number };
  assert.equal((await getPokemonBatch(db, lena, b3)).batch.owner, "Lena");
  await refused("discard by another player", () => discardPokemonBatch(db, mia, b3));
  await discardPokemonBatch(db, lena, b3);
  assert.deepEqual([(await db.select().from(scanBatches).where(eq(scanBatches.id, b3))).length, (await db.select().from(scanItems).where(eq(scanItems.batchId, b3))).length], [0, 0]);
}

// ── 7. The deck undo of the voice screen ─────────────────────────────────────

{
  const d = await createPokemonDeck(db, mia, { name: "Undo" });
  await ensurePokemonCard(db, GLURAK, { record: record(GLURAK), set: null, expire: false });
  await db.insert(deckCards).values({ deckId: d.id, cardId: `PKM-${GLURAK}`, zone: "main", quantity: 2 });
  const add = await addPokemonLots(db, mia, { tcgdexId: GLURAK, variant: "holo", language: "DE", quantity: 3, deckId: d.id }, { load });
  assert.deepEqual([add.deckAdded, add.deckBefore], [3, 2]);
  const line = async () => (await db.select().from(deckCards).where(and(eq(deckCards.deckId, d.id), eq(deckCards.cardId, `PKM-${GLURAK}`))))[0]?.quantity ?? 0;
  assert.equal(await line(), 5);
  // She also raised the deck by hand since: the undo takes back its own three, no more.
  await db.update(deckCards).set({ quantity: 6 }).where(eq(deckCards.deckId, d.id));
  assert.deepEqual(await undoPokemonDeckAdd(db, mia, { deckId: d.id, tcgdexId: GLURAK, added: 3, before: 2 }), { removed: 3 });
  assert.equal(await line(), 3);
  // She took copies out by hand: never below what the deck had before the add.
  await db.update(deckCards).set({ quantity: 3 }).where(eq(deckCards.deckId, d.id));
  assert.deepEqual(await undoPokemonDeckAdd(db, mia, { deckId: d.id, tcgdexId: GLURAK, added: 3, before: 2 }), { removed: 1 });
  assert.equal(await line(), 2, "the two copies the deck had are left");
  assert.deepEqual(await undoPokemonDeckAdd(db, mia, { deckId: d.id, tcgdexId: GLURAK, added: 3, before: 2 }), { removed: 0 });
  // A deck that was empty of the card: the line goes away.
  const add2 = await addPokemonLots(db, mia, { tcgdexId: GLUMANDA, variant: "normal", language: "DE", quantity: 2, deckId: d.id }, { load });
  assert.equal(add2.deckBefore, 0);
  await undoPokemonDeckAdd(db, mia, { deckId: d.id, tcgdexId: GLUMANDA, added: 2, before: 0 });
  assert.equal((await db.select().from(deckCards).where(and(eq(deckCards.deckId, d.id), eq(deckCards.cardId, `PKM-${GLUMANDA}`)))).length, 0);
  // Someone else's deck is refused.
  await assert.rejects(() => undoPokemonDeckAdd(db, lena, { deckId: d.id, tcgdexId: GLURAK, added: 1, before: 0 }), /isn't your deck/);
  void decks;
}

// ── 8. The Dragon Ball batch is untouched by all of it ───────────────────────

assert.equal(JSON.stringify(await dbsSnapshot()), dbsBefore, "the Dragon Ball batch, its photo and its item are byte for byte as they were");
assert.deepEqual((await listOpenBatches(db)).map((b) => b.id), [dbsId], "the Dragon Ball list holds only Dragon Ball batches, never a Pokémon page");
assert.equal(await getBatch(db, bid), null, "a Pokémon page does not open in the Dragon Ball review");
await assert.rejects(() => completeBatch(db, bid, "Mia"), /Not a Dragon Ball/, "nor complete in it");
{
  const done = await completeBatch(db, dbsId, "Mia");
  assert.deepEqual([done.added, done.deckAdded], [0, 0], "the Dragon Ball completion still works as before (this item had no print)");
  const [b] = await db.select().from(scanBatches).where(eq(scanBatches.id, dbsId));
  assert.deepEqual([b.status, b.game], ["done", "dbs"]);
  assert.equal((await db.select().from(scanItems).where(eq(scanItems.batchId, dbsId))).length, 0, "and it drops its items as it always did");
  assert.equal((await db.select().from(cardPrints).where(eq(cardPrints.id, "none"))).length, 0);
}

console.log("pokemon-scan-batch: ok");
