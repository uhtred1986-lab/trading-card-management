/**
 * The live Pokémon source: TCGdex (`https://api.tcgdex.net/v2/{de|en}/...`, no key).
 * docs/pokemon/plan.md §3 and docs/architecture/catalog-and-sync.md ("Pokémon: live source").
 *
 * Two halves in one file, so a test can use the second without the network:
 *
 * - **Pure mappers** (`hitFromTcgdex`, `detailsFromTcgdex`, `variantsFromTcgdex`,
 *   `recordFromTcgdex`, `mergeSearchHits`, `parseSearchQuery`): raw TCGdex JSON in, the shapes of
 *   `./types.ts` out. No fetch, no database, no Next.
 * - **Reads** (`searchPokemon`, `getPokemonCard`, `listPokemonSets`, `getPokemonSet`): one `fetch`
 *   per source call, cached about a day through Next's fetch cache (`next.revalidate`). Outside Next
 *   (the `assert` scripts) the option is simply ignored, so a test stubs `globalThis.fetch`.
 *
 * Language: the Pokémon screens are German, her cards are German and English mixed. A search asks
 * both languages and merges by TCGdex id. Language-neutral facts (stage, basic Energy, one-per-deck,
 * `evolveFrom`, legality, variants, prices) come from the English record; display strings and
 * `cards.name` prefer the German one.
 *
 * What a search result cannot say: TCGdex's list endpoint returns only id, localId, name and image.
 * So a hit from a search carries no price, no variant list and no legality (`priceCents` /
 * `lowCents` null, `variants` empty, `legal` null; the card read, `getPokemonCard`, fills them).
 * `category` and the first of `types` are known only when the search filtered on them (otherwise
 * the category is a guess from the name: an Energy by its name, anything else Pokémon) and the set
 * name and size come from the cached set list, never from one request per hit.
 */
import {
  POKEMON_VARIANTS,
  pokemonCardId,
  pokemonImage,
  type PokemonAttack,
  type PokemonCategory,
  type PokemonDetails,
  type PokemonFormat,
  type PokemonHit,
  type PokemonLang,
  type PokemonVariant,
} from "./types";

const BASE = "https://api.tcgdex.net/v2";
/** Every outbound read is reused for about a day (the card text and the set list barely move; prices are refreshed nightly by `refreshPokemonCards`). */
export const SOURCE_REVALIDATE_SECONDS = 24 * 60 * 60;
const TIMEOUT_MS = 8000;
/** Hits asked for per language and page. */
export const PAGE_SIZE = 40;
const MAX_PAGE = 50;

// ── Errors ───────────────────────────────────────────────────────────────────

export type PokemonSourceErrorKind = "unavailable" | "timeout" | "not_found" | "bad_response";

/** The source did not answer usefully. Screens say "Suche gerade nicht erreichbar"; collection and decks keep working. */
export class PokemonSourceError extends Error {
  constructor(
    message: string,
    readonly kind: PokemonSourceErrorKind,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "PokemonSourceError";
  }
}

export function isPokemonSourceError(e: unknown): e is PokemonSourceError {
  return e instanceof PokemonSourceError;
}

// ── Raw shapes (only what is read) ───────────────────────────────────────────

interface RawPricing {
  cardmarket?: { unit?: string; idProduct?: number; low?: number | null; trend?: number | null; avg?: number | null; "low-holo"?: number | null; "trend-holo"?: number | null } | null;
}

interface RawVariantDetail {
  type?: string;
  subtype?: string;
  stamp?: string[];
  thirdParty?: { cardmarket?: number; tcgplayer?: number; cardtrader?: number };
  pricing?: RawPricing | null;
}

