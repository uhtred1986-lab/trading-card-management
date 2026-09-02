/**
 * Deterministic cart optimiser: cheapest set of sellers to cover a want-list,
 * counting each seller's shipping once and respecting per-listing stock.
 *
 * Exact set-cover is NP-hard, but carts here are tens of cards and a handful
 * of sellers, so a greedy pass plus a "drop each seller and retry" local
 * search is enough — and, unlike an LLM, it doesn't miscount. Claude only
 * *explains* the result (see src/lib/ai/cart.ts).
 */

export interface Listing {
  id: string;
  seller: string;
  cardId: string;
  priceCents: number;
  quantity: number;
  /** Seller's shipping to the buyer, charged once per seller in the cart. */
  shippingCents: number;
  country: string;
  condition?: string;
  url?: string;
}

export interface Want {
  cardId: string;
  quantity: number;
}

export interface PlanLine {
  listing: Listing;
  quantity: number;
}

export interface SellerPlan {
  seller: string;
  country: string;
  lines: PlanLine[];
  itemsCents: number;
  shippingCents: number;
}

export interface Plan {
  sellers: SellerPlan[];
  totalCents: number;
  itemsCents: number;
  shippingCents: number;
  missing: Want[];
}

/** Assign every want to the cheapest listing among `allowedSellers`, filling stock cheapest-first. */
function assign(wants: Want[], listings: Listing[], allowedSellers: Set<string> | null): Plan {
  const bySeller = new Map<string, SellerPlan>();
  const missing: Want[] = [];
  const remainingStock = new Map(listings.map((l) => [l.id, l.quantity]));

  for (const w of wants) {
    let need = w.quantity;
    const options = listings
      .filter((l) => l.cardId === w.cardId && (allowedSellers ? allowedSellers.has(l.seller) : true))
      .sort((a, b) => a.priceCents - b.priceCents);
    for (const l of options) {
      if (need <= 0) break;
      const stock = remainingStock.get(l.id) ?? 0;
      if (stock <= 0) continue;
      const take = Math.min(stock, need);
      remainingStock.set(l.id, stock - take);
      need -= take;
      const sp = bySeller.get(l.seller) ?? { seller: l.seller, country: l.country, lines: [], itemsCents: 0, shippingCents: l.shippingCents };
      sp.lines.push({ listing: l, quantity: take });
      sp.itemsCents += take * l.priceCents;
      bySeller.set(l.seller, sp);
    }
    if (need > 0) missing.push({ cardId: w.cardId, quantity: need });
  }

  const sellers = [...bySeller.values()].sort((a, b) => b.itemsCents - a.itemsCents);
  const itemsCents = sellers.reduce((n, s) => n + s.itemsCents, 0);
  const shippingCents = sellers.reduce((n, s) => n + s.shippingCents, 0);
  return { sellers, totalCents: itemsCents + shippingCents, itemsCents, shippingCents, missing };
}

/** Lower total wins; fewer missing cards wins first. */
function better(a: Plan, b: Plan): boolean {
  const am = a.missing.reduce((n, m) => n + m.quantity, 0);
  const bm = b.missing.reduce((n, m) => n + m.quantity, 0);
  if (am !== bm) return am < bm;
  return a.totalCents < b.totalCents;
}

export function greedyOptimise(wants: Want[], listings: Listing[]): Plan {
  let best = assign(wants, listings, null);

  // Small instances (the normal case: a few dozen sellers) — evaluate every
  // 1-, 2- and 3-seller subset outright. This is what catches "one seller has
  // everything, slightly dearer per card, but only one shipping fee".
  const sellers = [...new Set(listings.map((l) => l.seller))];
  const consider = (allowed: string[]) => {
    const p = assign(wants, listings, new Set(allowed));
    if (better(p, best)) best = p;
  };
  if (sellers.length <= 40) for (const s of sellers) consider([s]);
  if (sellers.length <= 25) for (let i = 0; i < sellers.length; i++) for (let j = i + 1; j < sellers.length; j++) consider([sellers[i], sellers[j]]);
  if (sellers.length <= 12)
    for (let i = 0; i < sellers.length; i++)
      for (let j = i + 1; j < sellers.length; j++) for (let k = j + 1; k < sellers.length; k++) consider([sellers[i], sellers[j], sellers[k]]);

  // Local search: try removing each seller (consolidating onto others) while it helps.
  let improved = true;
  while (improved) {
    improved = false;
    for (const s of best.sellers) {
      const allowed = new Set(best.sellers.map((x) => x.seller));
      allowed.delete(s.seller);
      if (allowed.size === 0) continue;
      const candidate = assign(wants, listings, allowed);
      if (better(candidate, best)) {
        best = candidate;
        improved = true;
        break;
      }
    }
  }
  return best;
}

/** Alternatives to show alongside the best plan: fewest sellers, and single-seller if possible. */
export function alternatives(wants: Want[], listings: Listing[]): { fewestSellers: Plan | null } {
  const sellers = [...new Set(listings.map((l) => l.seller))];
  let fewest: Plan | null = null;
  for (const s of sellers) {
    const p = assign(wants, listings, new Set([s]));
    if (p.missing.length === 0 && (!fewest || p.totalCents < fewest.totalCents)) fewest = p;
  }
  return { fewestSellers: fewest };
}
