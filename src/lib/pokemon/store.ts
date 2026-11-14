/**
 * Pokémon rows in `card_sets` / `cards` / `card_prints` (docs/pokemon/plan.md §4).
 *
 * Pokémon has no imported catalog. `ensurePokemonCard` is the ONLY writer of those rows: a card is
 * written the moment a lot, a deck line or a wish refers to it, from a live TCGdex read. That is
 * the one exception to "errata are fixed in `errata.ts`, never by UPDATE": the source *is* the
 * catalog, so a re-ensure and the nightly refresh simply say what the source says now, keeping
 * (`coalesce`) any stored value the source stopped sending. Nothing here is hand-edited.
 *
 * It takes the `db` (or a transaction) so the caller writes the card and the lot, deck line or wish
 * in one transaction; the network read happens first (`opts.record`, or inside the call), never in
 * the middle of a transaction the caller holds open on purpose.
 */
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cardPrints, cards, cardSets } from "@/db/schema";
import { rows } from "@/db/rows";
import { expireTagsFromAction, expireTagsFromRoute } from "@/lib/cache/tags";
import { getPokemonCard, getPokemonSet, type PokemonCardRecord, type PokemonSetInfo } from "./tcgdex";
import { pokemonCardId, pokemonDetails, pokemonPrintId, tcgdexIdOf, type PokemonDetails, type PokemonVariant } from "./types";

export interface EnsuredPrint {
  id: string;
  variant: PokemonVariant;
  label: string;
  isBase: boolean;
  ctBlueprintId: number | null;
  priceCents: number | null;
  lowCents: number | null;
}

export interface EnsuredCard {
  cardId: string;
  tcgdexId: string;
  name: string;
  prints: EnsuredPrint[];
}

export const setCodeOf = (setId: string) => `PKM-${setId}`;

/** `2023-09-22` -> 20230922: the same newest-first ordering key the Dragon Ball sets use. Zero when the date is unknown. */
export function sortKeyOf(releaseDate: string | null | undefined): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(releaseDate ?? "");
  return m ? Number(`${m[1]}${m[2]}${m[3]}`) : 0;
}

/** Lower-cased words a local search of stored cards matches: both names, the number, the set. */
export function searchTextOf(rec: PokemonCardRecord, setNames: string[]): string {
  const d = rec.details;
  const number = d.setTotal ? [`${d.localId}/${d.setTotal}`, d.localId] : [d.localId];
  return [d.names.de, d.names.en, ...number, rec.setId, rec.tcgdexId, ...setNames].filter(Boolean).join(" ").toLowerCase();
}

type Expire = "action" | "route" | false;

/**
 * The hard rule for a writer of a cached table: expire the tag. `updateTag` is for a Server Action,
 * `revalidateTag` for a route handler; outside Next (a script, a test) neither can run, and the 24 h
 * backstop of `src/lib/cache/tags.ts` covers it.
 */
function expireCatalog(mode: Expire): void {
  if (!mode) return;
  try {
    if (mode === "route") expireTagsFromRoute("catalog");
    else expireTagsFromAction("catalog");
  } catch {
    // Not inside a request.
  }
}

/**
 * Store a card, its set and one print per variant it exists in. Idempotent. Returns the card id and
 * its prints. `opts.record` skips the read (the caller already has it); `opts.expire` says how the
 * catalog cache tag is expired (default: as a Server Action).
 */
