/**
 * Card-description text → predicate. Keyword conditions on cards name their
 * targets in a fixed grammar ("Blue <Baby> with an energy cost of 4",
 * "yellow non-≪Great Ape≫ <Son Goku: Childhood> card with an energy cost of 3
 * or less", "1 {Four-Star Ball, Parasitic Darkness}"). Reading that grammar
 * lets the engine offer the right candidates for Evolve, Union, Z-Stack,
 * Z-Awaken and Swap without a compiled script.
 */
import { baseType, hasCharacter, hasKeyword, hasTrait, keywordOf, keywordsOf } from "./cards";
import type { CardDef, Color, KeywordSkill } from "./types";

export interface CardFilter {
  colors: Color[];
  monoColor: boolean;
  /** "Multicolor <Pan> cards": two colours or more, which is not the opposite of mono-colour on a colourless card. */
  multiColor: boolean;
  characters: string[];
  notCharacters: string[];
  traits: string[];
  notTraits: string[];
  names: string[];
  /**
   * "Choose up to 1 Battle Card **other than** {Vegito, Powers Combined}" — a
   * name the target must not have. Thirty-six cards print the wording, and
   * read as an ordinary name it required the very card it excludes.
   */
  notNames: string[];
  type: "LEADER" | "BATTLE" | "EXTRA" | "UNISON" | null;
  /** "Non-Leader card under this card" — the type it must *not* be. */
  notType: "LEADER" | "BATTLE" | "EXTRA" | "UNISON" | null;
  /**
   * "2 **non-black** Battle Cards in your opponent's Drop Area": a colour the
   * card must not have. Read as nothing, the phrase selected black cards too —
   * a measure the parser drops widens the selection rather than narrowing it.
   */
  notColors: Color[];
  /**
   * "A blue **non-[Super Combo]** Battle Card", "a red **non-[Field]** Extra".
   * Read off the printed skills, which is what the wording is about: a keyword
   * an effect granted this turn does not make the card one of these.
   */
  notKeywords: KeywordSkill["name"][];
  /**
   * "1 red Extra Card with an energy cost of 1 and **no keyword skills**"
   * (BT29-001, P-247, XD1-08 and eight more). A measure that narrows, so
   * leaving it unread offered every card in the area instead.
   */
  noKeywords: boolean;
  /**
   * "Face-up ≪Boujack Brigade≫ cards" (3-9-2-1). Unlike every other measure
   * here this one is about the *instance*, not the card, so `matches` cannot
   * answer it — `resolveSelector` checks it where the instance is known.
   */
  faceUp: boolean;
  /**
   * "Choose 1 of your Earthling Tokens and switch it to Rest Mode" (19): a
   * token is named by what it is, and the name alone would also match a
   * printed card of that name, so the type is carried with it.
   */
  token: boolean;
  /** "Your opponent's **non-token** Battle Cards" (19-1-5): the other way round. */
  notToken: boolean;
  /** Energy cost bounds, inclusive. */
  costMin: number | null;
  costMax: number | null;
  powerMin: number | null;
  powerMax: number | null;
  /**
   * "with power less than or equal to this card's power" — a bound read off
   * the card whose skill this is, so it is applied where the skill runs
   * (`resolveSelector`), not here.
   */
  powerRel: { of: "self"; cmp: "<=" | "<" | ">=" | ">" } | null;
  z: boolean | null;
}

const COLOR_WORDS: Record<string, Color> = { red: "Red", blue: "Blue", green: "Green", yellow: "Yellow", black: "Black" };

/** Grammar that can sit between the number and a token's name, never part of it. */
const TOKEN_STOP = new Set(["of", "your", "their", "the", "opponent's", "opponents", "up", "to", "and", "or", "all", "each", "other", "another"]);

