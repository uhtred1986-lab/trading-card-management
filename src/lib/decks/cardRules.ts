/**
 * Deck-building keyword rules. Some cards repeat their rule text; others, like
 * Masters [Ultimate], are defined in the rule manual.
 *
 * These are pooled deck limits rather than the usual per-card 4:
 *
 *   [Dragon Ball]  "You can include as many copies of cards with [Dragon Ball]
 *                   in your deck as you like, as long as the total number
 *                   doesn't exceed 7."
 *   [Super Combo]  "You can only include up to 4 cards with [Super Combo] in
 *                   your deck."
 *   [Ultimate]     A player may only have up to one card with [Ultimate] in
 *                   their deck (Masters Rule Manual §22-14-2).
 *
 * The first one also *lifts* the copy limit — six of one Dragon Ball is legal —
 * so without reading it a deck like that gets wrongly flagged.
 *
 * Rules are read from the text of the cards in the deck, so a future keyword
 * works without a code change; known keyword limits are also listed as a
 * fallback for card pools where the cards do not print their reminder text.
 */

export interface KeywordDeckRule {
  /** The bracketed keyword, as printed: "Dragon Ball". */
  keyword: string;
  /** Most cards carrying it that a deck may contain, counted across copies. */
  max: number;
  /** True when the rule replaces the per-card copy limit rather than adding to it. */
  unlimitedCopies: boolean;
}

/** "as many copies … as long as the total number doesn't exceed 7" */
const POOLED_UNLIMITED = /include as many copies of cards with \[([^\]]+)\][^.]*?total number does\s?n[o']?t exceed (\d+)/i;
/** "only include up to 4 cards with [Super Combo] in your deck" */
const POOLED_CAPPED = /only include up to (\d+) cards? with \[([^\]]+)\]/i;

/** Known from the catalog; used when no card in the deck spells the rule out. */
export const KNOWN_RULES: KeywordDeckRule[] = [
  { keyword: "Dragon Ball", max: 7, unlimitedCopies: true },
  { keyword: "Super Combo", max: 4, unlimitedCopies: false },
  { keyword: "Ultimate", max: 1, unlimitedCopies: false },
];

export function parseDeckRules(skill: string | null | undefined): KeywordDeckRule[] {
  if (!skill) return [];
  const text = skill
    .replace(/\[br\]|<br\s*\/?>/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[’‘]/g, "'");
  const found: KeywordDeckRule[] = [];
  const unlimited = POOLED_UNLIMITED.exec(text);
  if (unlimited) found.push({ keyword: titled(unlimited[1]), max: Number(unlimited[2]), unlimitedCopies: true });
  const capped = POOLED_CAPPED.exec(text);
  if (capped) found.push({ keyword: titled(capped[2]), max: Number(capped[1]), unlimitedCopies: false });
  return found;
}

/** Cards print the keyword in mixed case ("[super combo]"); compare on a normal form. */
export function sameKeyword(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function titled(raw: string): string {
  const clean = raw.trim();
  const known = KNOWN_RULES.find((r) => sameKeyword(r.keyword, clean));
  return known ? known.keyword : clean;
}

/**
 * The bracketed tags a card prints at the *head* of one of its text blocks —
 * "[Dragon Ball] (You can include…)", "[Activate: Main][Once per turn] …".
 *
 * This is what distinguishes carrying a keyword from merely naming one. The
 * catalog's own `keywords` column can't be used: it is a scrape of every
 * bracketed token in the text, so "Choose up to 1 [Dragon Ball] card from your
 * deck" lands Bulma (BT5-107) and the Shenron leader (SD7-01) in it too.
 */
export function leadingTags(skill: string | null | undefined): string[] {
  if (!skill) return [];
  const tags: string[] = [];
  for (const block of skill.replace(/<br\s*\/?>/gi, "[br]").split("[br]")) {
    const run = /^\s*((?:\[[^\]]+\]\s*)+)/.exec(block);
    if (!run) continue;
    for (const t of run[1].matchAll(/\[([^\]]+)\]/g)) tags.push(t[1].trim());
  }
  return tags;
}

