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
import type { CardDef, Color, KeywordSkill, Skill, SkillKind } from "../types";

// ── text normalisation ─────────────────────────────────────────────────────

const SPELLED: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** `<br>` and `[br]` separate skill lines; entities are HTML-escaped in some sets. */
export function skillLines(text: string | null | undefined): string[] {
  if (!text) return [];
  const raw = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\[br\]/gi, "\n")
    .replace(/\[\/?ul\]/gi, "\n")
    .replace(/\[li\]/gi, "\n・")
    .replace(/\[\/li\]/gi, "")
    .replace(/\[\/?em\]/gi, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[’‘]/g, "'")
    // Some sets set a run of the text in full-width forms, and every one of
    // them reads the same to a person and matches nothing here. It is not only
    // the odd letter mid-word ("Leader Ｃard"): the whole FF01–FF5E block maps
    // onto ASCII by the same offset, and the ones that hurt are the punctuation
    // the compiler steers by — "：" is the colon `splitCost` looks for, "｛｝"
    // are the braces around a card name, "（）" a reminder note's parentheses.
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    // The rest of the same story, where the ASCII spelling is not one offset
    // away: the ideographic space, the half-width middle dot a few sets use for
    // a modal option, and the two bracket pairs that mean a keyword tag and a
    // special trait.
    .replace(/　/g, " ")
    .replace(/･/g, "・")
    .replace(/【/g, "[")
    .replace(/】/g, "]")
    .replace(/《/g, "≪")
    .replace(/》/g, "≫")
    // A handful of sets print a skill's colourless energy cost as a circled
    // number ("③, if your Leader Card is a blue <Gogeta: Br> card") where the
    // rest print "{3}". Normalising it here means every reader of a cost —
    // `orbsIn`, `costText`, `costIsOnlyOrbs`, `splitCost` — sees the one form.
    .replace(/[①-⑳]/g, (ch) => `{${ch.charCodeAt(0) - 0x245f}}`)
    .replace(/⓪/g, "{0}")
    // A count spelled out instead of printed as a digit. Every counted target
    // is read by a pattern that wants a digit, and a phrase that has none is
    // taken as *all* of them — "your opponent chooses two cards from their
    // hand" (BT1-074) emptied their hand. Only where a count can stand, so the
    // "Four" of {Grandpa's Heirloom, the Four-Star Ball} is left alone; "one"
    // is left alone too, because "choose one—" is how a modal skill opens.
    .replace(/\b(two|three|four|five|six|seven|eight|nine|ten)\b(?=\s+(?:cards?\b|of\b))/gi, (w) => String(SPELLED[w.toLowerCase()]))
    // Older sets hyphenate the verb — "when your ≪Saiyan≫ is KO-ed", "when
    // this card KO-s your opponent's Battle Card" — and every reader of the
    // text spells it the other way.
    .replace(/\bKO-ed\b/gi, "KO'd")
    .replace(/\bKO-s\b/gi, "KOs")
    // A bare carriage return is a line break too: 307 faces in the original
    // game separate their skills with one and carry no `<br>` at all, so
    // splitting on "\n" alone left every skill on those cards fused into one.
    .split(/\r\n?|\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  // The options of a "Choose one—" are printed on their own lines, but they
  // are not skills of their own (20-2): they belong to the line above them.
  const out: string[] = [];
  for (const line of raw) {
    if (BULLET.test(line) && out.length) out[out.length - 1] += ` ・${line.replace(BULLET, "").trim()}`;
    else out.push(...splitRunOn(line));
  }
  return out;
}

/** The tag a skill line opens with (1-5). A reference to one mid-sentence is not this. */
const OPENS_A_SKILL = /^\[(?:auto|activate\s*:|permanent|counter\s*:)/i;

/**
 * A keyword skill carries its own type instead of a type tag (22-1-1), so
 * "[Wish]" and "[Aegis Blue/Yellow]" open a skill exactly as "[Auto]" does.
 * Left out of `OPENS_A_SKILL`, the run-on split below never fired for them:
 * EX24-01's [Wish] and BT16-129's [Aegis] were absorbed into the skill printed
 * in front of them and never parsed as skills at all.
 */
function opensASkill(rest: string): boolean {
  if (OPENS_A_SKILL.test(rest)) return true;
  const tag = /^\[([^\]]+)\]/.exec(rest)?.[1];
  return !!tag && !!keywordOf(tag);
}

