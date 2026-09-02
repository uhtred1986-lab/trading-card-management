/**
 * Card catalog import from deckplanet — the source the `dragogodev/cgs` Card
 * Game Simulator definition points at. One JSON call returns every Dragon Ball
 * Super card (legacy + Masters, no Fusion World) with unstyled skill text,
 * keywords, ban/limit status, leader back sides, and the alternate prints of
 * each card. Images are hosted per print at a stable public bucket.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cardPrints, cardSets, cards } from "@/db/schema";
import { setCodeOfNumber, setLineFor, setNameFor, setSortKey } from "./sets";

export const DECKPLANET_CARDS_URL =
  "https://api.deckplanet.net/cardsearch/dbs_masters_cards?limit=100000";
const IMAGE_BASE = "https://storage.googleapis.com/deckplanet_card_images/";

interface DpVariant {
  id?: number;
  card_number: string;
  card_rarity?: string | null;
  img_link?: string | null;
}

interface DpCard extends DpVariant {
  id: number;
  card_name?: string | null;
  card_type?: string | null;
  card_color?: string | null;
  card_energy_cost?: string | null;
  z_energy_cost?: string | null;
  card_power?: string | null;
  card_combo_cost?: string | null;
  card_combo_power?: string | null;
  card_skill_unstyled?: string | null;
  card_character?: string[] | null;
  card_traits?: string[] | null;
  card_era?: string[] | null;
  keywords?: string[] | null;
  card_rarity?: string | null;
  card_series?: string | null;
  limited_to?: number | null;
  is_banned?: boolean | null;
  is_limited?: boolean | null;
  has_errata?: boolean | null;
  is_horizontal?: boolean | null;
  card_back_name?: string | null;
  card_back_skill_unstyled?: string | null;
  card_back_power?: string | null;
  variant_of?: number | null;
  variants?: DpVariant[] | null;
}

// ── normalisation ──────────────────────────────────────────────────────────

const EMPTY = new Set(["", "-", "　", "null", "undefined"]);

function cleanText(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return EMPTY.has(s) ? null : s;
}

function cleanInt(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const m = /-?\d+/.exec(String(v).replace(/,/g, ""));
  return m ? Number(m[0]) : null;
}

function cleanList(v: string[] | null | undefined): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((s) => String(s).trim()).filter((s) => s && !EMPTY.has(s));
}

/** "BT18-020_SPR" → "BT18-020"; tokens ("T_CLO_01") are their own base. */
export function baseNumber(n: string): string {
  const s = n.trim();
  if (s.startsWith("T_")) return s;
  return s.split("_")[0];
}

export function printSuffix(n: string): string {
  const s = n.trim();
  if (s.startsWith("T_")) return "";
  const i = s.indexOf("_");
  return i < 0 ? "" : s.slice(i + 1);
}

export function printLabel(suffix: string): string {
  if (!suffix) return "Standard";
  const u = suffix.toUpperCase();
  if (u === "PR") return "Parallel";
  if (/^PR\d+$/.test(u)) return `Parallel ${u.slice(2)}`;
  if (u === "PR_B") return "Parallel (b)";
  if (u === "SPR") return "Special Rare";
  if (u === "SPR_S") return "Special Rare (S)";
  if (/^SPR\d+$/.test(u)) return `Special Rare ${u.slice(3)}`;
  if (u === "SLR") return "Special Leader Rare";
  if (u === "GDR") return "God Rare";
  if (u === "GOLD") return "Gold";
  return suffix;
}

const UNKNOWN_RARITY = "Unknown";

function rarityCode(rarity: string): string {
  const m = /\[(.+?)\]/.exec(rarity);
  return m ? m[1] : rarity.trim() || "?";
}

function imageFor(imgLink: string | null | undefined, number: string): string {
  return `${IMAGE_BASE}${encodeURIComponent((imgLink && imgLink.trim()) || number)}.png`;
}

// ── shaping ────────────────────────────────────────────────────────────────

export interface CatalogCard {
  id: string;
  setCode: string;
  name: string;
  cardType: string;
  colors: string[];
  energyCost: string | null;
  zEnergyCost: string | null;
  power: number | null;
  comboCost: number | null;
  comboPower: number | null;
  skill: string | null;
  characters: string[];
  traits: string[];
  eras: string[];
  keywords: string[];
  rarity: string;
  rarityCode: string;
  limitedTo: number | null;
  isBanned: boolean;
  isLimited: boolean;
  hasErrata: boolean;
  isHorizontal: boolean;
  backName: string | null;
  backSkill: string | null;
  backPower: number | null;
  imageUrl: string;
  backImageUrl: string | null;
  deckplanetId: number;
  searchText: string;
}

