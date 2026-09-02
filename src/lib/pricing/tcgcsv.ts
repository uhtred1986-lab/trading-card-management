/**
 * TCGplayer pricing via tcgcsv.com — a free daily mirror, no key needed.
 * Category 27 is "Dragon Ball Super: Masters" and spans the whole legacy line
 * as well; it also contains the first Fusion World set, which we skip.
 *
 * Products join to the catalog on the printed card number. Prices are stored
 * as one snapshot per product/sub-type/day so the dashboard can show movers.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cardPrints, cardSets, cards, tcgGroups, tcgPrices, tcgProducts } from "@/db/schema";
import { baseNumber } from "@/lib/catalog/deckplanet";
import { setCodeOfNumber, setLineFor } from "@/lib/catalog/sets";

const BASE = "https://tcgcsv.com/tcgplayer/27";
export const TCG_CATEGORY_ID = 27;

interface TcgGroup {
  groupId: number;
  name: string;
  abbreviation?: string | null;
  publishedOn?: string | null;
  modifiedOn?: string | null;
}

interface TcgExtended {
  name: string;
  value: string;
}

interface TcgProduct {
  productId: number;
  name: string;
  imageUrl?: string | null;
  url?: string | null;
  modifiedOn?: string | null;
  extendedData?: TcgExtended[] | null;
}

interface TcgPrice {
  productId: number;
  subTypeName: string;
  marketPrice: number | null;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  directLowPrice: number | null;
}

async function getJson<T>(path: string): Promise<T[]> {
  // tcgcsv answers 401 to requests without a browser-like User-Agent.
  const res = await fetch(`${BASE}/${path}`, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 DBSCardCompanion/0.1 (+https://github.com)" },
  });
  if (!res.ok) throw new Error(`tcgcsv ${path}: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { results?: T[] };
  return Array.isArray(json.results) ? json.results : [];
}

export function isFusionWorld(g: TcgGroup): boolean {
  return /^FB|^FS|^FP/.test(g.abbreviation ?? "") || /fusion world/i.test(g.name);
}

function ext(p: TcgProduct, name: string): string | null {
  const v = p.extendedData?.find((e) => e.name === name)?.value;
  return v == null || v === "" ? null : v;
}

function toCents(v: number | null | undefined): number | null {
  return v == null ? null : Math.round(v * 100);
}

function dateOnly(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^\d{4}-\d{2}-\d{2}/.exec(s);
  return m ? m[0] : null;
}

/** "(SPR)", "(Silver Foil)" etc. from the product name, lower-cased. */
export function markerOf(name: string): string | null {
  const m = /\(([^)]+)\)\s*$/.exec(name.trim());
  return m ? m[1].trim().toLowerCase() : null;
}

/** Marker → deckplanet print suffix, when a marker denotes an alternate print. */
const MARKER_SUFFIX: Record<string, string> = {
  spr: "SPR",
  gdr: "GDR",
  slr: "SLR",
  "alternate art": "PR",
  "alt art": "PR",
  parallel: "PR",
};

export interface Lookup {
  printIds: Map<string, string>; // upper-cased print id → real id
  cardIds: Set<string>;
}

export async function loadLookup(db: Db): Promise<Lookup> {
  const prints = await db.select({ id: cardPrints.id }).from(cardPrints);
  const cardRows = await db.select({ id: cards.id }).from(cards);
  return {
    printIds: new Map(prints.map((p) => [p.id.toUpperCase(), p.id])),
    cardIds: new Set(cardRows.map((c) => c.id)),
  };
}

export function matchProduct(
  number: string | null,
  name: string,
  lookup: Lookup,
): { cardId: string | null; printId: string | null } {
  if (!number) return { cardId: null, printId: null };
  const n = number.trim().replace(/\s+/g, "");
  const base = baseNumber(n);
  const cardId = lookup.cardIds.has(base) ? base : null;
  if (!cardId) return { cardId: null, printId: null };

  // 1. The number itself carries a print suffix ("BT6-060_PR").
  if (n !== base) {
    const direct = lookup.printIds.get(n.toUpperCase());
    if (direct) return { cardId, printId: direct };
  }

  // 2. A marker in the name names a print ("… (SPR)").
  const marker = markerOf(name);
  const suffix = marker ? MARKER_SUFFIX[marker] : undefined;
  if (suffix) {
    const alt = lookup.printIds.get(`${base}_${suffix}`.toUpperCase());
    if (alt) return { cardId, printId: alt };
  }

  // 3. Otherwise it's the standard print.
  const std = lookup.printIds.get(base.toUpperCase());
  return { cardId, printId: std ?? null };
}

