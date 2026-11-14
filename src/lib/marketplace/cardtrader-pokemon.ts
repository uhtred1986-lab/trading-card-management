/**
 * CardTrader listings for Pokémon cards (docs/pokemon/plan.md §3 step 1 and §8).
 *
 * Pokémon is a separate CardTrader game with far too many blueprints to sync, so nothing here reads
 * `ct_blueprints` first. A stored Pokémon print carries `card_prints.ct_blueprint_id`, the number
 * TCGdex reports as `thirdParty.cardtrader`. **That mapping is unproven** (nobody has checked it
 * against CardTrader), so there are two paths:
 *
 *  1. **Direct:** `marketplace/products?blueprint_id=<ct_blueprint_id>`. Trusted only when it
 *     returns products and at least one product's name matches the card (and its collector number
 *     too, when the product or a stored blueprint says one).
 *  2. **Fallback**, when the direct id returns nothing or a product that is not this card: find the
 *     blueprint by CardTrader expansion (the set's name or code) and collector number, as the Dragon
 *     Ball crosswalk does (`blueprints/export?expansion_id=`). When it finds one, the corrected id
 *     is stored on the print, and the listings come from it.
 *
 * Rows go through the existing tables with no schema change: `ct_blueprints.expansion_id` is
 * nullable, so a blueprint found by the direct path is written without an expansion, and the
 * fallback writes the `ct_expansions` row it found. CardTrader stays read-only and gated by
 * `CARDTRADER_ENABLED`, like the rest of the client; the optimiser is not touched.
 */
import { and, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cardPrints, cards, ctBlueprints, ctExpansions, ctListings } from "@/db/schema";
import { pokemonDetails, tcgdexIdOf } from "@/lib/pokemon/types";
import { setIdOf } from "@/lib/pokemon/tcgdex";
import { blueprintsForExpansion, cachedListings, expansions, games, listingRowOf, pause, productsForBlueprint, type CachedListing, type CtBlueprint, type CtExpansion, type CtProduct } from "./cardtrader";

// ── pure matching helpers (tested without a database) ────────────────────────