export interface CatalogPrint {
  id: string;
  cardId: string;
  suffix: string;
  label: string;
  rarity: string;
  imageUrl: string;
  isBase: boolean;
  deckplanetId: number | null;
}

export interface ShapedCatalog {
  cards: CatalogCard[];
  prints: CatalogPrint[];
  sets: string[];
}

/**
 * Collapse the flat deckplanet list (where alternate prints appear both as
 * top-level entries *and* inside each other's `variants`) into one card per
 * base number with a de-duplicated print list.
 */
export function shapeCatalog(raw: DpCard[]): ShapedCatalog {
  type Group = { source: DpCard | null; fallback: DpCard; prints: Map<string, CatalogPrint> };
  const groups = new Map<string, Group>();

  const addPrint = (g: Group, base: string, v: DpVariant, fallbackRarity: string) => {
    const number = v.card_number.trim();
    if (baseNumber(number) !== base) return; // a reprint under a different number is its own card
    const suffix = printSuffix(number);
    const existing = g.prints.get(number);
    const print: CatalogPrint = {
      id: number,
      cardId: base,
      suffix,
      label: printLabel(suffix),
      rarity: cleanText(v.card_rarity) ?? existing?.rarity ?? fallbackRarity,
      imageUrl: imageFor(v.img_link, number),
      isBase: suffix === "",
      deckplanetId: v.id ?? existing?.deckplanetId ?? null,
    };
    g.prints.set(number, print);
  };

  for (const c of raw) {
    const number = c.card_number.trim();
    const base = baseNumber(number);
    let g = groups.get(base);
    if (!g) {
      g = { source: null, fallback: c, prints: new Map() };
      groups.set(base, g);
    }
    if (number === base) g.source = c;
    const rarity = cleanText(c.card_rarity) ?? UNKNOWN_RARITY;
    addPrint(g, base, c, rarity);
    for (const v of c.variants ?? []) addPrint(g, base, v, rarity);
  }

  const cardsOut: CatalogCard[] = [];
  const printsOut: CatalogPrint[] = [];
  const sets = new Set<string>();

  for (const [base, g] of groups) {
    const c = g.source ?? g.fallback;
    const setCode = setCodeOfNumber(base);
    sets.add(setCode);

    // Guarantee a standard print exists even if the source only listed alt-arts.
    if (!g.prints.has(base)) {
      g.prints.set(base, {
        id: base,
        cardId: base,
        suffix: "",
        label: "Standard",
        rarity: cleanText(c.card_rarity) ?? UNKNOWN_RARITY,
        imageUrl: imageFor(null, base),
        isBase: true,
        deckplanetId: g.source?.id ?? null,
      });
    }

    const characters = cleanList(c.card_character);
    const backName = cleanText(c.card_back_name);
    const name = cleanText(c.card_name) ?? base;
    const rarity = cleanText(c.card_rarity) ?? UNKNOWN_RARITY;
    const searchText = [base, base.replace(/-/g, ""), name, backName ?? "", ...characters]
      .join(" ")
      .toLowerCase();

    cardsOut.push({
      id: base,
      setCode,
      name,
      cardType: (cleanText(c.card_type) ?? "UNKNOWN").toUpperCase(),
      colors: (cleanText(c.card_color) ?? "").split("/").map((s) => s.trim()).filter(Boolean),
      energyCost: cleanText(c.card_energy_cost),
      zEnergyCost: cleanText(c.z_energy_cost),
      power: cleanInt(c.card_power),
      comboCost: cleanInt(c.card_combo_cost),
      comboPower: cleanInt(c.card_combo_power),
      skill: cleanText(c.card_skill_unstyled),
      characters,
      traits: cleanList(c.card_traits),
      eras: cleanList(c.card_era),
      keywords: cleanList(c.keywords),
      rarity,
      rarityCode: rarityCode(rarity),
      limitedTo: c.limited_to ?? null,
      isBanned: !!c.is_banned,
      isLimited: !!c.is_limited,
      hasErrata: !!c.has_errata,
      isHorizontal: !!c.is_horizontal,
      backName,
      backSkill: cleanText(c.card_back_skill_unstyled),
      backPower: cleanInt(c.card_back_power),
      imageUrl: g.prints.get(base)!.imageUrl,
      // Leaders' awakened side lives beside the front as "<number>_b.png".
      backImageUrl: backName ? imageFor(`${base}_b`, base) : null,
      deckplanetId: c.id,
      searchText,
    });
    printsOut.push(...g.prints.values());
  }

  return { cards: cardsOut, prints: printsOut, sets: [...sets] };
}

