/**
 * Card catalog import from deckplanet — the source the `dragogodev/cgs` Card
 * Game Simulator definition points at. One JSON call per game returns every
 * card with unstyled skill text, keywords, ban/limit status, leader back sides
 * and the alternate prints of each card:
 *
 *   dbs    → `dbs_masters_cards`  (legacy BT1–BT25 + the Masters line)
 *   fusion → `fusion_world_cards` (FB/FS/FP/SB/ST sets + Energy Markers)
 *
 * The two payloads have the same shape bar three things, all handled below.
 * Fusion World prints rarities as bare codes ("SR") rather than the original
 * game's "Super Rare[SR]"; it carries no character or era lists; and its
 * energy cost arrives as a number. It also has **no images in the deckplanet
 * bucket** — those come from TCGplayer during the price sync, so the upserts
 * here `coalesce` the image columns instead of overwriting them.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cardPrints, cardSets, cards } from "@/db/schema";
import { applyOfficialImages, fetchOfficialImageNames } from "./bandai";
import { GAMES, GAME_INFO, type Game } from "./games";
import { setCodeOfNumber, setLineFor, setNameFor, setSortKey } from "./sets";

export function catalogUrl(game: Game): string {
  return `https://api.deckplanet.net/cardsearch/${GAME_INFO[game].catalogPath}?limit=100000`;
}

/** The original game's catalog, kept as a constant for the sync script. */
export const DECKPLANET_CARDS_URL = catalogUrl("dbs");
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
  /** A string in the original game's payload, a number in Fusion World's. */
  card_energy_cost?: string | number | null;
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

function cleanText(v: string | number | null | undefined): string | null {
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

/** Fusion World rarity codes, so one rarity filter can serve both games. */
const FUSION_RARITY: Record<string, string> = {
  C: "Common",
  UC: "Uncommon",
  R: "Rare",
  SR: "Super Rare",
  SCR: "Secret Rare",
  L: "Leader Rare",
  PR: "Promo",
};

/**
 * The original game names its rarities "Super Rare[SR]"; Fusion World prints
 * the code alone, with a "★" suffix for the alternate-art version. Both are
 * normalised to the "Name[CODE]" form, so `rarityCode` and the rarity dropdown
 * behave the same whichever game a card is from.
 */
export function normaliseRarity(raw: string | null, game: Game): string {
  const s = (raw ?? "").trim();
  if (!s) return UNKNOWN_RARITY;
  if (game !== "fusion" || s.includes("[")) return s;
  const star = s.endsWith("★");
  const base = star ? s.slice(0, -1) : s;
  const name = FUSION_RARITY[base.toUpperCase()];
  if (!name) return s;
  return `${name}${star ? " Alt Art" : ""}[${s}]`;
}

/**
 * Fusion World cards are not in the deckplanet image bucket. The shaper leaves
 * them null; `applyOfficialImages` (bandai.ts) then writes Bandai's own art
 * over the shaped catalog, and the price sync copies TCGplayer's photo onto
 * whatever is still missing.
 */
function imageFor(imgLink: string | null | undefined, number: string, game: Game): string | null {
  if (game === "fusion") return null;
  return `${IMAGE_BASE}${encodeURIComponent((imgLink && imgLink.trim()) || number)}.png`;
}

// ── shaping ────────────────────────────────────────────────────────────────

export interface CatalogCard {
  id: string;
  setCode: string;
  game: Game;
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
  /** Null for Fusion World out of the shaper; Bandai's art is laid on by `applyOfficialImages`. */
  imageUrl: string | null;
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
  imageUrl: string | null;
  isBase: boolean;
  deckplanetId: number | null;
}

export interface ShapedCatalog {
  game: Game;
  cards: CatalogCard[];
  prints: CatalogPrint[];
  sets: string[];
}

/**
 * Collapse the flat deckplanet list (where alternate prints appear both as
 * top-level entries *and* inside each other's `variants`) into one card per
 * base number with a de-duplicated print list.
 */
export function shapeCatalog(raw: DpCard[], game: Game = "dbs"): ShapedCatalog {
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
      rarity: v.card_rarity ? normaliseRarity(v.card_rarity, game) : (existing?.rarity ?? fallbackRarity),
      imageUrl: imageFor(v.img_link, number, game),
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
    const rarity = normaliseRarity(cleanText(c.card_rarity), game);
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
        rarity: normaliseRarity(cleanText(c.card_rarity), game),
        imageUrl: imageFor(null, base, game),
        isBase: true,
        deckplanetId: g.source?.id ?? null,
      });
    }

    const characters = cleanList(c.card_character);
    const backName = cleanText(c.card_back_name);
    const name = cleanText(c.card_name) ?? base;
    const rarity = normaliseRarity(cleanText(c.card_rarity), game);
    const searchText = [base, base.replace(/-/g, ""), name, backName ?? "", ...characters]
      .join(" ")
      .toLowerCase();

    cardsOut.push({
      id: base,
      setCode,
      game,
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
      backImageUrl: backName ? imageFor(`${base}_b`, base, game) : null,
      deckplanetId: c.id,
      searchText,
    });
    printsOut.push(...g.prints.values());
  }

  return { game, cards: cardsOut, prints: printsOut, sets: [...sets] };
}

