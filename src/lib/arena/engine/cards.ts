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
const TIMING_PHRASE = /at the (?:beginning|start|end) of (?:your opponent'?s|your|the|this|a) (?:next )?(?:turn|battle|charge phase|main phase|offense step|defense step|damage step)/;

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
