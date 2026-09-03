import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { cardPrints, cardSets, cards, ownedCards } from "@/db/schema";

export const CARD_TYPES = ["LEADER", "BATTLE", "EXTRA", "UNISON", "Z-LEADER", "Z-BATTLE", "Z-EXTRA", "Z-UNISON", "TOKEN"];
export const COLORS = ["Red", "Blue", "Green", "Yellow", "Black", "White", "Colorless"];

export interface CardSearch {
  q?: string;
  set?: string;
  type?: string;
  color?: string;
  rarity?: string;
  owned?: "yes" | "no";
  sort?: "number" | "name" | "newest";
  page?: number;
  pageSize?: number;
}

export function searchTerms(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function whereFor(s: CardSearch): SQL | undefined {
  const parts: SQL[] = [];
  for (const t of searchTerms(s.q ?? "")) parts.push(ilike(cards.searchText, `%${t.replace(/[%_]/g, "")}%`));
  if (s.set) parts.push(eq(cards.setCode, s.set));
  if (s.type) parts.push(eq(cards.cardType, s.type));
  if (s.color) parts.push(sql`${s.color} = any(${cards.colors})`);
  if (s.rarity) parts.push(eq(cards.rarityCode, s.rarity));
  if (s.owned === "yes")
    parts.push(sql`exists (select 1 from ${ownedCards} o where o.card_id = ${cards.id})`);
  if (s.owned === "no")
    parts.push(sql`not exists (select 1 from ${ownedCards} o where o.card_id = ${cards.id})`);
  return parts.length ? and(...parts) : undefined;
}

/** Natural ordering: set sort key, then number so BT1-002 < BT1-010. */
const numberOrder = sql`${cards.id} collate "C"`;

export async function searchCards(db: Db, s: CardSearch) {
  const pageSize = s.pageSize ?? 60;
  const page = Math.max(1, s.page ?? 1);
  const where = whereFor(s);
  const order =
    s.sort === "name"
      ? [asc(cards.name), asc(numberOrder)]
      : s.sort === "newest"
        ? [desc(cardSets.sortKey), asc(numberOrder)]
        : [asc(cardSets.sortKey), asc(numberOrder)];

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: cards.id,
        name: cards.name,
        setCode: cards.setCode,
        cardType: cards.cardType,
        colors: cards.colors,
        rarityCode: cards.rarityCode,
        imageUrl: cards.imageUrl,
        energyCost: cards.energyCost,
        power: cards.power,
        isBanned: cards.isBanned,
        isLimited: cards.isLimited,
      })
      .from(cards)
      .innerJoin(cardSets, eq(cardSets.code, cards.setCode))
      .where(where)
      .orderBy(...order)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(cards).where(where),
  ]);

  return { rows, total: count, page, pageSize, pages: Math.max(1, Math.ceil(count / pageSize)) };
}

/**
 * Fast typeahead for the bulk-entry form and deck builder.
 *
 * `cardType` narrows in SQL rather than after the fact: "son goku" matches
 * hundreds of cards, so filtering a capped result set would leave a leader
 * search with almost no leaders in it.
 */
export async function quickSearch(db: Db, q: string, limit = 12, cardType?: string) {
  const terms = searchTerms(q);
  if (terms.length === 0) return [];
  const where = and(
    ...terms.map((t) => ilike(cards.searchText, `%${t.replace(/[%_]/g, "")}%`)),
    ...(cardType ? [eq(cards.cardType, cardType)] : []),
  );
  const exact = q.trim().toUpperCase();
  return db
    .select({
      id: cards.id,
      name: cards.name,
      setCode: cards.setCode,
      cardType: cards.cardType,
      colors: cards.colors,
      rarityCode: cards.rarityCode,
      imageUrl: cards.imageUrl,
    })
    .from(cards)
    .where(where)
    // Exact number match, then number-prefix, then cards whose *name* matches
    // ahead of ones that merely mention the words in their skill text —
    // otherwise typing "goku" offers Dende, who only talks about him.
    .orderBy(
      sql`case when ${cards.id} = ${exact} then 0 when ${cards.id} like ${exact + "%"} then 1 else 2 end`,
      sql`case when ${cards.name} ilike ${"%" + q.trim().replace(/[%_]/g, "") + "%"} then 0 else 1 end`,
      asc(cards.name),
    )
    .limit(limit);
}

export async function listSets(db: Db) {
  return db.select().from(cardSets).orderBy(desc(cardSets.sortKey));
}

export async function listRarities(db: Db) {
  const rows = await db
    .select({ code: cards.rarityCode, label: cards.rarity, n: sql<number>`count(*)::int` })
    .from(cards)
    .groupBy(cards.rarityCode, cards.rarity)
    .orderBy(desc(sql`count(*)`));
  return rows;
}

export async function getCard(db: Db, id: string) {
  const card = await db.query.cards.findFirst({ where: eq(cards.id, id) });
  if (!card) return null;
  const [set, prints] = await Promise.all([
    db.query.cardSets.findFirst({ where: eq(cardSets.code, card.setCode) }),
    db.select().from(cardPrints).where(eq(cardPrints.cardId, id)).orderBy(desc(cardPrints.isBase), asc(cardPrints.id)),
  ]);
  return { ...card, set: set!, prints };
}

export async function cardsByIds(db: Db, ids: string[]) {
  if (ids.length === 0) return [];
  return db.select().from(cards).where(inArray(cards.id, ids));
}
