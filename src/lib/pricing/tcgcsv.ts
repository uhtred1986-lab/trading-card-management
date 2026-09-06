/**
 * TCGplayer pricing via tcgcsv.com — a free daily mirror, no key needed.
 *
 * One category per game: 27 is "Dragon Ball Super: Masters", which spans the
 * whole legacy line as well, and 80 is "Dragon Ball Super: Fusion World".
 * Category 27 *also* carries a stray copy of the first Fusion World set, which
 * is skipped there because category 80 has it properly.
 *
 * Products join to the catalog on the printed card number. Prices are stored
 * as one snapshot per product/sub-type/day so the dashboard can show movers.
 *
 * This is also where Fusion World gets its **card art**: deckplanet hosts no
 * images for it, so a matched product's TCGplayer photo is copied onto any
 * card or print that still has none.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { rows } from "@/db/rows";
import { cardPrints, cardSets, cards, tcgGroups, tcgPrices, tcgProducts } from "@/db/schema";
import { baseNumber } from "@/lib/catalog/deckplanet";
import { GAMES, GAME_INFO, type Game } from "@/lib/catalog/games";
import { setCodeOfNumber, setLineFor } from "@/lib/catalog/sets";

const BASE = "https://tcgcsv.com/tcgplayer";
export const TCG_CATEGORY_ID = GAME_INFO.dbs.tcgCategoryId;

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

async function getJson<T>(categoryId: number, path: string): Promise<T[]> {
  // tcgcsv answers 401 to requests without a browser-like User-Agent.
  const res = await fetch(`${BASE}/${categoryId}/${path}`, {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 DBSCardCompanion/0.1 (+https://github.com)" },
  });
  if (!res.ok) throw new Error(`tcgcsv ${categoryId}/${path}: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { results?: T[] };
  return Array.isArray(json.results) ? json.results : [];
}

/**
 * Fusion World groups that turn up in the *original* game's category. Only one
 * does (a duplicate of FB01), and category 80 carries the real thing, so it is
 * skipped rather than imported twice under the wrong game.
 */
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
  /** Cards and prints that got their art from a TCGplayer photo this run. */
  imagesFilled?: number;
  /** Per-game breakdown; absent on a single-game run. */
  games?: Record<Game, Omit<PriceSyncSummary, "capturedOn" | "games">>;
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

/**
 * One game's TCGplayer category. `capturedOn` and the catalog lookup are
 * passed in so both games land on the same snapshot date and share one read
 * of the card/print ids.
 */
export async function syncPricesForGame(
  db: Db,
  game: Game,
  capturedOn: string,
  lookup: Lookup,
  opts: { onProgress?: (done: number, total: number, name: string) => void } = {},
): Promise<Omit<PriceSyncSummary, "capturedOn" | "games">> {
  const categoryId = GAME_INFO[game].tcgCategoryId;
  const allGroups = await getJson<TcgGroup>(categoryId, "groups");
  // Fusion World sets that stray into the original game's category belong to
  // the other category, where they are imported properly.
  const groups = game === "dbs" ? allGroups.filter((g) => !isFusionWorld(g)) : allGroups;

  await db
    .insert(tcgGroups)
    .values(
      groups.map((g) => ({
        id: g.groupId,
        categoryId,
        name: g.name,
        abbreviation: g.abbreviation ?? null,
        publishedOn: dateOnly(g.publishedOn),
        modifiedOn: g.modifiedOn ? new Date(g.modifiedOn) : null,
      })),
    )
    .onConflictDoUpdate({
      target: tcgGroups.id,
      set: {
        categoryId: sql`excluded.category_id`,
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
      getJson<TcgProduct>(categoryId, `${g.groupId}/products`),
      getJson<TcgPrice>(categoryId, `${g.groupId}/prices`),
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
    imagesFilled: await fillMissingImages(db),
  };
}

/**
 * Give cards and prints that still have no art the photo from their matched
 * TCGplayer product. Today that is the Fusion World alternate prints Bandai's
 * card list does not show (see catalog/bandai.ts) — deckplanet covers the
 * original game — but it is written for any card with a null image, so a
 * print deckplanet never uploaded gets one too.
 *
 * TCGplayer serves several sizes off one path; the catalog grid wants the big
 * one, and the stored product row keeps the thumbnail it was given.
 */
async function fillMissingImages(db: Db): Promise<number> {
  const big = sql`replace(src.image_url, '_200w.jpg', '_in_1000x1000.jpg')`;
  // A print can have several products (foil and non-foil listings); the
  // unmarked one is the plain card face, so it is preferred.
  const source = sql`
    select distinct on (p.print_id) p.print_id, p.image_url
    from tcg_products p
    where p.print_id is not null and p.image_url is not null
    order by p.print_id, (p.marker is null) desc, p.id
  `;
  const prints = rows<{ n: number }>(
    await db.execute(sql`
      with src as (${source})
      update card_prints cp set image_url = ${big}
      from src where src.print_id = cp.id and cp.image_url is null
      returning 1 as n
    `),
  ).length;
  // The card's own image is the base print's. Postgres won't let an
  // UPDATE ... FROM join reference the target table (`c`) from inside the
  // join condition, so the card_prints join is folded into its own CTE first.
  const cardsFilled = rows<{ n: number }>(
    await db.execute(sql`
      with base as (${source}),
      src as (
        select bp.card_id, base.image_url
        from base
        join card_prints bp on bp.id = base.print_id and bp.is_base
      )
      update cards c set image_url = ${big}
      from src where src.card_id = c.id and c.image_url is null
      returning 1 as n
    `),
  ).length;
  return prints + cardsFilled;
}

/** Both games, onto one snapshot date. */
export async function syncPrices(
  db: Db,
  opts: { onProgress?: (done: number, total: number, name: string) => void } = {},
): Promise<PriceSyncSummary> {
  const capturedOn = new Date().toISOString().slice(0, 10);
  const lookup = await loadLookup(db);
  const games = {} as Record<Game, Omit<PriceSyncSummary, "capturedOn" | "games">>;
  for (const game of GAMES) {
    // Group names alone don't say which game they came from, and both games
    // count their groups from one, so the progress line carries the label.
    const label = GAME_INFO[game].short;
    games[game] = await syncPricesForGame(db, game, capturedOn, lookup, {
      onProgress: opts.onProgress && ((done, total, name) => opts.onProgress!(done, total, `${label}: ${name}`)),
    });
  }
  const total = (pick: (s: Omit<PriceSyncSummary, "capturedOn" | "games">) => number) => GAMES.reduce((n, g) => n + pick(games[g]), 0);
  return {
    capturedOn,
    games,
    groups: total((s) => s.groups),
    skippedFusionWorld: total((s) => s.skippedFusionWorld),
    products: total((s) => s.products),
    matchedProducts: total((s) => s.matchedProducts),
    prices: total((s) => s.prices),
    imagesFilled: total((s) => s.imagesFilled ?? 0),
  };
}
