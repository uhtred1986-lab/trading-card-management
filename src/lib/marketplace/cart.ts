/**
 * Turns cached CardTrader listings into optimiser input, with shipping
 * estimates: CardTrader Zero (hub) sellers ship via CardTrader's consolidated
 * parcel, everyone else via their own cheapest method to Austria.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { settings } from "@/db/schema";
import { cachedListings, cardTraderEnabled, shippingMethods, type CachedListing } from "./cardtrader";
import { isPokemonCardId } from "@/lib/pokemon/types";
import { alternatives, greedyOptimise, type Listing, type Plan, type Want } from "./optimizer";

export interface CartSettings {
  /** Flat estimate for a CardTrader Zero parcel, EUR cents. */
  hubShippingCents: number;
  /** Fallback estimate for a direct seller before their real rates are fetched. */
  directShippingCents: number;
  /** Only consider sellers in these countries (empty = any). */
  countries: string[];
  preferences: string;
}

export const DEFAULT_CART_SETTINGS: CartSettings = { hubShippingCents: 450, directShippingCents: 600, countries: [], preferences: "" };

export async function cartSettings(db: Db): Promise<CartSettings> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, "cart") });
  return { ...DEFAULT_CART_SETTINGS, ...((row?.value as Partial<CartSettings> | null) ?? {}) };
}

export async function saveCartSettings(db: Db, value: CartSettings): Promise<void> {
  await db
    .insert(settings)
    .values({ key: "cart", value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

/**
 * What a buyer wants of a Pokémon listing. Language is the card's printed language; condition keeps
 * Near Mint by default. Applied to Pokémon cards only: a Dragon Ball listing is never filtered here.
 */
export interface ListingFilter {
  language: "de" | "en" | "any";
  condition: "nm" | "any";
}
export const DEFAULT_LISTING_FILTER: ListingFilter = { language: "any", condition: "nm" };

/** Parse the `lang` / `cond` query values; anything unknown falls back to the default. */
export function listingFilterFrom(lang: string | undefined, cond: string | undefined): ListingFilter {
  const l = String(lang ?? "").toLowerCase();
  const c = String(cond ?? "").toLowerCase();
  return { language: l === "de" || l === "en" ? l : "any", condition: c === "any" ? "any" : "nm" };
}

/** "German", "de" and "DE" are one language; null when the listing says none. */
export function languageCodeOf(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "de" || s === "german" || s === "deutsch") return "de";
  if (s === "en" || s === "english") return "en";
  return s;
}

const isNearMint = (c: string | null) => /^(near mint|nm)\b/i.test((c ?? "").trim());

/** Drop the Pokémon listings that are the wrong language or below the wanted condition; others pass untouched. */
export function applyListingFilter<T extends { cardId: string | null; language: string | null; condition: string | null }>(listings: T[], filter: ListingFilter): T[] {
  return listings.filter((l) => {
    if (!l.cardId || !isPokemonCardId(l.cardId)) return true;
    if (filter.language !== "any" && languageCodeOf(l.language) !== filter.language) return false;
    if (filter.condition === "nm" && !isNearMint(l.condition)) return false;
    return true;
  });
}

export function toListings(cached: CachedListing[], cfg: CartSettings, shippingBySeller: Map<string, number> = new Map()): Listing[] {
  return cached
    .filter((l) => l.cardId && !l.onVacation && l.currency === "EUR" && (cfg.countries.length === 0 || cfg.countries.includes(l.countryCode ?? "")))
    .map((l) => ({
      id: String(l.id),
      seller: l.seller,
      cardId: l.cardId!,
      priceCents: l.priceCents,
      quantity: l.quantity,
      shippingCents: shippingBySeller.get(l.seller) ?? (l.canSellViaHub ? cfg.hubShippingCents : cfg.directShippingCents),
      country: l.countryCode ?? "?",
      condition: l.condition ?? undefined,
      language: l.language ?? undefined,
    }));
}

export interface CartResult {
  best: Plan;
  fewestSellers: Plan | null;
  listings: number;
  refinedSellers: string[];
  fetchedAt: Date | null;
}

/**
 * Optimise from the cache. When live calls are enabled, the shortlisted
 * direct sellers get their real cheapest shipping cost looked up (one call
 * per seller, never per listing) and the plan is recomputed.
 */
export async function optimiseCart(db: Db, wants: Want[], cfg: CartSettings, filter: ListingFilter = DEFAULT_LISTING_FILTER): Promise<CartResult> {
  const cached = applyListingFilter(
    await cachedListings(
      db,
      wants.map((w) => w.cardId),
    ),
    filter,
  );
  let listings = toListings(cached, cfg);
  let best = greedyOptimise(wants, listings);
  const refined: string[] = [];

  if (cardTraderEnabled()) {
    const hub = new Set(cached.filter((l) => l.canSellViaHub).map((l) => l.seller));
    const shipping = new Map<string, number>();
    for (const s of best.sellers) {
      if (hub.has(s.seller)) continue;
      try {
        const methods = await shippingMethods(s.seller);
        const cheapest = Math.min(...methods.flatMap((m) => m.shipping_method_costs.map((c) => c.price.cents)));
        if (Number.isFinite(cheapest)) {
          shipping.set(s.seller, cheapest);
          refined.push(s.seller);
        }
      } catch {
        // keep the estimate
      }
    }
    if (shipping.size) {
      listings = toListings(cached, cfg, shipping);
      best = greedyOptimise(wants, listings);
    }
  }

  const { fewestSellers } = alternatives(wants, listings);
  const fetchedAt = cached.reduce<Date | null>((d, l) => (!d || l.fetchedAt < d ? l.fetchedAt : d), null);
  return { best, fewestSellers, listings: listings.length, refinedSellers: refined, fetchedAt };
}