/**
 * Some cards are printed without the `<br>` between two skills, so a line
 * arrives as "…: <Towa> with an energy cost of 2 or less. [Auto] When this
 * card is played, …". Left joined, the second skill is never parsed as one —
 * its type is wrong, and when the first line is a keyword that owns its text
 * the whole of it is discarded without even being reported as unread.
 *
 * A sentence ending followed by a skill's opening tag is the break. Reminder
 * text is skipped, because a note may name a tag ("this card isn't affected by
 * [Counter: Play] skills") without starting a skill.
 */
function splitRunOn(line: string): string[] {
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "(" || ch === "（") depth++;
    else if (ch === ")" || ch === "）") depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === "[" && i > start && /[.]\s+$/.test(line.slice(start, i)) && opensASkill(line.slice(i))) {
      const piece = line.slice(start, i).trim();
      if (piece) out.push(piece);
      start = i;
    }
  }
  const last = line.slice(start).trim();
  if (last) out.push(last);
  return out.length ? out : [line];
}

/** The bullet a modal option starts with. The catalog uses several. */
export const BULLET = /^[・･·•‧]\s*/;

// Blue is u rather than b, to leave b for black; White — which BT28 added as
// a sixth colour — is w. `k` is kept as a second spelling of black alongside
// the catalog's own `b`: nothing in 6,493 cards ever prints `{k}` (`{b}`
// appears 248 times), so it cost nothing to find out {b} was the one
// actually missing — every skill-cost or cost-reduction orb written in black
// was reading as an unrecognised letter and losing the whole clause.
const COLOR_BY_LETTER: Record<string, Color> = { r: "Red", u: "Blue", g: "Green", y: "Yellow", k: "Black", b: "Black", w: "White" };
const COLOR_BY_NAME: Record<string, Color> = { red: "Red", blue: "Blue", green: "Green", yellow: "Yellow", black: "Black", white: "White" };

/** "{g}{g}" / "{u}" orbs in a cost → per-colour counts; "{1}" style numbers → any. */
/**
 * "{r}/{u}" is one orb payable with *either* named colour — not with any
 * colour at all, which is what it used to fold into. The colours are carried
 * separately by `eitherOrbsIn` so that every loop over `orbsIn`'s result stays
 * a loop over numbers.
 */
export function eitherOrbsIn(text: string): Color[][] {
  return [...text.matchAll(/\{([rugykbw])\}\/\{([rugykbw])\}/gi)].map((m) => [COLOR_BY_LETTER[m[1].toLowerCase()], COLOR_BY_LETTER[m[2].toLowerCase()]]);
}

