/**
 * Card-description text → predicate. Keyword conditions on cards name their
 * targets in a fixed grammar ("Blue <Baby> with an energy cost of 4",
 * "yellow non-≪Great Ape≫ <Son Goku: Childhood> card with an energy cost of 3
 * or less", "1 {Four-Star Ball, Parasitic Darkness}"). Reading that grammar
 * lets the engine offer the right candidates for Evolve, Union, Z-Stack,
 * Z-Awaken and Swap without a compiled script.
 */
import { baseType, characterIncludes, hasCharacter, hasKeyword, hasTrait, identityKey, keywordName, keywordOf, keywordsOf, nameIncludes, namesOf, skillsOf, specifiedCostOf, specifiedCostUnknown } from "./cards";
import type { CardDef, Color, KeywordSkill, SkillKindPrefix } from "../types";

export interface CardFilter {
  colors: Color[];
  /** Explicit original-colour payment selector; absent on ordinary effective filters. */
  originalColors?: Color[];
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
  /**
   * "A blue Leader with **both <Son Goku> and <Vegeta>**" (BT22-035, #768):
   * every character named, not one of them. `characters` is an any-of list
   * ("<A> or <B>", "<A>/<B>"), so the two readings need two lists; a card
   * answers by having each name among its character names (2-3), on top of any
   * other measure. `?? []` at the readers: older stored programs lack it.
   */
  charactersAll: string[];
  traits: string[];
  notTraits: string[];
  /**
   * "White <Baby> **or** ≪Brainwashed≫ cards" (BT29-114): a character or a
   * trait, either will do — where `characters` and `traits` otherwise both
   * have to hold. Read as both, the description asked for a Brainwashed Baby,
   * a narrower card than the one printed.
   */
  characterOrTrait: boolean;
  /**
   * "A <Veku: Br> card **or** a red <Son Goku: Br> card" (BT6-009), "a blue
   * ≪Cooler's Armored Squadron≫ card or a blue Extra with an energy cost of 0"
   * (BT29-035): two descriptions, each with its own words, and a card answers
   * by meeting either one in full. Every other field still has to hold
   * beside it. Absent on every filter that is one description, which is
   * nearly all of them; the compiler writes it only for an "or" whose halves
   * would otherwise share words they do not share (#537).
   */
  anyOf?: CardFilter[];
  /**
   * "A black <Son Goku>**-only** card" (BT29-108, 52 skills): a card whose
   * characters are only the ones named — not a card that lists <Son Goku>
   * among others, the way a fusion or a pair card does.
   */
  onlyCharacters: boolean;
  /**
   * "A black ≪Saiyan≫**-only** card" (BT12-136, BT12-137, P-286, #932): the
   * trait twin of `onlyCharacters` — a card whose traits are only the ones
   * named, not a card that lists ≪Saiyan≫ among others (a [Saiyan, Earthling]
   * Leader is not "≪Saiyan≫-only"). Written only when printed, so a stored
   * program without it reads as before.
   */
  onlyTraits?: boolean;
  /**
   * "A blue ≪Great Ape≫ ≪Bardock's Crew≫ card" (BT18-106, #907 round 5): two
   * traits written side by side with nothing between them are traits the one
   * card has **both** of, the trait twin of `charactersAll`. Written only when
   * printed, so a stored program without it reads as before.
   */
  traitsAll?: string[];
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
  /** "…with both {A} and {B}": the card-name twin of `charactersAll` (#768). */
  namesAll: string[];
  /**
   * "Play up to 1 Battle Card **whose card name is in the text of a skill on the
   * chosen card**" (BT30-084, #542): the variable (bound by an earlier
   * `choose … as`, #550) whose printed skill text the candidate's name must
   * appear in. A measure against another card the skill holds, like `powerRel`,
   * so it is applied where that card is known (`resolveSelector`), not by
   * `matches`. A name is "in the text" when it is written in `{}` brackets there
   * (2-3-2) and equals the card's name as a whole (2-3-1-1).
   */
  nameInSkillTextOf: string | null;
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
   * "…a ≪Saiyan≫ Battle Card with **[Over Realm 2]**" (#941): the keywords the
   * description prints *with their parameter*, by printed name (`keywordName`:
   * "Over Realm 2", "Dark Over Realm 2", "Swap 1"). The card must carry a
   * keyword of exactly that name, so Over Realm 4 and Dark Over Realm 2 are
   * different cards. Written beside `keywords`, which keeps the family, and
   * absent on every filter that names no number, so old rows read as before.
   */
  keywordsExact?: string[];
  /** "non-[Over Realm 2]": the same exact names, as a keyword the card must not have. */
  notKeywordsExact?: string[];
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
  /**
   * "An **original** energy cost of 3" (20-3-1, 62 skills): the printed total, before any skill
   * effect is applied, so a cost reduction or increase in force does not move it. Its own pair of
   * fields because the two words ask different questions - "original energy cost of 1" is how
   * BT13-001 picks the cards it then gives +2 energy cost - and a reading that cannot tell them
   * apart cannot be signed off (#907 round 6). Answered by the printed `energyCost` attribute. Optional and
   * written only when read, like `traitsAll`, so no stored filter grows two nulls.
   */
  originalCostMin?: number | null;
  originalCostMax?: number | null;
  powerMin: number | null;
  powerMax: number | null;
  /**
   * "An original power of 500" (20-3-1): the printed value, before any skill
   * effect is applied — distinct from `powerMin`/`powerMax` in what the words
   * mean, though not (yet) in what `matches` checks: `d.power` is always the
   * face's printed number, because `cardNow` never rewrites it (only `gains`
   * does, and only to colours/characters/traits/names). A live "current
   * power" filter would have to read `powerOf` off the game state instead,
   * which `matches` — being a pure function of `CardDef` — cannot do; that
   * gap is `powerMin`/`powerMax`'s, not this one's, and out of scope here
   * (issue #238).
   */
  originalPowerMin: number | null;
  originalPowerMax: number | null;
  /**
   * "Cards with **5000 combo power**" (BT29-030), "a combo power of 5000"
   * (2-8): the number a card adds when it is used in a combo, inclusive
   * bounds the same shape as `powerMin`/`powerMax`. Until 2 Oct 2026 nothing
   * read it, and "card with 5000 combo power" parsed with the measure
   * silently dropped — every card in the Drop answered.
   */
  comboPowerMin: number | null;
  comboPowerMax: number | null;
  /**
   * "A red Unison Card **with 2 or more markers**" (BT10-008, BT10-044,
   * BT15-086), "Battle Cards and Unison Cards with 3 or fewer markers"
   * (BT14-116): how many markers (13-2) the card carries now, inclusive
   * bounds. A fact about the copy in play, not the printed card, so the
   * definition-level `matches` cannot see it (it is applied where the
   * instance is known, the way `faceUp` is). Until 13 Oct 2026 the measure was
   * dropped, so BT10-008's [Permanent] was met by any red Unison (#721).
   * Only the bounded forms are read: an exact "with 2 markers on it" is what
   * a *play* arrives with (BT16-023), not something a card in play is asked.
   */
  markersMin: number | null;
  markersMax: number | null;
  /**
   * "A red Unison Card **with a specified cost of 2**" (SD15-01, SD15-03 and
   * some 170 more lines, nearly all on Unisons), "Unisons with a specified
   * cost of 2 or less": how many coloured orbs the card's specified cost
   * (1-2-3) has, inclusive bounds. Answered only where that cost is *known*:
   * the owner's stored `specifiedCost` (`cards.specified_cost`), or a fixed
   * numeric energy cost, whose orbs the engine fills by its one-per-colour
   * convention (`specifiedCostOf`). A Unison has no energy cost in the feed, so
   * one with nothing stored is unknown and matches no bound at all — neither
   * "2" nor "2 or less" — rather than answering as if it had no orbs (#728).
   * Until 13 Oct 2026 the phrase made the whole description unreadable.
   */
  specifiedCostMin: number | null;
  specifiedCostMax: number | null;
  /**
   * "A black Unison Card **with no specified cost** and 15000 power"
   * (BT12-139, P-287 and a dozen more lines): the card prints no orbs at all.
   * Answered the way the engine already prices a card (`specifiedCostOf`,
   * the rules engine's `specifiedCost` attribute): a card with no stored orbs
   * and no number or X to fill them from demands none — in the feed 104 of the
   * 210 Unisons have no energy cost at all and 106 print "X" (17 Oct 2026).
   * An "X" nobody entered is only unknown, not "none", and never matches
   * (#980). The reading is exact for Unisons the owner has entered; a Unison
   * the feed prints blank that does carry orbs (SD15-02 is one, entered by
   * ruling) would count as "none" until its orbs are stored. Not the same as a
   * bound of 0, which "unknown" also fails and "none" does not claim.
   */
  specifiedCostNone: boolean;
  /**
   * "Play up to 1 blue skill-less Battle Card from your Drop Area with an
   * **energy cost less than or equal to your current energy**" (BT12-030,
   * TB3-046, EX03-12 and a dozen more): a bound that is not a number but how
   * many energy cards the player running the skill has *when it resolves*, so
   * — like `powerRel` — it is applied where the skill runs (`resolveSelector`),
   * not by the definition-level `matches`. The energy is the master's own even
   * when the cards chosen are the opponent's (EX03-12). "Their current energy"
   * (BT13-152) is another player's count and stays unread (#979).
   */
  costAtMostEnergy: boolean;
  /**
   * The same measure with the other comparators and the other player's count
   * (#1011): `costBelowEnergy` is "less than", `costAtLeastEnergy` "greater than
   * or equal to", `costAboveEnergy` "greater than" — "choose up to 1 of your
   * opponent's Battle Cards with an energy cost **greater than their current
   * energy**" (BT19-036, DB2-129, P-658 … about 55 skills). `energyOfOpponent`
   * says whose energy: set for "their", "your opponent's" and "the opponent's"
   * (the cards offered are the opponent's, and so is the count), clear for "your".
   * Applied where the skill runs, like `costAtMostEnergy`; "less than or equal
   * to their energy" is `costAtMostEnergy` + `energyOfOpponent`.
   */
  costBelowEnergy: boolean;
  costAtLeastEnergy: boolean;
  costAboveEnergy: boolean;
  energyOfOpponent: boolean;
  /**
   * "An originally skill-less Battle Card" (20-3-1, 1-5-9): the card printed
   * with no text at all, whether or not a later effect granted it a skill —
   * narrower than "skill-less" on its own, which would also ask about a skill
   * negated for the turn (9-1-4) or one this filter has no way to see was
   * granted. Bare "skill-less" is `skillLess`, below.
   */
  originallySkillLess: boolean;
  /**
   * "Your opponent's **skill-less** Battle Cards", "a red skill-less Battle
   * Card" — some 250 printed skills. 1-5-9: a card that lacks card text; and
   * 9-1-4: a card all of whose skills are negated is treated as one. So this
   * is the card as it stands *now*: no printed skill still in force (none
   * printed, or every one negated) and no skill it has been granted or has
   * copied (20-18) — a keyword "gained" is a skill like any other (22-1).
   * Until 3 Oct 2026 `parseFilter` dropped the word, and every such
   * description offered cards with text as readily as cards without.
   *
   * `matches` is a pure function of a `CardDef`, so the live answer arrives on
   * the def itself — `CardDef.skillLess`, filled by `cardNow` — and a bare
   * catalog row with no table to ask answers off its printed text, the same
   * reading `originallySkillLess` makes. On the rules engine it is the
   * declared `skillLess` attribute (`attributes.rules`), seeded by `attrsNow`.
   */
  skillLess: boolean;
  /**
   * "with power less than or equal to this card's power" — a bound read off
   * the card whose skill this is, so it is applied where the skill runs
   * (`resolveSelector`), not here.
   *
   * "…**the chosen card's** power" (BT19-096) measures against a card a
   * clause earlier in the same skill chose, not the card printing the skill —
   * `of: "chosen"` is a placeholder `compileClause` resolves to the actual
   * bound variable (`c.last`) at the point it builds the `choose` op, because
   * that is the only place the compiler still knows which variable that is.
   */
  powerRel: {
    of: "self" | "chosen";
    cmp: "<=" | "<" | ">=" | ">";
    /**
     * The bound variable `of: "chosen"` measures against — filled in by
     * `compileClause` (`c.last`) once the filter comes back from parsing,
     * which is the only place still holding the name; `parseFilter` cannot
     * set it, having no `Ctx`. Unset while `of` is `"self"`, and if a
     * "chosen" bound somehow reaches here with nothing to point at,
     * `resolveSelector` treats the filter as failing to match rather than
     * falling back to `frame.card` — that would silently measure against the
     * wrong card instead of naming none.
     */
    var?: string;
  } | null;
  z: boolean | null;
}

/**
 * A shared qualification for alternatives: “a <Cell> or <Cell Jr.> card—both
 * white and with an energy cost of 3 or more—”. The clause after the dash
 * applies to each alternative, so make it ordinary conjunctive filter text
 * before asking the card-description parser to read it.
 */
export function expandSharedCardDescription(text: string): string {
  // The feed sometimes decodes the dash as "?" (SD20-05: "card?both yellow?or").
  return text.replace(/(?:-|—|–|―|(?<=[a-z>≫}])\?)\s*both\s+(.+?)(?:-|—|–|―|\?)\s*/g, " $1 ").trim();
}