// ── fetch + persist ────────────────────────────────────────────────────────

export async function fetchDeckplanet(): Promise<DpCard[]> {
  const res = await fetch(DECKPLANET_CARDS_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`deckplanet ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { data?: DpCard[] };
  if (!Array.isArray(json.data)) throw new Error("deckplanet: unexpected payload shape");
  return json.data;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface CatalogSyncSummary {
  sets: number;
  cards: number;
  prints: number;
  backImages?: number;
}

/**
 * deckplanet only hosts "<number>_b.png" for older sets, so each candidate back
 * URL is checked with a HEAD request before it is stored; a 404 becomes null
 * and the CardTrader sync may fill it in later.
 */
export async function verifyBackImages(shaped: ShapedCatalog, concurrency = 12): Promise<number> {
  const withBack = shaped.cards.filter((c) => c.backImageUrl);
  let kept = 0;
  let next = 0;
  const worker = async () => {
    while (next < withBack.length) {
      const c = withBack[next++];
      try {
        const res = await fetch(c.backImageUrl!, { method: "HEAD" });
        if (res.ok) kept++;
        else c.backImageUrl = null;
      } catch {
        c.backImageUrl = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, withBack.length) }, worker));
  return kept;
}

export async function importCatalog(db: Db, shaped: ShapedCatalog): Promise<CatalogSyncSummary> {
  // Sets first (cards reference them). Preserve any release date already known.
  await db
    .insert(cardSets)
    .values(
      shaped.sets.map((code) => ({
        code,
        name: setNameFor(code),
        line: setLineFor(code, null),
        sortKey: setSortKey(code),
      })),
    )
    .onConflictDoUpdate({
      target: cardSets.code,
      set: { name: sql`excluded.name`, sortKey: sql`excluded.sort_key` },
    });

  for (const batch of chunk(shaped.cards, 250)) {
    await db
      .insert(cards)
      .values(batch)
      .onConflictDoUpdate({
        target: cards.id,
        set: {
          setCode: sql`excluded.set_code`,
          name: sql`excluded.name`,
          cardType: sql`excluded.card_type`,
          colors: sql`excluded.colors`,
          energyCost: sql`excluded.energy_cost`,
          zEnergyCost: sql`excluded.z_energy_cost`,
          power: sql`excluded.power`,
          comboCost: sql`excluded.combo_cost`,
          comboPower: sql`excluded.combo_power`,
          skill: sql`excluded.skill`,
          characters: sql`excluded.characters`,
          traits: sql`excluded.traits`,
          eras: sql`excluded.eras`,
          keywords: sql`excluded.keywords`,
          rarity: sql`excluded.rarity`,
          rarityCode: sql`excluded.rarity_code`,
          limitedTo: sql`excluded.limited_to`,
          isBanned: sql`excluded.is_banned`,
          isLimited: sql`excluded.is_limited`,
          hasErrata: sql`excluded.has_errata`,
          isHorizontal: sql`excluded.is_horizontal`,
          backName: sql`excluded.back_name`,
          backSkill: sql`excluded.back_skill`,
          backPower: sql`excluded.back_power`,
          imageUrl: sql`excluded.image_url`,
          // Keep a back image the CardTrader sync supplied when deckplanet has none.
          backImageUrl: sql`coalesce(excluded.back_image_url, ${cards.backImageUrl})`,
          deckplanetId: sql`excluded.deckplanet_id`,
          searchText: sql`excluded.search_text`,
          updatedAt: sql`now()`,
        },
      });
  }

  for (const batch of chunk(shaped.prints, 500)) {
    await db
      .insert(cardPrints)
      .values(batch)
      .onConflictDoUpdate({
        target: cardPrints.id,
        set: {
          cardId: sql`excluded.card_id`,
          suffix: sql`excluded.suffix`,
          label: sql`excluded.label`,
          rarity: sql`excluded.rarity`,
          imageUrl: sql`excluded.image_url`,
          isBase: sql`excluded.is_base`,
          deckplanetId: sql`excluded.deckplanet_id`,
        },
      });
  }

  return { sets: shaped.sets.length, cards: shaped.cards.length, prints: shaped.prints.length };
}

export async function syncCatalog(db: Db): Promise<CatalogSyncSummary> {
  const raw = await fetchDeckplanet();
  const shaped = shapeCatalog(raw);
  const backImages = await verifyBackImages(shaped);
  return { ...(await importCatalog(db, shaped)), backImages };
}