/** Lower-case, accents and punctuation folded away: "Pokémon-ex" and "pokemon ex" compare equal. */
export function foldName(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Does a CardTrader card name say this card? Either name (German or English) may lead the other,
 * since CardTrader adds finishes and versions to a name ("Charizard ex (Full Art)").
 */
export function nameMatches(ctName: string | null | undefined, names: readonly (string | null | undefined)[]): boolean {
  const c = foldName(ctName);
  if (!c) return false;
  return names.some((n) => {
    const f = foldName(n);
    return !!f && (c === f || c.startsWith(`${f} `) || f.startsWith(`${c} `));
  });
}

/** "006/165" and "6" are the same number; "SWSH001" and "SWSH1" too. Null when nothing readable. */
export function normalNumber(v: unknown): string | null {
  if (v == null) return null;
  const head = String(v).trim().toUpperCase().split("/")[0].trim();
  if (!head) return null;
  const m = /^([A-Z]*)0*(\d+)$/.exec(head);
  return m ? `${m[1]}${m[2]}` : head;
}

/** The collector number a blueprint's fixed properties carry, normalised. */
export function blueprintNumber(bp: Pick<CtBlueprint, "fixed_properties">): string | null {
  const fp = bp.fixed_properties ?? {};
  return normalNumber(fp.collector_number ?? fp.number ?? null);
}

/** The collector number a product carries in its properties, when it carries one at all. */
export function productNumber(p: CtProduct): string | null {
  const ph = p.properties_hash ?? {};
  return normalNumber(ph.collector_number ?? ph.number ?? null);
}

export interface PokemonCardInfo {
  cardId: string;
  /** Every name the card has (German and English). */
  names: string[];
  /** The collector number as printed on the card, normalised. */
  number: string | null;
  setId: string | null;
  setNames: string[];
}

export interface PokemonPrintRef {
  id: string;
  suffix: string;
  ctBlueprintId: number | null;
}

/** Is the direct answer this card? Needs a product whose name matches, and no product that names another number. */
export function directAnswerMatches(products: CtProduct[], info: Pick<PokemonCardInfo, "names" | "number">, storedBlueprintNumber: string | null): boolean {
  if (products.length === 0) return false;
  if (!products.some((p) => nameMatches(p.name_en, info.names))) return false;
  if (info.number) {
    const seen = [storedBlueprintNumber, ...products.map(productNumber)].filter((n): n is string => !!n);
    if (seen.length && !seen.includes(info.number)) return false;
  }
  return true;
}

/** Pick the CardTrader expansion(s) of a set: by name first, then by code against the TCGdex set id. */
export function expansionCandidates(all: CtExpansion[], info: Pick<PokemonCardInfo, "setNames" | "setId">): CtExpansion[] {
  const names = info.setNames.map(foldName).filter(Boolean);
  const byName = all.filter((e) => names.includes(foldName(e.name)));
  if (byName.length) return byName.slice(0, 3);
  const id = (info.setId ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return id ? all.filter((e) => (e.code ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") === id).slice(0, 3) : [];
}

/** The blueprints of one expansion that are this card: the same collector number and a matching name. */
export function blueprintsOfCard(bps: CtBlueprint[], info: Pick<PokemonCardInfo, "names" | "number">): CtBlueprint[] {
  if (!info.number) return [];
  return bps.filter((bp) => blueprintNumber(bp) === info.number && nameMatches(bp.name, info.names)).sort((a, b) => a.id - b.id);
}

// ── reading the card ─────────────────────────────────────────────────────────

/** What the matching needs from a stored Pokémon card, or null when it is not one (or not stored). */
export async function pokemonCardInfo(db: Db, cardId: string): Promise<PokemonCardInfo | null> {
  const [row] = await db.select({ name: cards.name, details: cards.details }).from(cards).where(eq(cards.id, cardId)).limit(1);
  if (!row) return null;
  const d = pokemonDetails(row.details);
  const names = [...new Set([d.names?.de, d.names?.en, row.name].filter((n): n is string => !!n))];
  const tcgdexId = d.tcgdexId ?? tcgdexIdOf(cardId);
  const localId = d.localId ?? null;
  return {
    cardId,
    names,
    number: normalNumber(localId),
    setId: tcgdexId ? setIdOf(tcgdexId, localId) : null,
    setNames: [...new Set(Object.values(d.setNames ?? {}).filter((n): n is string => !!n))],
  };
}

// ── the refresh ──────────────────────────────────────────────────────────────

export type PokemonPath = "direct" | "fallback" | "none";

export interface PokemonPrintReport {
  printId: string;
  /** The id the print carried before this run. */
  storedBlueprintId: number | null;
  /** The id the listings came from (null when no blueprint was found). */
  blueprintId: number | null;
  path: PokemonPath;
  /** True when the stored id was replaced by the one the fallback found. */
  corrected: boolean;
  /** Plain words for the owner: why the fallback ran, or why nothing was found. */
  note: string | null;
  listings: number;
}

export interface PokemonRefresh {
  listings: CachedListing[];
  prints: PokemonPrintReport[];
}

/** A read the owner's token is refused for or that finds no such blueprint is "nothing", not a failure. */
const isMissing = (err: unknown) => err instanceof Error && /CardTrader [^:]+: (400|404|422) /.test(err.message);

async function productsOf(blueprintId: number, wait: (ms: number) => Promise<void>): Promise<CtProduct[]> {
  try {
    const res = await productsForBlueprint(blueprintId);
    await wait(110); // 10 req/s ceiling on this endpoint
    return Object.values(res ?? {}).flat();
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

interface Found {
  blueprint: CtBlueprint;
  expansion: CtExpansion;
  /** How many blueprints of that expansion carry the same number and name (more than one is ambiguous). */
  matches: number;
}

/** The fallback: CardTrader expansion by set, blueprint by collector number and name. Null when nothing fits. */
export async function findBlueprintByNumber(info: PokemonCardInfo, wait: (ms: number) => Promise<void> = pause): Promise<Found | null> {
  if (!info.number) return null;
  const all = await games();
  const game = all.find((g) => /pok[eé]mon/i.test(g.display_name) && !/japan/i.test(g.display_name)) ?? all.find((g) => /pok[eé]mon/i.test(g.display_name));
  if (!game) return null;
  const exps = expansionCandidates((await expansions()).filter((e) => e.game_id === game.id), info);
  for (const e of exps) {
    const bps = await blueprintsForExpansion(e.id);
    await wait(120);
    const hit = blueprintsOfCard(bps, info);
    if (hit.length) return { blueprint: hit[0], expansion: e, matches: hit.length };
  }
  return null;
}

/**
 * Fetch live listings for every print of a Pokémon card and replace the cache for it (the Pokémon
 * twin of `refreshListingsForCard`). Direct path first, fallback when the direct id is unusable;
 * the corrected id is stored on the print. Returns the cached listings and a per-print report.
 */
export async function refreshPokemonListings(db: Db, cardId: string, opts: { pause?: (ms: number) => Promise<void> } = {}): Promise<PokemonRefresh> {
  const wait = opts.pause ?? pause;
  const info = await pokemonCardInfo(db, cardId);
  if (!info) return { listings: [], prints: [] };
  const prints: PokemonPrintRef[] = await db.select({ id: cardPrints.id, suffix: cardPrints.suffix, ctBlueprintId: cardPrints.ctBlueprintId }).from(cardPrints).where(eq(cardPrints.cardId, cardId)).orderBy(cardPrints.id);
  const stored = new Map(
    (await db.select({ id: ctBlueprints.id, fp: ctBlueprints.fixedProperties }).from(ctBlueprints).where(eq(ctBlueprints.cardId, cardId))).map((b) => [b.id, blueprintNumber({ fixed_properties: (b.fp as Record<string, unknown> | null) ?? null })] as const),
  );

  const fresh = new Map<number, typeof ctListings.$inferInsert>();
  const reports: PokemonPrintReport[] = [];
  const used = new Set<number>();
  /** Fallback answer shared by prints of the same card (one lookup, not one per variant). */
  let fallbackMemo: Found | null | undefined;
  const fallback = async () => (fallbackMemo === undefined ? (fallbackMemo = await findBlueprintByNumber(info, wait)) : fallbackMemo);

  for (const print of prints) {
    const report: PokemonPrintReport = { printId: print.id, storedBlueprintId: print.ctBlueprintId, blueprintId: print.ctBlueprintId, path: "none", corrected: false, note: null, listings: 0 };
    let blueprintId = print.ctBlueprintId;
    let products: CtProduct[] = [];
    let trusted = false;
    let found: Found | null = null;

    if (blueprintId != null) {
      products = await productsOf(blueprintId, wait);
      trusted = directAnswerMatches(products, info, stored.get(blueprintId) ?? null);
      if (trusted) report.path = "direct";
      else report.note = products.length === 0 ? "The stored CardTrader id returned no listings; looked the card up by expansion and number." : "The stored CardTrader id returned another card; looked the card up by expansion and number.";
    } else {
      report.note = "No CardTrader id stored for this variant; looked the card up by expansion and number.";
    }

    if (!trusted) {
      found = await fallback();
      if (found) {
        report.path = "fallback";
        if (found.blueprint.id !== blueprintId) {
          blueprintId = found.blueprint.id;
          report.corrected = blueprintId !== print.ctBlueprintId;
          products = await productsOf(blueprintId, wait);
        }
        // Same id as stored: the direct answer was simply empty (nobody sells it right now), keep it.
        if (found.matches > 1) report.note = `${report.note ?? ""} ${found.matches} blueprints fit; used the lowest id.`.trim();
        else report.note = null;
      } else {
        // Nothing fits: whatever the stored id returned is not trusted, so no listings for this print.
        products = [];
        blueprintId = print.ctBlueprintId;
        report.path = "none";
        report.note = `${report.note ?? ""} No CardTrader blueprint found by expansion and number.`.trim();
      }
    }

    report.blueprintId = report.path === "none" ? null : blueprintId;
    if (report.path === "none" || blueprintId == null) {
      reports.push(report);
      continue;
    }

    // The blueprint row the listings point at (foreign key), and the print's corrected id.
    if (found) {
      await db
        .insert(ctExpansions)
        .values({ id: found.expansion.id, gameId: found.expansion.game_id, code: found.expansion.code, name: found.expansion.name })
        .onConflictDoNothing();
    }
    const bp = found && found.blueprint.id === blueprintId ? found.blueprint : null;
    await db
      .insert(ctBlueprints)
      .values({
        id: blueprintId,
        expansionId: bp ? found!.expansion.id : null,
        name: bp?.name ?? products[0]?.name_en ?? info.names[0],
        version: bp?.version ?? null,
        imageUrl: bp?.image_url ?? null,
        fixedProperties: bp?.fixed_properties ?? null,
        cardId,
        printId: print.id,
        matchedBy: report.path === "fallback" ? "expansion-number" : "blueprint-id",
      })
      .onConflictDoUpdate({
        target: ctBlueprints.id,
        set: {
          cardId: sql`excluded.card_id`,
          printId: sql`excluded.print_id`,
          matchedBy: sql`excluded.matched_by`,
          name: sql`excluded.name`,
          expansionId: sql`coalesce(excluded.expansion_id, ${ctBlueprints.expansionId})`,
          fixedProperties: sql`coalesce(excluded.fixed_properties, ${ctBlueprints.fixedProperties})`,
        },
      });
    if (report.corrected) await db.update(cardPrints).set({ ctBlueprintId: blueprintId }).where(eq(cardPrints.id, print.id));
    used.add(blueprintId);
    for (const p of products) fresh.set(p.id, listingRowOf(p, cardId));
    report.listings = products.length;
    reports.push(report);
  }

  await db.transaction(async (tx) => {
    await tx.delete(ctListings).where(eq(ctListings.cardId, cardId));
    if (fresh.size) await tx.insert(ctListings).values([...fresh.values()]);
    // A blueprint this card pointed at before and no longer does (a corrected id) is unlinked, not deleted.
    const keep = [...used];
    await tx
      .update(ctBlueprints)
      .set({ cardId: null, printId: null })
      .where(keep.length ? and(eq(ctBlueprints.cardId, cardId), notInArray(ctBlueprints.id, keep)) : eq(ctBlueprints.cardId, cardId));
  });
  return { listings: await cachedListings(db, [cardId]), prints: reports };
}

/** The print each cached listing of a Pokémon card belongs to, by blueprint id (for "cheapest variant"). */
export async function printsByBlueprint(db: Db, cardId: string): Promise<Map<number, { printId: string; suffix: string }>> {
  const rows = await db.select({ id: cardPrints.id, suffix: cardPrints.suffix, bp: cardPrints.ctBlueprintId }).from(cardPrints).where(and(eq(cardPrints.cardId, cardId), isNotNull(cardPrints.ctBlueprintId)));
  return new Map(rows.map((r) => [r.bp as number, { printId: r.id, suffix: r.suffix }]));
}