/**
 * Every field of a `CardFilter` and the kind of value it holds: the language's
 * predicate form (`lang/ast.ts` re-exports it) and the list `filterProblem`
 * (`vm/script-schema.ts`) checks a stored filter's keys and values against.
 */
export type FilterFieldType = "strings" | "colors" | "keywords" | "cardType" | "skillKind" | "boolean" | "tri" | "number" | "powerRel" | "variable" | "filters";

export const FILTER_FIELDS: Record<keyof CardFilter, FilterFieldType> = {
  colors: "colors",
  originalColors: "colors",
  notColors: "colors",
  monoColor: "boolean",
  multiColor: "boolean",
  characters: "strings",
  notCharacters: "strings",
  charactersIncluding: "strings",
  notCharactersIncluding: "strings",
  charactersAll: "strings",
  namesAll: "strings",
  traits: "strings",
  notTraits: "strings",
  characterOrTrait: "boolean",
  anyOf: "filters",
  onlyCharacters: "boolean",
  onlyTraits: "boolean",
  traitsAll: "strings",
  names: "strings",
  notNames: "strings",
  namesIncluding: "strings",
  notNamesIncluding: "strings",
  keywords: "keywords",
  notKeywords: "keywords",
  keywordsExact: "strings",
  notKeywordsExact: "strings",
  type: "cardType",
  notType: "cardType",
  skillKind: "skillKind",
  unreadable: "boolean",
  noKeywords: "boolean",
  faceUp: "boolean",
  token: "boolean",
  notToken: "boolean",
  costMin: "number",
  costMax: "number",
  originalCostMin: "number",
  originalCostMax: "number",
  powerMin: "number",
  powerMax: "number",
  originalPowerMin: "number",
  originalPowerMax: "number",
  comboPowerMin: "number",
  comboPowerMax: "number",
  markersMin: "number",
  markersMax: "number",
  specifiedCostMin: "number",
  specifiedCostMax: "number",
  specifiedCostNone: "boolean",
  costAtMostEnergy: "boolean",
  costBelowEnergy: "boolean",
  costAtLeastEnergy: "boolean",
  costAboveEnergy: "boolean",
  energyOfOpponent: "boolean",
  originallySkillLess: "boolean",
  skillLess: "boolean",
  powerRel: "powerRel",
  nameInSkillTextOf: "variable",
  z: "tri",
};
type FilterFieldMissing = Exclude<keyof CardFilter, keyof typeof FILTER_FIELDS>;
const _everyFilterFieldWritten: FilterFieldMissing extends never ? true : never = true;
void _everyFilterFieldWritten;

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