/** Every rule in play for a set of cards, deduplicated, tightest limit winning. */
export function rulesFor(cards: { skill?: string | null }[]): KeywordDeckRule[] {
  const byKeyword = new Map<string, KeywordDeckRule>();
  for (const c of cards) {
    for (const rule of parseDeckRules(c.skill)) {
      const key = rule.keyword.toLowerCase();
      const seen = byKeyword.get(key);
      if (!seen || rule.max < seen.max) byKeyword.set(key, rule);
    }
  }
  // A deck can hold the keyword without any of its cards restating the rule.
  for (const rule of KNOWN_RULES) {
    const key = rule.keyword.toLowerCase();
    if (byKeyword.has(key)) continue;
    if (cards.some((c) => hasKeyword(c, rule.keyword))) byKeyword.set(key, rule);
  }
  return [...byKeyword.values()];
}

/**
 * Whether a card *carries* the keyword, rather than referring to one. Plenty of
 * cards fetch or count [Dragon Ball] cards without being one themselves.
 */
export function hasKeyword(card: { skill?: string | null }, keyword: string): boolean {
  return leadingTags(card.skill).some((t) => sameKeyword(t, keyword));
}

// ── Deck-building clauses (#1146) ───────────────────────────────────────────
//
// About 35 cards print deck-building restrictions as [Permanent] lines: a
// Leader that keeps whole families of cards out of the deck ("You can't
// include non-white Extra in your deck"), a card that changes its own copy
// limit ("…up to 7 copies of this card in your deck"), a pooled limit ("…only
// include up to 7 ≪Dark Dragon Ball≫ cards"). One reader serves both halves of
// the app: deck legality (`legality.ts`) applies the restrictions, and the
// arena (`compile/silent.ts`) takes the clause out of the line so the rest of
// a mixed line is still compiled as a game effect.
//
// Read from the printed text only, never from card ids. A clause that names
// the deck but cannot be read whole is returned in `unread`, never guessed.

/** A description of cards, as a deck-building clause names them. Every field present must hold. */
export interface DeckCardFilter {
  /** Catalog card types ("BATTLE", "EXTRA", "Z-UNISON"): any one of them. */
  types?: string[];
  /** The card has one of these colours. */
  colors?: string[];
  /** The card has none of these colours ("non-red"). */
  notColors?: string[];
  traits?: string[];
  notTraits?: string[];
  characters?: string[];
  notCharacters?: string[];
  /** Carries this bracketed keyword at the head of a text block. */
  keyword?: string;
  /** Energy cost bounds, inclusive. A card with no numeric cost (X, none) never matches a cost bound. */
  cost?: { min?: number; max?: number };
  multicolor?: boolean;
}

export type DeckZone = "main" | "z";

export type DeckBuildingRule =
  /** "You can't include A, B or C in your deck": a card matching any filter is refused, unless it matches `except`. */
  | { kind: "exclude"; filters: DeckCardFilter[]; except?: DeckCardFilter; zone: DeckZone; words: string }
  /** "You can only include Z-Unisons in your Z-Deck": a card of that zone that does not match is refused. */
  | { kind: "only"; filter: DeckCardFilter; zone: DeckZone; words: string }
  /** "…up to 7 copies of this card…", "…as many copies … as you like" (max null), "…only 1 copy … in your Z-Deck". */
  | { kind: "copies"; max: number | null; zone: DeckZone; words: string }
  /** "…only include up to 7 ≪Dark Dragon Ball≫ cards in your deck": at most `max` matching cards, counted across copies. */
  | { kind: "pool"; filter: DeckCardFilter; max: number; zone: DeckZone; words: string }
  /** The keyword limits `parseDeckRules` reads ([Dragon Ball], [Super Combo]); legality applies them already. */
  | { kind: "keyword"; rule: KeywordDeckRule; words: string };

export interface DeckBuildingReading {
  rules: DeckBuildingRule[];
  /** The text left once the deck-building clauses are taken out: the game half of a mixed line. Empty for a pure one. */
  rest: string;
  /** Sentences that name the deck's contents but could not be read whole. They stay in `rest`. */
  unread: string[];
}