export function orbsIn(text: string): Partial<Record<Color, number>> & { any?: number } {
  const out: Partial<Record<Color, number>> & { any?: number } = {};
  const rest = text.replace(/\{[rugykbw]\}\/\{[rugykbw]\}/gi, "");
  for (const m of rest.matchAll(/\{([rugykbw])\}/gi)) {
    const c = COLOR_BY_LETTER[m[1].toLowerCase()];
    out[c] = (out[c] ?? 0) + 1;
  }
  for (const m of rest.matchAll(/\{(\d+)\}/g)) out.any = (out.any ?? 0) + Number(m[1]);
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
  // 22-13-3: printed "[Union-(type)]", but some sets set it with a space.
  // Unrecognised, the whole line falls back to [Permanent] and the skill is
  // read as a standing effect it is not.
  if ((m = /^union[- ](fusion|potara|absorb)$/.exec(t))) {
    const variant = m[1] === "fusion" ? "Fusion" : m[1] === "potara" ? "Potara" : "Absorb";
    return { name: "Union", variant };
  }
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
  // Issue #110 (ui-110-empower-two-colour.md): 22-45-3-1 defines [Empower XY/ZY], but catalog tally
  // confirms 0 cards currently print the two-colour form. Deferred until a card requires it.
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
  for (const m of text.toLowerCase().matchAll(/red|blue|green|yellow|black|white/g)) {
    const c = COLOR_BY_NAME[m[0]];
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

// ── skill lines ────────────────────────────────────────────────────────────

function kindOf(tags: string[], keyword: KeywordSkill | null): SkillKind {
  for (const raw of tags) {
    const t = raw
      .toLowerCase()
      .replace(/\s*:\s*/, ":")
      .replace(/\s+/g, " ");
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
    // A few printings close the bracket with a brace — BT1-074 is "[Auto}
    // When a card evolves into this card". Left unread, the tag is not a tag,
    // so the line becomes a [Permanent] whose text opens with its own trigger.
    const m = /^\s*\[([^\]}]+)[\]}]\s*/.exec(rest);
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
  // A keyword skill writes its cost after the tag with no colon at all:
  // "[Arrival red/green] {r}", "[Successor]{g}{y}". Read as an effect those
  // orbs say nothing, and the engine never learns what the keyword costs.
  if (isOnlyOrbs(body)) return { cost: body.trim(), effect: "" };
  return { cost: "", effect: body };
}

/**
 * Orbs, and at most the condition that follows them — "{g}{y}, if your Leader
 * is a green <Frieza> card". On a keyword line everything after the tag is
 * cost and validity; the keyword's own rules are the effect.
 */
function isOnlyOrbs(body: string): boolean {
  const withoutNotes = body
    .replace(/\([^)]*\)/g, "")
    .replace(/（[^）]*）/g, "")
    .trim();
  // It has to *start* with an orb, or "When this card attacks, draw 1 card"
  // would count as a cost and the whole skill would vanish.
  if (!/^\{[rugykbw\d]\}/i.test(withoutNotes)) return false;
  const rest = withoutNotes
    .replace(/\{[rugykbw\d]\}/gi, "")
    .replace(/\//g, "") // "{r}/{u}": either colour
    // Only a *bare* condition, with no comma of its own: "{g}{y}, if your
    // Leader is a green <Frieza> card" is validity and nothing else, but
    // "{u}, when this card is played, choose up to 1 …" (P-523) is a trigger
    // followed by the effect the trigger sets up, and `.*` used to run past
    // that comma to the end of the line — swallowing the entire effect into
    // the cost and leaving nothing for the skill to do (found when widening
    // the orb letters exposed the same shape for {b}, BT31-097 and P-709).
    .replace(/^[\s,]*(?:if|when|while)\b[^,]*$/i, "")
    .trim();
  return rest.length === 0;
}

/** Parse a card face's whole text into skills. */
export function parseSkills(text: string | null | undefined): Skill[] {
  if (!text) return [];
  // The rules engine holds a card's text as a declared attribute and asks for
  // its skills on every query it answers (`permanents`, `skillsShowing`,
  // `keywordsInForce`), so the same few dozen texts were parsed thousands of
  // times per request — two thirds of a game's CPU. A text always parses the
  // same way, so the answer is kept, frozen, because every caller now shares it.
  let hit = parsedByText.get(text);
  if (!hit) {
    if (parsedByText.size >= PARSED_BY_TEXT_LIMIT) parsedByText.clear();
    hit = deepFreeze(parseSkillsUncached(text));
    parsedByText.set(text, hit);
  }
  return hit;
}

