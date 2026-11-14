/**
 * Own card photos (src/lib/collection/photos.ts) on PGlite: save, replace,
 * refusals, the per-owner ceiling, delete and the scope rules. No network.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema.ts";
import type { Db } from "../../src/db/index.ts";
import { MAX_PHOTOS_PER_OWNER, MAX_PHOTO_BYTES, CardPhotoError, cardPhotoIds, deleteCardPhoto, readCardPhoto, saveCardPhoto } from "../../src/lib/collection/photos.ts";

const client = new PGlite();
const db = drizzle(client, { schema }) as unknown as Db;
const dir = path.resolve("drizzle");
for (const file of fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  for (const stmt of fs.readFileSync(path.join(dir, file), "utf8").split("--> statement-breakpoint")) {
    if (stmt.trim()) await client.exec(stmt.trim());
  }
}

await db.insert(schema.cardSets).values({ code: "BT18", name: "Dawn", line: "legacy", sortKey: 18 });
const card = (id: string) => ({ id, setCode: "BT18", name: id, cardType: "BATTLE", rarity: "Common[C]", rarityCode: "C", searchText: id.toLowerCase() });
await db.insert(schema.cards).values([card("BT18-020"), card("BT18-021")]);
await db.insert(schema.cardPrints).values([
  { id: "BT18-020", cardId: "BT18-020", suffix: "", label: "Standard", rarity: "C", isBase: true },
  { id: "BT18-020_SPR", cardId: "BT18-020", suffix: "SPR", label: "SPR", rarity: "SPR", isBase: false },
  { id: "BT18-021", cardId: "BT18-021", suffix: "", label: "Standard", rarity: "C", isBase: true },
]);

const bytes = (n: number, fill = 1) => Buffer.alloc(n, fill);
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof CardPhotoError, String(e));
    return e.code;
  }
  return "none";
};

// Save, then replace: one row, the id changes, the bytes are the new ones.
const a1 = await saveCardPhoto(db, { printId: "BT18-020", owner: "Anna", data: bytes(100, 1), mime: "image/webp" });
const a2 = await saveCardPhoto(db, { printId: "BT18-020", owner: "Anna", data: bytes(120, 2), mime: "image/jpeg" });
assert.notEqual(a1, a2, "replacing gives a new id");
assert.equal((await db.select().from(schema.cardPhotos).where(eq(schema.cardPhotos.printId, "BT18-020"))).length, 1);
assert.equal(await readCardPhoto(db, a1, "Anna"), null, "the old id is gone");
const got = await readCardPhoto(db, a2, "Anna");
assert.equal(got?.mime, "image/jpeg");
assert.equal(got?.data.length, 120);

// Refusals.
assert.equal(await code(saveCardPhoto(db, { printId: "BT18-020", owner: "Anna", data: bytes(MAX_PHOTO_BYTES + 1), mime: "image/webp" })), "too_large");
assert.ok(await saveCardPhoto(db, { printId: "BT18-021", owner: "Anna", data: bytes(MAX_PHOTO_BYTES), mime: "image/webp" }), "exactly 400 KB is fine");
assert.equal(await code(saveCardPhoto(db, { printId: "BT18-020", owner: "Anna", data: bytes(10), mime: "image/png" })), "bad_mime");
assert.equal(await code(saveCardPhoto(db, { printId: "NOPE", owner: "Anna", data: bytes(10), mime: "image/webp" })), "no_print");
assert.equal(await code(saveCardPhoto(db, { printId: "BT18-020", owner: "Anna", data: bytes(0), mime: "image/webp" })), "empty");
assert.equal((await readCardPhoto(db, a2, "Anna"))?.data.length, 120, "a refused save leaves the old photo");

// Scope: a player sees only their own; an SL sees all.
const b1 = await saveCardPhoto(db, { printId: "BT18-020", owner: "Ben", data: bytes(50, 3), mime: "image/webp" });
assert.equal(await readCardPhoto(db, b1, "Anna"), null, "Anna cannot read Ben's photo");
assert.ok(await readCardPhoto(db, b1, "Ben"));
assert.ok(await readCardPhoto(db, b1, undefined), "an SL reads any");
assert.ok(await readCardPhoto(db, a2, undefined));
assert.equal(await readCardPhoto(db, b1, null), null, "the no-owner scope sees only ownerless photos");

const anna = await cardPhotoIds(db, "Anna", { printIds: ["BT18-020", "BT18-020_SPR"], cardIds: ["BT18-020"] });
assert.deepEqual([...anna.byPrint], [["BT18-020", a2]]);
assert.equal(anna.byCard.get("BT18-020"), a2);
const sl = await cardPhotoIds(db, undefined, { printIds: ["BT18-020"] });
assert.equal(sl.byPrint.get("BT18-020"), b1, "an SL gets the newest when nothing is preferred");
const slOwn = await cardPhotoIds(db, undefined, { printIds: ["BT18-020"], prefer: "Anna" });
assert.equal(slOwn.byPrint.get("BT18-020"), a2, "an SL gets their own first");
const slByCard = await cardPhotoIds(db, undefined, { cardIds: ["BT18-021"] });
assert.ok(slByCard.byCard.has("BT18-021") && slByCard.byPrint.has("BT18-021"));
assert.equal((await cardPhotoIds(db, "Ben", { cardIds: ["BT18-021"] })).byCard.size, 0, "Ben has none for 021");
assert.equal((await cardPhotoIds(db, "Ben", {})).byPrint.size, 0);

// Ownerless photos (the app running open) are one photo per print too.
const n1 = await saveCardPhoto(db, { printId: "BT18-020_SPR", owner: null, data: bytes(10), mime: "image/webp" });
const n2 = await saveCardPhoto(db, { printId: "BT18-020_SPR", owner: null, data: bytes(10), mime: "image/webp" });
assert.notEqual(n1, n2);
assert.equal((await db.select().from(schema.cardPhotos).where(eq(schema.cardPhotos.printId, "BT18-020_SPR"))).length, 1);
assert.ok(await readCardPhoto(db, n2, null));

// Delete removes only that owner's photo.
await deleteCardPhoto(db, { printId: "BT18-020", owner: "Anna" });
assert.equal(await readCardPhoto(db, a2, undefined), null);
assert.ok(await readCardPhoto(db, b1, "Ben"), "Ben's photo stays");

// The per-owner ceiling: one photo per print, so fill it with distinct prints.
await client.exec(
  `insert into card_prints (id, card_id, suffix, label, rarity, is_base)
   select 'X' || g, 'BT18-021', 'X' || g, 'X', 'C', false from generate_series(1, ${MAX_PHOTOS_PER_OWNER + 1}) g`,
);
await client.exec(
  `insert into card_photos (print_id, card_id, owner, data, mime, bytes)
   select 'X' || g, 'BT18-021', 'Cara', '\\x01'::bytea, 'image/webp', 1 from generate_series(1, ${MAX_PHOTOS_PER_OWNER}) g`,
);
assert.equal(await code(saveCardPhoto(db, { printId: `X${MAX_PHOTOS_PER_OWNER + 1}`, owner: "Cara", data: bytes(10), mime: "image/webp" })), "limit");
assert.ok(await saveCardPhoto(db, { printId: "X1", owner: "Cara", data: bytes(10), mime: "image/webp" }), "replacing at the ceiling is fine");
assert.ok(await saveCardPhoto(db, { printId: `X${MAX_PHOTOS_PER_OWNER + 1}`, owner: "Ben", data: bytes(10), mime: "image/webp" }), "the ceiling is per owner");

console.log("card-photos: ok");