export async function ensurePokemonCard(db: Db, tcgdexId: string, opts: { record?: PokemonCardRecord; set?: PokemonSetInfo | null; expire?: Expire } = {}): Promise<EnsuredCard> {
  const rec = opts.record ?? (await getPokemonCard(tcgdexId));
  const set = opts.set !== undefined ? opts.set : await getPokemonSet(rec.setId).catch(() => null);
  const d = rec.details;
  const id = rec.tcgdexId;
  const cardId = pokemonCardId(id);
  const setCode = setCodeOf(rec.setId);
  const setName = set?.names.de ?? d.setNames.de ?? set?.names.en ?? d.setNames.en ?? rec.setId;
  const releasedOn = set?.releaseDate ?? null;
  const now = new Date();

  await db
    .insert(cardSets)
    .values({ code: setCode, name: setName, game: "pokemon", line: "pokemon", releasedOn, sortKey: sortKeyOf(releasedOn) })
    .onConflictDoUpdate({
      target: cardSets.code,
      set: {
        name: sql`excluded.name`,
        releasedOn: sql`coalesce(excluded.released_on, ${cardSets.releasedOn})`,
        sortKey: sql`case when excluded.sort_key = 0 then ${cardSets.sortKey} else excluded.sort_key end`,
      },
    });

  const name = d.names.de ?? d.names.en ?? id;
  await db
    .insert(cards)
    .values({
      id: cardId,
      setCode,
      game: "pokemon",
      name,
      cardType: rec.category,
      colors: d.display.types,
      power: d.hp,
      skill: rec.skillText,
      rarity: rec.rarity ?? "",
      rarityCode: rec.rarityEn ?? "",
      imageUrl: rec.imageHigh,
      details: d,
      searchText: searchTextOf(rec, [set?.names.de, set?.names.en, ...Object.values(d.setNames)].filter((s): s is string => !!s)),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: cards.id,
      set: {
        setCode: sql`excluded.set_code`,
        name: sql`excluded.name`,
        cardType: sql`excluded.card_type`,
        colors: sql`excluded.colors`,
        rarity: sql`excluded.rarity`,
        rarityCode: sql`excluded.rarity_code`,
        searchText: sql`excluded.search_text`,
        // A re-ensure never erases what is stored: a picture, an HP, a text the source stopped sending stay.
        power: sql`coalesce(excluded.power, ${cards.power})`,
        skill: sql`coalesce(excluded.skill, ${cards.skill})`,
        imageUrl: sql`coalesce(excluded.image_url, ${cards.imageUrl})`,
        details: sql`coalesce(excluded.details, ${cards.details})`,
        updatedAt: now,
      },
    });

  const printRows = rec.variants.map((v, i) => ({
    id: pokemonPrintId(id, v.variant),
    cardId,
    suffix: v.variant === "normal" ? "" : v.variant,
    label: v.label,
    rarity: rec.rarity ?? "",
    imageUrl: rec.imageHigh,
    isBase: i === 0,
    ctBlueprintId: v.ctBlueprintId,
    marketCents: v.priceCents,
    marketLowCents: v.lowCents,
    marketCurrency: v.priceCents !== null || v.lowCents !== null ? "EUR" : null,
    marketAt: v.priceCents !== null || v.lowCents !== null ? now : null,
  }));
  if (printRows.length > 0) {
    await db
      .insert(cardPrints)
      .values(printRows)
      .onConflictDoUpdate({
        target: cardPrints.id,
        set: {
          label: sql`excluded.label`,
          rarity: sql`excluded.rarity`,
          imageUrl: sql`coalesce(excluded.image_url, ${cardPrints.imageUrl})`,
          ctBlueprintId: sql`coalesce(excluded.ct_blueprint_id, ${cardPrints.ctBlueprintId})`,
          marketCents: sql`coalesce(excluded.market_cents, ${cardPrints.marketCents})`,
          marketLowCents: sql`coalesce(excluded.market_low_cents, ${cardPrints.marketLowCents})`,
          marketCurrency: sql`coalesce(excluded.market_currency, ${cardPrints.marketCurrency})`,
          marketAt: sql`case when excluded.market_cents is not null or excluded.market_low_cents is not null then excluded.market_at else ${cardPrints.marketAt} end`,
        },
      });
  }

  expireCatalog(opts.expire === undefined ? "action" : opts.expire);
  return {
    cardId,
    tcgdexId: id,
    name,
    prints: rec.variants.map((v, i) => ({ id: pokemonPrintId(id, v.variant), variant: v.variant, label: v.label, isBase: i === 0, ctBlueprintId: v.ctBlueprintId, priceCents: v.priceCents, lowCents: v.lowCents })),
  };
}

/** The print id of one variant of an ensured card; throws a plain sentence when the card is not printed in it. */
export function printFor(card: EnsuredCard, variant: PokemonVariant): EnsuredPrint {
  const print = card.prints.find((p) => p.variant === variant);
  if (!print) throw new Error(`${card.name} gibt es nicht als ${variant}.`);
  return print;
}

// ── The nightly refresh ──────────────────────────────────────────────────────