const COLOURS = ["red", "blue", "green", "yellow", "black", "white", "purple"];
const TYPE_WORDS: Record<string, string> = {
  "battle": "BATTLE", "battles": "BATTLE", "extra": "EXTRA", "extras": "EXTRA", "unison": "UNISON", "unisons": "UNISON",
  "leader": "LEADER", "leaders": "LEADER", "z-battle": "Z-BATTLE", "z-battles": "Z-BATTLE", "z-extra": "Z-EXTRA", "z-extras": "Z-EXTRA",
  "z-unison": "Z-UNISON", "z-unisons": "Z-UNISON", "z-leader": "Z-LEADER", "z-leaders": "Z-LEADER",
};
const TYPE_LABEL: Record<string, string> = { BATTLE: "Battle", EXTRA: "Extra", UNISON: "Unison", LEADER: "Leader", "Z-BATTLE": "Z-Battle", "Z-EXTRA": "Z-Extra", "Z-UNISON": "Z-Unison", "Z-LEADER": "Z-Leader" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const bare = (s: string) => s.replace(/^[≪<{[]|[≫>}\]]$/g, "").trim();

/** One described set of cards ("non-white Extra Cards", "cards with energy costs of 5 or more"), or null when any of it is unreadable. */
export function parseCardDescription(raw: string): DeckCardFilter | null {
  let t = raw.trim().replace(/\s+/g, " ");
  const f: DeckCardFilter = {};
  const cost = /\bwith (?:an? )?(?:original )?energy costs? of (\d+) or (less|more)\b/i.exec(t);
  if (cost) {
    f.cost = cost[2].toLowerCase() === "less" ? { max: Number(cost[1]) } : { min: Number(cost[1]) };
    t = t.replace(cost[0], " ");
  }
  const lacks = /\bthat (?:do not|does not|don't|doesn't) have (≪[^≫]+≫) as part of (?:their|its) special traits?\b/i.exec(t);
  if (lacks) {
    f.notTraits = [bare(lacks[1])];
    t = t.replace(lacks[0], " ");
  }
  const has = /\bthat (?:have|has) (≪[^≫]+≫) as part of (?:their|its) special traits?\b/i.exec(t);
  if (has) {
    f.traits = [bare(has[1])];
    t = t.replace(has[0], " ");
  }
  let any = !!(f.cost || f.notTraits || f.traits);
  type ListKey = "traits" | "notTraits" | "characters" | "notCharacters" | "types" | "colors" | "notColors";
  const push = (key: ListKey, v: string) => {
    (f[key] ??= []).push(v);
  };
  for (const m of t.matchAll(/(non-)?(≪[^≫]+≫|<[^>]+>|\[[^\]]+\]|[A-Za-z][A-Za-z-]*)/g)) {
    const neg = !!m[1];
    const word = m[2];
    const low = word.toLowerCase();
    if (word.startsWith("≪")) push(neg ? "notTraits" : "traits", bare(word));
    else if (word.startsWith("<")) push(neg ? "notCharacters" : "characters", bare(word));
    else if (word.startsWith("[")) {
      if (neg) return null;
      f.keyword = bare(word);
    } else if (COLOURS.includes(low)) push(neg ? "notColors" : "colors", cap(low));
    else if (low === "multicolor" || low === "multicolour" || low === "multi-color") {
      if (neg) return null;
      f.multicolor = true;
    } else if (TYPE_WORDS[low]) {
      if (neg) return null;
      push("types", TYPE_WORDS[low]);
    } else if (low === "card" || low === "cards") {
      // the noun
    } else return null;
    any = true;
  }
  return any ? f : null;
}

/** The description in words, the way the clause was printed: "non-white Extra Cards". */
export function describeCardFilter(f: DeckCardFilter): string {
  const parts: string[] = [];
  for (const c of f.notColors ?? []) parts.push(`non-${c.toLowerCase()}`);
  for (const c of f.colors ?? []) parts.push(c.toLowerCase());
  if (f.multicolor) parts.push("multicolor");
  for (const t of f.notTraits ?? []) parts.push(`non-≪${t}≫`);
  for (const t of f.traits ?? []) parts.push(`≪${t}≫`);
  for (const c of f.notCharacters ?? []) parts.push(`non-<${c}>`);
  for (const c of f.characters ?? []) parts.push(`<${c}>`);
  if (f.keyword) parts.push(`[${f.keyword}]`);
  parts.push(f.types?.length ? `${f.types.map((t) => TYPE_LABEL[t] ?? t).join(" or ")} Cards` : "cards");
  if (f.cost) parts.push(f.cost.max !== undefined ? `with energy costs of ${f.cost.max} or less` : `with energy costs of ${f.cost.min} or more`);
  return parts.join(" ");
}

/** The card facts a description is checked against. Colours, traits and characters compare without case or brackets. */
export interface DeckCardFacts {
  cardType: string;
  colors: string[];
  traits?: string[];
  characters?: string[];
  energyCost?: string | number | null;
  skill?: string | null;
}

