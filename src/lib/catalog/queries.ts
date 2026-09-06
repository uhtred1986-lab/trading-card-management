import { and, asc, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { cardPrints, cardSets, cards, ownedCards } from "@/db/schema";
import { abilityKeywordsOf } from "./abilityKeywords";
import { sameKeyword } from "@/lib/decks/cardRules";
import { GAME_INFO, type Game } from "./games";

/** Card types across both games; Fusion World adds ENERGY MARKER and has no Z- types. */
export const CARD_TYPES = ["LEADER", "BATTLE", "EXTRA", "UNISON", "Z-LEADER", "Z-BATTLE", "Z-EXTRA", "Z-UNISON", "TOKEN", "ENERGY MARKER"];
export const COLORS = ["Red", "Blue", "Green", "Yellow", "Black", "White", "Colorless"];

/** The types a game actually prints, for the type dropdown. */
export function cardTypesFor(game?: Game): string[] {
  if (!game) return CARD_TYPES;
  const fusion = ["LEADER", "BATTLE", "EXTRA", "ENERGY MARKER"];
  return game === "fusion" ? fusion : CARD_TYPES.filter((t) => t !== "ENERGY MARKER");
}

export interface CardSearch {
  q?: string;
  set?: string;
  /** Undefined shows both games, which is the default view. */
  game?: Game;
  type?: string;
  color?: string;
  rarity?: string;
  /** A trait/race tag as printed: "Saiyan", "God". */
  trait?: string;
  /** A §22 keyword ability the card carries: "Blocker", "Double Strike". */
  ability?: string;
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

/** Cards carrying a §22 keyword ability, found in TS since it reads bracket text rather than a column. */
async function cardIdsWithAbility(db: Db, ability: string, game?: Game): Promise<string[]> {
  const rows = await db
    .select({ id: cards.id, skill: cards.skill, backSkill: cards.backSkill })
    .from(cards)
    .where(game ? eq(cards.game, game) : undefined);
  return rows.filter((r) => abilityKeywordsOf(r).some((t) => sameKeyword(t, ability))).map((r) => r.id);
}

function whereFor(s: CardSearch, abilityIds?: string[]): SQL | undefined {
  const parts: SQL[] = [];
  for (const t of searchTerms(s.q ?? "")) parts.push(ilike(cards.searchText, `%${t.replace(/[%_]/g, "")}%`));
  if (s.game) parts.push(eq(cards.game, s.game));
  if (s.set) parts.push(eq(cards.setCode, s.set));
  if (s.type) parts.push(eq(cards.cardType, s.type));
  if (s.color) parts.push(sql`${s.color} = any(${cards.colors})`);
  if (s.rarity) parts.push(eq(cards.rarityCode, s.rarity));
  if (s.trait) parts.push(sql`${s.trait} = any(${cards.traits})`);
  if (abilityIds) parts.push(abilityIds.length ? inArray(cards.id, abilityIds) : sql`false`);
  if (s.owned === "yes")
    parts.push(sql`exists (select 1 from ${ownedCards} o where o.card_id = ${cards.id} and o.archived_at is null)`);
  if (s.owned === "no")
    parts.push(sql`not exists (select 1 from ${ownedCards} o where o.card_id = ${cards.id} and o.archived_at is null)`);
  return parts.length ? and(...parts) : undefined;
}

/** Natural ordering: set sort key, then number so BT1-002 < BT1-010. */
const numberOrder = sql`${cards.id} collate "C"`;

export async function searchCards(db: Db, s: CardSearch) {
  const pageSize = s.pageSize ?? 60;
  const page = Math.max(1, s.page ?? 1);
  const abilityIds = s.ability ? await cardIdsWithAbility(db, s.ability, s.game) : undefined;
  const where = whereFor(s, abilityIds);
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
        game: cards.game,
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
export async function quickSearch(db: Db, q: string, limit = 12, cardType?: string, game?: Game) {
  const terms = searchTerms(q);
  if (terms.length === 0) return [];
  const where = and(
    ...terms.map((t) => ilike(cards.searchText, `%${t.replace(/[%_]/g, "")}%`)),
    ...(cardType ? [eq(cards.cardType, cardType)] : []),
    // Scoped to one game when the caller has one in mind — a Fusion World deck
    // should not offer Masters cards in its search box.
    ...(game ? [eq(cards.game, game)] : []),
  );
  const exact = q.trim().toUpperCase();
  return db
    .select({
      id: cards.id,
      name: cards.name,
      setCode: cards.setCode,
      game: cards.game,
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

export async function listSets(db: Db, opts: { game?: Game } = {}) {
  return db
    .select()
    .from(cardSets)
    .where(opts.game ? eq(cardSets.game, opts.game) : undefined)
    .orderBy(desc(cardSets.sortKey));
}

/**
 * Rarity codes for the filter dropdown. Grouped by *code* rather than by the
 * full label, because both games use "SR" and a dropdown cannot offer the same
 * value twice; `min(rarity)` picks one label to show it under.
 */
export async function listRarities(db: Db, opts: { game?: Game } = {}) {
  return db
    .select({ code: cards.rarityCode, label: sql<string>`min(${cards.rarity})`, n: sql<number>`count(*)::int` })
    .from(cards)
    .where(opts.game ? eq(cards.game, opts.game) : undefined)
    .groupBy(cards.rarityCode)
    .orderBy(desc(sql`count(*)`));
}

/** Trait/race tags actually printed, for the keyword dropdown. */
export async function listTraits(db: Db, opts: { game?: Game } = {}): Promise<string[]> {
  const rows = await db
    .selectDistinct({ trait: sql<string>`unnest(${cards.traits})` })
    .from(cards)
    .where(opts.game ? eq(cards.game, opts.game) : undefined);
  return rows.map((r) => r.trait).sort((a, b) => a.localeCompare(b));
}

/**
 * §22 keyword abilities actually carried by some card, for the ability
 * keyword dropdown. Read from `skill`/`backSkill` rather than a column, so
 * this scans every card in the game(s) shown — fine at this catalog's size.
 */
export async function listAbilityKeywords(db: Db, opts: { game?: Game } = {}): Promise<string[]> {
  const rows = await db
    .select({ skill: cards.skill, backSkill: cards.backSkill })
    .from(cards)
    .where(opts.game ? eq(cards.game, opts.game) : undefined);
  const found = new Set<string>();
  for (const r of rows) for (const t of abilityKeywordsOf(r)) found.add(t);
  return [...found].sort((a, b) => a.localeCompare(b));
}

/** Sets grouped by game, for a picker that shows both at once. */
export async function listSetsByGame(db: Db) {
  const sets = await listSets(db);
  return (Object.keys(GAME_INFO) as Game[])
    .map((game) => ({ game, label: GAME_INFO[game].short, sets: sets.filter((s) => s.game === game) }))
    .filter((g) => g.sets.length > 0);
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
