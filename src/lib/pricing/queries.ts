/**
 * Read-side pricing helpers. A print can have several TCGplayer products
 * (foil/non-foil versions, alt-art listings); we reduce them to one Normal and
 * one Foil USD price per print, using the newest snapshot per product.
 */
import { inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { rows } from "@/db/rows";
import { tcgProducts } from "@/db/schema";

export interface PrintPrice {
  printId: string;
  normalCents: number | null;
  foilCents: number | null;
  productId: number | null;
  capturedOn: string | null;
}

interface Row {
  print_id: string;
  product_id: number;
  marker: string | null;
  sub_type: string;
  captured_on: string;
  market_cents: number | null;
  mid_cents: number | null;
  low_cents: number | null;
}

function pick(r: Row): number | null {
  return r.market_cents ?? r.mid_cents ?? r.low_cents ?? null;
}

const isFoilMarker = (m: string | null) => !!m && /foil/.test(m) && !/non-foil/.test(m);
const isNonFoilMarker = (m: string | null) => !m || /non-foil/.test(m);
/**
 * TCGplayer names the foil sub-type "Foil" in the original game's category and
 * "Holofoil" in Fusion World's; plenty of Fusion World cards are printed *only*
 * as Holofoil, so missing this would leave them unpriced.
 */
const FOIL_SUB_TYPES = ["Foil", "Holofoil"];
const isFoilSubType = (s: string) => FOIL_SUB_TYPES.includes(s);

/** Latest Normal/Foil price per print for the given prints. */
export async function pricesForPrints(db: Db, printIds: string[]): Promise<Map<string, PrintPrice>> {
  const out = new Map<string, PrintPrice>();
  if (printIds.length === 0) return out;

  const found = rows<Row>(
    await db.execute(sql`
    select distinct on (p.id, pr.sub_type)
      p.print_id, p.id as product_id, p.marker, pr.sub_type, pr.captured_on,
      pr.market_cents, pr.mid_cents, pr.low_cents
    from ${tcgProducts} p
    join tcg_prices pr on pr.product_id = p.id
    where p.print_id in ${printIds}
    order by p.id, pr.sub_type, pr.captured_on desc
  `),
  );

  const byPrint = new Map<string, Row[]>();
  for (const r of found) {
    const list = byPrint.get(r.print_id) ?? [];
    list.push(r);
    byPrint.set(r.print_id, list);
  }

  for (const [printId, list] of byPrint) {
    // Normal: a non-foil product's Normal price, else any Normal.
    const normal =
      list.find((r) => r.sub_type === "Normal" && isNonFoilMarker(r.marker)) ??
      list.find((r) => r.sub_type === "Normal");
    // Foil: a foil-marked product's Normal price, else any foil sub-type.
    const foil =
      list.find((r) => r.sub_type === "Normal" && isFoilMarker(r.marker)) ??
      list.find((r) => isFoilSubType(r.sub_type));
    const newest = list.reduce((a, b) => (a.captured_on >= b.captured_on ? a : b));
    out.set(printId, {
      printId,
      normalCents: normal ? pick(normal) : null,
      foilCents: foil ? pick(foil) : null,
      productId: normal?.product_id ?? foil?.product_id ?? null,
      capturedOn: newest.captured_on,
    });
  }
  return out;
}

/** Convenience: base-print Normal price per card (for grids). */
export async function basePricesForCards(db: Db, cardIds: string[]): Promise<Map<string, PrintPrice>> {
  if (cardIds.length === 0) return new Map();
  const prints = await db.query.cardPrints.findMany({
    columns: { id: true, cardId: true },
    where: (p, { and, eq }) => and(inArray(p.cardId, cardIds), eq(p.isBase, true)),
  });
  const byPrint = await pricesForPrints(
    db,
    prints.map((p) => p.id),
  );
  const out = new Map<string, PrintPrice>();
  for (const p of prints) {
    const price = byPrint.get(p.id);
    if (price) out.set(p.cardId, price);
  }
  return out;
}

/** Price a specific lot: foil lots use the foil price when one exists. */
export function priceForFinish(p: PrintPrice | undefined, finish: string): number | null {
  if (!p) return null;
  if (finish === "foil") return p.foilCents ?? p.normalCents;
  return p.normalCents ?? p.foilCents;
}

/**
 * Market price of the base print of each card on a given past date (or the
 * nearest earlier snapshot), for "movers". Returns USD cents.
 */
export async function basePricesAsOf(db: Db, cardIds: string[], asOf: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (cardIds.length === 0) return out;
  const found = rows<{ card_id: string; market_cents: number | null; mid_cents: number | null; low_cents: number | null }>(
    await db.execute(sql`
    select distinct on (c.id)
      c.id as card_id, pr.market_cents, pr.mid_cents, pr.low_cents
    from cards c
    join card_prints cp on cp.card_id = c.id and cp.is_base
    join tcg_products p on p.print_id = cp.id and (p.marker is null or p.marker like '%non-foil%')
    join tcg_prices pr on pr.product_id = p.id and pr.sub_type in ('Normal', 'Holofoil') and pr.captured_on <= ${asOf}
    where c.id in ${cardIds}
    -- Newest snapshot wins; a Fusion World card printed only as Holofoil falls
    -- back to that rather than dropping out of the movers list entirely.
    order by c.id, pr.captured_on desc, (pr.sub_type = 'Normal') desc
  `),
  );
  for (const r of found) {
    const v = r.market_cents ?? r.mid_cents ?? r.low_cents;
    if (v != null) out.set(r.card_id, v);
  }
  return out;
}