// ── fetch + persist ────────────────────────────────────────────────────────

export async function fetchDeckplanet(game: Game = "dbs"): Promise<DpCard[]> {
  const res = await fetch(catalogUrl(game), { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`deckplanet ${game} ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { data?: DpCard[] };
  if (!Array.isArray(json.data)) throw new Error(`deckplanet ${game}: unexpected payload shape`);
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
  /** Original-game prints whose deckplanet front image was confirmed to exist. */
  frontImages?: number;
  /** Fusion World prints given Bandai's official art (bandai.ts). */
  officialImages?: number;
}

/** One summary per game, plus the totals, so the settings page reads at a glance. */
export type CatalogSyncSummaries = CatalogSyncSummary & { games: Record<Game, CatalogSyncSummary> };

/** HEAD-checks a batch of URLs and returns the ones that 404 or error. */
async function findBrokenImages(urls: Iterable<string>, concurrency: number): Promise<Set<string>> {
  const list = [...urls];
  const broken = new Set<string>();
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const url = list[next++];
      try {
        const res = await fetch(url, { method: "HEAD" });
        if (!res.ok) broken.add(url);
      } catch {
        broken.add(url);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return broken;
}

/**
 * deckplanet only hosts "<number>_b.png" for older sets, so each candidate back
 * URL is checked with a HEAD request before it is stored; a 404 becomes null
 * and the CardTrader sync may fill it in later.
 */
export async function verifyBackImages(shaped: ShapedCatalog, concurrency = 12): Promise<number> {
  const withBack = shaped.cards.filter((c) => c.backImageUrl);
  const broken = await findBrokenImages(withBack.map((c) => c.backImageUrl!), concurrency);
  for (const c of withBack) if (broken.has(c.backImageUrl!)) c.backImageUrl = null;
  return withBack.length - broken.size;
}

/**
 * Front images are guessed from deckplanet's `img_link` the same way, and
 * deckplanet's bucket turns out to lag its own catalog badly: as of Sep 2026
 * every Masters-era set from BT19 on (plus recent EX/SD sets and most promos)
 * 404s, even though the card data itself is there. Each candidate is
 * HEAD-checked before it is stored; a 404 becomes null so the price sync's
 * `fillMissingImages` can supply TCGplayer's product photo instead, rather
 * than the grid holding a link that will never resolve.
 */
export async function verifyFrontImages(shaped: ShapedCatalog, concurrency = 40): Promise<number> {
  if (shaped.game === "fusion") return 0; // deckplanet has no Fusion World art at all; imageFor already left these null
  const urls = new Set<string>();
  for (const p of shaped.prints) if (p.imageUrl) urls.add(p.imageUrl);
  const broken = await findBrokenImages(urls, concurrency);
  let kept = 0;
  for (const p of shaped.prints) {
    if (!p.imageUrl) continue;
    if (broken.has(p.imageUrl)) p.imageUrl = null;
    else kept++;
  }
  for (const c of shaped.cards) {
    if (c.imageUrl && broken.has(c.imageUrl)) c.imageUrl = null;
  }
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
        game: shaped.game,
        line: setLineFor(code, null),
        sortKey: setSortKey(code),
      })),
    )
    .onConflictDoUpdate({
      target: cardSets.code,
      // `line` is left alone: the price sync refines it from real release dates.
      set: { name: sql`excluded.name`, game: sql`excluded.game`, sortKey: sql`excluded.sort_key` },
    });

  for (const batch of chunk(shaped.cards, 250)) {
    await db
      .insert(cards)
      .values(batch)
      .onConflictDoUpdate({
        target: cards.id,
        set: {
          setCode: sql`excluded.set_code`,
          game: sql`excluded.game`,
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
          // Fusion World prints Bandai does not show arrive null here; keep the
          // TCGplayer art the price sync supplied for them. But a deckplanet
          // URL that just failed its HEAD check (verifyFrontImages) must
          // still land as null — coalesce alone would keep replaying the same
          // broken guess forever — so a stored value that is itself still a
          // deckplanet URL always yields to the fresh (possibly null) one.
          imageUrl: sql`case when ${cards.imageUrl} is null or starts_with(${cards.imageUrl}, ${IMAGE_BASE})
            then excluded.image_url else coalesce(excluded.image_url, ${cards.imageUrl}) end`,
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
          imageUrl: sql`case when ${cardPrints.imageUrl} is null or starts_with(${cardPrints.imageUrl}, ${IMAGE_BASE})
            then excluded.image_url else coalesce(excluded.image_url, ${cardPrints.imageUrl}) end`,
          isBase: sql`excluded.is_base`,
          deckplanetId: sql`excluded.deckplanet_id`,
        },
      });
  }

  return { sets: shaped.sets.length, cards: shaped.cards.length, prints: shaped.prints.length };
}

/** One game's catalog, end to end. */
export async function syncCatalogFor(db: Db, game: Game): Promise<CatalogSyncSummary> {
  const shaped = shapeCatalog(await fetchDeckplanet(game), game);
  if (game === "fusion") {
    // deckplanet hosts no Fusion World art; Bandai's card list has fronts,
    // leader backs and most alternate prints (bandai.ts).
    const official = applyOfficialImages(shaped, await fetchOfficialImageNames());
    // Backs are inferred from the leader's front, so they get the same HEAD check.
    const backImages = await verifyBackImages(shaped);
    return { ...(await importCatalog(db, shaped)), backImages, officialImages: official.prints };
  }
  // Front images are deckplanet's own guess too, and its bucket lags badly
  // for the original game (see verifyFrontImages); Fusion World has none to
  // check, so this is a no-op there.
  const frontImages = await verifyFrontImages(shaped);
  return { ...(await importCatalog(db, shaped)), backImages: await verifyBackImages(shaped), frontImages };
}

/** Both games, in order. A failure on either aborts the whole sync run. */
export async function syncCatalog(db: Db): Promise<CatalogSyncSummaries> {
  const games = {} as Record<Game, CatalogSyncSummary>;
  for (const game of GAMES) games[game] = await syncCatalogFor(db, game);
  const total = (pick: (s: CatalogSyncSummary) => number) => GAMES.reduce((n, g) => n + pick(games[g]), 0);
  return {
    games,
    sets: total((s) => s.sets),
    cards: total((s) => s.cards),
    prints: total((s) => s.prints),
    backImages: total((s) => s.backImages ?? 0),
    frontImages: total((s) => s.frontImages ?? 0),
    officialImages: total((s) => s.officialImages ?? 0),
  };
}