/** A list entry (search, set page): brief. */
export interface TcgdexBrief {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

/** A full card record. Every field but the id is optional: old cards, Energy and Trainers lack many. */
export interface TcgdexCard {
  id: string;
  localId?: string;
  name?: string;
  image?: string;
  category?: string;
  rarity?: string;
  set?: { id?: string; name?: string; logo?: string; symbol?: string; cardCount?: { official?: number; total?: number } };
  variants?: Partial<Record<PokemonVariant, boolean>>;
  variants_detailed?: RawVariantDetail[];
  dexId?: number[];
  hp?: number;
  types?: string[];
  evolveFrom?: string;
  stage?: string;
  suffix?: string;
  abilities?: { type?: string; name?: string; effect?: string }[];
  attacks?: { name?: string; cost?: string[]; damage?: string | number | null; effect?: string | null }[];
  weaknesses?: { type?: string; value?: string }[];
  retreat?: number;
  regulationMark?: string;
  legal?: { standard?: boolean; expanded?: boolean };
  effect?: string;
  trainerType?: string;
  energyType?: string;
  thirdParty?: { cardmarket?: number; tcgplayer?: number; cardtrader?: number };
  pricing?: RawPricing | null;
}

interface RawSetBrief {
  id: string;
  name?: string;
  logo?: string;
  symbol?: string;
  cardCount?: { official?: number; total?: number };
}

interface RawSetDetail extends RawSetBrief {
  releaseDate?: string;
  serie?: { id?: string; name?: string };
}

interface RawSerie {
  id: string;
  name?: string;
  sets?: RawSetBrief[];
}

// ── Public shapes ────────────────────────────────────────────────────────────

/** One variant of a card: what a print row is made from. */
export interface PokemonVariantInfo {
  variant: PokemonVariant;
  /** German label for the print ("Normal", "Holo", "Reverse Holo", ...). */
  label: string;
  /** TCGdex's CardTrader number for this variant (a blueprint id; plan §3 step 1). Null when the source has none. */
  ctBlueprintId: number | null;
  cardmarketId: number | null;
  /** Cardmarket trend and low in integer EUR cents; null when the source has no price for this variant. */
  priceCents: number | null;
  lowCents: number | null;
}

/** Everything one card read yields: what `ensurePokemonCard` stores and what the viewer shows. */
export interface PokemonCardRecord {
  tcgdexId: string;
  hit: PokemonHit;
  details: PokemonDetails;
  variants: PokemonVariantInfo[];
  category: PokemonCategory;
  setId: string;
  /** Set logo at the source (German when it has one), for the card page. */
  setLogo: string | null;
  /** The German rarity as printed, else the English one. */
  rarity: string | null;
  /** The English rarity, language-neutral, for `cards.rarity_code`. */
  rarityEn: string | null;
  /** The viewer-size picture (`.../high.webp`), German print preferred. */
  imageHigh: string | null;
  /** Abilities, attacks (Pokémon) or the effect (Trainer, Energy) as plain lines, for `cards.skill`. */
  skillText: string | null;
}

export interface PokemonSetInfo {
  id: string;
  /** German name when the source has one, else English. */
  name: string;
  names: Partial<Record<PokemonLang, string>>;
  logo: string | null;
  symbol: string | null;
  official: number | null;
  total: number | null;
  /** ISO date; only `getPokemonSet` knows it (the list is sorted newest first but does not carry it). */
  releaseDate: string | null;
}

export interface PokemonSearchParams {
  q?: string;
  /** A Pokémon type, in English or German ("Fire" / "Feuer"). */
  type?: string;
  /** POKEMON | TRAINER | ENERGY (any case; "Pokémon", "Energie" also work). */
  category?: string;
  /** TCGdex set id, e.g. "sv03.5". */
  setId?: string;
  page?: number;
}

// ── Vocabulary ───────────────────────────────────────────────────────────────

/** English and German type names (verified against the live source, 14 Nov 2026). */
export const POKEMON_TYPES: readonly { en: string; de: string }[] = [
  { en: "Grass", de: "Pflanze" },
  { en: "Fire", de: "Feuer" },
  { en: "Water", de: "Wasser" },
  { en: "Lightning", de: "Elektro" },
  { en: "Psychic", de: "Psycho" },
  { en: "Fighting", de: "Kampf" },
  { en: "Darkness", de: "Unlicht" },
  { en: "Metal", de: "Metall" },
  { en: "Dragon", de: "Drache" },
  { en: "Fairy", de: "Fee" },
  { en: "Colorless", de: "Farblos" },
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** A type given in either language, as the entry of `POKEMON_TYPES`; null when it is none. */
export function pokemonTypeOf(name: string | null | undefined): { en: string; de: string } | null {
  if (!name) return null;
  const n = norm(name);
  return POKEMON_TYPES.find((t) => norm(t.en) === n || norm(t.de) === n) ?? null;
}

const CATEGORY_NAMES: Record<PokemonCategory, Record<PokemonLang, string>> = {
  POKEMON: { de: "Pokémon", en: "Pokemon" },
  TRAINER: { de: "Trainer", en: "Trainer" },
  ENERGY: { de: "Energie", en: "Energy" },
};

/** "Pokemon", "Pokémon", "POKEMON", "energie", "Energy", ... to the catalog's value; null when it is none. */
export function pokemonCategoryOf(name: string | null | undefined): PokemonCategory | null {
  if (!name) return null;
  const n = norm(name);
  if (n === "pokemon") return "POKEMON";
  if (n === "trainer") return "TRAINER";
  if (n === "energy" || n === "energie") return "ENERGY";
  return null;
}

const VARIANT_LABELS: Record<PokemonVariant, string> = {
  normal: "Normal",
  holo: "Holo",
  reverse: "Reverse Holo",
  firstEdition: "1. Edition",
  wPromo: "W-Promo",
};

export function pokemonVariantLabel(variant: PokemonVariant): string {
  return VARIANT_LABELS[variant];
}

// ── Mappers ──────────────────────────────────────────────────────────────────

/** Euros as the source prints them (7.76) to integer cents (776). Zero and negatives are "no price". */
export function eurosToCents(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
}

/** "sv03.5-006" -> "sv03.5": the id is the set id, a dash and the local id. */
export function setIdOf(tcgdexId: string, localId?: string | null): string {
  if (localId && tcgdexId.endsWith(`-${localId}`)) return tcgdexId.slice(0, tcgdexId.length - localId.length - 1);
  const cut = tcgdexId.lastIndexOf("-");
  return cut > 0 ? tcgdexId.slice(0, cut) : tcgdexId;
}

function categoryOfRecord(de: TcgdexCard | null, en: TcgdexCard | null): PokemonCategory {
  return pokemonCategoryOf(en?.category) ?? pokemonCategoryOf(de?.category) ?? (en?.hp ?? de?.hp ? "POKEMON" : en?.energyType || de?.energyType ? "ENERGY" : en?.trainerType || de?.trainerType ? "TRAINER" : "POKEMON");
}

/** ACE SPEC / Radiant: one per deck. Read from the English rarity and name (language-neutral). */
function onePerDeckOf(en: TcgdexCard | null, de: TcgdexCard | null): PokemonDetails["onePerDeck"] {
  const rarity = en?.rarity ?? "";
  const name = en?.name ?? de?.name ?? "";
  if (/ace\s*spec/i.test(rarity)) return "ace-spec";
  if (/^radiant\s/i.test(name) || /radiant/i.test(rarity)) return "radiant";
  return null;
}

function weaknessText(c: TcgdexCard | null): string | null {
  const w = c?.weaknesses?.[0];
  return w?.type ? `${w.type}${w.value ? ` ${w.value}` : ""}` : null;
}

/**
 * `cards.details`: both names, the language-neutral rule fields from the English record and the
 * German display strings. Either record may be null (a card TCGdex has in one language only).
 */
export function detailsFromTcgdex(de: TcgdexCard | null, en: TcgdexCard | null): PokemonDetails {
  const any = en ?? de;
  if (!any) throw new PokemonSourceError("No card record", "bad_response");
  const category = categoryOfRecord(de, en);
  const kind = category === "POKEMON" ? en?.stage : category === "TRAINER" ? en?.trainerType : en?.energyType;
  const kindDe = category === "POKEMON" ? de?.stage : category === "TRAINER" ? de?.trainerType : de?.energyType;
  const abilities = (de?.abilities?.length ? de : en)?.abilities ?? [];
  const attacks = (de?.attacks?.length ? de : en)?.attacks ?? [];
  const legalSrc = en?.legal ?? de?.legal;
  const legal: Record<PokemonFormat, boolean> = { standard: legalSrc?.standard === true, expanded: legalSrc?.expanded === true };
  const lang = de ? de : en;
  return {
    tcgdexId: any.id,
    localId: any.localId ?? "",
    setTotal: any.set?.cardCount?.official ?? null,
    names: { ...(de?.name ? { de: de.name } : {}), ...(en?.name ? { en: en.name } : {}) },
    setNames: { ...(de?.set?.name ? { de: de.set.name } : {}), ...(en?.set?.name ? { en: en.set.name } : {}) },
    stage: kind ?? null,
    basicEnergy: category === "ENERGY" && (en?.energyType ?? de?.energyType)?.toLowerCase() === "normal",
    onePerDeck: onePerDeckOf(en, de),
    hp: en?.hp ?? de?.hp ?? null,
    evolveFrom: en?.evolveFrom ?? null,
    abilities: abilities.filter((a) => a.name).map((a) => ({ name: a.name!, effect: a.effect ?? null })),
    attacks: attacks.filter((a) => a.name).map((a): PokemonAttack => ({ name: a.name!, cost: a.cost ?? [], damage: a.damage === undefined || a.damage === null ? null : String(a.damage), effect: a.effect ?? null })),
    weakness: weaknessText(de) ?? weaknessText(en),
    retreat: en?.retreat ?? de?.retreat ?? null,
    regulationMark: en?.regulationMark ?? de?.regulationMark ?? null,
    legal,
    dexIds: en?.dexId ?? de?.dexId ?? [],
    display: { types: lang?.types ?? en?.types ?? [], stage: kindDe ?? kind ?? null, rarity: de?.rarity ?? en?.rarity ?? null },
  };
}

/** Plain lines for `cards.skill`: abilities and attacks of a Pokémon, the effect of a Trainer or Energy. */
export function skillTextOf(de: TcgdexCard | null, en: TcgdexCard | null): string | null {
  const src = de ?? en;
  if (!src) return null;
  const lines: string[] = [];
  for (const a of src.abilities ?? []) if (a.name) lines.push(`${a.type ? `${a.type}: ` : "Fähigkeit: "}${a.name}${a.effect ? ` – ${a.effect}` : ""}`);
  for (const a of src.attacks ?? []) {
    if (!a.name) continue;
    const cost = a.cost?.length ? `[${a.cost.join(", ")}] ` : "";
    lines.push(`${cost}${a.name}${a.damage !== undefined && a.damage !== null && a.damage !== "" ? ` ${a.damage}` : ""}${a.effect ? ` – ${a.effect}` : ""}`);
  }
  if (src.effect) lines.push(src.effect);
  return lines.length ? lines.join("\n") : null;
}

/** The variants a card exists in (English `variants` flags), in the app's order. A card with no flags is a plain "normal" one. */
export function variantsOf(en: TcgdexCard | null, de: TcgdexCard | null = null): PokemonVariant[] {
  const flags = en?.variants ?? de?.variants;
  const found = flags ? POKEMON_VARIANTS.filter((v) => flags[v] === true) : [];
  return found.length ? found : ["normal"];
}

const stampText = (v: RawVariantDetail) => (v.stamp ?? []).join(" ").toLowerCase();

/** The `variants_detailed` entry that stands for one variant: the plain print before a stamped one. */
function entryFor(variant: PokemonVariant, entries: RawVariantDetail[]): RawVariantDetail | null {
  const type = (v: RawVariantDetail) => (v.type ?? "").toLowerCase();
  const plain = (v: RawVariantDetail) => (v.stamp ?? []).length === 0;
  if (variant === "firstEdition") return entries.find((v) => /1st|first/.test(stampText(v)) || /first/.test(type(v))) ?? null;
  if (variant === "wPromo") return entries.find((v) => /w-?promo/.test(stampText(v)) || /promo/.test(type(v))) ?? null;
  return entries.find((v) => type(v) === variant.toLowerCase() && plain(v)) ?? entries.find((v) => type(v) === variant.toLowerCase()) ?? null;
}

/**
 * Trend and low (EUR) of one Cardmarket price block. A reverse print's own product prices under
 * `trend`; the card-level block keeps the reverse under `trend-holo` / `low-holo`. A normal print
 * never borrows the holo figures.
 */
function cardmarketCents(block: NonNullable<RawPricing["cardmarket"]>, variant: PokemonVariant, cardLevel: boolean): { priceCents: number | null; lowCents: number | null } {
  if (block.unit && block.unit !== "EUR") return { priceCents: null, lowCents: null };
  if (cardLevel && variant === "reverse") return { priceCents: eurosToCents(block["trend-holo"]), lowCents: eurosToCents(block["low-holo"]) };
  const holoLike = variant !== "normal";
  const priceCents = eurosToCents(block.trend) ?? (holoLike ? eurosToCents(block["trend-holo"]) : null) ?? eurosToCents(block.avg);
  const lowCents = eurosToCents(block.low) ?? (holoLike ? eurosToCents(block["low-holo"]) : null);
  return { priceCents, lowCents };
}

/** Per variant: CardTrader blueprint and Cardmarket EUR prices. */
export function variantsFromTcgdex(de: TcgdexCard | null, en: TcgdexCard | null): PokemonVariantInfo[] {
  const rec = en ?? de;
  if (!rec) return [];
  const entries = rec.variants_detailed ?? [];
  const cardPricing = rec.pricing?.cardmarket ?? null;
  return variantsOf(en, de).map((variant) => {
    const entry = entryFor(variant, entries);
    const block = entry?.pricing?.cardmarket ?? null;
    const cents = block ? cardmarketCents(block, variant, false) : cardPricing && entries.every((e) => !e.pricing) ? cardmarketCents(cardPricing, variant, true) : { priceCents: null, lowCents: null };
    return {
      variant,
      label: VARIANT_LABELS[variant],
      ctBlueprintId: entry?.thirdParty?.cardtrader ?? rec.thirdParty?.cardtrader ?? null,
      cardmarketId: entry?.thirdParty?.cardmarket ?? rec.thirdParty?.cardmarket ?? null,
      ...cents,
    };
  });
}

export interface HitOptions {
  /** The language the query matched in: the name shown; the other one becomes `altName`. */
  lang?: PokemonLang;
  /** Names of the set when the record carries none (a list entry). */
  setName?: string | null;
  setTotal?: number | null;
  category?: PokemonCategory | null;
  types?: string[];
  variants?: PokemonVariantInfo[];
}

/**
 * One tile. Works for a full record and for a list entry (`TcgdexBrief`, which is why every other
 * field is read defensively); `opts` supplies what a list entry lacks.
 */
export function hitFromTcgdex(de: TcgdexCard | TcgdexBrief | null, en: TcgdexCard | TcgdexBrief | null, opts: HitOptions = {}): PokemonHit {
  const any = (de ?? en) as TcgdexCard | null;
  if (!any) throw new PokemonSourceError("No card record", "bad_response");
  const d = de as TcgdexCard | null;
  const e = en as TcgdexCard | null;
  const lang: PokemonLang = opts.lang ?? (d ? "de" : "en");
  const main = (lang === "de" ? d : e) ?? d ?? e!;
  const other = main === d ? e : d;
  const name = main.name ?? other?.name ?? any.id;
  const altRaw = other?.name && other.name !== name ? other.name : null;
  const hasCategory = !!(d?.category || e?.category);
  const category: PokemonCategory = hasCategory ? categoryOfRecord(d, e) : (opts.category ?? (/\b(energy|energie)$/i.test(name) ? "ENERGY" : "POKEMON"));
  const tcgdexId = any.id;
  const localId = any.localId ?? "";
  const variants = opts.variants ?? [];
  const priced = variants.find((v) => v.priceCents !== null);
  const legalSrc = e?.legal ?? d?.legal;
  const types = (main.types ?? other?.types ?? opts.types ?? []).slice();
  return {
    id: pokemonCardId(tcgdexId),
    tcgdexId,
    name,
    altName: altRaw,
    setName: main.set?.name ?? other?.set?.name ?? opts.setName ?? "",
    localId,
    setTotal: any.set?.cardCount?.official ?? opts.setTotal ?? null,
    category,
    types: types.length ? types : (opts.types ?? []),
    image: main.image ?? other?.image ?? null,
    priceCents: priced?.priceCents ?? null,
    lowCents: priced?.lowCents ?? null,
    variants: variants.map((v) => v.variant),
    legal: legalSrc ? { standard: legalSrc.standard === true, expanded: legalSrc.expanded === true } : null,
  };
}

/** The whole read of one card (German and English records, either may be null). */
export function recordFromTcgdex(de: TcgdexCard | null, en: TcgdexCard | null): PokemonCardRecord {
  const any = en ?? de;
  if (!any) throw new PokemonSourceError("No card record", "bad_response");
  const variants = variantsFromTcgdex(de, en);
  const details = detailsFromTcgdex(de, en);
  const category = categoryOfRecord(de, en);
  const hit = hitFromTcgdex(de, en, { lang: de ? "de" : "en", variants });
  const image = de?.image ?? en?.image ?? null;
  return {
    tcgdexId: any.id,
    hit: { ...hit, category },
    details,
    variants,
    category,
    setId: any.set?.id ?? setIdOf(any.id, any.localId),
    setLogo: de?.set?.logo ?? en?.set?.logo ?? null,
    rarity: de?.rarity ?? en?.rarity ?? null,
    rarityEn: en?.rarity ?? null,
    imageHigh: pokemonImage(image, "high"),
    skillText: skillTextOf(de, en),
  };
}

// ── Search ───────────────────────────────────────────────────────────────────

export interface ParsedQuery {
  /** The text to search names for; empty when the query is a number alone. */
  name: string;
  /** A collector number as the digits read ("006" and "6" both give 6). */
  number: number | null;
  /** The set's official size, when the query said "6/165". */
  size: number | null;
}

/**
 * "Glurak", "6", "006", "6/165", "#6", "Glurak 6/165". A trailing number (alone or after a space) is
 * a collector number; digits inside a word ("Porygon2") are part of the name.
 */
export function parseSearchQuery(q: string | null | undefined): ParsedQuery {
  const text = (q ?? "").trim().replace(/\s+/g, " ").slice(0, 100);
  const m = /(?:^|\s)#?(\d{1,3})(?:\s*\/\s*(\d{1,3}))?$/.exec(text);
  if (!m) return { name: text, number: null, size: null };
  return { name: text.slice(0, m.index).trim(), number: parseInt(m[1], 10), size: m[2] ? parseInt(m[2], 10) : null };
}

const numberOfLocalId = (localId: string): number | null => {
  const m = /^0*(\d+)$/.exec(localId);
  return m ? parseInt(m[1], 10) : null;
};

/**
 * German and English list entries to one list of hits, by TCGdex id: German order first, then the
 * cards only the English search found. A card found in both shows the German name with the English
 * one beside it; a card found in one language shows that language's name.
 */
export function mergeSearchHits(
  de: TcgdexBrief[],
  en: TcgdexBrief[],
  ctx: { sets?: Map<string, PokemonSetInfo>; category?: PokemonCategory | null; type?: { en: string; de: string } | null; number?: number | null } = {},
): PokemonHit[] {
  const deById = new Map(de.map((c) => [c.id, c]));
  const enById = new Map(en.map((c) => [c.id, c]));
  const ids = [...new Set([...de.map((c) => c.id), ...en.map((c) => c.id)])];
  const hits: PokemonHit[] = [];
  for (const id of ids) {
    const d = deById.get(id) ?? null;
    const e = enById.get(id) ?? null;
    const localId = (d ?? e)!.localId;
    // The list is "contains" matching on the number: keep the exact ones.
    if (ctx.number != null && numberOfLocalId(localId) !== ctx.number) continue;
    const set = ctx.sets?.get(setIdOf(id, localId));
    const lang: PokemonLang = d ? "de" : "en";
    const setName = (lang === "de" ? set?.names.de : set?.names.en) ?? set?.name ?? "";
    hits.push(
      hitFromTcgdex(d, e, {
        lang,
        setName,
        setTotal: set?.official ?? null,
        category: ctx.category ?? null,
        types: ctx.type ? [ctx.type.de] : [],
      }),
    );
  }
  return hits;
}

// ── Reads ────────────────────────────────────────────────────────────────────

interface GetOptions {
  /** Skip the day cache (the nightly refresh wants today's prices). */
  fresh?: boolean;
  /** A 404 is an answer ("TCGdex has no such card"), not a failure. */
  allow404?: boolean;
}

/** `?key=value&...` with every part encoded, keys such as `pagination:page` included. */
function query(params: [string, string | number][]): string {
  return params.length ? `?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&")}` : "";
}

async function getJson<T>(path: string, opts: GetOptions & { allow404: true }): Promise<T | null>;
async function getJson<T>(path: string, opts?: GetOptions): Promise<T>;
async function getJson<T>(path: string, opts: GetOptions = {}): Promise<T | null> {
  const url = `${BASE}/${path}`;
  let last: PokemonSourceError | null = null;
  // One retry: the source answers a 503 now and then and the next call is fine.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 300));
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        ...(opts.fresh ? { cache: "no-store" as const } : { next: { revalidate: SOURCE_REVALIDATE_SECONDS } }),
      });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      last = new PokemonSourceError(timeout ? "TCGdex did not answer in time" : `TCGdex is not reachable: ${e instanceof Error ? e.message : String(e)}`, timeout ? "timeout" : "unavailable");
      continue;
    }
    if (res.status === 404) {
      if (opts.allow404) return null;
      throw new PokemonSourceError(`TCGdex has no ${path}`, "not_found", 404);
    }
    if (!res.ok) {
      last = new PokemonSourceError(`TCGdex answered ${res.status}`, "unavailable", res.status);
      if (res.status >= 500) continue;
      throw last;
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new PokemonSourceError("TCGdex sent something that is not JSON", "bad_response", res.status);
    }
  }
  throw last ?? new PokemonSourceError("TCGdex is not reachable", "unavailable");
}