export interface PriceSyncSummary {
  groups: number;
  skippedFusionWorld: number;
  products: number;
  matchedProducts: number;
  prices: number;
  capturedOn: string;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function syncPrices(
  db: Db,
  opts: { onProgress?: (done: number, total: number, name: string) => void } = {},
): Promise<PriceSyncSummary> {
  const capturedOn = new Date().toISOString().slice(0, 10);
  const allGroups = await getJson<TcgGroup>("groups");
  const groups = allGroups.filter((g) => !isFusionWorld(g));
  const lookup = await loadLookup(db);

  await db
    .insert(tcgGroups)
    .values(
      groups.map((g) => ({
        id: g.groupId,
        name: g.name,
        abbreviation: g.abbreviation ?? null,
        publishedOn: dateOnly(g.publishedOn),
        modifiedOn: g.modifiedOn ? new Date(g.modifiedOn) : null,
      })),
    )
    .onConflictDoUpdate({
      target: tcgGroups.id,
      set: {
        name: sql`excluded.name`,
        abbreviation: sql`excluded.abbreviation`,
        publishedOn: sql`excluded.published_on`,
        modifiedOn: sql`excluded.modified_on`,
      },
    });

  let products = 0;
  let matched = 0;
  let prices = 0;
  let done = 0;
  /** Earliest group release per set prefix, to backfill card_sets.released_on. */
  const setDates = new Map<string, string>();

  await mapLimit(groups, 4, async (g) => {
    const [prodList, priceList] = await Promise.all([
      getJson<TcgProduct>(`${g.groupId}/products`),
      getJson<TcgPrice>(`${g.groupId}/prices`),
    ]);

    const rows = prodList.map((p) => {
      const number = ext(p, "Number");
      const m = matchProduct(number, p.name, lookup);
      if (m.cardId) {
        matched++;
        const code = setCodeOfNumber(baseNumber(number!.trim()));
        const d = dateOnly(g.publishedOn);
        if (d && (!setDates.has(code) || d < setDates.get(code)!)) setDates.set(code, d);
      }
      return {
        id: p.productId,
        groupId: g.groupId,
        name: p.name,
        number,
        rarity: ext(p, "Rarity"),
        imageUrl: p.imageUrl ?? null,
        url: p.url ?? null,
        marker: markerOf(p.name),
        cardId: m.cardId,
        printId: m.printId,
        modifiedOn: p.modifiedOn ? new Date(p.modifiedOn) : null,
      };
    });
    products += rows.length;

    if (rows.length) {
      await db
        .insert(tcgProducts)
        .values(rows)
        .onConflictDoUpdate({
          target: tcgProducts.id,
          set: {
            groupId: sql`excluded.group_id`,
            name: sql`excluded.name`,
            number: sql`excluded.number`,
            rarity: sql`excluded.rarity`,
            imageUrl: sql`excluded.image_url`,
            url: sql`excluded.url`,
            marker: sql`excluded.marker`,
            cardId: sql`excluded.card_id`,
            printId: sql`excluded.print_id`,
            modifiedOn: sql`excluded.modified_on`,
          },
        });
    }

    const known = new Set(rows.map((r) => r.id));
    const priceRows = priceList
      .filter((p) => known.has(p.productId))
      .map((p) => ({
        productId: p.productId,
        subType: p.subTypeName,
        capturedOn,
        marketCents: toCents(p.marketPrice),
        lowCents: toCents(p.lowPrice),
        midCents: toCents(p.midPrice),
        highCents: toCents(p.highPrice),
        directLowCents: toCents(p.directLowPrice),
      }));
    prices += priceRows.length;

    if (priceRows.length) {
      await db
        .insert(tcgPrices)
        .values(priceRows)
        .onConflictDoUpdate({
          target: [tcgPrices.productId, tcgPrices.subType, tcgPrices.capturedOn],
          set: {
            marketCents: sql`excluded.market_cents`,
            lowCents: sql`excluded.low_cents`,
            midCents: sql`excluded.mid_cents`,
            highCents: sql`excluded.high_cents`,
            directLowCents: sql`excluded.direct_low_cents`,
          },
        });
    }

    done++;
    opts.onProgress?.(done, groups.length, g.name);
  });

  // Backfill set release dates + line classification where unknown.
  for (const [code, releasedOn] of setDates) {
    await db
      .update(cardSets)
      .set({ releasedOn, line: setLineFor(code, releasedOn) })
      .where(and(eq(cardSets.code, code), isNull(cardSets.releasedOn)));
  }

  return {
    groups: groups.length,
    skippedFusionWorld: allGroups.length - groups.length,
    products,
    matchedProducts: matched,
    prices,
    capturedOn,
  };
}