/**
 * Record one keyword a description names. A tag printed with a number —
 * "[Over Realm 2]", "[Swap 1]", "[Spirit Boost 3]" — is an exact requirement
 * (`keywordsExact`, by printed name) as well as the family, because "Over
 * Realm 2" and "Over Realm 4" (or "Dark Over Realm 2") are different skills
 * (22-15) and the family alone selects all of them (#941). A tag that prints
 * no number keeps the family-only reading, so "[Over Realm]" and "[Double
 * Strike]" read exactly as before. A negated exact tag is *only* exact: the
 * family would also forbid the cards the description allows.
 */
function addKeyword(f: CardFilter, kw: KeywordSkill | { name: KeywordSkill["name"] }, printed: string, negated = false): void {
  const exact = /\d/.test(printed);
  if (exact) {
    const key = negated ? "notKeywordsExact" : "keywordsExact";
    const name = keywordName(kw as KeywordSkill);
    const list = (f[key] ??= []);
    if (!list.includes(name)) list.push(name);
    if (negated) return;
  }
  const family = negated ? f.notKeywords : f.keywords;
  if (!family.includes(kw.name)) family.push(kw.name);
}

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
    charactersAll: [],
    namesAll: [],
    traits: [],
    notTraits: [],
    characterOrTrait: false,
    onlyCharacters: false,
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
    originalPowerMin: null,
    originalPowerMax: null,
    comboPowerMin: null,
    comboPowerMax: null,
    markersMin: null,
    markersMax: null,
    specifiedCostMin: null,
    specifiedCostMax: null,
    specifiedCostNone: false,
    costAtMostEnergy: false,
    costBelowEnergy: false,
    costAtLeastEnergy: false,
    costAboveEnergy: false,
    energyOfOpponent: false,
    originallySkillLess: false,
    skillLess: false,
    powerRel: null,
    nameInSkillTextOf: null,
    z: null,
  };;
}

/**
 * "…with an energy cost **greater than their current energy**": a card's cost
 * measured against a player's energy count, which no field of a filter carries
 * apart from the booleans of #1011. `parseFilter` flags every form but "at most
 * your energy" `unreadable` — a forbid or a trigger subject cannot apply it — and
 * `parseTarget` takes the phrase off before the areas are read and puts the bound
 * on the selector, where `resolveSelector` applies it. A trigger's subject
 * (`subjectFilterOf`) takes it out first, as it always left such a description's
 * other words alone. Group 1 is the comparator, group 2 whose energy.
 */
const ENERGY_CMP = "(less than or equal to|equal to or less than|equal or less than|no (?:more|greater) than|greater than or equal to|more than or equal to|equal to or greater than|equal or greater than|equal to or more than|less than|fewer than|lower than|greater than|more than|higher than)";
export const ENERGY_COST_VS_ENERGY = new RegExp(`\\benergy costs? (?:of |is )?(?:(?:that is|which is) )?${ENERGY_CMP} (?:the (?:amount|number) of )?(their|your opponent'?s|the opponent'?s|your) (?:current |total )?energy\\b`, "i");

export type EnergyBoundKey = "costAtMostEnergy" | "costBelowEnergy" | "costAtLeastEnergy" | "costAboveEnergy";
/** Which comparator and whose energy a match of `ENERGY_COST_VS_ENERGY` / `ENERGY_BOUND` said. */
export function energyBoundOf(m: RegExpExecArray): { key: EnergyBoundKey; opponent: boolean } {
  const cmp = m[1].toLowerCase();
  const key: EnergyBoundKey = /greater than or equal|more than or equal|equal (?:to )?or (?:greater|more)/.test(cmp)
    ? "costAtLeastEnergy"
    : /less than or equal|equal (?:to )?or less|^no /.test(cmp)
      ? "costAtMostEnergy"
      : /greater|more|higher/.test(cmp)
        ? "costAboveEnergy"
        : "costBelowEnergy";
  return { key, opponent: m[2].toLowerCase() !== "your" };
}
/** The comparison itself, for the matcher that holds both numbers (`resolveSelector`). */
export function costEnergyOk(f: CardFilter, cost: number, energy: number): boolean {
  if (f.costAtMostEnergy && !(cost <= energy)) return false;
  if (f.costBelowEnergy && !(cost < energy)) return false;
  if (f.costAtLeastEnergy && !(cost >= energy)) return false;
  if (f.costAboveEnergy && !(cost > energy)) return false;
  return true;
}
/** Is any cost-versus-energy bound set, whichever comparator? */
export function hasEnergyBound(f: CardFilter): boolean {
  return f.costAtMostEnergy || f.costBelowEnergy || f.costAtLeastEnergy || f.costAboveEnergy;
}

export function parseFilter(text: string): CardFilter {
  return eitherFilter(text) ?? parseOneFilter(text);
}

/**
 * Does `parseFilter` read this description's "or" whole — as either colour,
 * either name, or either description (`anyOf`)? The trigger readers ask
 * before trusting a subject with an "or" in it (#539): one read short would
 * stop the skill on the half it dropped.
 */
export function readsOr(text: string): boolean {
  const f = parseFilter(text.replace(/^(?:an?|1|up to \d+|\d+|your)\s+/i, ""));
  return !f.unreadable && (f.colors.length > 1 || f.characters.length + f.traits.length + f.names.length > 1 || !!f.anyOf?.length);
}

/** The list measures an "or" between two descriptions already reads as either. */
const OR_ABLE: (keyof CardFilter)[] = ["characters", "charactersIncluding", "names", "namesIncluding", "traits", "characterOrTrait"];
/**
 * "…with an energy cost less than or equal to your current energy" (#979), with
 * the "with"/"an" it hangs on. `parseTarget` takes it off the phrase before the
 * areas are read — "your energy" at the end of it is not the Energy Area — and
 * puts the measure back on the selector's filter.
 */