const LANGS: readonly PokemonLang[] = ["de", "en"];

/** The sets, newest first, with logos. Names in both languages. Cached a day. */
export async function listPokemonSets(): Promise<PokemonSetInfo[]> {
  const [de, en, series] = await Promise.all([
    getJson<RawSetBrief[]>(`de/sets${query([["sort:field", "releaseDate"], ["sort:order", "DESC"]])}`),
    getJson<RawSetBrief[]>(`en/sets${query([["sort:field", "releaseDate"], ["sort:order", "DESC"]])}`).catch(() => [] as RawSetBrief[]),
    seriesLogos(),
  ]);
  const enById = new Map(en.map((s) => [s.id, s]));
  return de.map((s) => {
    const e = enById.get(s.id);
    return {
      id: s.id,
      name: s.name ?? e?.name ?? s.id,
      names: { ...(s.name ? { de: s.name } : {}), ...(e?.name ? { en: e.name } : {}) },
      logo: s.logo ?? series.logos.get(s.id) ?? null,
      symbol: s.symbol ?? series.symbols.get(s.id) ?? null,
      official: s.cardCount?.official ?? null,
      total: s.cardCount?.total ?? null,
      releaseDate: null,
    };
  });
}

/** Set logos and symbols come with the series pages, not the set list; a series that fails just has none. */
async function seriesLogos(): Promise<{ logos: Map<string, string>; symbols: Map<string, string> }> {
  const logos = new Map<string, string>();
  const symbols = new Map<string, string>();
  try {
    const list = await getJson<RawSerie[]>("de/series");
    const details = await Promise.allSettled(list.map((s) => getJson<RawSerie>(`de/series/${encodeURIComponent(s.id)}`)));
    for (const d of details) {
      if (d.status !== "fulfilled") continue;
      for (const set of d.value.sets ?? []) {
        if (set.logo) logos.set(set.id, set.logo);
        if (set.symbol) symbols.set(set.id, set.symbol);
      }
    }
  } catch {
    // No logos today; the names and counts still show.
  }
  return { logos, symbols };
}

