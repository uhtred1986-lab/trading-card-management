/**
 * Card text → structure. The catalog stores skills as printed ("[Auto] When
 * you play this card, draw 1 card.<br>[Blocker]"); the engine needs to know,
 * per line, the skill type, the keyword skills it carries with their
 * parameters, and where the cost ends and the effect begins.
 *
 * Nothing here interprets an *effect* — that is `effects.ts` (compiled
 * scripts) and, failing that, the referee. This file only reads what the
 * manual calls the skill's type, keywords, and cost (1-5, 1-6, 22).
 */
import type { CardDef, Color, KeywordSkill, Skill, SkillKind } from "./types";

// ── text normalisation ─────────────────────────────────────────────────────

/** `<br>` and `[br]` separate skill lines; entities are HTML-escaped in some sets. */
export function skillLines(text: string | null | undefined): string[] {
  if (!text) return [];
  const raw = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\[br\]/gi, "\n")
    .replace(/\[\/?ul\]/gi, "\n")
    .replace(/\[li\]/gi, "\n・")
    .replace(/\[\/li\]/gi, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[’‘]/g, "'")
    // Some sets print the odd full-width Latin letter mid-word ("Leader Ｃard"),
    // which reads the same and matches nothing.
    .replace(/[Ａ-Ｚａ-ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // The options of a "Choose one—" are printed on their own lines, but they
  // are not skills of their own (20-2): they belong to the line above them.
  const out: string[] = [];
  for (const line of raw) {
    if (BULLET.test(line) && out.length) out[out.length - 1] += ` ・${line.replace(BULLET, "").trim()}`;
    else out.push(line);
  }
  return out;
}

/** The bullet a modal option starts with. The catalog uses several. */
export const BULLET = /^[・･·•‧]\s*/;

const COLOR_BY_LETTER: Record<string, Color> = { r: "Red", u: "Blue", g: "Green", y: "Yellow", k: "Black" };
const COLOR_BY_NAME: Record<string, Color> = { red: "Red", blue: "Blue", green: "Green", yellow: "Yellow", black: "Black" };

/** "{g}{g}" / "{u}" orbs in a cost → per-colour counts; "{1}" style numbers → any. */
export function orbsIn(text: string): Partial<Record<Color, number>> & { any?: number } {
  const out: Partial<Record<Color, number>> & { any?: number } = {};
  for (const m of text.matchAll(/\{([rugyk])\}/gi)) {
    const c = COLOR_BY_LETTER[m[1].toLowerCase()];
    out[c] = (out[c] ?? 0) + 1;
  }
  for (const m of text.matchAll(/\{(\d+)\}/g)) out.any = (out.any ?? 0) + Number(m[1]);
  return out;
}

// ── keyword skills (22) ────────────────────────────────────────────────────

const STRIKE: Record<string, 2 | 3 | 4> = { double: 2, triple: 3, quadruple: 4 };

/** Parse one bracket tag into a keyword skill, or null when it is a skill type / modifier / unknown. */
export function keywordOf(tag: string): KeywordSkill | null {
  const t = tag.trim().toLowerCase().replace(/\s+/g, " ");
  let m: RegExpExecArray | null;
  if (t === "awaken") return { name: "Awaken", surge: false };
  if (t === "awaken: surge" || t === "awaken : surge") return { name: "Awaken", surge: true };
  if (t === "wish") return { name: "Wish" };
  if (t === "field") return { name: "Field" };
  if (t === "blocker") return { name: "Blocker" };
  if (t === "critical") return { name: "Critical" };
  if ((m = /^(double|triple|quadruple) strike$/.exec(t))) return { name: "Strike", x: STRIKE[m[1]] };
  if (t === "dual attack") return { name: "Attack", x: 2 };
  if (t === "triple attack") return { name: "Attack", x: 3 };
  if (t === "revenge") return { name: "Revenge" };
  if (t === "indestructible") return { name: "Indestructible" };
  if (t === "barrier") return { name: "Barrier" };
  if (t === "deflect") return { name: "Deflect" };
  if (t === "unique") return { name: "Unique" };
  if (t === "servant") return { name: "Servant" };
  if (t === "energy-exhaust" || t === "energy exhaust") return { name: "Energy-Exhaust" };
  if (t === "victory strike") return { name: "Victory Strike" };
  if (t === "warrior of universe 7") return { name: "Warrior of Universe 7" };
  if (t === "ultimate") return { name: "Ultimate" };
  if (t === "super combo") return { name: "Super Combo" };
  if (t === "dragon ball") return { name: "Dragon Ball" };
  if (t === "wormhole") return { name: "Wormhole" };
  if (t === "invoker") return { name: "Invoker" };
  if (t === "heroic") return { name: "Heroic" };
  if (t === "villainous") return { name: "Villainous" };
  if (t === "offering") return { name: "Offering" };
  if (t === "evolve") return { name: "Evolve", variant: "Evolve" };
  if (t === "ex-evolve") return { name: "Evolve", variant: "EX-Evolve" };
  if (t === "xeno-evolve") return { name: "Evolve", variant: "Xeno-Evolve" };
  if (t === "union-fusion") return { name: "Union", variant: "Fusion" };
  if (t === "union-potara") return { name: "Union", variant: "Potara" };
  if (t === "union-absorb") return { name: "Union", variant: "Absorb" };
  if ((m = /^(dark )?over realm(?: (\d+))?$/.exec(t))) return { name: "Over Realm", x: Number(m[2] ?? 0), dark: !!m[1] };
  if ((m = /^swap(?: (\d+))?$/.exec(t))) return { name: "Swap", x: Number(m[1] ?? 0) };
  if ((m = /^(arrival|aegis|alliance|revive)\b(.*)$/.exec(t))) {
    const colors = colorsIn(m[2]);
    const name = (m[1][0].toUpperCase() + m[1].slice(1)) as "Arrival" | "Aegis" | "Alliance" | "Revive";
    return { name, colors };
  }
  if (t === "successor") return { name: "Successor" };
  if (t === "overlord") return { name: "Overlord" };
  if (t === "rejuvenate") return { name: "Rejuvenate" };
  if ((m = /^spirit boost(?: (\d+))?$/.exec(t))) return { name: "Spirit Boost", x: Number(m[1] ?? 1) };
  if ((m = /^empower(?: ([a-z]+))?(?: (\d+))?$/.exec(t))) {
    const color = m[1] ? (COLOR_BY_NAME[m[1]] ?? null) : null;
    return { name: "Empower", color, x: Number(m[2] ?? (m[1] && /^\d+$/.test(m[1]) ? m[1] : 0)) };
  }
  if (t === "z-awaken") return { name: "Z-Awaken" };
  if ((m = /^z-stack(?: (\d+))?$/.exec(t))) return { name: "Z-Stack", x: Number(m[1] ?? 1) };
  return null;
}

/** Colour words in a tag tail: "Red/Blue", "Green Yellow", "Blue". */
function colorsIn(text: string): Color[] {
  const out: Color[] = [];
  for (const m of text.toLowerCase().matchAll(/red|blue|green|yellow|black/g)) {
    const c = COLOR_BY_NAME[m[0]];
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

// ── skill lines ────────────────────────────────────────────────────────────

function kindOf(tags: string[], keyword: KeywordSkill | null): SkillKind {
  for (const raw of tags) {
    const t = raw.toLowerCase().replace(/\s*:\s*/, ":").replace(/\s+/g, " ");
    if (t === "activate:main") return "activate:main";
    if (t === "activate:battle") return "activate:battle";
    if (t === "activate:main/battle") return "activate:main/battle";
    if (t === "auto") return "auto";
    if (t === "permanent") return "permanent";
    if (t === "counter:play") return "counter:play";
    if (t === "counter:attack") return "counter:attack";
    if (t === "counter:battle card attack") return "counter:battle card attack";
    if (t === "counter:counter") return "counter:counter";
  }
  // Keyword skills carry their own type (22-1-1); the engine knows which.
  if (keyword) return "keyword";
  return "permanent";
}

/**
 * Leading bracket tags, then the rest. "[Auto][Once per turn] When…" →
 * tags [Auto, Once per turn], body "When…". Marker costs "[+2]"/"[-1]" and
 * energy orbs "{g}" that appear *before* the first tag on Unison lines are
 * kept as tags too.
 */
function splitTags(line: string): { tags: string[]; body: string } {
  const tags: string[] = [];
  let rest = line;
  for (;;) {
    const m = /^\s*\[([^\]]+)\]\s*/.exec(rest);
    if (!m) break;
    tags.push(m[1].trim());
    rest = rest.slice(m[0].length);
  }
  return { tags, body: rest.trim() };
}

/**
 * "cost : effect" — the first colon outside brackets/braces/angle brackets.
 * Explanatory notes in parentheses are not costs (1-5-8).
 */
function splitCost(body: string): { cost: string; effect: string } {
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(" || ch === "[" || ch === "{" || ch === "<" || ch === "≪") depth++;
    else if (ch === ")" || ch === "]" || ch === "}" || ch === ">" || ch === "≫") depth = Math.max(0, depth - 1);
    else if (ch === ":" && depth === 0) return { cost: body.slice(0, i).trim(), effect: body.slice(i + 1).trim() };
  }
  return { cost: "", effect: body };
}

/** Parse a card face's whole text into skills. */
export function parseSkills(text: string | null | undefined): Skill[] {
  const out: Skill[] = [];
  for (const [index, line] of skillLines(text).entries()) {
    const { tags, body } = splitTags(line);
    // A line that is only keyword tags ("[Deflect][Triple Attack]") is several
    // keyword skills; emit one per keyword so each can be negated alone.
    const keywords = tags.map(keywordOf).filter((k): k is KeywordSkill => !!k);
    const typeTag = tags.find((t) => kindOf([t], null) !== "permanent" || /^permanent$/i.test(t));
    if (!body && keywords.length > 1 && !typeTag) {
      for (const [j, kw] of keywords.entries()) out.push(makeSkill(index * 10 + j, [tagFor(kw)], kw, "", "", line));
      continue;
    }
    const primary = keywords[0] ?? null;
    const { cost, effect } = splitCost(body);
    out.push(makeSkill(index * 10, tags, primary, cost, effect, line));
  }
  return out;
}

function tagFor(kw: KeywordSkill): string {
  return kw.name;
}

function makeSkill(index: number, tags: string[], keyword: KeywordSkill | null, cost: string, effect: string, raw: string): Skill {
  const lower = tags.map((t) => t.toLowerCase());
  const num = (re: RegExp): number | null => {
    for (const t of lower) {
      const m = re.exec(t);
      if (m) return Number(m[1]);
    }
    return null;
  };
  const marker = num(/^([+-]\d+)$/);
  return {
    index,
    kind: kindOf(tags, keyword),
    tags,
    keyword,
    cost,
    effect,
    oncePerTurn: lower.includes("once per turn"),
    limit: num(/^limit (\d+)$/),
    bond: num(/^bond (\d+)/),
    sparking: num(/^sparking (\d+)$/),
    burst: num(/^burst (\d+)$/),
    markerCost: marker,
    energyCost: orbsIn(cost),
    raw,
  };
}

// ── card-level helpers ─────────────────────────────────────────────────────

const parsedCache = new WeakMap<CardDef, { front: Skill[]; back: Skill[] }>();

export function skillsOf(def: CardDef, side: "front" | "back" = "front"): Skill[] {
  let entry = parsedCache.get(def);
  if (!entry) {
    entry = { front: parseSkills(def.skill), back: parseSkills(def.back?.skill) };
    parsedCache.set(def, entry);
  }
  return side === "back" ? entry.back : entry.front;
}

/** Every keyword skill a face carries, including those on typed lines ("[Auto][Blocker]" is rare but exists). */
export function keywordsOf(def: CardDef, side: "front" | "back" = "front"): KeywordSkill[] {
  const out: KeywordSkill[] = [];
  for (const s of skillsOf(def, side)) {
    if (s.keyword) out.push(s.keyword);
    for (const t of s.tags) {
      const k = keywordOf(t);
      if (k && k !== s.keyword && !out.some((o) => JSON.stringify(o) === JSON.stringify(k))) out.push(k);
    }
  }
  return out;
}

export function hasKeyword(def: CardDef, name: KeywordSkill["name"], side: "front" | "back" = "front"): boolean {
  return keywordsOf(def, side).some((k) => k.name === name);
}

export function isZ(def: CardDef): boolean {
  return def.type.startsWith("Z-");
}

export function baseType(def: CardDef): "LEADER" | "BATTLE" | "EXTRA" | "UNISON" {
  const t = def.type.replace(/^Z-/, "");
  return t === "TOKEN" ? "BATTLE" : (t as "LEADER" | "BATTLE" | "EXTRA" | "UNISON");
}

/**
 * Specified cost by convention (proposal §9.1): one orb of each of the card's
 * colours, capped by the total cost. Colorless tokens and X costs get none.
 */
export function specifiedCostOf(def: CardDef): Partial<Record<Color, number>> {
  if (def.specifiedCost) return def.specifiedCost;
  if (typeof def.energyCost !== "number" || def.energyCost <= 0) return {};
  const out: Partial<Record<Color, number>> = {};
  let left = def.energyCost;
  for (const c of def.colors) {
    if (c === "Colorless" || left <= 0) continue;
    out[c] = 1;
    left--;
  }
  return out;
}

/** 5-7-2: a card can only combo with both a non-negative combo cost and combo power. */
export function canCombo(def: CardDef): boolean {
  return baseType(def) === "BATTLE" && def.comboCost != null && def.comboPower != null && def.comboCost >= 0 && def.comboPower >= 0;
}

/** Character names are `<Name>` in text; a card "has" a character when it is in `characters`. */
export function hasCharacter(def: CardDef, name: string): boolean {
  const n = name.toLowerCase();
  return def.characters.some((c) => c.toLowerCase() === n);
}

export function hasTrait(def: CardDef, name: string): boolean {
  const n = name.toLowerCase();
  return def.traits.some((c) => c.toLowerCase() === n);
}
