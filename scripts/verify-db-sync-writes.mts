/**
 * verify-db checks for issue #379 (syncs write less). Called from verify-db.mts
 * with one line; kept in its own file so it never interleaves with other checks.
 * Uses ids in the BT79 / 9790xx ranges so it cannot collide with the seed data.
 */
import assert from "node:assert/strict";
import { eq, inArray, sql } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
import type { Db } from "../src/db/index.ts";
import { addCardsToDeck } from "../src/lib/decks/add.ts";
import { fillMissingImages, upsertProducts } from "../src/lib/pricing/tcgcsv.ts";

interface Querier {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

export async function verifySyncWrites(db: Db, client: Querier): Promise<void> {
  await db.insert(schema.cardSets).values({ code: "BT79", name: "Sync writes", line: "legacy", sortKey: 79 });
  const card = (id: string, name: string) => ({ id, setCode: "BT79", name, cardType: "BATTLE", rarity: "C", rarityCode: "C", searchText: id.toLowerCase() });
  await db.insert(schema.cards).values([card("BT79-001", "One"), card("BT79-002", "Two")]);
  await db.insert(schema.cardPrints).values([
    { id: "BT79-001", cardId: "BT79-001", suffix: "", label: "Standard", rarity: "C", isBase: true },
    { id: "BT79-002", cardId: "BT79-002", suffix: "", label: "Standard", rarity: "C", isBase: true },
  ]);
  await db.insert(schema.tcgGroups).values({ id: 979000, categoryId: 27, name: "BT79" });

  // 1. A second identical product upsert rewrites nothing (xmin is the row version).
  const product = (id: number, name: string) => ({
    id,
    groupId: 979000,
    name,
    number: "BT79-001",
    rarity: null,
    imageUrl: null,
    url: null,
    marker: null,
    cardId: "BT79-001",
    printId: "BT79-001",
    modifiedOn: null,
  });
  const xmins = async () => (await client.query("select id, xmin::text as x from tcg_products where group_id = 979000 order by id")).rows.map((r) => `${r.id}:${r.x}`);
  await upsertProducts(db, [product(979001, "A"), product(979002, "B")]);
  const before = await xmins();
  assert.equal(before.length, 2);
  await upsertProducts(db, [product(979001, "A"), product(979002, "B")]);
  assert.deepEqual(await xmins(), before, "an identical product upsert must not rewrite any row");
  await upsertProducts(db, [product(979001, "A"), product(979002, "B renamed")]);
  const after = await xmins();
  assert.equal(after[0], before[0], "the unchanged product stays untouched alongside a changed one");
  assert.notEqual(after[1], before[1], "a changed product is still rewritten");
  assert.equal((await db.select().from(schema.tcgProducts).where(eq(schema.tcgProducts.id, 979002)))[0].name, "B renamed");

  // 2. addCardsToDeck: a duplicate card in one call sums, and an existing row gains.
  const [d] = await db.insert(schema.decks).values({ name: "Sync writes" }).returning({ id: schema.decks.id });
  const res = await addCardsToDeck(db, d.id, [
    { cardId: "BT79-001", quantity: 2 },
    { cardId: "BT79-001", quantity: 3 },
    { cardId: "BT79-002", quantity: 1 },
  ]);
  assert.equal(res.added, 6);
  await addCardsToDeck(db, d.id, [{ cardId: "BT79-001", quantity: 1 }]);
  const qty = Object.fromEntries((await db.select().from(schema.deckCards).where(eq(schema.deckCards.deckId, d.id))).map((r) => [r.cardId, r.quantity]));
  assert.deepEqual(qty, { "BT79-001": 6, "BT79-002": 1 }, "duplicates sum (2+3), a later add accumulates, nothing is capped");

  // 3. fillMissingImages: something missing -> fills; nothing missing -> only the guard query.
  await db.update(schema.tcgProducts).set({ imageUrl: "https://x/p_200w.jpg" }).where(eq(schema.tcgProducts.id, 979001));
  assert.ok((await fillMissingImages(db)) >= 1, "a print without art is filled from its product");
  assert.equal((await db.select().from(schema.cardPrints).where(eq(schema.cardPrints.id, "BT79-001")))[0].imageUrl, "https://x/p_in_1000x1000.jpg");
  // Close every remaining gap, then count statements.
  await db.update(schema.cardPrints).set({ imageUrl: "x" });
  await db.update(schema.cards).set({ imageUrl: "x" });
  await db.delete(schema.tcgProducts).where(eq(schema.tcgProducts.groupId, 979000));
  let executed = 0;
  const counting = new Proxy(db, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      return prop === "execute"
        ? (...a: unknown[]) => {
            executed++;
            return (v as (...x: unknown[]) => unknown).apply(target, a);
          }
        : v;
    },
  }) as Db;
  assert.equal(await fillMissingImages(counting), 0);
  assert.equal(executed, 1, "with nothing to fill only the guard query runs");

  // 4. The set-date backfill is one UPDATE ... FROM (VALUES ...) and only fills a null date.
  await db.insert(schema.cardSets).values({ code: "BT78", name: "Dated", line: "legacy", sortKey: 78, releasedOn: "2020-01-01" });
  await db.execute(sql`
    update card_sets cs set released_on = v.released_on, line = v.line
    from (values ${sql.join([sql`(${"BT79"}, ${"2024-05-03"}::date, ${"masters"})`, sql`(${"BT78"}, ${"2024-05-03"}::date, ${"masters"})`], sql`, `)}) as v(code, released_on, line)
    where cs.code = v.code and cs.released_on is null
  `);
  const sets = Object.fromEntries((await db.select().from(schema.cardSets).where(inArray(schema.cardSets.code, ["BT78", "BT79"]))).map((r) => [r.code, [r.releasedOn, r.line]]));
  assert.deepEqual(sets, { BT79: ["2024-05-03", "masters"], BT78: ["2020-01-01", "legacy"] });
}