/** One set with its release date (the store keeps it for ordering). Null when TCGdex has no such set. */
export async function getPokemonSet(setId: string): Promise<PokemonSetInfo | null> {
  const [de, en] = await Promise.all(LANGS.map((l) => getJson<RawSetDetail>(`${l}/sets/${encodeURIComponent(setId)}`, { allow404: true }).catch(() => null)));
  const any = de ?? en;
  if (!any) return null;
  return {
    id: any.id,
    name: de?.name ?? en?.name ?? any.id,
    names: { ...(de?.name ? { de: de.name } : {}), ...(en?.name ? { en: en.name } : {}) },
    logo: de?.logo ?? en?.logo ?? null,
    symbol: de?.symbol ?? en?.symbol ?? null,
    official: any.cardCount?.official ?? null,
    total: any.cardCount?.total ?? null,
    releaseDate: de?.releaseDate ?? en?.releaseDate ?? null,
  };
}

/**
 * Cards by name or number, in both languages, merged by id. One page is up to `PAGE_SIZE` cards per
 * language, so a page can hold more than 40 hits when the two languages found different cards.
 * Nothing to ask (no text, number or filter) answers an empty list: that screen shows the sets.
 * Throws `PokemonSourceError` when neither language could be read.
 */
export async function searchPokemon(params: PokemonSearchParams): Promise<PokemonHit[]> {
  const parsed = parseSearchQuery(params.q);
  const category = pokemonCategoryOf(params.category);
  const type = pokemonTypeOf(params.type);
  const setId = params.setId?.trim() || null;
  if (!parsed.name && parsed.number === null && !category && !type && !setId) return [];
  if (params.type && !type) return [];
  if (params.category && !category) return [];
  const page = Math.min(MAX_PAGE, Math.max(1, Math.floor(params.page ?? 1) || 1));

  const listFor = (lang: PokemonLang): Promise<TcgdexBrief[]> => {
    const q: [string, string | number][] = [];
    if (parsed.name) q.push(["name", parsed.name]);
    if (parsed.number !== null) q.push(["localId", String(parsed.number).padStart(3, "0")]);
    if (parsed.size !== null) q.push(["set.cardCount.official", `eq:${parsed.size}`]);
    if (setId) q.push(["set.id", `eq:${setId}`]);
    if (category) q.push(["category", `eq:${CATEGORY_NAMES[category][lang]}`]);
    if (type) q.push(["types", `eq:${type[lang]}`]);
    q.push(["pagination:page", page], ["pagination:itemsPerPage", PAGE_SIZE]);
    return getJson<TcgdexBrief[]>(`${lang}/cards${query(q)}`);
  };

  const [deR, enR, setsR] = await Promise.allSettled([listFor("de"), listFor("en"), listPokemonSets()]);
  if (deR.status === "rejected" && enR.status === "rejected") throw deR.reason;
  const sets = setsR.status === "fulfilled" ? new Map(setsR.value.map((s) => [s.id, s])) : undefined;
  return mergeSearchHits(deR.status === "fulfilled" ? deR.value : [], enR.status === "fulfilled" ? enR.value : [], { sets, category, type, number: parsed.number });
}

/**
 * One card in both languages, as a record. A language TCGdex lacks is skipped; no record at all
 * throws `PokemonSourceError` of kind `not_found`. `fresh` skips the day cache and `langs: ["en"]`
 * reads the English record only (the nightly refresh needs nothing else).
 */
export async function getPokemonCard(tcgdexId: string, opts: { fresh?: boolean; langs?: readonly PokemonLang[] } = {}): Promise<PokemonCardRecord> {
  const langs = opts.langs ?? LANGS;
  const get = (lang: PokemonLang) => (langs.includes(lang) ? getJson<TcgdexCard>(`${lang}/cards/${encodeURIComponent(tcgdexId)}`, { allow404: true, fresh: opts.fresh }) : Promise.resolve(null));
  const [de, en] = await Promise.all([get("de"), get("en")]);
  if (!de && !en) throw new PokemonSourceError(`TCGdex has no card ${tcgdexId}`, "not_found", 404);
  return recordFromTcgdex(de, en);
}