const norm = (s: string) => bare(s).toLowerCase();
const hasAny = (have: string[] | undefined, want: string[]) => (have ?? []).some((h) => want.some((w) => norm(h) === norm(w)));

export function matchesCardFilter(card: DeckCardFacts, f: DeckCardFilter): boolean {
  const colours = card.colors.filter((c) => c.toLowerCase() !== "colorless");
  if (f.types && !f.types.includes(card.cardType.toUpperCase())) return false;
  if (f.colors && !hasAny(colours, f.colors)) return false;
  if (f.notColors && hasAny(colours, f.notColors)) return false;
  if (f.multicolor && colours.length < 2) return false;
  if (f.traits && !hasAny(card.traits, f.traits)) return false;
  if (f.notTraits && hasAny(card.traits, f.notTraits)) return false;
  if (f.characters && !hasAny(card.characters, f.characters)) return false;
  if (f.notCharacters && hasAny(card.characters, f.notCharacters)) return false;
  if (f.keyword && !hasKeyword(card, f.keyword)) return false;
  if (f.cost) {
    const n = typeof card.energyCost === "number" ? card.energyCost : /^\d+$/.test(String(card.energyCost ?? "").trim()) ? Number(card.energyCost) : null;
    if (n === null) return false;
    if (f.cost.min !== undefined && n < f.cost.min) return false;
    if (f.cost.max !== undefined && n > f.cost.max) return false;
  }
  return true;
}

