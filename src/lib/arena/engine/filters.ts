/**
 * Card-description text → predicate. Keyword conditions on cards name their
 * targets in a fixed grammar ("Blue <Baby> with an energy cost of 4",
 * "yellow non-≪Great Ape≫ <Son Goku: Childhood> card with an energy cost of 3
 * or less", "1 {Four-Star Ball, Parasitic Darkness}"). Reading that grammar
 * lets the engine offer the right candidates for Evolve, Union, Z-Stack,
 * Z-Awaken and Swap without a compiled script.
 */
import { baseType, characterIncludes, hasCharacter, hasKeyword, hasTrait, keywordOf, keywordsOf, nameIncludes, namesOf, skillsOf } from "./cards";
import type { CardDef, Color, KeywordSkill, SkillKindPrefix } from "./types";

export interface CardFilter {
  colors: Color[];
  monoColor: boolean;
  /** "Multicolor <Pan> cards": two colours or more, which is not the opposite of mono-colour on a colourless card. */
  multiColor: boolean;
  characters: string[];
  notCharacters: string[];
  /**
   * "≪Goku's Lineage≫ with **<Son Goku> in its character name**", "cards with
   * **<GT> in their character names**" — *part* of a character name rather
   * than the whole one.
   *
   * A separate list because 2-10-1-1 makes the two readings genuinely
   * different: a bare <Son Goku> is not <Son Goku : GT>, so exact is right for
   * the bare token and wrong for this phrase. Reading this wording as the bare
   * token left BT4-096 asking whether "Son Goku: GT" was exactly "Son Goku",
   * finding it was not, and quietly granting neither the +15000 nor the
   * [Double Strike] — one of 162 cards in the original game that print one of
   * these phrases and, until now, matched nothing at all.
   *
   * It is answered in the same `some` as `characters`, not as a second
   * requirement: "<Pan> card or card with <GT> in its character name"
   * (BT25-068) is one choice with two ways to satisfy it.
   */
  charactersIncluding: string[];
  /** "…without <Turles> in their character names" (BT24-099). */
  notCharactersIncluding: string[];
  traits: string[];
  notTraits: string[];
  names: string[];
  /**
   * "Choose up to 1 Battle Card **other than** {Vegito, Powers Combined}" — a
   * name the target must not have. Thirty-six cards print the wording, and
   * read as an ordinary name it required the very card it excludes.
   */
  notNames: string[];
  /**
   * The same measure against the printed card name: "{SS4} in its card name"
   * (EX23-49), "card whose card name includes {Baby}" (BT3-017). Shares the
   * `some` with `names` for the same reason `charactersIncluding` shares one
   * with `characters`.
   */
  namesIncluding: string[];
  notNamesIncluding: string[];
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
   * "Up to 1 opponent Battle Card **with [Blocker]**", "a yellow ≪Demon Realm≫
   * card **with an [Evolve] skill**". Ground rule 5's second named widening:
   * dropped, the phrase chose any card in the area, on 83 selectors.
   *
   * Compared by keyword *name* only, so "with the [Revive Blue/Green] skill"
   * matches a card whose [Revive] names other colours. The narrower reading
   * would need the parameters, which only two cards in the catalog print.
   */
  keywords: KeywordSkill["name"][];
  /**
   * "Mono-blue cards **with [Counter] skills**", "an Extra Card with the
   * [Activate: Main] skill" — a kind of skill rather than a keyword, and the
   * one shape `keywordOf` cannot answer.
   */
  skillKind: SkillKindPrefix | null;
  /**
   * A bracketed word in the description that is neither of those. Nothing may
   * be selected on a guess, so `filterFor` refuses the whole phrase rather
   * than quietly widening it (ground rule 5).
   */
  unreadable: boolean;
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

const COLOR_WORDS: Record<string, Color> = { red: "Red", blue: "Blue", green: "Green", yellow: "Yellow", black: "Black", white: "White" };

/**
 * Keyword families a target description names without the parameters the
 * printed tag carries: a card "with a **[Union]** skill" means any of
 * [Union-Fusion], [Union-Potara] and [Union-Absorb], and `keywordOf` only
 * reads the hyphenated forms. Deliberately a list rather than a rule — every
 * other keyword is named in full, and guessing at one is how a filter starts
 * matching cards the text never mentioned.
 */
const KEYWORD_FAMILIES = new Set(["union"]);

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());

