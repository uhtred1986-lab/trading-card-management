/**
 * CardTrader API v2 client — READ-ONLY by design. Nothing here can add to a
 * cart or purchase; only catalog, marketplace listings and shipping lookups.
 * Docs: https://www.cardtrader.com/en/docs/api/full/reference
 *
 * Every live call is gated by CARDTRADER_ENABLED=true so the token can sit in
 * the environment without the app talking to CardTrader until the owner
 * has tested it manually.
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { rows } from "@/db/rows";
import { cardPrints, ctBlueprints, ctExpansions, ctListings, tcgProducts } from "@/db/schema";
import { baseNumber } from "@/lib/catalog/deckplanet";

const BASE = "https://api.cardtrader.com/api/v2";

export function cardTraderConfigured(): boolean {
  return !!process.env.CARDTRADER_API_TOKEN;
}
export function cardTraderEnabled(): boolean {
  return cardTraderConfigured() && process.env.CARDTRADER_ENABLED === "true";
}

export class CardTraderDisabled extends Error {
  constructor() {
    super("CardTrader live calls are disabled. Set CARDTRADER_ENABLED=true after testing the token manually.");
  }
}

/** Only GET is ever issued; the method is not a parameter on purpose. */
async function get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  if (!cardTraderEnabled()) throw new CardTraderDisabled();
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { authorization: `Bearer ${process.env.CARDTRADER_API_TOKEN}`, accept: "application/json" } });
  if (res.status === 429) throw new Error("CardTrader rate limit hit — slow down.");
  if (!res.ok) throw new Error(`CardTrader ${path}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

// ── shapes (subset of the documented objects) ──────────────────────────────

export interface CtGame {
  id: number;
  name: string;
  display_name: string;
}
export interface CtExpansion {
  id: number;
  game_id: number;
  code: string | null;
  name: string;
}
export interface CtBlueprint {
  id: number;
  name: string;
  version?: string | null;
  game_id: number;
  expansion_id: number;
  image_url?: string | null;
  tcg_player_id?: string | number | null;
  card_market_ids?: number[] | null;
  fixed_properties?: Record<string, unknown> | null;
}
export interface CtProduct {
  id: number;
  blueprint_id: number;
  name_en: string;
  quantity: number;
  price: { cents: number; currency: string };
  properties_hash: Record<string, unknown>;
  user: { id: number; username: string; country_code: string; can_sell_via_hub: boolean; max_sellable_in24h_quantity: number | null };
  on_vacation?: boolean;
  graded?: boolean;
  bundle_size?: number;
}
export interface CtShippingMethod {
  id: number;
  name: string;
  tracked: boolean;
  min_estimate_shipping_days: number | null;
  max_estimate_shipping_days: number | null;
  free_shipping_threshold_price: { cents: number; currency: string } | null;
  max_cart_subtotal_price: { cents: number; currency: string } | null;
  shipping_method_costs: { from_grams: number; to_grams: number; price: { cents: number; currency: string } }[];
}

export const info = () => get<{ id: number; name: string; user_id: number }>("info");
export const games = () => get<CtGame[]>("games");
export const expansions = () => get<CtExpansion[]>("expansions");
export const blueprintsForExpansion = (expansionId: number) => get<CtBlueprint[]>("blueprints/export", { expansion_id: expansionId });
export const productsForBlueprint = (blueprintId: number, opts: { language?: string; foil?: boolean } = {}) =>
  get<Record<string, CtProduct[]>>("marketplace/products", { blueprint_id: blueprintId, ...opts });
export const shippingMethods = (username: string) => get<CtShippingMethod[]>("shipping_methods", { username });

// ── catalog crosswalk ──────────────────────────────────────────────────────

/** Sleep helper for the 200 req / 10 s ceiling. */
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CtSyncSummary {
  game: string;
  expansions: number;
  blueprints: number;
  matchedByTcgPlayer: number;
  matchedByNumber: number;
  unmatched: number;
}

function collectorNumber(bp: CtBlueprint): string | null {
  const fp = bp.fixed_properties ?? {};
  const v = fp.collector_number ?? fp.dbs_number ?? fp.number ?? null;
  return v == null ? null : String(v).trim().toUpperCase();
}

/**
 * Pull CardTrader's DBS catalog and link each blueprint to our card/print:
 * first through TCGplayer product ids (already matched to prints by the
 * price sync), then by printed collector number.
 */
export async function syncCardTraderCatalog(db: Db): Promise<CtSyncSummary> {
  const all = await games();
  const game = all.find((g) => /dragon ?ball ?super/i.test(g.display_name) && !/fusion/i.test(g.display_name)) ?? all.find((g) => /dragon ?ball/i.test(g.display_name));
  if (!game) throw new Error(`CardTrader lists no Dragon Ball Super game (saw: ${all.map((g) => g.display_name).join(", ")})`);

  const exps = (await expansions()).filter((e) => e.game_id === game.id);
  await db
    .insert(ctExpansions)
    .values(exps.map((e) => ({ id: e.id, gameId: e.game_id, code: e.code, name: e.name })))
    .onConflictDoUpdate({ target: ctExpansions.id, set: { code: sql`excluded.code`, name: sql`excluded.name` } });

  const tcg = await db.select({ id: tcgProducts.id, cardId: tcgProducts.cardId, printId: tcgProducts.printId }).from(tcgProducts).where(isNotNull(tcgProducts.cardId));
  const byTcg = new Map(tcg.map((p) => [p.id, p]));
  const prints = await db.select({ id: cardPrints.id, cardId: cardPrints.cardId }).from(cardPrints);
  const printById = new Map(prints.map((p) => [p.id.toUpperCase(), p]));

  let blueprints = 0;
  let byTcgN = 0;
  let byNumN = 0;
  let unmatched = 0;

  for (const e of exps) {
    const bps = await blueprintsForExpansion(e.id);
    await pause(120); // ≈8 req/s, under the 200/10 s ceiling
    const values = bps.map((bp) => {
      const tcgId = bp.tcg_player_id == null || bp.tcg_player_id === "" ? null : Number(bp.tcg_player_id);
      let cardId: string | null = null;
      let printId: string | null = null;
      let matchedBy: string | null = null;
      const viaTcg = tcgId != null ? byTcg.get(tcgId) : undefined;
      if (viaTcg?.cardId) {
        cardId = viaTcg.cardId;
        printId = viaTcg.printId;
        matchedBy = "tcgplayer";
        byTcgN++;
      } else {
        const num = collectorNumber(bp);
        const print = num ? (printById.get(num) ?? printById.get(baseNumber(num).toUpperCase())) : undefined;
        if (print) {
          cardId = print.cardId;
          printId = print.id;
          matchedBy = "number";
          byNumN++;
        } else unmatched++;
      }
      return {
        id: bp.id,
        expansionId: e.id,
        name: bp.name,
        version: bp.version ?? null,
        imageUrl: bp.image_url ?? null,
        tcgPlayerId: Number.isFinite(tcgId) ? tcgId : null,
        cardMarketIds: bp.card_market_ids ?? null,
        fixedProperties: bp.fixed_properties ?? null,
        cardId,
        printId,
        matchedBy,
      };
    });
    blueprints += values.length;
    for (let i = 0; i < values.length; i += 300) {
      await db
        .insert(ctBlueprints)
        .values(values.slice(i, i + 300))
        .onConflictDoUpdate({
          target: ctBlueprints.id,
          set: {
            expansionId: sql`excluded.expansion_id`,
            name: sql`excluded.name`,
            version: sql`excluded.version`,
            imageUrl: sql`excluded.image_url`,
            tcgPlayerId: sql`excluded.tcg_player_id`,
            cardMarketIds: sql`excluded.card_market_ids`,
            fixedProperties: sql`excluded.fixed_properties`,
            cardId: sql`excluded.card_id`,
            printId: sql`excluded.print_id`,
            matchedBy: sql`excluded.matched_by`,
          },
        });
    }
  }
  return { game: game.display_name, expansions: exps.length, blueprints, matchedByTcgPlayer: byTcgN, matchedByNumber: byNumN, unmatched };
}

// ── on-demand listings ─────────────────────────────────────────────────────

export interface CachedListing {
  id: number;
  blueprintId: number;
  cardId: string | null;
  seller: string;
  sellerId: number;
  countryCode: string | null;
  canSellViaHub: boolean;
  onVacation: boolean;
  priceCents: number;
  currency: string;
  quantity: number;
  condition: string | null;
  language: string | null;
  foil: boolean;
  fetchedAt: Date;
}

/** Fetch live listings for every blueprint of a card and replace the cache for it. */
export async function refreshListingsForCard(db: Db, cardId: string): Promise<CachedListing[]> {
  const bps = await db.select({ id: ctBlueprints.id }).from(ctBlueprints).where(eq(ctBlueprints.cardId, cardId));
  if (bps.length === 0) return [];
  const fresh: (typeof ctListings.$inferInsert)[] = [];
  for (const bp of bps) {
    const res = await productsForBlueprint(bp.id);
    await pause(110); // 10 req/s ceiling on this endpoint
    for (const p of Object.values(res).flat()) {
      const ph = p.properties_hash ?? {};
      fresh.push({
        id: p.id,
        blueprintId: p.blueprint_id,
        cardId,
        sellerId: p.user.id,
        seller: p.user.username,
        countryCode: p.user.country_code ?? null,
        canSellViaHub: !!p.user.can_sell_via_hub,
        onVacation: !!p.on_vacation,
        priceCents: p.price.cents,
        currency: p.price.currency,
        quantity: p.quantity,
        condition: ph.condition == null ? null : String(ph.condition),
        language: (Object.entries(ph).find(([k]) => /language$/.test(k))?.[1] as string | undefined) ?? null,
        foil: !!Object.entries(ph).find(([k]) => /foil$/.test(k))?.[1],
        fetchedAt: new Date(),
      });
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(ctListings).where(eq(ctListings.cardId, cardId));
    if (fresh.length) await tx.insert(ctListings).values(fresh);
  });
  return cachedListings(db, [cardId]);
}

export async function cachedListings(db: Db, cardIds: string[]): Promise<CachedListing[]> {
  if (!cardIds.length) return [];
  return db.select().from(ctListings).where(inArray(ctListings.cardId, cardIds)).orderBy(ctListings.priceCents);
}

export async function blueprintCountFor(db: Db, cardId: string): Promise<number> {
  const r = rows<{ n: number }>(await db.execute(sql`select count(*)::int as n from ct_blueprints where card_id = ${cardId}`));
  return r[0]?.n ?? 0;
}

export async function blueprintsFor(db: Db, cardId: string) {
  return db.select().from(ctBlueprints).where(and(eq(ctBlueprints.cardId, cardId)));
}

/** Deep links even without an integration: CardTrader search, TCGplayer, Cardmarket. */
export function externalLinks(card: { id: string; name: string }, tcgUrl?: string | null, cardMarketIds?: unknown) {
  const q = encodeURIComponent(`${card.name} ${card.id}`);
  const cm = Array.isArray(cardMarketIds) && cardMarketIds.length ? `https://www.cardmarket.com/en/DragonBallSuper/Products/Singles?idProduct=${cardMarketIds[0]}` : `https://www.cardmarket.com/en/DragonBallSuper/Products/Search?searchString=${encodeURIComponent(card.name)}`;
  return {
    cardtrader: `https://www.cardtrader.com/en/search?q=${q}`,
    tcgplayer: tcgUrl ?? `https://www.tcgplayer.com/search/dragon-ball-super-ccg/product?q=${q}`,
    cardmarket: cm,
  };
}