function cleanText(skill: string): string {
  return skill
    .replace(/\[br\]|<br\s*\/?>/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const zoneOf = (word: string): DeckZone => (word.toLowerCase() === "z-deck" ? "z" : "main");
const inZone = (z: DeckZone) => (z === "z" ? "in the Z-Deck" : "in the deck");

/**
 * Reads one piece of a sentence that begins at the verb: "can't include X in your deck, except for Y cards, and …".
 * Returns the rule and whatever game text follows it, "unreadable" when it names the deck but cannot be read
 * whole, or null when the piece is not a deck-building clause.
 */
function readClause(piece: string, continuation: boolean): { rule: DeckBuildingRule; rest: string } | "unreadable" | null {
  const head = /^(?:(?:you|your deck) )?(can(?:'t| not|not)|can only|can|may only|may)\s+include\s+(.+)$/i.exec(piece);
  if (!head) return null;
  const mode = head[1].toLowerCase();
  const refuse = /^can(?:'t| not|not)$/.test(mode);
  const only = /only/.test(mode);
  let body = head[2];
  let zone: DeckZone = "main";
  let tail = "";
  const where = /\s+in (?:your|the) (z-deck|deck)\b(?: as you like)?/i.exec(body);
  if (where) {
    zone = zoneOf(where[1]);
    tail = body.slice(where.index + where[0].length);
    body = body.slice(0, where.index);
  } else if (!continuation) return null;
  // "…except for <Vegeta> cards" and what follows.
  let except: DeckCardFilter | undefined;
  const exc = /^\s*,?\s*except (?:for )?(.+?)(?=\s*(?:,|$))/i.exec(tail);
  if (exc) {
    const f = parseCardDescription(exc[1]);
    if (!f) return "unreadable";
    except = f;
    tail = tail.slice(exc[0].length);
  }
  const rest = tail.replace(/^\s*,?\s*(?:and\s+)?/i, "").trim();
  if (refuse) {
    if (/^this card\b/i.test(body)) return "unreadable";
    // "A, B, or C": cost bounds print "N or less", which is not an alternative.
    const guarded = body.replace(/(\d+) or (less|more)/gi, "$1 OR$2");
    const items = guarded.split(/\s*,\s*(?:or\s+)?|\s+or\s+/i).map((s) => s.replace(/ OR(less|more)/g, " or $1").trim()).filter(Boolean);
    const filters = items.map(parseCardDescription);
    if (!filters.length || filters.some((f) => !f)) return "unreadable";
    const fs = filters as DeckCardFilter[];
    const words = `can't include ${fs.map(describeCardFilter).join(", or ")}${except ? `, except for ${describeCardFilter(except)}` : ""}`;
    return { rule: { kind: "exclude", filters: fs, except, zone, words }, rest };
  }
  const copies = /^(?:(as many) copies of this card|(any number) of this card|(?:up to )?(\d+) cop(?:y|ies) of this card)$/i.exec(body);
  if (copies) {
    const max = copies[1] || copies[2] ? null : Number(copies[3]);
    const words = max === null ? `any number of copies of this card ${inZone(zone)}` : `up to ${max} cop${max === 1 ? "y" : "ies"} of this card ${inZone(zone)}`;
    return { rule: { kind: "copies", max, zone, words }, rest };
  }
  const pool = /^up to (\d+) (.+)$/i.exec(body);
  if (pool) {
    const f = parseCardDescription(pool[2]);
    // "cards with [Super Combo]" is the keyword reader's (`parseDeckRules`).
    if (!f || /\bwith \[/i.test(pool[2])) return "unreadable";
    return { rule: { kind: "pool", filter: f, max: Number(pool[1]), zone, words: `at most ${pool[1]} ${describeCardFilter(f)} ${inZone(zone)}` }, rest };
  }
  if (only) {
    const f = parseCardDescription(body);
    if (!f) return "unreadable";
    return { rule: { kind: "only", filter: f, zone, words: `only ${describeCardFilter(f)} ${inZone(zone)}` }, rest };
  }
  return "unreadable";
}

/**
 * Every deck-building clause in a skill text, and the text left over. A sentence is a deck-building one when it
 * says the deck "includes" something; the game half of a mixed sentence ("…in your deck, and treat ≪Villainous≫
 * cards in your hand as if…") goes to `rest`. "…cards in your deck" without "include" is game text.
 */
export function parseDeckBuilding(skill: string | null | undefined): DeckBuildingReading {
  const out: DeckBuildingReading = { rules: [], rest: "", unread: [] };
  if (!skill) return out;
  const rest: string[] = [];
  for (const sentence of cleanText(skill).split(/(?<=\.)\s+|\.$/).map((s) => s.trim().replace(/\.$/, "")).filter(Boolean)) {
    if (!/\binclude\b/i.test(sentence)) { rest.push(sentence); continue; }
    // The keyword limits: [Dragon Ball], [Super Combo].
    const keyword = parseDeckRules(sentence);
    if (keyword.length) {
      for (const rule of keyword) out.rules.push({ kind: "keyword", rule, words: `at most ${rule.max} [${rule.keyword}] cards in the deck` });
      continue;
    }
    // Reminder in parentheses, with or without its closing one: the keyword skills' own wording.
    if (/^(?:\[[^\]]*\]\s*)*\(/.test(sentence)) continue;
    // Leading tags ("[Permanent] …") belong to the skill, not the sentence.
    const body = sentence.replace(/^(?:\[[^\]]*\]\s*)+/, "");
    if (!/\bin (?:your|the) (?:z-)?deck\b|\bdeck can\b/i.test(body)) { rest.push(sentence); continue; }
    // "…cards, and can't include non-red Battle Cards": a second verb with no "in your deck" of its own.
    const pieces = body.split(/,\s*(?:and\s+)?(?=(?:(?:you|your deck) )?(?:can(?:'t| not|not)|can only|can)\s+include\b)/i);
    const read: DeckBuildingRule[] = [];
    const left: string[] = [];
    let failed = false;
    pieces.forEach((piece, i) => {
      const got = readClause(piece.trim(), i > 0 || /^your deck\b/i.test(piece.trim()));
      if (got === "unreadable") failed = true;
      else if (got === null) left.push(piece.trim());
      else {
        read.push(got.rule);
        if (got.rest) left.push(got.rest);
      }
    });
    if (failed) { out.unread.push(sentence); rest.push(sentence); continue; }
    // Nothing in it was a deck-building clause after all: it is game text that happens to say "include".
    if (!read.length) { rest.push(sentence); continue; }
    out.rules.push(...read);
    rest.push(...left);
  }
  out.rest = rest.map((s) => s.replace(/\.$/, "")).join(". ");
  return out;
}

const readings = new Map<string, DeckBuildingReading>();
/** `parseDeckBuilding`, remembered: a deck check reads the same few card texts over and over. */
export function deckBuildingOf(skill: string | null | undefined): DeckBuildingReading {
  if (!skill) return { rules: [], rest: "", unread: [] };
  const hit = readings.get(skill);
  if (hit) return hit;
  const got = parseDeckBuilding(skill);
  if (readings.size > 2000) readings.clear();
  readings.set(skill, got);
  return got;
}