export interface RefreshSummary {
  /** Stored Pokémon cards something still refers to (a lot, a deck line or a wish): the ones worth reading. */
  cards: number;
  refreshed: number;
  failed: number;
  /** Cards whose legality or regulation mark changed (a rotation shows up here). */
  legalityChanged: number;
  /** Prints whose market price was updated. */
  pricesUpdated: number;
  /** Cards left for tomorrow because the time budget ran out; they are read first next time. */
  skipped: number;
  errors: string[];
}

/**
 * Re-read every stored Pokémon card that something refers to and update `details.legal`,
 * `details.regulationMark` and its prints' market columns (and a CardTrader blueprint the source
 * gained). A card nobody refers to any more stays a row but is skipped (plan §4). Single failures are
 * counted, never thrown; the oldest-refreshed cards go first so a time budget never starves one.
 */
export async function refreshPokemonCards(db: Db, opts: { budgetMs?: number; concurrency?: number; fetchCard?: (tcgdexId: string) => Promise<PokemonCardRecord> } = {}): Promise<RefreshSummary> {
  const budget = opts.budgetMs ?? 180_000;
  const fetchCard = opts.fetchCard ?? ((id: string) => getPokemonCard(id, { fresh: true, langs: ["en"] }));
  const started = Date.now();
  const ids = rows<{ id: string }>(
    await db.execute(sql`
      select c.id from cards c
      where c.game = 'pokemon'
        and (exists (select 1 from owned_cards o where o.card_id = c.id)
          or exists (select 1 from deck_cards k where k.card_id = c.id)
          or exists (select 1 from want_list w where w.card_id = c.id))
      order by c.updated_at asc, c.id asc`),
  ).map((r) => r.id);
  const summary: RefreshSummary = { cards: ids.length, refreshed: 0, failed: 0, legalityChanged: 0, pricesUpdated: 0, skipped: 0, errors: [] };

  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const cardId = ids[next++];
      if (Date.now() - started > budget) {
        summary.skipped++;
        continue;
      }
      const tcgdexId = tcgdexIdOf(cardId);
      try {
        if (!tcgdexId) throw new Error("not a Pokémon card id");
        const rec = await fetchCard(tcgdexId);
        const changed = await applyRefresh(db, cardId, rec);
        summary.refreshed++;
        if (changed.legalityChanged) summary.legalityChanged++;
        summary.pricesUpdated += changed.pricesUpdated;
      } catch (e) {
        summary.failed++;
        if (summary.errors.length < 5) summary.errors.push(`${cardId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, 8)) }, worker));
  return summary;
}

async function applyRefresh(db: Db, cardId: string, rec: PokemonCardRecord): Promise<{ legalityChanged: boolean; pricesUpdated: number }> {
  const now = new Date();
  const stored = await db.query.cards.findFirst({ where: eq(cards.id, cardId), columns: { details: true } });
  const before = pokemonDetails(stored?.details);
  const next: PokemonDetails = { ...(before as PokemonDetails), legal: rec.details.legal, regulationMark: rec.details.regulationMark };
  const legalityChanged = before.legal?.standard !== next.legal.standard || before.legal?.expanded !== next.legal.expanded || (before.regulationMark ?? null) !== (next.regulationMark ?? null);
  await db.update(cards).set({ details: next, updatedAt: now }).where(eq(cards.id, cardId));

  let pricesUpdated = 0;
  for (const v of rec.variants) {
    const printId = pokemonPrintId(rec.tcgdexId, v.variant);
    const hasPrice = v.priceCents !== null || v.lowCents !== null;
    const res = await db
      .update(cardPrints)
      .set({
        ctBlueprintId: sql`coalesce(${v.ctBlueprintId}::integer, ${cardPrints.ctBlueprintId})`,
        ...(hasPrice ? { marketCents: v.priceCents, marketLowCents: v.lowCents, marketCurrency: "EUR", marketAt: now } : {}),
      })
      .where(eq(cardPrints.id, printId))
      .returning({ id: cardPrints.id });
    if (hasPrice && res.length > 0) pricesUpdated++;
  }
  return { legalityChanged, pricesUpdated };
}

/**
 * The network half of `ensurePokemonCard`, kept apart so a caller can read first and then write
 * the card with its lot, deck line or wish in one transaction.
 */
export async function loadPokemonCard(tcgdexId: string): Promise<{ record: PokemonCardRecord; set: PokemonSetInfo | null }> {
  const record = await getPokemonCard(tcgdexId);
  const set = await getPokemonSet(record.setId).catch(() => null);
  return { record, set };
}