export function parseFilter(text: string): CardFilter {
  const f: CardFilter = { colors: [], notColors: [], monoColor: false, multiColor: false, characters: [], notCharacters: [], traits: [], notTraits: [], names: [], notNames: [], notKeywords: [], noKeywords: false, type: null, notType: null, faceUp: false, token: false, notToken: false, costMin: null, costMax: null, powerMin: null, powerMax: null, powerRel: null, z: null };
  let t = text.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  // "Choose up to 1 Battle Card **other than** <Grand Supreme Kai>" (SD15-01,
  // in the owner's own decks) says which card is *excluded*. Read by the loops
  // below it became a card the target had to *be* — the filter inverted rather
  // than widened, which is the worst way for a selector to be wrong. It is the
  // same thing "non-<X>" says, so it lands in the same lists; the tokens are
  // then taken out of the text so the positive loops cannot see them.
  const NAMED = /<[^>]+>|≪[^≫]+≫|\{[^}]+\}/;
  const EXCLUDED = new RegExp(`\\bother than (?:copies of )?((?:(?:${NAMED.source})(?:\\s*(?:,|and/or|and|or)\\s*)?)+)`, "g");
  t = t.replace(EXCLUDED, (whole, run: string) => {
    for (const m of run.matchAll(/<([^>]+)>|≪([^≫]+)≫|\{([^}]+)\}/g)) {
      if (m[1]) f.notCharacters.push(m[1].trim());
      else if (m[2]) f.notTraits.push(m[2].trim());
      else if (m[3]) f.notNames.push(m[3].trim());
    }
    // Keep the words, drop the names: "other than" itself carries no measure,
    // and removing the whole phrase would take a following "in your Battle
    // Area" with it on some wordings.
    return " other than ";
  });
  for (const m of t.matchAll(/(non-)?<([^>]+)>/g)) (m[1] ? f.notCharacters : f.characters).push(m[2].trim());
  for (const m of t.matchAll(/(non-)?≪([^≫]+)≫/g)) (m[1] ? f.notTraits : f.traits).push(m[2].trim());
  for (const m of t.matchAll(/\{([^}]+)\}/g)) if (!/^[rugyk]$|^\d+$/i.test(m[1])) f.names.push(m[1].trim());
  const lower = t.toLowerCase();
  // Colour words are read off the description with every *name* taken out of
  // it. ≪Red Ribbon Army≫, <Goku Black>, <Commander Red>, {Super Saiyan Blue
  // Vegeta} and [Revive Blue/Green] all carry a colour word that says nothing
  // about the card's colour, and reading it made "a **blue** ≪Red Ribbon
  // Army≫ card" mean blue *or* red. While several colours meant *all* of them
  // that filter merely matched nothing; since they mean *either* (see
  // `matches`) it selects the opponent's red ones too — the same mis-read,
  // turned from a missing effect into a wrong one. 39 selectors and one
  // [Auto] trigger read this way.
  const colourText = lower
    .replace(/<[^>]*>/g, " ")
    .replace(/≪[^≫]*≫/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\[[^\]]*\]/g, " ");
  if (/\bmono-?colou?r\b|\bmono-(red|blue|green|yellow|black)\b/.test(lower)) f.monoColor = true;
  if (/\bmulti-?colou?r(?:ed)?\b/.test(lower)) f.multiColor = true;
  // "Use up to 1 face-up ≪Turles Crusher Corps≫ card from your life in a combo"
  // (3-9-2-1). "Face down" is never a way a card is picked out, so only the
  // one direction is read.
  if (/\bface[- ]up\b/.test(lower)) f.faceUp = true;
  // "Non-black Battle Cards": the colour is one the card must *not* have, and
  // reading it as an ordinary colour word would invert the phrase.
  for (const m of colourText.matchAll(/\bnon-(red|blue|green|yellow|black)\b/g)) {
    const c = COLOR_WORDS[m[1]];
    if (!f.notColors.includes(c)) f.notColors.push(c);
  }
  for (const m of colourText.matchAll(/(non-)?\b(red|blue|green|yellow|black)\b/g)) {
    if (m[1]) continue;
    const c = COLOR_WORDS[m[2]];
    if (!f.colors.includes(c) && !f.notColors.includes(c)) f.colors.push(c);
  }
  // "…with an energy cost of 1 **and no keyword skills**" — none at all, which
  // the sets also write "skill-less" for a card with no text whatsoever. This
  // one is only about the keywords, so a card with an [Auto] and no keyword
  // still qualifies.
  if (/\bno keyword skills?\b|\bno keywords\b/.test(lower)) f.noKeywords = true;
  // "A blue non-[Super Combo] Battle Card" — a keyword the card must not have.
  for (const m of lower.matchAll(/\bnon-\[([a-z0-9:\- ]+)\]/g)) {
    const kw = keywordOf(m[1]);
    if (kw && !f.notKeywords.includes(kw.name)) f.notKeywords.push(kw.name);
  }
  if (/\bz-(leader|battle|extra|unison)\b|\bz-card\b/.test(lower)) f.z = true;
  // "Choose 1 of your Earthling Tokens", "up to 2 Cell Jr. tokens in your
  // Battle Area", "switch 1 of your Chilled Army tokens to rest" (19). The
  // name sits straight before the word, but a character class that admits
  // spaces starts as early as it can, so it is bounded to three words and the
  // grammar in front of it is then dropped. "1 token with combo power" names
  // no token and must come out with nothing rather than with a name of "1".
  // "Your opponent's non-token Battle Cards" (19-1-5) is the other way round,
  // and has to be read first — otherwise the name below takes "non-token" for
  // a token called "non".
  if (/\bnon-tokens?\b/.test(lower)) f.notToken = true;
  const tok = f.notToken ? null : /\b([a-z0-9'.-]+(?: [a-z0-9'.-]+){0,2}) tokens?\b/.exec(lower);
  if (tok) {
    const words = tok[1].split(" ");
    while (words.length && (TOKEN_STOP.has(words[0]) || /^\d+$/.test(words[0]))) words.shift();
    if (words.length) {
      f.token = true;
      f.names.push(words.join(" "));
    }
  }
  // "Non-Leader card" is the type it must not be, and reading it as the type
  // itself inverted the filter — a stack of "non-Leader cards" became Leaders.
  const typeWord = (re: RegExp): "yes" | "no" | null => (new RegExp(`non-${re.source}`).test(lower) ? "no" : re.test(lower) ? "yes" : null);
  for (const [re, type] of [
    [/\bleader( card)?\b/, "LEADER"],
    [/\bunison( card)?\b/, "UNISON"],
    [/\bextra( card)?\b/, "EXTRA"],
    [/\bbattle card\b/, "BATTLE"],
  ] as const) {
    const said = typeWord(re);
    if (said === "no") f.notType ??= type;
    else if (said === "yes" && !f.type) f.type = type;
  }
  let m: RegExpExecArray | null;
  if ((m = /energy cost (?:of )?(\d+) or less/.exec(lower))) f.costMax = Number(m[1]);
  else if ((m = /energy cost (?:of )?(\d+) or more/.exec(lower))) f.costMin = Number(m[1]);
  else if ((m = /energy cost (?:of )?between (\d+) and (\d+)/.exec(lower))) {
    f.costMin = Number(m[1]);
    f.costMax = Number(m[2]);
  } else if ((m = /energy cost (?:of )?(\d+)\b/.exec(lower))) f.costMin = f.costMax = Number(m[1]);
  if ((m = /(\d+) power or less/.exec(lower))) f.powerMax = Number(m[1]);
  else if ((m = /(\d+) power or more/.exec(lower))) f.powerMin = Number(m[1]);
  // An exact power, which searches print alongside the cost: "a yellow
  // <Son Goku> card with an energy cost of 3 and 5000 power". Only after
  // "with"/"and", so that "it gets +5000 power for the turn" is not read as a
  // bound on the target.
  else if ((m = /\b(?:with|and) (\d+) power\b/.exec(lower))) f.powerMin = f.powerMax = Number(m[1]);
  // "with power less than or equal to this card's power", "with power greater
  // than this card's power" — measured against the card the skill is on.
  if ((m = /power (less than or equal to|equal to or less than|no more than|at or below|less than|lower than|greater than or equal to|equal to or greater than|no less than|at or above|greater than|higher than|more than) (?:this card'?s|its) power/.exec(lower))) {
    const w = m[1];
    const cmp = /^(?:less than or equal|equal to or less|no more|at or below)/.test(w) ? "<=" : /^(?:less|lower)/.test(w) ? "<" : /^(?:greater than or equal|equal to or greater|no less|at or above)/.test(w) ? ">=" : ">";
    f.powerRel = { of: "self", cmp };
  }
  return f;
}

/** The relative power bound, given the power of the card the skill is on. */
export function powerRelOk(f: CardFilter, power: number, own: number): boolean {
  if (!f.powerRel) return true;
  switch (f.powerRel.cmp) {
    case "<=":
      return power <= own;
    case "<":
      return power < own;
    case ">=":
      return power >= own;
    case ">":
      return power > own;
  }
}

export function matches(d: CardDef, f: CardFilter): boolean {
  if (f.z != null && d.type.startsWith("Z-") !== f.z) return false;
  if (f.token && d.type !== "TOKEN") return false;
  if (f.notToken && d.type === "TOKEN") return false;
  if (f.type && baseType(d) !== f.type) return false;
  if (f.notType && baseType(d) === f.notType) return false;
  // Several colours in one description mean *either* of them — "blue, yellow
  // ≪Universe 6≫ cards", "if your Leader Card is green or yellow" — and a card
  // has to be all of them only when the text says it is one card in both
  // colours at once, which is what "Red/Yellow **multicolor**" says. Requiring
  // all of them everywhere made every such filter match nothing at all.
  const colourOk = f.multiColor ? f.colors.every((c) => d.colors.includes(c)) : f.colors.some((c) => d.colors.includes(c));
  if (f.colors.length && !colourOk) return false;
  if (f.notColors.some((c) => d.colors.includes(c))) return false;
  if (f.notKeywords.some((k) => hasKeyword(d, k))) return false;
  if (f.noKeywords && keywordsOf(d).length) return false;
  if (f.monoColor && d.colors.length !== 1) return false;
  if (f.multiColor && d.colors.length < 2) return false;
  if (f.characters.length && !f.characters.some((c) => hasCharacter(d, c))) return false;
  if (f.notCharacters.some((c) => hasCharacter(d, c))) return false;
  if (f.traits.length && !f.traits.some((c) => hasTrait(d, c))) return false;
  if (f.notTraits.some((c) => hasTrait(d, c))) return false;
  if (f.names.length && !f.names.some((n) => n.toLowerCase() === d.name.toLowerCase())) return false;
  if (f.notNames.some((n) => n.toLowerCase() === d.name.toLowerCase())) return false;
  const cost = typeof d.energyCost === "number" ? d.energyCost : null;
  if (f.costMin != null && (cost == null || cost < f.costMin)) return false;
  if (f.costMax != null && (cost == null || cost > f.costMax)) return false;
  if (f.powerMin != null && (d.power == null || d.power < f.powerMin)) return false;
  if (f.powerMax != null && (d.power == null || d.power > f.powerMax)) return false;
  return true;
}

/** "When your life is at 4 or less" and friends — the conditions Awaken/Wish print most often. */
export interface SimpleCondition {
  lifeAtMost: number | null;
  opponentLifeAtMost: number | null;
  energyAtLeast: number | null;
  totalEnergyAtLeast: number | null;
  dropAtLeast: number | null;
  /** Parsed something the engine can check; false = leave to a script / the referee. */
  recognised: boolean;
}

export function parseCondition(text: string): SimpleCondition {
  const c: SimpleCondition = { lifeAtMost: null, opponentLifeAtMost: null, energyAtLeast: null, totalEnergyAtLeast: null, dropAtLeast: null, recognised: false };
  const t = text.toLowerCase();
  let m: RegExpExecArray | null;
  if ((m = /your opponent'?s life is (?:at )?(\d+) or less/.exec(t))) {
    c.opponentLifeAtMost = Number(m[1]);
    c.recognised = true;
  }
  if ((m = /(?<!opponent'?s )(?:your )?life is (?:at )?(\d+) or less/.exec(t))) {
    c.lifeAtMost = Number(m[1]);
    c.recognised = true;
  }
  if ((m = /total of (\d+) or more energy between you and your opponent/.exec(t))) {
    c.totalEnergyAtLeast = Number(m[1]);
    c.recognised = true;
  }
  if ((m = /you have (\d+) or more energy/.exec(t))) {
    c.energyAtLeast = Number(m[1]);
    c.recognised = true;
  }
  if ((m = /(\d+) or more cards in your drop/.exec(t))) {
    c.dropAtLeast = Number(m[1]);
    c.recognised = true;
  }
  // Conditions with a further clause ("and you have a Blue/Green card in your energy") are only partly read.
  if (c.recognised && /\band\b|\bwhen you have\b.*\bin your energy\b/.test(t) && !c.totalEnergyAtLeast) c.recognised = false;
  return c;
}
