/**
 * Turns cached CardTrader listings into optimiser input, with shipping
 * estimates: CardTrader Zero (hub) sellers ship via CardTrader's consolidated
 * parcel, everyone else via their own cheapest method to Austria.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { settings } from "@/db/schema";
import { cachedListings, cardTraderEnabled, shippingMethods, type CachedListing } from "./cardtrader";
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
export async function optimiseCart(db: Db, wants: Want[], cfg: CartSettings): Promise<CartResult> {
  const cached = await cachedListings(
    db,
    wants.map((w) => w.cardId),
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