/** Grammar that can sit between the number and a token's name, never part of it. */
const TOKEN_STOP = new Set(["of", "your", "their", "the", "opponent's", "opponents", "up", "to", "and", "or", "all", "each", "other", "another"]);

/** A filter that says nothing: every measure at rest. What a program's filter is filled up from before it is read. */
export function emptyFilter(): CardFilter {
  return {
    colors: [],
    notColors: [],
    monoColor: false,
    multiColor: false,
    characters: [],
    notCharacters: [],
    charactersIncluding: [],
    notCharactersIncluding: [],
    traits: [],
    notTraits: [],
    names: [],
    notNames: [],
    namesIncluding: [],
    notNamesIncluding: [],
    notKeywords: [],
    keywords: [],
    skillKind: null,
    unreadable: false,
    noKeywords: false,
    type: null,
    notType: null,
    faceUp: false,
    token: false,
    notToken: false,
    costMin: null,
    costMax: null,
    powerMin: null,
    powerMax: null,
    powerRel: null,
    z: null,
  };;
}

export function parseFilter(text: string): CardFilter {
  const f = emptyFilter();
  let t = text.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  // "Choose up to 1 Battle Card **other than** <Grand Supreme Kai>" (SD15-01,
  // in the owner's own decks) says which card is *excluded*. Read by the loops
  // below it became a card the target had to *be* — the filter inverted rather
  // than widened, which is the worst way for a selector to be wrong. It is the
  // same thing "non-<X>" says, so it lands in the same lists; the tokens are
  // then taken out of the text so the positive loops cannot see them.
  //
  // The run may open with "this card", which is not a name and is answered by
  // the selector's own `notSelf` rather than by a list here — but leaving it
  // to anchor the phrase meant the names *after* it were never reached.
  // TB1-015's "choose all Battle Cards with 25000 or less power other than
  // this card **or your <Caulifla>**, and KO them" excluded the card printing
  // it and then required <Caulifla>, so the skill KO'd precisely the cards it
  // was written to spare. A possessive may stand in front of each name for the
  // same reason.
  const NAMED = /(?:your |their |its owner's )?(?:<[^>]+>|≪[^≫]+≫|\{[^}]+\})/;
  const JOIN = /(?:\s*(?:,|and\/or|and|or)\s*)?/;
  const EXCLUDED = new RegExp(`\\bother than (?:copies of )?(?:this card${JOIN.source})?((?:${NAMED.source}${JOIN.source})+)`, "g");
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
  // "…with <Son Goku> in its character name", "…{SS4} in its card name",
  // "…without <Turles> in their character names". Read before the exact loops
  // below and taken out of the text, so a token the phrase governs cannot also
  // be claimed as a whole name. See `charactersIncluding`.
  // The negation is written three ways and only two were read: BT21-040 prints
  // "your opponent's Battle Cards **that does not include** <Son Goku: GT> in
  // its character name", and matched as a positive it named the one card the
  // sentence rules out. Until 9 Sep 2026 nothing noticed, because the measure
  // was thrown away before it reached a selector (see `narrows` in
  // `compile.ts`) — the filter was wrong and the selector had none at all.
  t = t.replace(/(without\s+|non-|(?:that |which )?does\s?n'?o?t include\s+)?(<[^>]+>|\{[^}]+\})\s+in (?:its|their) (character|card) names?/gi, (_whole, neg: string | undefined, token: string, which: string) => {
    const value = token.slice(1, -1).trim();
    const character = which.toLowerCase() === "character";
    if (neg) (character ? f.notCharactersIncluding : f.notNamesIncluding).push(value);
    else (character ? f.charactersIncluding : f.namesIncluding).push(value);
    return " ";
  });
  // The same measure with the phrase in front of the name: "card whose card
  // name includes {Baby}" (BT3-017), "a card name that includes {Supreme Kai}"
  // (BT3-037). Not "character names **including** <SH>" (EX24-25), which
  // counts names rather than looking inside one — hence `includes?` and not
  // the participle.
  t = t.replace(/(character|card) names? (?:that |which )?includes?\s+(<[^>]+>|\{[^}]+\})/gi, (_whole, which: string, token: string) => {
    const value = token.slice(1, -1).trim();
    (which.toLowerCase() === "character" ? f.charactersIncluding : f.namesIncluding).push(value);
    return " ";
  });
  for (const m of t.matchAll(/(non-)?<([^>]+)>/g)) (m[1] ? f.notCharacters : f.characters).push(m[2].trim());
  for (const m of t.matchAll(/(non-)?≪([^≫]+)≫/g)) (m[1] ? f.notTraits : f.traits).push(m[2].trim());
  for (const m of t.matchAll(/\{([^}]+)\}/g)) if (!/^[rugykbw]$|^\d+$/i.test(m[1])) f.names.push(m[1].trim());
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
  if (/\bmono-?colou?r\b|\bmono-(red|blue|green|yellow|black|white)\b/.test(lower)) f.monoColor = true;
  if (/\bmulti-?colou?r(?:ed)?\b/.test(lower)) f.multiColor = true;
  // "Use up to 1 face-up ≪Turles Crusher Corps≫ card from your life in a combo"
  // (3-9-2-1). "Face down" is never a way a card is picked out, so only the
  // one direction is read.
  if (/\bface[- ]up\b/.test(lower)) f.faceUp = true;
  // "Non-black Battle Cards": the colour is one the card must *not* have, and
  // reading it as an ordinary colour word would invert the phrase.
  for (const m of colourText.matchAll(/\bnon-(red|blue|green|yellow|black|white)\b/g)) {
    const c = COLOR_WORDS[m[1]];
    if (!f.notColors.includes(c)) f.notColors.push(c);
  }
  for (const m of colourText.matchAll(/(non-)?\b(red|blue|green|yellow|black|white)\b/g)) {
    if (m[1]) continue;
    const c = COLOR_WORDS[m[2]];
    if (!f.colors.includes(c) && !f.notColors.includes(c)) f.colors.push(c);
  }
  // "…with an energy cost of 1 **and no keyword skills**" — none at all, which
  // the sets also write "skill-less" for a card with no text whatsoever. This
  // one is only about the keywords, so a card with an [Auto] and no keyword
  // still qualifies.
  if (/\bno keyword skills?\b|\bno keywords\b/.test(lower)) f.noKeywords = true;
  // "…**with [Blocker]**", "…with an [Evolve] skill", "…with [Counter]
  // skills". A requirement, and dropping it chose any card in the area (83
  // selectors). "Without" and "non-" are read below as the opposite; anything
  // else in brackets that is neither a keyword nor a skill kind makes the
  // whole description unreadable, because guessing selects the wrong cards.
  for (const m of lower.matchAll(/\bwith (?:an?|the )?\s*\[([a-z0-9:\- /]+)\](?: skills?)?/g)) {
    const word = m[1].trim();
    const kind: SkillKindPrefix | null = /^counter\b/.test(word) ? "counter" : /^activate\b/.test(word) ? "activate" : word === "auto" ? "auto" : word === "permanent" ? "permanent" : null;
    if (kind) {
      f.skillKind = kind;
      continue;
    }
    // `keywordOf` wants the parameters the *printed* tag carries — it reads
    // "[Union-Fusion]" but not the bare "[Union]" a target description uses,
    // because the family alone is what the description means. Matching is by
    // name anyway, so the family name is enough.
    const kw = keywordOf(word) ?? (KEYWORD_FAMILIES.has(word) ? { name: titleCase(word) as KeywordSkill["name"] } : null);
    if (!kw) f.unreadable = true;
    else if (!f.keywords.includes(kw.name)) f.keywords.push(kw.name);
  }
  // "Battle Cards **without [Barrier]** in Active Mode" — the same thing
  // "non-[Barrier]" says, written the long way. Sixteen of the cards that let
  // an active card be attacked carve out [Barrier] like this, and a
  // permission that misses the carve-out allows an attack the card forbids.
  for (const m of lower.matchAll(/\bwithout \[([a-z0-9:\- ]+)\]/g)) {
    const kw = keywordOf(m[1]);
    if (kw && !f.notKeywords.includes(kw.name)) f.notKeywords.push(kw.name);
  }
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
  // The plural counts too. Anchored with a trailing `\b`, "Battle Card" did
  // not match "Battle **Cards**" — so every phrase that names the type in the
  // plural set no type at all and selected every card in the area, and
  // `filterFor` handed back nothing for a description like "Battle Cards"
  // whose only measure is the type.
  const TYPE_WORDS = [
    [/\bleaders?( cards?)?\b/, "LEADER"],
    [/\bunisons?( cards?)?\b/, "UNISON"],
    [/\bextras?( cards?)?\b/, "EXTRA"],
    [/\bbattle cards?\b/, "BATTLE"],
  ] as const;
  // "Your opponent's Battle Cards **or** Unisons" names two kinds, and one
  // field cannot hold both — so it holds neither. Taking the first would drop
  // the other half in silence, which is the alternation trap `subjectFilterOf`
  // refuses for the same reason; the two areas the phrase names already narrow
  // the selection to what the card meant.
  const named = TYPE_WORDS.filter(([re]) => typeWord(re) === "yes");
  for (const [re, type] of TYPE_WORDS) {
    const said = typeWord(re);
    if (said === "no") f.notType ??= type;
    else if (said === "yes" && named.length === 1 && !f.type) f.type = type;
  }
  let m: RegExpExecArray | null;
  // A phrase naming several cards puts the noun in the plural — "choose all of
  // your opponent's Battle Cards with energy **costs** of 7 or less" — and only
  // the "between" line admitted it, so the other three read no cost at all and
  // handed back every card in the area. Silent, and the wrong direction: the
  // filter that vanishes is always the one that was narrowing the target.
  if ((m = /energy costs? (?:of )?(\d+) or less/.exec(lower))) f.costMax = Number(m[1]);
  else if ((m = /energy costs? (?:of )?(\d+) or more/.exec(lower))) f.costMin = Number(m[1]);
  else if ((m = /energy costs? (?:of )?between (\d+) and (\d+)/.exec(lower))) {
    f.costMin = Number(m[1]);
    f.costMax = Number(m[2]);
  } else if ((m = /energy costs? (?:of )?(\d+)\b/.exec(lower))) f.costMin = f.costMax = Number(m[1]);
  // "Battle Cards with power between 30000 and 35000", "up to 2 black Battle
  // Cards with powers between 20000 and 30000" — the same range the cost line
  // above already reads, which the sets also write for power. Read before the
  // single bounds, because "between 30000 and 35000" contains neither "or
  // less" nor "or more" but does contain a bare number the last pattern would
  // take for an exact power.
  if ((m = /powers? between ([\d,]+) and ([\d,]+)/.exec(lower))) {
    f.powerMin = Number(m[1].replace(/,/g, ""));
    f.powerMax = Number(m[2].replace(/,/g, ""));
  } else if ((m = /(\d+) power or less/.exec(lower))) f.powerMax = Number(m[1]);
  else if ((m = /(\d+) power or more/.exec(lower))) f.powerMin = Number(m[1]);
  // The sets print the same bound with the words the other way round —
  // "Battle Cards with 25000 **or less power**" — on 41 lines, and only the
  // first order was read, so some thirty-eight selectors carried no bound at
  // all and were offered every card in the area. TB1-015 is the one that shows
  // what that costs: with its exclusion fixed but its bound still missing, it
  // KO'd every Battle Card on both boards instead of the small ones.
  else if ((m = /([\d,]+) or less power\b/.exec(lower))) f.powerMax = Number(m[1].replace(/,/g, ""));
  else if ((m = /([\d,]+) or more power\b/.exec(lower))) f.powerMin = Number(m[1].replace(/,/g, ""));
  // An exact power, which searches print alongside the cost: "a yellow
  // <Son Goku> card with an energy cost of 3 and 5000 power". Only after
  // "with"/"and", so that "it gets +5000 power for the turn" is not read as a
  // bound on the target.
  else if ((m = /\b(?:with|and) (\d+) power\b/.exec(lower))) f.powerMin = f.powerMax = Number(m[1]);
  // "with power less than or equal to this card's power", "with power greater
  // than this card's power" — measured against the card the skill is on.
  if (
    (m =
      /power (less than or equal to|equal to or less than|no more than|at or below|less than|lower than|greater than or equal to|equal to or greater than|no less than|at or above|greater than|higher than|more than) (?:this card'?s|its) power/.exec(
        lower,
      ))
  ) {
    const w = m[1];
    const cmp = /^(?:less than or equal|equal to or less|no more|at or below)/.test(w)
      ? "<="
      : /^(?:less|lower)/.test(w)
        ? "<"
        : /^(?:greater than or equal|equal to or greater|no less|at or above)/.test(w)
          ? ">="
          : ">";
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

export function matches(d: CardDef, given: CardFilter): boolean {
  // The compiler writes every field; a program a person or Claude wrote — a
  // `card_rules` row, a referee ruling — carries only the fields it means, and
  // read as written it crashed the engine on the first `.some`. Fill it up.
  const f: CardFilter = { ...emptyFilter(), ...given };
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
  if (f.keywords.some((k) => !hasKeyword(d, k))) return false;
  if (f.skillKind && !skillsOf(d).some((sk) => sk.kind.startsWith(f.skillKind!))) return false;
  if (f.noKeywords && keywordsOf(d).length) return false;
  if (f.monoColor && d.colors.length !== 1) return false;
  if (f.multiColor && d.colors.length < 2) return false;
  // A name asked for whole and a name asked for in part are two ways to
  // satisfy one choice, so each pair shares a single test rather than becoming
  // two requirements. `?? []` because a program stored in `card_rules`, or
  // one a referee ruling put in a game's action log, carries the filter shape
  // of the day it was written.
  const partChars = f.charactersIncluding ?? [];
  const partNames = f.namesIncluding ?? [];
  if ((f.characters.length || partChars.length) && !f.characters.some((c) => hasCharacter(d, c)) && !partChars.some((c) => characterIncludes(d, c))) return false;
  if (f.notCharacters.some((c) => hasCharacter(d, c))) return false;
  if ((f.notCharactersIncluding ?? []).some((c) => characterIncludes(d, c))) return false;
  if (f.traits.length && !f.traits.some((c) => hasTrait(d, c))) return false;
  if (f.notTraits.some((c) => hasTrait(d, c))) return false;
  // Every name the card answers to: its printed one, plus any it was "also
  // treated as in all areas" (20-1). A card that gained {Planet M-2} is found
  // by a skill naming {Planet M-2}, and excluded by one naming it as the card
  // *not* to choose — both readings come from the same list.
  const names = namesOf(d);
  if ((f.names.length || partNames.length) && !f.names.some((n) => names.some((own) => own.toLowerCase() === n.toLowerCase())) && !partNames.some((n) => nameIncludes(d, n))) return false;
  if (f.notNames.some((n) => names.some((own) => own.toLowerCase() === n.toLowerCase()))) return false;
  if ((f.notNamesIncluding ?? []).some((n) => nameIncludes(d, n))) return false;
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