export const ENERGY_BOUND = new RegExp(`(?:\\b(?:with|and|whose) )?(?:\\ban? )?${ENERGY_COST_VS_ENERGY.source}`, "i");
/** A piece that is only colours and one name token (names masked as "N"): "blue ≪Saiyan≫", "mono-green <Vegeta: GT>". */
const NAMES_ONLY = /^(?:(?:(?:non-|mono-)?(?:red|blue|green|yellow|black|white)|multicolou?r|an?|1|up to \d+)\s+)*N$/i;
/** Does a (masked) piece start with a name, after any colour or count words? */
const STARTS_WITH_NAME = /^(?:(?:(?:non-|mono-)?(?:red|blue|green|yellow|black|white)|multicolou?r|an?|1|up to \d+)\s+)*N\b/i;
const CARD_NOUN = /\b(?:battle |extra |leader |unison )?(?:cards?|extras?|leaders?|unisons?)\b/i;

/**
 * "A <Veku: Br> card or a red <Son Goku: Br> card" (BT6-009), "white <Cell>
 * cards or white Extras" (BT31-119), "a blue <Cooler> card, blue ≪Cooler's
 * Armored Squadron≫ card, or blue Extra with an energy cost of 0" (BT29-035):
 * whole descriptions joined by "or", each with its own words. Read as one
 * description, every word landed on every card — "red" on the <Veku: Br>, "an
 * energy cost of 0" on the <Cooler> — or a second card type replaced the first
 * (#537). Split only when every piece names a card noun, and only when the
 * pieces differ in more than the names an "or" already reads as either; "<Son
 * Goku> card or <Vegeta> card" stays one filter, as it always read.
 */
function eitherFilter(text: string): CardFilter | null {
  // "…≪Namekian≫ or ≪Demon Clan≫ card―both green and with an energy cost of
  // 4 or less―or 1 green Unison with a specified cost of 2" (BT18-083, #980):
  // the aside belongs to the description in front of it, so it is folded into
  // that description before the alternatives are cut apart.
  const t = expandSharedCardDescription(text.replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
  // "…with an energy cost of 1 or 5" (BT29-032, #537): two costs, either one.
  // Read as a bound it was the first number alone. "4 or less" is not this.
  // Not "…with an energy cost of 1 **or 1 yellow Unison** with a specified
  // cost of 1" (SD20-01, #728): there the second number is the next
  // description's count, and the "or" is between two descriptions.
  const costs = /\benergy costs? (?:of )?(\d+) or (\d+)\b(?!\s*or\b)(?!\s+(?:red|blue|green|yellow|black|white|mono|multi|card|unison|extra|battle|leader|z-|<|≪|\{))/i.exec(t);
  if (costs) {
    const at = (n: string) => parseFilter(t.slice(0, costs.index) + t.slice(costs.index).replace(costs[0], `energy cost of ${n}`));
    return { ...emptyFilter(), anyOf: [at(costs[1]), at(costs[2])] };
  }
  if (!/\bor\b/i.test(t)) return null;
  // Split at top level only: names carry commas and "or"s of their own.
  const pieces: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "<" || ch === "≪" || ch === "{" || ch === "[") depth++;
    else if (ch === ">" || ch === "≫" || ch === "}" || ch === "]") depth = Math.max(0, depth - 1);
    if (depth) continue;
    const rest = t.slice(i);
    const sep = /^(?:,\s*(?:and\/or|or)\s+|,\s+|\s+and\/or\s+|\s+or\s+)/i.exec(rest);
    // "less than **or** equal to", "5000 power **or** more": a comparison's
    // "or", not a second description.
    const comparing = sep && (/\bthan$/i.test(t.slice(0, i)) || /^(?:less|more|fewer|equal|lower|higher|greater|above|below)\b/i.test(rest.slice(sep[0].length)));
    if (sep && !comparing && i > from) {
      pieces.push(t.slice(from, i));
      from = i + sep[0].length;
      i = from - 1;
    }
  }
  pieces.push(t.slice(from));
  // "blue ≪Saiyan≫ **or** ≪Earthling≫ card with an energy cost of 3 or less
  // **or** 1 blue Unison with a specified cost of 3" (BT14-040, #980): a piece
  // that is only a colour and a name has no card noun because its noun is in
  // the next piece — "either name" is one description, joined back to it. A
  // run of names that ends before a piece which does not start with a name
  // ("<Hirudegarn>, <Tapion>, <Minotia>, or green Unison with a specified cost
  // of 1", DB3-074) is a description of its own: those cards, by name.
  const mask = (p: string) => p.trim().replace(/<[^>]*>|≪[^≫]*≫|\{[^}]*\}/g, "N");
  const joined: string[] = [];
  let carry = "";
  for (const [i, p] of pieces.entries()) {
    const nameOnly = i < pieces.length - 1 && !CARD_NOUN.test(p) && NAMES_ONLY.test(mask(p));
    if (nameOnly && STARTS_WITH_NAME.test(mask(pieces[i + 1]))) {
      carry = carry ? `${carry} or ${p}` : p;
      continue;
    }
    joined.push((carry ? `${carry} or ${p}` : p) + (nameOnly ? " card" : ""));
    carry = "";
  }
  if (joined.length < 2) return null;
  const cleaned = joined.map((p) => p.trim().replace(/^(?:a|an|1|up to \d+|any number of)\s+/i, ""));
  if (!cleaned.every((p) => CARD_NOUN.test(p) && !/^(?:less|more|fewer)\b/i.test(p))) return null;
  const alts = cleaned.map((p) => parseOneFilter(p));
  if (alts.some((a) => a.unreadable)) return null;
  // Halves that are nothing but a card type name the areas of a pair —
  // "your opponent's Battle Cards or Unisons" is two areas, and the selector
  // says that. Anything else beside the type ("white <Cell> cards or white
  // Extras") is two descriptions.
  const EMPTY = JSON.stringify({ ...emptyFilter(), type: null });
  if (alts.every((a) => JSON.stringify({ ...a, type: null }) === EMPTY)) return null;
  const shape = (a: CardFilter) => JSON.stringify({ ...a, ...Object.fromEntries(OR_ABLE.map((k) => [k, null])) });
  if (alts.every((a) => shape(a) === shape(alts[0]))) return null;
  return { ...emptyFilter(), anyOf: alts };
}