/** Bounded so a long-lived process that reads the whole catalog (`arena:draft`, a sync) cannot grow it without end; the catalog has fewer distinct texts than this. */
const PARSED_BY_TEXT_LIMIT = 20_000;
const parsedByText = new Map<string, Skill[]>();

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function parseSkillsUncached(text: string): Skill[] {
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
    // [Spirit Boost X] is a cost written as a tag (22-43), like [Burst X]: it
    // never names the skill it sits on, which keeps its own [Activate] type.
    const primary = keywords.find((k) => k.name !== "Spirit Boost") ?? null;
    const { cost, effect } = splitCost(body);
    out.push(makeSkill(index * 10, tags, primary?.name === "Rejuvenate" ? rejuvenateOf(cost || effect) : primary, cost, effect, line));
  }
  return out;
}

/**
 * 22-42-2: "[Rejuvenate] skill cost" — what follows the tag is the line's price,
 * not an effect, and the keyword carries its two numbers as parameters so a
 * `DEFINE KEYWORD` can gate on them (#155): the markers "Remove N markers from
 * this card" takes, and the ceiling "if your life is at N or less" adds. The
 * legacy engine reads the same two numbers off the text with the same words
 * (`rejuvenateCost`); a cost in other words carries neither.
 */
function rejuvenateOf(text: string): KeywordSkill {
  const t = text.toLowerCase();
  const markers = /remove (\d+) markers? from this card/.exec(t);
  const life = /your life is at (\d+) or less/.exec(t);
  return { name: "Rejuvenate", ...(markers ? { markers: Number(markers[1]) } : {}), ...(life ? { lifeAtMost: Number(life[1]) } : {}) };
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
    spiritBoost: num(/^spirit boost (\d+)$/),
    markerCost: marker,
    energyCost: orbsIn(cost),
    energyEither: eitherOrbsIn(cost),
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

/**
 * Every keyword skill a list of parsed skills carries, including those on typed
 * lines ("[Auto][Blocker]" is rare but exists).
 *
 * Split out of `keywordsOf` so the same reading can be had from skill *text*
 * alone: the rules engine holds a card's text as a declared attribute and has
 * no `CardDef` to pass (`vm/filters.ts`). Same loop, same order, no second
 * reading of a keyword anywhere.
 */
export function keywordsInSkills(skills: Skill[]): KeywordSkill[] {
  const out: KeywordSkill[] = [];
  for (const s of skills) {
    if (s.keyword) out.push(s.keyword);
    for (const t of s.tags) {
      const k = keywordOf(t);
      if (k && k !== s.keyword && !out.some((o) => JSON.stringify(o) === JSON.stringify(k))) out.push(k);
    }
  }
  return out;
}

/** Every keyword skill a face carries. */
export function keywordsOf(def: CardDef, side: "front" | "back" = "front"): KeywordSkill[] {
  return keywordsInSkills(skillsOf(def, side));
}

export function hasKeyword(def: CardDef, name: KeywordSkill["name"], side: "front" | "back" = "front"): boolean {
  return keywordsOf(def, side).some((k) => k.name === name);
}

export function isZ(def: CardDef): boolean {
  return def.type.startsWith("Z-");
}

/**
 * The description a keyword line prints after its tag and price — [Evolve]{1}:
 * <Nail>'s "<Nail>", [Union-Fusion]'s "<Goku> <Vegeta>". The legacy engine
 * reads `sk.effect || sk.cost` at every keyword site that needs one; this is
 * that reading, named, so the rules engine's `asPrinted` and `eachNamed` read
 * the same words.
 */
export function printedDescription(sk: Pick<Skill, "effect" | "cost">): string {
  return sk.effect || sk.cost;
}

/** The character names a keyword line prints in ‹…› (22-13): "<Goku> <Vegeta>" → ["Goku", "Vegeta"]. */
export function printedNames(sk: Pick<Skill, "effect" | "cost">): string[] {
  return printedDescription(sk).match(/<([^>]+)>/g)?.map((x) => x.slice(1, -1)) ?? [];
}

/**
 * The `eachNamed` condition, read the legacy [Union] way (22-13): for each
 * name, the first card in `pool` order with that character; every name must
 * find one, no card may answer two names, and with `samePower` the cards
 * found must share a power. One reading for both engines.
 */
export function eachNamedHolds(names: string[], pool: { id: string; characters: string[]; power: number }[], samePower: boolean): boolean {
  if (!names.length) return false;
  const found = names.map((n) => pool.find((c) => c.characters.some((x) => x.toLowerCase() === n.toLowerCase())));
  if (found.some((f) => !f) || new Set(found.map((f) => f!.id)).size < names.length) return false;
  return !samePower || new Set(found.map((f) => f!.power)).size === 1;
}

/**
 * The `covers` condition (22-29-3, 22-30-3, 22-34-3): the cards' colours,
 * between them, include every colour named — the legacy `canCoverColors`'
 * reading, one for both engines.
 */
export function coversColors(cardColors: readonly (readonly string[])[], colors: readonly string[]): boolean {
  return colors.every((c) => cardColors.some((cs) => cs.includes(c)));
}

/**
 * The `sumsTo` condition (22-38-2): some non-empty set of these values adds up
 * to exactly `target`, and `target` is above 0 — the legacy `subsetSumExists`
 * with the [Successor] gate's "no energy cost to match" folded in, since an
 * empty set is not a cost.
 */
export function sumReachable(values: readonly number[], target: number): boolean {
  if (target <= 0) return false;
  const reachable = new Set<number>([0]);
  for (const v of values) if (v > 0) for (const r of [...reachable]) if (r + v <= target) reachable.add(r + v);
  return reachable.has(target);
}

export function baseType(def: CardDef): "LEADER" | "BATTLE" | "EXTRA" | "UNISON" {
  const t = def.type.replace(/^Z-/, "");
  return t === "TOKEN" ? "BATTLE" : (t as "LEADER" | "BATTLE" | "EXTRA" | "UNISON");
}

/**
 * Specified cost by convention (proposal §9.1): one orb of each of the card's
 * colours, capped by the total cost. Colorless tokens get none.
 *
 * **An X cost has no baseline this function will invent** (issue #96). The
 * convention above reads the *total* to cap the orbs, and an X cost has no
 * total until the player names one, so there is nothing to read. Nor does the
 * catalog say: the deckplanet feed was checked card by card on 12 Sep 2026 and
 * carries no cost orbs at all — `card_energy_cost` is a bare number, `"X"` or
 * blank on every one of the 6,493 cards, and the orb images appear only inside
 * skill text. BT19-039 is the proof the convention must not be stretched over
 * the gap rather than the reason it could be: the owner's ruling of 9 Sep 2026
 * puts its printed requirement at **2** blue, and one-orb-per-colour would say
 * one. So an X cost answers `{}` — no colour demanded — and `playCost` charges
 * the total alone, which is the same price the engine charged before and is
 * wrong only in being lenient.
 *
 * `def.specifiedCost` is the way out, and it is honoured for an X cost like any
 * other: a card whose orbs are actually known carries them and the whole
 * mechanism runs. Since issue #255 that is where a **hand-entered** baseline
 * arrives: the `cards.specified_cost` column (orb notation, `{u}{u}`), entered
 * from the rules record on the workbench or seeded by a migration on a ruling
 * (BT19-039 = two blue, the owner's ruling of 9 Sep 2026), read onto the def
 * by `cardDefFrom` through `parseSpecifiedCost` (`specified-cost.ts`), and
 * `coalesce`d by the catalog upsert so `sync:catalog` never erases it. What is
 * missing for the rest is the data, not the reading. `npm run arena:specified`
 * lists every card still waiting on it, and `specifiedCostUnknown` below is
 * how the record, the probe and the report say "incomplete" about one.
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

/**
 * True when this card's coloured requirement is the engine declining to guess
 * rather than a fact — an X cost with no `specifiedCost` on the def.
 *
 * `specifiedCostOf` answers `{}` for both "this card demands no colour" and
 * "nobody knows what this card demands", and the two are not the same claim:
 * the first is a price, the second is a gap. Anything that *reports* on a cost
 * — the workbench, the probe's assumptions, `arena:specified` — asks this so it
 * can say which it is. Nothing that *charges* one needs to: an unknown baseline
 * is charged as no colour either way.
 */
export function specifiedCostUnknown(def: CardDef): boolean {
  return def.energyCost === "X" && !def.specifiedCost;
}

/** 5-7-2: a card can only combo with both a non-negative combo cost and combo power. */
export function canCombo(def: CardDef): boolean {
  return baseType(def) === "BATTLE" && def.comboCost != null && def.comboPower != null && def.comboCost >= 0 && def.comboPower >= 0;
}

/**
 * The words a card name puts in front of a character to say which form it is
 * in — "SS Gogeta", "SSB Kaio-Ken Son Goku", "Great Ape Son Gohan" — which are
 * part of the card name (2-2) and not of the character's (2-10). Matched as
 * whole words from the front of the phrase, any number of them in a row.
 */
const FORM_WORDS = /^(?:(?:SS(?:GSS|[234BG])?|SS Rose|Rose|Super Saiyan(?: (?:God(?: Super Saiyan)?|Blue|Rose|[234]))?|Golden|Great Ape|Ultra Instinct|Kaio-Ken|Full-Power)\s+)+/i;

/** "Son Goku: GT" → { base: "Son Goku", era: ": GT" }; a name with no era has an empty one. */
function splitEra(character: string): { base: string; era: string } {
  const m = /^(.*?)(\s*:\s*\S.*)$/.exec(character);
  return m ? { base: m[1].trim(), era: m[2].replace(/^\s*:\s*/, ": ") } : { base: character.trim(), era: "" };
}

const backCharactersCache = new WeakMap<CardDef, string[]>();

/**
 * 1-9, 2-10: the character names a Leader's **back side** carries.
 *
 * The catalog records a card's characters once, off the front (the feed's
 * `card_character`; there is no back-side column), so the back's are read off
 * the back side's own name. A Leader's card name is the character's name with
 * the form in front and the epithet after the last comma —
 * "SS Gogeta, Situation Reversal Fusion" is <Gogeta>, "Son Goku, Pan, &
 * Trunks, Space Adventurers" is <Son Goku>, <Pan> and <Trunks> — so the reading
 * is: drop the epithet, split the people on "&", "," and "and", and for each
 * one take
 *   - a front character the phrase contains as whole words ("SS Son Goku" →
 *     <Son Goku>), era and all, since the back of a <Son Goku: GT> Leader is
 *     still that Son Goku;
 *   - otherwise the phrase with its form words (`FORM_WORDS`) taken off the
 *     front ("SSB Vegito" → <Vegito>), which carries the front's era only when
 *     every front character shares it and there are two or more — the fusion
 *     of <Son Goku: GT> and <Vegeta: GT> is <Gogeta: GT>, while the partner
 *     Android 18 beside a lone <Son Goku: GT> is not <Android 18: GT>.
 * A name with no comma has no epithet to tell the character from, so there a
 * phrase is read only when it is one of those two; "Miracle Strike Gogeta"
 * is neither, and is left alone rather than guessed at.
 * Pure and read once per definition, like `skillsOf`. Empty for a card with
 * no back; a back whose name reads to nothing keeps the front's characters,
 * which is what was read before this existed.
 */
export function backCharactersOf(def: CardDef): string[] {
  if (!def.back?.name) return [];
  const cached = backCharactersCache.get(def);
  if (cached) return cached;
  const name = def.back.name.replace(/[\u3000\s]+/g, " ").trim();
  const comma = name.lastIndexOf(", ");
  const front = def.characters.map(splitEra);
  const eras = [...new Set(front.map((f) => f.era))];
  const sharedEra = front.length >= 2 && eras.length === 1 ? eras[0] : "";
  /**
   * One phrase's characters, and whether any of them is one the front carries.
   * `bare` is a phrase with no epithet beside it, where a person that is
   * neither a front character nor a form word and a name is not read at all.
   */
  const read = (phrase: string, bare: boolean): { characters: string[]; known: boolean } => {
    const characters: string[] = [];
    let known = false;
    for (const raw of phrase.split(/\s*,\s*&\s*|\s*&\s*|\s*,\s*|\s+and\s+/)) {
      const person = raw.replace(/\s+Returns$/i, "").trim();
      if (!person) continue;
      const words = ` ${person.toLowerCase()} `;
      // Whole words, and not the start of a longer name: <Cell Jr.> is not
      // <Cell> (2-10-1-1).
      const holds = (base: string) => words.includes(` ${base} `) && !words.includes(` ${base} jr. `);
      const same = front.filter((f) => f.base && holds(f.base.toLowerCase())).sort((x, y) => y.base.length - x.base.length)[0];
      const bareName = person.replace(FORM_WORDS, "");
      if (!same && bare && (bareName === person || !bareName)) continue;
      const character = same ? same.base + same.era : (bareName || person) + sharedEra;
      if (same) known = true;
      if (!characters.some((c) => c.toLowerCase() === character.toLowerCase())) characters.push(character);
    }
    return { characters, known };
  };
  // The epithet is after the last comma — except on the few names printed the
  // other way round ("Going All In, SSB Vegito"), which the front's own
  // characters give away.
  const title = read(comma > 0 ? name.slice(0, comma) : name, comma < 0);
  const tail = comma > 0 && !title.known ? read(name.slice(comma + 2), false) : null;
  const result = tail?.known ? tail.characters : title.characters.length ? title.characters : def.characters;
  backCharactersCache.set(def, result);
  return result;
}

/** Character names are `<Name>` in text; a card "has" a character when it is in `characters`. */
export function hasCharacter(def: CardDef, name: string): boolean {
  const n = name.toLowerCase();
  return def.characters.some((c) => c.toLowerCase() === n);
}

/**
 * "<Son Goku> **in its character name**": part of a character name, not the
 * whole one.
 *
 * The loose twin of `hasCharacter`, and separate from it on purpose. 2-10-1-1
 * says <Son Goku> and <Son Goku : Childhood> are different character names, so
 * a card that names one exactly must be answered exactly; this phrase is what
 * a card prints when it means both, and only this phrase gets the loose
 * reading. See `charactersIncluding` in `filters.ts`.
 */
export function characterIncludes(def: CardDef, part: string): boolean {
  const n = part.toLowerCase();
  return def.characters.some((c) => c.toLowerCase().includes(n));
}

/** The same, against the printed card name: "{SS4} in its card name". */
/**
 * Every card name this card answers to (20-1): its printed one, and any it was
 * "also treated as in all areas". Only `cardNow` ever fills the second, so a
 * plain catalog row is just its own name.
 */
export function namesOf(def: CardDef): string[] {
  return def.alsoNames?.length ? [def.name, ...def.alsoNames] : [def.name];
}

export function nameIncludes(def: CardDef, part: string): boolean {
  const p = part.toLowerCase();
  return namesOf(def).some((n) => n.toLowerCase().includes(p));
}

export function hasTrait(def: CardDef, name: string): boolean {
  const n = name.toLowerCase();
  return def.traits.some((c) => c.toLowerCase() === n);
}

/**
 * The moments a skill can be triggered by that are printed as a phrase rather
 * than a “when …”. Spelled out rather than left as “at the … of anything”: a
 * loose tail swallows the rest of the sentence, and “at the end of the battle
 * for this card **or at the end of the turn**” (BT25-040) then reads as one
 * moment made of both.
 */
// The possessive admits both players named at once — "at the end of you and
// your opponent's turns" (EX24-20), "at the end of each player's turn" — for
// the same reason `EVERY_TURN_END` reads them in `triggers.ts`: a phrase this
// does not admit is not a trailing trigger, so EX24-20's [Auto] had no moment
// to fire at and the card never left the game. Plurals with it: the wording
// that names both players names their turns in the plural.
const TIMING_PHRASE = /at the (?:beginning|start|end) of (?:(?:you|your) (?:and|or) your opponent'?s|each player'?s|your opponent'?s|your|the|this|a) (?:next )?(?:turns?|battle|charge phase|main phases?|offense step|defense step|damage step)/;

/**
 * The head of a skill's effect: where a trigger has to be printed.
 *
 * A validity condition may come before it rather than before the colon — “If
 * your Leader Card is red, at the end of your turn, …”, or with the sets' own
 * bar between them — and the trigger after it is still the head of the
 * sentence. A “when …” in front of it is not: that is the trigger itself, and
 * what follows is a delayed effect.
 */
export function effectHead(effect: string): string {
  return effect
    .toLowerCase()
    .trim()
    .replace(/^if [^,|]{0,90}[,|]\s*/, "");
}

/**
 * The timing phrase an [Auto]'s trigger has to be read from when it is printed
 * at the *end* of the sentence rather than at its head: “you may place 1 card
 * from your hand in the Drop Area **at the end of the battle**” (BT3-103).
 *
 * A trigger is normally the head and nothing else, because 116 skills merely
 * *mention* a moment mid-effect and mean a delayed effect by it. But a delayed
 * effect needs a trigger to schedule it, and a skill like BT3-103 has none: read
 * by the head rule alone its [Auto] never pends at all, and the card does
 * nothing. So when there is nothing else to fire on, the trailing phrase is the
 * trigger after all — and being the trigger, it is no longer part of the effect.
 *
 * Only then. A “when …” anywhere is the skill's own trigger — every trigger the
 * engine reads that is not a timing phrase is written with that word — and the
 * timing phrase beside it is the delay that trigger schedules.
 */
export function trailingTrigger(sk: Skill): string | null {
  if (sk.kind !== "auto") return null;
  if (/\bwhen\b/i.test(`${sk.cost} ${sk.effect}`)) return null;
  const head = effectHead(sk.effect);
  if (new RegExp(`^${TIMING_PHRASE.source}`).test(head)) return null;
  // It has to *end* the sentence it is in, rather than sit in the middle of one.
  const first = (head.split(/(?<=[.])\s+/)[0] ?? head).trim();
  // And it has to be the only moment that sentence names. “Remove this card from
  // the game at the end of the battle for this card **or** at the end of the
  // turn” (BT25-040) names two, which is a shape this does not read — and taking
  // one of them would remove the card at a moment the text does not say.
  if ((first.match(new RegExp(TIMING_PHRASE.source, "g")) ?? []).length !== 1) return null;
  const m = new RegExp(`\\s(${TIMING_PHRASE.source})[.]?$`).exec(first);
  return m ? m[1] : null;
}

/** The effect with `phrase` taken out of it — a trigger is not also an effect. */
export function withoutTrailingTrigger(effect: string, phrase: string): string {
  const at = effect.toLowerCase().lastIndexOf(phrase);
  if (at < 0) return effect;
  return `${effect.slice(0, at).replace(/\s+$/, "")}${effect.slice(at + phrase.length)}`;
}

/** The printed name of a keyword, with its number folded in: [Double Strike], [Over Realm 4]. */
export function keywordName(k: KeywordSkill): string {
  switch (k.name) {
    case "Strike":
      return { 2: "Double Strike", 3: "Triple Strike", 4: "Quadruple Strike" }[k.x];
    case "Attack":
      return k.x === 2 ? "Dual Attack" : "Triple Attack";
    case "Over Realm":
      return `${k.dark ? "Dark " : ""}Over Realm ${k.x}`;
    case "Swap":
      return `Swap ${k.x}`;
    case "Spirit Boost":
      return `Spirit Boost ${k.x}`;
    case "Z-Stack":
      return `Z-Stack ${k.x}`;
    case "Empower":
      return `Empower ${k.color ?? ""} ${k.x}`.replace(/\s+/g, " ").trim();
    case "Arrival":
    case "Aegis":
    case "Alliance":
    case "Revive":
      return `${k.name} ${k.colors.join("/")}`;
    case "Evolve":
      return k.variant;
    case "Union":
      return `Union-${k.variant}`;
    default:
      return k.name;
  }
}