function parseOneFilter(text: string): CardFilter {
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
  // "…with **both <Son Goku> and <Vegeta>**" (BT22-035, #768): all of the
  // names, not one. Taken out of the text first so the loops below cannot
  // also read the two tokens as the any-of `characters` / `names`. "<A> or
  // <B>" and "<A>/<B>" never reach this and stay any-of.
  t = t.replace(/\bboth\s+(<[^>]+>|\{[^}]+\})\s+and\s+(<[^>]+>|\{[^}]+\})/gi, (_whole, a: string, b: string) => {
    for (const token of [a, b]) (token.startsWith("<") ? f.charactersAll : f.namesAll).push(token.slice(1, -1).trim());
    return " ";
  });
  // "…a red ≪Great Ape≫ ≪Bardock's Crew≫ card": the trait twin of the line above.
  t = t.replace(/\bboth\s+(≪[^≫]+≫)\s+and\s+(≪[^≫]+≫)/gi, (_whole, a: string, b: string) => {
    (f.traitsAll ??= []).push(a.slice(1, -1).trim(), b.slice(1, -1).trim());
    return " ";
  });
  // "…with <Son Goku> in its character name", "…{SS4} in its card name",
  // "…without <Turles> in their character names", and the bare "{Cabba} in
  // its name" (card name, #758). Read before the exact loops
  // below and taken out of the text, so a token the phrase governs cannot also
  // be claimed as a whole name. See `charactersIncluding`.
  // The negation is written three ways and only two were read: BT21-040 prints
  // "your opponent's Battle Cards **that does not include** <Son Goku: GT> in
  // its character name", and matched as a positive it named the one card the
  // sentence rules out. Until 9 Sep 2026 nothing noticed, because the measure
  // was thrown away before it reached a selector (see `narrows` in
  // `compile.ts`) — the filter was wrong and the selector had none at all.
  t = t.replace(/(without\s+|non-|(?:that |which )?does\s?n'?o?t include\s+)?(<[^>]+>|\{[^}]+\})\s+in (?:its|their) (?:(character|card) )?names?/gi, (_whole, neg: string | undefined, token: string, which: string | undefined) => {
    const value = token.slice(1, -1).trim();
    // A bare "in its name" (SD15-01: "Unison Cards with {Cabba} in its name",
    // #758) is the card name (2-3), looked inside, not matched whole.
    const character = which?.toLowerCase() === "character";
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
  // Names written side by side, nothing between them (#907 round 5): "if your Leader is a red
  // <Son Goku: GT> <Vegeta: GT> card" (BT18-010), "[Z-Awaken]: Yellow <Son Goku> <Vegeta>"
  // (BT20-086), "play up to 1 <Baby> <Janemba> Battle Card" (P-388), "≪Great Ape≫ ≪Bardock's
  // Crew≫ cards" (BT18-106). The card prints every name it means, so the card has *all* of
  // them: the Leader of BT18-001 has the character names Son Goku: GT and Vegeta: GT (2-10-4,
  // names separated by slashes), and the official FAQ for BT22-138 calls the same sort of
  // Leader "a red ＜Son Goku/Vegeta/Trunks: Future＞ card" against a "＜Son Goku＞-only" Z-Leader.
  // Any-of is always written with a word between ("<A> or <B>", "<A>, <B>, and <C>",
  // "<A>/<B>"), which the loops below still read as `characters` / `traits`. Not after "non-":
  // "non-≪God≫ ≪Universe 7≫" is one exclusion and one trait.
  t = t.replace(/(?<!non-)(<[^<>]+>(?:\s+<[^<>]+>)+)/g, (whole, run: string, at: number, all: string) => {
    // "<A> <B>-only" is the any-of list `onlyCharacters` reads, not a pair of names.
    if (all.startsWith("-only", at + whole.length)) return whole;
    for (const m of run.matchAll(/<([^<>]+)>/g)) f.charactersAll.push(m[1].trim());
    return " ";
  });
  t = t.replace(/(?<!non-)(≪[^≪≫]+≫(?:\s+≪[^≪≫]+≫)+)/g, (whole, run: string, at: number, all: string) => {
    // "≪A≫ ≪B≫-only" (#932) likewise stays the list `onlyTraits` reads.
    if (all.startsWith("-only", at + whole.length)) return whole;
    for (const m of run.matchAll(/≪([^≪≫]+)≫/g)) (f.traitsAll ??= []).push(m[1].trim());
    return " ";
  });
  for (const m of t.matchAll(/(non-)?<([^>]+)>/g)) (m[1] ? f.notCharacters : f.characters).push(m[2].trim());
  if (f.characters.length && /<[^>]+>-only\b/i.test(t)) f.onlyCharacters = true;
  for (const m of t.matchAll(/(non-)?≪([^≫]+)≫/g)) (m[1] ? f.notTraits : f.traits).push(m[2].trim());
  // "≪Saiyan≫-only" (#932): nothing but the traits named — the trait twin of the line above.
  if (f.traits.length && /≪[^≫]+≫-only\b/i.test(t)) f.onlyTraits = true;
  // "<Baby> or ≪Brainwashed≫", "≪Brainwashed≫ and/or <Baby>": one of each kind
  // joined by "or" is a choice between them, not both at once.
  if (f.characters.length && f.traits.length && /<[^>]+>\s*(?:or|and\/or)\s+(?:a |an )?≪[^≫]+≫|≪[^≫]+≫\s*(?:or|and\/or)\s+(?:a |an )?<[^>]+>/i.test(t)) f.characterOrTrait = true;
  for (const m of t.matchAll(/\{([^}]+)\}/g)) if (!/^[rugykbw]$|^\d+$/i.test(m[1])) f.names.push(m[1].trim());
  // "Cards other than Battle Cards" (BT23-140) says the same as "non-Battle
  // Cards" the long way, naming a *type* rather than the named cards `EXCLUDED`
  // reads above — rewritten so the ordinary "non-" reading below catches it.
  const lower = t.toLowerCase().replace(/\bother than ((?:leader|unison|extra|battle) cards?)\b/g, "non-$1");
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
  // "**Non-multicolor** energy" (BT8-122) is the opposite of "multicolor": the
  // word boundary between the hyphen and "multicolor" used to match, so the
  // card read as asking for the multicoloured energy it excludes. A card has
  // one colour or several (2-2), so what is not multicoloured is mono.
  if (/\bnon-?multi-?colou?r(?:ed)?\b/.test(lower)) f.monoColor = true;
  else if (/\bmulti-?colou?r(?:ed)?\b/.test(lower)) f.multiColor = true;
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
  // "With a specified cost of 2", "with specified costs of 2 or less", "with a
  // specified cost of 3 or more" (SD15-01, SD15-03, #728): a bound on the
  // orbs of the card's specified cost — see `specifiedCostMin`. Any other
  // sentence about a specified cost ("reduce the specified cost of …") is not
  // a measure of the card, and with "an energy cost less than or equal to your
  // current energy" (BT5-119, SD7-01) stays a measure no field carries (#537):
  // dropped, the description offered every card the rest of it named — the
  // widening ground rule 5 forbids — so the phrase is refused instead.
  // BT25-127 prints "a specified costof 1": the missing space is a typo, not
  // another measure, and before #728 it slipped past the refusal below and
  // chose any green Z-Unison.
  // "…Unison Card **with no specified cost** and 15000 power" (BT12-139, #980):
  // the card prints no orbs — see `specifiedCostNone`. Only the descriptive
  // "with no …": "treat this card as if it had no specified cost" is a
  // sentence about the card, not a measure of it, and stays refused.
  const noSpecified = /\bwith no specified costs?\b/.test(lower);
  if (noSpecified) f.specifiedCostNone = true;
  const specified = /\bspecified costs?\s*(?:of\s*)?(\d+)(?: or (less|fewer|more))?\b/.exec(lower);
  if (specified) {
    if (specified[2] !== "more") f.specifiedCostMax = Number(specified[1]);
    if (specified[2] !== "less" && specified[2] !== "fewer") f.specifiedCostMin = Number(specified[1]);
    // The measure is nearly always the second of two descriptions — "a blue
    // ≪Saiyan≫ or ≪Earthling≫ card with an energy cost of 3 or less **or** 1
    // blue Unison Card with a specified cost of 3" (BT14-040), "…card―both
    // green and with an energy cost of 4 or less―or 1 green Unison…"
    // (BT18-083). When `eitherFilter` could not cut such a phrase in two, read
    // as one description every word lands on one card — a ≪Saiyan≫ Unison with
    // both costs — which is a wrong card rather than a missing one. So an "or"
    // still standing here (not a bound's, not between two colours) refuses it.
    const loose = colourText
      .replace(/\b(?:or|and\/or) (?:less|more|fewer)\b/g, " ")
      .replace(/\b(?:red|blue|green|yellow|black|white),? (?:and\/or|or) (?=red|blue|green|yellow|black|white)/g, " ")
      // "…from your deck **or** hand" (BT28-039, #980) lists places, not
      // descriptions: the areas a card is taken from are read by the selector.
      .replace(/\b(?:from|in) (?:your |their )?(?:hand|deck|drop(?: area)?|warp|life(?: area)?)(?:,? (?:and\/or|or) (?:your |their )?(?:hand|deck|drop(?: area)?|warp|life(?: area)?))+/g, " ");
    if (/\bor\b/.test(loose)) f.unreadable = true;
  }
  // BT31-051 prints "Unison with a specified **of** 2": the word "cost" is
  // missing, and a description that drops the bound would offer every Unison.
  if (!specified && !noSpecified && /\bspecified (?:cost|of\b)/.test(lower)) f.unreadable = true;
  // "…with an energy cost less than or equal to your (current) energy" (#979):
  // the cost is measured against the master's energy count — see `costAtMostEnergy`.
  // The long-standing refusal (#537) held because no field carried it; dropped, the
  // description offered every card the rest of it named.
  // The same measure with the other comparators and the other player's count
  // (#1011): "with an energy cost **greater than their current energy**" (about
  // 55 skills: BT19-036, DB2-129, P-159 …). The words "their current energy"
  // were read as the area to look in, so every one of them chose a card in the
  // opponent's *Energy Area* — a wrong card, not a missing one — and DB1-059's
  // "greater than or equal to your opponent's energy" dropped the bound and
  // chose a Battle Card with no cost test at all. `parseTarget` takes the phrase
  // off first and puts the bound on the selector (`costBelowEnergy` …,
  // `energyOfOpponent`), where the skill runs. A description that reaches here
  // with one — a forbid, a condition, a trigger's subject — has nowhere to
  // apply it, so it is refused rather than read as a place or widened.
  const energyVs = ENERGY_COST_VS_ENERGY.exec(lower);
  if (energyVs) {
    const bound = energyBoundOf(energyVs);
    if (bound.key === "costAtMostEnergy" && !bound.opponent) f.costAtMostEnergy = true;
    else f.unreadable = true;
  }
  // "An originally skill-less Battle Card" (20-3-1): printed with no text at
  // all, which the catalog only ever writes with the adverb — see
  // `originallySkillLess` above for why bare "skill-less" is a separate
  // measure.
  if (/\boriginally skill-less\b/.test(lower)) f.originallySkillLess = true;
  // Bare "skill-less" (1-5-9, 9-1-4): no skill in force now. Only where the
  // adverb is absent — "originally" asks about the printed card alone, and a
  // skill negated or granted since must not move that answer.
  if (/(?<!\boriginally )\bskill-less\b/.test(lower)) f.skillLess = true;
  // "…**with [Blocker]**", "…with an [Evolve] skill", "…with [Counter]
  // skills". A requirement, and dropping it chose any card in the area (83
  // selectors). "Without" and "non-" are read below as the opposite; anything
  // else in brackets that is neither a keyword nor a skill kind makes the
  // whole description unreadable, because guessing selects the wrong cards.
  // "…with an energy cost of 5 or less **and [Swap]**" (BT4-095, #537): the
  // keyword joined to the measure before it is required just the same.
  for (const m of lower.matchAll(/\b(?:with|and) (?:an?|the )?\s*\[([a-z0-9:\- /]+)\](?: skills?)?/g)) {
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
    else addKeyword(f, kw, word);
  }
  // "7 **[Dragon Ball]** cards in your Drop" (BT25-019): the tag written in
  // front of the noun, as a kind of card. Read nowhere, it was dropped in
  // silence and any card in the Drop counted. A keyword is a requirement like
  // "with [X]"; anything else in that place makes the description unreadable.
  // "A yellow **[Field]** Extra is placed in your Battle Area" (P-416): the
  // same tag in front of the type said without "card".
  for (const m of lower.matchAll(/(?:^|[\s(])\[([a-z0-9:\- ]+)\](?= (?:(?:battle |extra |unison |leader )?cards?|extras?|unisons?)\b)/g)) {
    const before = lower.slice(0, m.index + (m[0].startsWith("[") ? 0 : 1));
    if (/(?:\bwith(?: an?| the)?|\bwithout|non-)\s*$/.test(before)) continue;
    const kw = keywordOf(m[1].trim());
    if (!kw) f.unreadable = true;
    else addKeyword(f, kw, m[1].trim());
  }
  // A name, a character or a trait asked of a card's SKILL TEXT: "a blue Z-Extra with <Janemba> in its skill text"
  // (EX24-23), "a Battle Card with a card name in the chosen card's skill text" (P-269b), "a card that has
  // ≪Agent of Destruction≫ in its skill text" (P-677). The words name text, not a character or a trait, and the
  // parser took them for the card's own - EX24-23 read as "<Janemba> Z-Extras", P-269b as any Battle Card in the
  // hand (#907 round 6). A bracketed KEYWORD in the text ("[Rejuvenate] in its skill text") is read as the
  // keyword, which is what it asks. Only `nameInSkillTextOf` (above, a chosen card's text) says the rest.
  if (!f.nameInSkillTextOf && /(?:[<≪{][^<>≪≫{}]+[>≫}]|\bcard names?) in (?:its|their|the chosen card'?s|that card'?s) skill text\b/.test(lower)) f.unreadable = true;
  // "Battle Cards **without [Barrier]** in Active Mode" — the same thing
  // "non-[Barrier]" says, written the long way. Sixteen of the cards that let
  // an active card be attacked carve out [Barrier] like this, and a
  // permission that misses the carve-out allows an attack the card forbids.
  for (const m of lower.matchAll(/\bwithout \[([a-z0-9:\- ]+)\]/g)) {
    const kw = keywordOf(m[1]);
    if (kw) addKeyword(f, kw, m[1], true);
  }
  // "A blue non-[Super Combo] Battle Card" — a keyword the card must not have.
  for (const m of lower.matchAll(/\bnon-\[([a-z0-9:\- ]+)\]/g)) {
    const kw = keywordOf(m[1]);
    if (kw) addKeyword(f, kw, m[1], true);
  }
  // "One of your blue **Z-Extras**" (BT22-032b): the plural is the same kind —
  // but not as one half of "your Battle Cards **or Z-Unisons**" (BT24-112b),
  // where it would rule out the other half.
  if (/\bz-(leader|battle|extra|unison)\b|\bz-card\b/.test(lower) || (/(?<!\b(?:or|and) )\bz-(?:leader|battle|extra|unison|card)s\b/.test(lower) && !/\b(?:or|and) z-[a-z]+s\b/.test(lower))) f.z = true;
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
  // "An **original** energy cost of 3" (20-3-1): the printed total, a measure of its own - read first and
  // taken out of the text, so the plain cost patterns below do not read the same number a second time as
  // a cost bound. "Whose original energy cost was 5 or more" (BT2-105) and "an original cost of 1"
  // (BT26-095) are the same measure said another way.
  let costText = lower;
  const original = /\boriginal (?:energy )?costs? (?:of |was |were )?(?:(\d+) or (less|more)\b|between (\d+) and (\d+)|(\d+)\b)/.exec(costText);
  if (original) {
    if (original[2] === "less") f.originalCostMax = Number(original[1]);
    else if (original[2] === "more") f.originalCostMin = Number(original[1]);
    else if (original[3]) {
      f.originalCostMin = Number(original[3]);
      f.originalCostMax = Number(original[4]);
    } else f.originalCostMin = f.originalCostMax = Number(original[5]);
    costText = costText.replace(original[0], " ");
  }
  if ((m = /energy costs? (?:of )?(\d+) or less/.exec(costText))) f.costMax = Number(m[1]);
  else if ((m = /energy costs? (?:of )?(\d+) or more/.exec(costText))) f.costMin = Number(m[1]);
  else if ((m = /energy costs? (?:of )?between (\d+) and (\d+)/.exec(costText))) {
    f.costMin = Number(m[1]);
    f.costMax = Number(m[2]);
  } else if ((m = /energy costs? (?:of )?(\d+)\b/.exec(costText))) f.costMin = f.costMax = Number(m[1]);
  // "Battle Cards with power between 30000 and 35000", "up to 2 black Battle
  // Cards with powers between 20000 and 30000" — the same range the cost line
  // above already reads, which the sets also write for power. Read before the
  // single bounds, because "between 30000 and 35000" contains neither "or
  // less" nor "or more" but does contain a bare number the last pattern would
  // take for an exact power.
  // "An original power of 500" (20-3-1): the printed value, read the same
  // shape the cost line above reads but with the "original" the catalog
  // marks it by — never matched by the plain `power` patterns below, which
  // require the number *before* the word and never see "of". Read before
  // them so it cannot be confused with a bound they express in the other
  // word order.
  if ((m = /original powers? between ([\d,]+) and ([\d,]+)/.exec(lower))) {
    f.originalPowerMin = Number(m[1].replace(/,/g, ""));
    f.originalPowerMax = Number(m[2].replace(/,/g, ""));
  } else if ((m = /original powers? (?:of )?([\d,]+) or less/.exec(lower))) f.originalPowerMax = Number(m[1].replace(/,/g, ""));
  else if ((m = /original powers? (?:of )?([\d,]+) or more/.exec(lower))) f.originalPowerMin = Number(m[1].replace(/,/g, ""));
  else if ((m = /original powers? (?:of )?([\d,]+)\b/.exec(lower))) f.originalPowerMin = f.originalPowerMax = Number(m[1].replace(/,/g, ""));
  // "Cards with 5000 combo power" (BT29-030), "a combo power of 5000" (2-8):
  // read before the bare power lines and then taken out of the text they
  // read, because "combo power between 5000 and 10000" contains "power
  // between", which would otherwise land on `powerMin`/`powerMax` as well.
  // The number-first order is read only after "with"/"and"/"of", so that "it
  // gets +5000 combo power" is not read as a bound on the target.
  const num = (x: string) => Number(x.replace(/,/g, ""));
  let comboSaid: string | null = null;
  if ((m = /combo powers? (?:of )?between ([\d,]+) and ([\d,]+)/.exec(lower))) {
    f.comboPowerMin = num(m[1]);
    f.comboPowerMax = num(m[2]);
    comboSaid = m[0];
  } else if ((m = /combo powers? (?:of )?([\d,]+) or (less|more)\b/.exec(lower) ?? /\b([\d,]+) or (less|more) combo powers?\b/.exec(lower) ?? /\b([\d,]+) combo powers? or (less|more)\b/.exec(lower))) {
    if (m[2] === "less") f.comboPowerMax = num(m[1]);
    else f.comboPowerMin = num(m[1]);
    comboSaid = m[0];
  } else if ((m = /\b(?:with|and|of) ([\d,]+) combo powers?\b/.exec(lower) ?? /combo powers? of ([\d,]+)\b/.exec(lower))) {
    f.comboPowerMin = f.comboPowerMax = num(m[1]);
    comboSaid = m[0];
  }
  // "A red Unison Card with 2 or more markers" (BT10-008), "Unison Cards with
  // 3 or fewer markers" (BT14-116), "2 markers or less" (EX19-01): a bound on
  // the markers the card carries (#721). Only a bound is read — see the field.
  for (const re of [/\b(\d+) or (more|fewer|less) markers?\b/g, /\b(\d+) markers? or (more|fewer|less)\b/g]) {
    for (const [, n, dir] of lower.matchAll(re)) {
      if (dir === "more") f.markersMin = num(n);
      else f.markersMax = num(n);
    }
  }
  const pw = comboSaid ? lower.replace(comboSaid, " ") : lower;
  if ((m = /powers? between ([\d,]+) and ([\d,]+)/.exec(pw))) {
    f.powerMin = Number(m[1].replace(/,/g, ""));
    f.powerMax = Number(m[2].replace(/,/g, ""));
  // The number may carry a thousands comma — "Battle Cards with 25,000 power
  // or less" — as the reversed order below and the cost lines already allow;
  // with `\d+` the bound took only the "000" after the comma and read as 0.
  } else if ((m = /([\d,]+) power or less/.exec(pw))) f.powerMax = num(m[1]);
  else if ((m = /([\d,]+) power or more/.exec(pw))) f.powerMin = num(m[1]);
  // The sets print the same bound with the words the other way round —
  // "Battle Cards with 25000 **or less power**" — on 41 lines, and only the
  // first order was read, so some thirty-eight selectors carried no bound at
  // all and were offered every card in the area. TB1-015 is the one that shows
  // what that costs: with its exclusion fixed but its bound still missing, it
  // KO'd every Battle Card on both boards instead of the small ones.
  else if ((m = /([\d,]+) or less power\b/.exec(pw))) f.powerMax = Number(m[1].replace(/,/g, ""));
  else if ((m = /([\d,]+) or more power\b/.exec(pw))) f.powerMin = Number(m[1].replace(/,/g, ""));
  // "...with an energy cost of 3 or more and **power of 35000 or less** in your Drop Area" (BT7-017, #907
  // round 4): the measure said before its number. Unread, the bound vanished and the selector offered
  // every card in the area. Never "original power of" (read above) or "combo power" (taken out of `pw`).
  else if ((m = /(?<!original )\bpowers? of ([\d,]+) or (less|more)\b/.exec(pw))) {
    if (m[2] === "less") f.powerMax = num(m[1]);
    else f.powerMin = num(m[1]);
  }
  // An exact power, which searches print alongside the cost: "a yellow
  // <Son Goku> card with an energy cost of 3 and 5000 power". Only after
  // "with"/"and", so that "it gets +5000 power for the turn" is not read as a
  // bound on the target.
  else if ((m = /\b(?:with|and) ([\d,]+) power\b/.exec(pw))) f.powerMin = f.powerMax = num(m[1]);
  // "with power less than or equal to this card's power", "with power greater
  // than this card's power" — measured against the card the skill is on.
  if (
    (m =
      /power (less than or equal to|equal to or less than|no more than|at or below|less than|lower than|greater than or equal to|equal to or greater than|no less than|at or above|greater than|higher than|more than) (?:this card'?s|its|the chosen card'?s) power/.exec(
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
    f.powerRel = { of: /the chosen card/.test(m[0]) ? "chosen" : "self", cmp };
  }
  return f;
}

/**
 * "A card whose card name is in the text of a skill on the chosen card"
 * (BT30-084, #542). Rule Manual 2-3-2: text in `{}` brackets with no noun after
 * it refers to the card with that card name, so a name is "in the text" when it
 * is written as `{Name}`; a bare occurrence of the words is not a reference.
 * 2-3-1-1: names are equal only when all of the text is the same, so
 * `{Son Goku, The Awakened Power}` names that card and not `Son Goku`, and
 * `{Dark Dragon Ball}` does not name `Super Dragon Balls`. 2-3-2-1: singular
 * and plural of a name are the same reference. Case is ignored, as for names.
 */
export function nameInSkillText(names: readonly string[], skill: string | null | undefined): boolean {
  if (!skill) return false;
  const norm = (x: string) => x.trim().toLowerCase().replace(/\s+/g, " ");
  const singular = (x: string) => (x.endsWith("s") && x.length > 1 ? x.slice(0, -1) : x);
  const named = [...skill.matchAll(/\{([^{}]+)\}/g)].map((m) => norm(m[1]));
  return names.some((n) => {
    const own = norm(n);
    return named.some((w) => w === own || singular(w) === singular(own));
  });
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
  // Either description in full (#537).
  if (f.anyOf?.length && !f.anyOf.some((alt) => matches(d, alt))) return false;
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
  if (f.keywordsExact?.length || f.notKeywordsExact?.length) {
    const have = new Set(keywordsOf(d).map((k) => keywordName(k).toLowerCase()));
    if (f.keywordsExact?.some((k) => !have.has(k.toLowerCase()))) return false;
    if (f.notKeywordsExact?.some((k) => have.has(k.toLowerCase()))) return false;
  }
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
  const characterOk = !(f.characters.length || partChars.length) || f.characters.some((c) => hasCharacter(d, c)) || partChars.some((c) => characterIncludes(d, c));
  const traitOk = !f.traits.length || f.traits.some((c) => hasTrait(d, c));
  // "with both <A> and <B>" (#768): each one, where `characters` takes any.
  if (!(f.charactersAll ?? []).every((c) => hasCharacter(d, c))) return false;
  // "a ≪Great Ape≫ ≪Saiyan≫ card" (#907 round 5): every trait named.
  if (!(f.traitsAll ?? []).every((c) => hasTrait(d, c))) return false;
  // "<Baby> or ≪Brainwashed≫" (BT29-114): either one answers.
  if (f.characterOrTrait) {
    if (!f.characters.some((c) => hasCharacter(d, c)) && !f.traits.some((c) => hasTrait(d, c))) return false;
  } else if (!characterOk || !traitOk) return false;
  // "<Son Goku>-only": nothing but the characters named.
  if (f.onlyCharacters && !(d.characters ?? []).every((c) => f.characters.some((n) => n.toLowerCase() === c.toLowerCase()))) return false;
  // "≪Saiyan≫-only" (#932): every trait the card has is one of those named.
  if (f.onlyTraits && !(d.traits ?? []).every((t) => f.traits.some((n) => n.toLowerCase() === t.toLowerCase()))) return false;
  if (f.notCharacters.some((c) => hasCharacter(d, c))) return false;
  if ((f.notCharactersIncluding ?? []).some((c) => characterIncludes(d, c))) return false;
  if (f.notTraits.some((c) => hasTrait(d, c))) return false;
  // Every name the card answers to: its printed one, plus any it was "also
  // treated as in all areas" (20-1). A card that gained {Planet M-2} is found
  // by a skill naming {Planet M-2}, and excluded by one naming it as the card
  // *not* to choose — both readings come from the same list.
  const names = namesOf(d);
  // Match the token-kind names stored by parseFilter, preserving full names
  // for ordinary card-name references and requiring type TOKEN above.
  if (f.token) names.push(...names.map((n) => n.replace(/ token$/i, "")));
  if ((f.names.length || partNames.length) && !f.names.some((n) => names.some((own) => identityKey(own) === identityKey(n))) && !partNames.some((n) => nameIncludes(d, n))) return false;
  if (!(f.namesAll ?? []).every((n) => names.some((own) => identityKey(own) === identityKey(n)))) return false;
  if (f.notNames.some((n) => names.some((own) => identityKey(own) === identityKey(n)))) return false;
  if ((f.notNamesIncluding ?? []).some((n) => nameIncludes(d, n))) return false;
  const cost = typeof d.energyCost === "number" ? d.energyCost : null;
  if (f.costMin != null && (cost == null || cost < f.costMin)) return false;
  if (f.costMax != null && (cost == null || cost > f.costMax)) return false;
  // 20-3-1: `d.energyCost` is the printed total, which is what "original" asks.
  if (f.originalCostMin != null && (cost == null || cost < f.originalCostMin)) return false;
  if (f.originalCostMax != null && (cost == null || cost > f.originalCostMax)) return false;
  if (f.powerMin != null && (d.power == null || d.power < f.powerMin)) return false;
  if (f.powerMax != null && (d.power == null || d.power > f.powerMax)) return false;
  // `d` is always a `CardDef` — the catalog row, or `cardNow`'s copy of it
  // with only `gains`' colours/characters/traits/names applied — so `d.power`
  // is already the printed number a marker or a [Permanent] never touches.
  // Checking it here *is* the original-power reading; see the field's own
  // comment for the "current power" reading this filter cannot give.
  if (f.originalPowerMin != null && (d.power == null || d.power < f.originalPowerMin)) return false;
  if (f.originalPowerMax != null && (d.power == null || d.power > f.originalPowerMax)) return false;
  if (f.originallySkillLess && d.skill) return false;
  // 1-5-9, 9-1-4: `cardNow` says whether the card has a skill in force; a
  // catalog row read with no table under it has only its printed text.
  if (f.skillLess && !(d.skillLess ?? !d.skill)) return false;
  // 2-8: the printed combo power — `cardNow` never rewrites it, the same as
  // `d.power` above.
  const combo = typeof d.comboPower === "number" ? d.comboPower : null;
  if (f.comboPowerMin != null && (combo == null || combo < f.comboPowerMin)) return false;
  if (f.comboPowerMax != null && (combo == null || combo > f.comboPowerMax)) return false;
  // 1-2-3: the orbs of the specified cost, where it is known (#728) — see the field.
  if (f.specifiedCostMin != null || f.specifiedCostMax != null) {
    const orbs = specifiedOrbsKnown(d);
    if (orbs == null) return false;
    if (f.specifiedCostMin != null && orbs < f.specifiedCostMin) return false;
    if (f.specifiedCostMax != null && orbs > f.specifiedCostMax) return false;
  }
  if (f.specifiedCostNone && !specifiedCostNone(d)) return false;
  return true;
}

/**
 * "Has no specified cost" (1-2-3), as far as the data can say it: nothing
 * stored, no X cost to leave unentered, and no orbs by the one-per-colour
 * convention (`specifiedCostOf`). A Unison off the feed with no energy cost is
 * the case — the same reading the rules engine's `specifiedCost` attribute makes.
 */
export function specifiedCostNone(d: CardDef): boolean {
  return !specifiedCostUnknown(d) && Object.values(specifiedCostOf(d)).every((n) => !n);
}

/**
 * How many coloured orbs a card's specified cost has, or null when nobody
 * knows (#728): the stored value when there is one, the one-per-colour
 * convention for a fixed numeric energy cost (`specifiedCostOf`), and nothing
 * for a card with no number to fill it from — a Unison off the feed, an X cost.
 */
export function specifiedOrbsKnown(d: CardDef): number | null {
  if (!d.specifiedCost && typeof d.energyCost !== "number") return null;
  return Object.values(specifiedCostOf(d)).reduce((n, k) => n + (k ?? 0), 0);
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
