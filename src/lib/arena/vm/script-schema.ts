import { potaraMaterialsProblem } from "./potara-materials";
import { fusionMaterialsProblem } from "./fusion-materials";
import { skillPriceProblem } from "./skill-payment";
import { FILTER_FIELDS, emptyFilter, type CardFilter, type FilterFieldType } from "../text/filters";
import { keywordName } from "../text/cards";
// `AmountAttr` and `CardAttr` are deliberately two lists, not one: `CardAttr`
// is what `modifyAttr` may *write* (colours, characters, traits and names among
// them, which are lists), `AmountAttr` what an amount may *read as a number*.
// Collapsing them would let `attr($t, colors)` stand where a number belongs.
import type { Amount, AmountAttr, CardAttr, Cond, Duration, NegateScope, Op, Ref, ReplaceEvent, ScriptArea, Selector, Side, SpecialTarget } from "./script";
import type { Area, CardDef, Color, DelayScope, DelayTiming, ForbiddenAction, KeywordSkill, MoveReason, Phase, Prompt, SkillKindPrefix, SkipWhat } from "../types";

// ── the schema: one row per op, read by everything that is not the interpreter ──

/**
 * What each field of each op is. `validateProgram`, `describeScript`, the
 * referee's prompt and the workbench's editor all read this table, so adding
 * an op is one interpreter case above and one row here — nowhere else.
 *
 * `{ enum }` lists the values a field may take; `{ list }` is an array of
 * strings or of one enum. `keyword` is a `KeywordSkill` object, `filter` a
 * `CardFilter`, `modes` the `chooseMode` options.
 */
export type FieldType =
  | "amount"
  | "ref"
  | "selector"
  | "side"
  | "area"
  | "duration"
  | "cond"
  | "conds"
  | "ops"
  | "string"
  | "number"
  | "boolean"
  | "price"
  | "keyword"
  | "filter"
  | "modes"
  | { enum: readonly string[] }
  | { list: "string" | { enum: readonly string[] } };

export interface OpField {
  name: string;
  type: FieldType;
  required?: boolean;
  /** What the interpreter assumes when the field is left out. */
  default?: unknown;
  /** `null` is a value here ("no combo cost"), not an omission. */
  nullable?: boolean;
  /**
   * A field no printed card's record writes — a `DEFINE KEYWORD` body's word
   * (#155) — and what it does. Left out of what the referee is told
   * (`opSignature`), as `CONDITIONS_OFF_A_CARD` leaves out a whole condition:
   * a word only a keyword's own program writes is one a ruling on a card
   * could only use wrongly. The language reference lists it with this line.
   */
  offCard?: string;
}

/**
 * `sentence` is the op in words. A string is a template: `{field}` renders
 * the field, `{field:hint}` hands the describer a hint (a noun for an amount,
 * "A|B" for a side, boolean or two-valued enum, a fallback for a string,
 * filter or list of ops), and `{field? text with {field}}` renders only when
 * the field is set. Four ops whose prose turns on how their fields combine
 * carry a function instead. `doc` is the one line the referee is told.
 */
export interface OpSpec {
  fields: OpField[];
  sentence: string | ((op: Op, r: RenderOptions) => string);
  doc?: string;
  /**
   * A whole op no printed card's record writes — a `DEFINE KEYWORD` body's
   * word (#156) — and what it does: `OpField.offCard` one level up, the way
   * `CONDITIONS_OFF_A_CARD` is for a condition. Left out of what the referee
   * is told and of the workbench's op picker; the language reference lists it
   * with this line.
   */
  offCard?: string;
}

export interface RenderOptions {
  /** A [Permanent] holds while its card is where the skill is valid (9-5-1), so no duration is said. */
  permanent?: boolean;
}

/**
 * The closed word lists, as the **legacy engine** knows them.
 *
 * Since #137 these are no longer what the language, the chip editor and the
 * referee's prompt read: those read the game's own declarations
 * (`rulesets/words.ts`, ultimately `zones.rules`), so a zone deleted there
 * disappears from all three at once. What is left here is the engine's side of
 * the same claim — the unions `Selector`, `Op` and the interpreter are typed
 * against — and `scripts/verify/rulesets.ts` is where the two are asserted to
 * be one list. `KEYWORD_NAMES` is still read directly, by the parser and the
 * editor, until `keywords.rules` declares the 39 (#135).
 *
 * `COLORS` is exported for one more reader: no declaration carries the colour
 * words — `Vocabulary` has no list for them — so an attribute declared
 * `value: colors` is checked against this one (`vm/cards.ts`). The day a game
 * declares its own colours, that check reads the declaration and this export
 * goes back to being private.
 */
export const COLORS = ["Red", "Blue", "Green", "Yellow", "Black", "White", "Colorless"] as const satisfies readonly Color[];

/** The card measures an `Amount` may read off one card (`AmountAttr`) — `lang/ast.ts`'s `EXPR_ATTRS`, written out here because the schema cannot import the language. */
const AMOUNT_ATTRS = ["power", "originalPower", "comboPower", "energyCost", "comboCost", "specifiedCost"] as const satisfies readonly AmountAttr[];
export const SIDES = ["you", "opponent", "both"] as const satisfies readonly Side[];
export const SPECIAL_TARGETS = ["self", "attacker", "guard", "subject", "leader", "opponentLeader", "resolving", "onTop"] as const satisfies readonly SpecialTarget[];
export const REPLACE_EVENTS = ["leave", "ko", "play", "life", "marker", "attack", "counter"] as const satisfies readonly ReplaceEvent[];
export const AREAS = ["hand", "deck", "drop", "life", "battle", "combo", "energy", "unison", "leader", "warp", "zDeck", "zEnergy", "under", "play", "removed"] as const satisfies readonly ScriptArea[];
/**
 * Every `modifyAttr` may name in `attr`: the six card attributes it always
 * could, the six spec §2.5-1/§2.5-3 (#275) adds, and the one attribute each
 * of the two widened subjects has — `energyMarkers` for a player (1-14),
 * `guard` for the battle in progress (8-1, 22-4-2). One closed list rather
 * than one per subject, because the field itself does not branch on
 * `subject` — `modifyAttrAs` is what reads the two together.
 */
export const CARD_ATTRS = ["power", "comboPower", "colors", "characters", "traits", "alsoNames", "mode", "markers", "keywords", "hidden", "faceUp", "flipped", "energyMarkers", "guard"] as const satisfies readonly (CardAttr | "energyMarkers" | "guard")[];
export const DURATIONS = ["battle", "turn", "opponentTurn", "nextTurn", "afterNextCharge", "afterOpponentCharge", "nextMain", "ownTurn", "game", "whileSourceInPlay"] as const satisfies readonly Duration[];
const DELAY_TIMINGS = ["turnStart", "mainStart", "turnEnd", "turnCleanup", "battleEnd"] as const satisfies readonly DelayTiming[];
export const MOVE_REASONS = ["ko", "effect", "rule", "cost", "play", "combo", "damage", "draw", "charge", "areaExtension"] as const satisfies readonly MoveReason[];
const DELAY_SCOPES = ["thisTurn", "nextTurn", "yourNextTurn", "opponentNextTurn"] as const satisfies readonly DelayScope[];
const SKILL_KIND_PREFIXES = ["auto", "activate", "counter", "permanent"] as const satisfies readonly SkillKindPrefix[];
export const KEYWORD_NAMES = [
  "Awaken", "Wish", "Field", "Blocker", "Critical", "Strike", "Attack", "Revenge", "Indestructible", "Barrier", "Deflect", "Unique", "Servant", "Energy-Exhaust", "Victory Strike",
  "Warrior of Universe 7", "Ultimate", "Super Combo", "Dragon Ball", "Wormhole", "Invoker", "Heroic", "Villainous", "Offering", "Evolve", "Union", "Over Realm", "Swap", "Arrival", "Aegis",
  "Alliance", "Revive", "Successor", "Overlord", "Rejuvenate", "Spirit Boost", "Empower", "Z-Awaken", "Z-Stack",
] as const satisfies readonly KeywordSkill["name"][];
// A keyword the parser knows but this list does not would fail the referee and the editor silently; make it fail the typecheck instead.
type MissingKeyword = Exclude<KeywordSkill["name"], (typeof KEYWORD_NAMES)[number]>;
const _everyKeywordListed: MissingKeyword extends never ? true : never = true;
void _everyKeywordListed;

// ── the legacy engine's other unions, as runtime arrays (#136) ──────────────
//
// `Area` and `Phase` have no runtime array of their own — they are read off
// the board, never printed by a schema — so `scripts/verify/rulesets.ts`
// needs one to check a `.rules` ruleset's declarations against, by name, in
// both directions. Each gets the same never-check as `KEYWORD_NAMES` above:
// a member added to the union and not listed here fails the typecheck
// rather than going unnoticed by the suite.

/** `Area` (13), the places a card can actually be. `AREAS` above is `ScriptArea` (15): the two extra values, `under` and `play`, are effect-language routes ("place it under this card", "the card resolving a skill"), not board zones a `.rules` file declares. */
/** `SkipWhat` (20-13), as a runtime list the schema row and `verify/rulesets.ts` read. */
export const SKIP_WHATS = ["charge", "main", "end", "offense", "defense", "turn", "span"] as const satisfies readonly SkipWhat[];
type MissingSkipWhat = Exclude<SkipWhat, (typeof SKIP_WHATS)[number]>;
const _everySkipWhatListed: MissingSkipWhat extends never ? true : never = true;
void _everySkipWhatListed;

export const AREA_NAMES = ["hand", "deck", "drop", "life", "battle", "combo", "energy", "unison", "leader", "warp", "zDeck", "zEnergy", "removed"] as const satisfies readonly Area[];
type MissingArea = Exclude<Area, (typeof AREA_NAMES)[number]>;
const _everyAreaListed: MissingArea extends never ? true : never = true;
void _everyAreaListed;

export const PHASES = ["setup", "charge", "main", "mainEnd", "end", "over"] as const satisfies readonly Phase[];
type MissingPhase = Exclude<Phase, (typeof PHASES)[number]>;
const _everyPhaseListed: MissingPhase extends never ? true : never = true;
void _everyPhaseListed;

/**
 * Every `Prompt["kind"]` (`types.ts`), so `scripts/verify/rulesets.ts`
 * can check `prompts.rules` against a runtime list rather than a type — the
 * union itself has none. `prompts.rules` is #135's open question (`DEFINE
 * PROMPT` awaits the owner's word on #131); this array exists so the two
 * cannot drift apart once it lands.
 */
export const PROMPT_KINDS = [
  "chooseFirst", "mulligan", "charge", "main", "combo", "blocker", "counter", "orderPending", "chooseCards", "chooseMode",
  "replaceMove", "zEnergyFromCombo", "optionalCost", "payCost", "offering", "empowerCarry", "referee", "gameOver",
] as const satisfies readonly Prompt["kind"][];
// A prompt kind types.ts adds but this list does not would go unchecked; make it fail the typecheck instead.
type MissingPromptKind = Exclude<Prompt["kind"], (typeof PROMPT_KINDS)[number]>;
const _everyPromptKindListed: MissingPromptKind extends never ? true : never = true;
void _everyPromptKindListed;

/**
 * Every `CardDef` field, as `attributes.rules` (#133) declares one `DEFINE
 * ATTRIBUTE` for each — `id`/`name` included (2-14, 2-3: a card's identity is
 * still something it *has*), `skill` (2-4, the whole text box before any is
 * gained or negated), `back` (1-9: whether a second face exists, not what is
 * on it — that face has no kind of its own yet) and `alsoNames` (20-1,
 * `printed: false` since a skill grants it rather than the card printing it)
 * and `skillLess` (1-5-9, 9-1-4: no skill in force, `printed: false` because
 * a negation or a grant moves it).
 * `attributes.rules` also declares three derived `of: card` attributes with
 * no `CardDef` field at all (`costOf`, `comboCostOf`, `zEnergyCostOf`,
 * 20-21) — real values the board computes, so `scripts/verify/rulesets.ts`
 * sets those three aside by name rather than by shape.
 */
export const CARD_ATTRIBUTES = ["id", "name", "type", "colors", "energyCost", "zEnergyCost", "power", "comboCost", "comboPower", "skill", "characters", "traits", "back", "specifiedCost", "alsoNames", "skillLess"] as const satisfies readonly (keyof CardDef)[];
type MissingCardAttribute = Exclude<keyof CardDef, (typeof CARD_ATTRIBUTES)[number]>;
const _everyCardAttributeListed: MissingCardAttribute extends never ? true : never = true;
void _everyCardAttributeListed;

/** Each prohibition as the verb phrase a sentence needs after "can't". Shared with `effects.ts`, so the inspector and the board say the same thing. */
export const FORBIDDEN_IN_WORDS: Record<ForbiddenAction, string> = {
  attack: "attack",
  beAttacked: "be attacked",
  block: "block",
  play: "play cards",
  activateSkill: "activate skills",
  activateCounter: "activate [Counter] skills",
  combo: "combo",
  beKOd: "be KO'd",
  beKOdBySkill: "be KO'd by skills",
  beChosen: "be chosen by skills",
  switchToActive: "switch to Active Mode",
  switchToActiveInCharge: "switch to Active Mode in the Charge Phase",
  switchEnergyToActive: "switch energy to Active Mode",
  placeEnergy: "place cards in the Energy Area",
  energyCap: "place another card in the Energy Area",
  addLifeToHand: "add cards from life to hand",
  beMovedBySkill: "be removed from a Battle Area by skills",
  beNegated: "have their skills negated",
  beRestedBySkill: "be switched to Rest Mode by skills",
  dropToWarp: "send cards from a Drop Area to a Warp",
  beKOdInBattle: "be KO'd by attacks",
  placeUnder: "have cards placed under them",
  loseGame: "lose the game",
  winGame: "win the game",
  evolveOnto: "be the base of an [Evolve]",
  placeOnTop: "have cards placed on top of them",
  removeMarkers: "have markers removed by skills",
};
const FORBIDDEN_ACTIONS = Object.keys(FORBIDDEN_IN_WORDS) as readonly ForbiddenAction[];
/** The actions a `forbid` may put a price on (`unlessPay`, 20-14-1): the ones both engines charge one where the action is taken. */
export const TAXABLE: ReadonlySet<ForbiddenAction> = new Set(["attack", "play", "switchEnergyToActive", "activateSkill", "activateCounter"]);

const SIDE: OpField = { name: "side", type: "side", default: "you" };
const TARGET: OpField = { name: "target", type: "ref", required: true };
/**
 * With what: "evolve", the change holds only for an [Evolve] played onto one
 * of these cards (22-5-5) — EX03-16's `onto: [self]`. Shared by
 * `costReduction` and `costModifier`, which `costModifierAs` hands it across.
 */
const ONTO: OpField = { name: "onto", type: "ref" };
/** `costReduction`'s fields, named so its `sentence` function (below) can hand them to `renderTemplate` for the non-"specified" branch without reaching into `OP_SCHEMA` mid-construction. */
const COST_REDUCTION_FIELDS: OpField[] = [
  TARGET,
  { name: "amount", type: "amount", required: true },
  { name: "what", type: { enum: ["energy", "skill", "evolve", "combo", "zEnergy", "specified"] }, default: "energy" },
  { name: "skillKind", type: { enum: SKILL_KIND_PREFIXES } },
  { name: "tag", type: "string" },
  { name: "colors", type: { list: { enum: ["any", ...COLORS] } } },
  { name: "until", type: "duration" },
  { name: "uses", type: "number" },
  {
    name: "all",
    type: "boolean",
    offCard:
      'with what: "specified", no specified cost at all — every orb, after every other change to it, and amount is not read — [Warrior of Universe 7]\'s ≪Universe 7≫ cards (22-19-2), the leaf of its altPayment hook',
  },
  ONTO,
];
/**
 * `costModifier`'s fields — the union of `costReduction`'s and `altCost`'s,
 * every one optional since which half of the union a call means is read off
 * whether `pay` is there at all (`costModifierAs`), not off which fields were
 * required to begin with. Named for the same reason the other two constants
 * beside it are.
 */
const COST_MODIFIER_FIELDS: OpField[] = [
  { name: "target", type: "ref", default: { sel: { special: "self" } } },
  { name: "amount", type: "amount" },
  { name: "what", type: { enum: ["energy", "skill", "evolve", "combo", "zEnergy", "specified"] }, default: "energy" },
  { name: "skillKind", type: { enum: SKILL_KIND_PREFIXES } },
  { name: "tag", type: "string" },
  { name: "colors", type: { list: { enum: ["any", ...COLORS] } } },
  { name: "pay", type: { enum: ["none", "life", "program", "energy"] } },
  { name: "n", type: "number" },
  { name: "for", type: { enum: ["counter", "play", "activate:battle"] }, default: "counter" },
  { name: "alt", type: "ops" },
  { name: "orbs", type: { list: { enum: ["any", ...COLORS] } } },
  { name: "until", type: "duration" },
  ONTO,
  { name: "uses", type: "number" },
];
const MODE = { enum: ["active", "rest"] } as const;
/**
 * `modifyAttr`'s fields, named for the same reason `costReduction`'s are:
 * its `sentence` hands the first three to `renderTemplate` for the two
 * numeric attributes, and reads the rest itself through `modifyAttrAs`.
 *
 * `subject`/`side` name the two widened subjects (spec §2.5-1); `target`
 * stays the card subject's own field and — for the battle subject's one
 * attribute, `guard` — the value `redirectAttack` would have taken as its
 * own `target`. `mode`, `sign`, `keyword` and `flag` are the shapes the six
 * new card attributes need that `amount`/`values` have no room for: `sign`
 * says which way `amount` moves `markers` (`addMarker`/`removeMarker` are
 * the same field, opposite signs), `flag` is the boolean `hidden` and
 * `faceUp` take. `flipped` and `guard` read no value field at all — a flip
 * and a redirect are what they are once the subject and the attribute are
 * named.
 */
const MODIFY_ATTR_FIELDS: OpField[] = [
  { name: "subject", type: { enum: ["card", "player", "battle"] }, default: "card" },
  { name: "target", type: "ref", default: { sel: { special: "self" } } },
  { name: "side", type: "side" },
  { name: "attr", type: { enum: CARD_ATTRS }, required: true },
  { name: "amount", type: "amount", default: 0 },
  { name: "values", type: { list: "string" } },
  { name: "mode", type: MODE },
  { name: "sign", type: { enum: ["add", "remove"] }, default: "add" },
  { name: "keyword", type: "keyword" },
  { name: "flag", type: "boolean" },
  { name: "allAreas", type: "boolean" },
  { name: "until", type: "duration" },
];
const SELF: OpField = { name: "target", type: "ref", default: { sel: { special: "self" } } };
const UNTIL: OpField = { name: "until", type: "duration", required: true };
const NEGATE_SCOPES = ["skills", "kind", "keyword", "own"] as const satisfies readonly NegateScope[];
/** `negate`'s fields, named so its `sentence` can hand the spelling it stands for to `describeScript`. */
const NEGATE_FIELDS: OpField[] = [
  SELF,
  { name: "what", type: { enum: NEGATE_SCOPES }, required: true },
  { name: "kind", type: { enum: SKILL_KIND_PREFIXES } },
  { name: "keyword", type: { enum: KEYWORD_NAMES } },
  { name: "chosen", type: "boolean" },
  { name: "until", type: "duration" },
];
const POSITION = { enum: ["top", "bottom"] } as const;
const n = (required = true): OpField => ({ name: "n", type: "amount", required });
/** `copySkills`' fields, named so its `sentence` function can hand them to `renderTemplate` for each of the five ways the wording comes out. */
const COPY_SKILLS_FIELDS: OpField[] = [
  SELF,
  { name: "from", type: "ref", required: true },
  { name: "which", type: { enum: ["all"] } },
  { name: "skill", type: "number" },
  { name: "only", type: { enum: ["keyword"] } },
  { name: "quoted", type: "boolean" },
  UNTIL,
];

type OpOf<K extends Op["op"]> = Extract<Op, { op: K }>;

/** `permit`'s fields, named so its sentence can render the `attackActive` case with them. */
const PERMIT_FIELDS: OpField[] = [{ name: "what", type: { enum: ["attackActive", "comboRest", "fieldBattle", "overRealmFromWarp", "unionFusionAreas", "unionFusionWarp", "unionFusionDropBottom", "unionEnergy", "unionLine", "evolveEnergyBases", "evolveFromZEnergy", "aegisAltDrop", "aegisAltOpponentHand", "attackUnnegatable", "unionSourceUnder", "unionSourceOpponentBattle", "playInOpponentBattle", "startLife", "absorbMaterialUnder"] }, required: true }, UNTIL, TARGET, { name: "filter", type: "filter" }, { name: "line", type: "string" }, { name: "unionVariant", type: { enum: ["Fusion", "Potara"] } }, { name: "price", type: "price" }, { name: "source", type: "filter" }, { name: "n", type: "number" }];

/** `choose`'s fields, named so its sentence can render the plain case with them. */
const CHOOSE_FIELDS: OpField[] = [
      { name: "permission", type: { enum: ["unionFusionDropBottom"] }, offCard: "recheck this typed own-hand permission while the suspended Fusion material cost is being chosen and paid" },
      { name: "sel", type: "selector", required: true },
      { name: "as", type: "string", required: true },
      { name: "reason", type: "string" },
      { name: "chooser", type: "side" },
      { name: "bindX", type: "boolean" },
      {
        name: "sumTo",
        type: "amount",
        offCard: "picks one card at a time until their sumAttr adds up to exactly this much, offering only the cards that still leave a way to the exact sum; the selector's count is not read, and a set that cannot be finished binds nothing — [Successor]'s cost (22-38-3)",
      },
      { name: "sumAttr", type: { enum: AMOUNT_ATTRS }, offCard: "the measure sumTo adds up — energyCost when left out" },
      {
        name: "namedSet",
        type: "boolean",
        offCard: "picks one card at a time for the characters the keyword line prints in ‹…› — one card per name, all of one printed power — offering only the cards that still leave a complete set; binds the picks to `as` and those that stood outside the hand to `<as>Outside` — [Union-Fusion] (22-13-4-2)",
      },
      {
        name: "anyPower",
        type: "boolean",
        offCard: "with namedSet: the named cards need not share a power — [Union-Potara] (22-13-5-2), which asks only for one Battle Card of each specified character; left out the set is of one printed power, as [Union-Fusion] needs (22-13-4-2)",
      },
      {
        name: "blind",
        type: "boolean",
        offCard: "the candidates are cards the chooser may not read (the opponent's hand), so asking reveals none of them: they are offered by position only — [Aegis]'s alternative payment (BT22-140)",
      },
      {
        name: "atMost",
        type: "amount",
        offCard: "any number of the selected cards, up to this many read off the board as the choice is made — \"choose any number of your opponent's Battle Cards up to the number of your Hidden Mode cards\" (BT29-139); the selector's count is not read",
      },
      {
        name: "exactly",
        type: "amount",
        offCard: "exactly this many of the selected cards, read off the board as the choice is made — \"switch the same number of your green energy as that card's specified cost to Rest Mode\" (BT26-088); the selector's count is not read; with too few cards nothing is chosen and an accepted \"you may\" around it counts as not done (20-16-1)",
      },
      {
        name: "specifiedCostAtMost",
        type: "amount",
        offCard: "only the selected cards whose specified cost (1-2-3) is at most this much, read off the board as the choice is made — \"reveal 1 mono-green <Vegito> card from your hand and switch the same number of your green energy as that card's specified cost to Rest Mode\" (BT26-088): a card the counted energy cannot pay for is not on offer",
      },
    ];

export const OP_SCHEMA: Record<Op["op"], OpSpec> = {
  draw: { fields: [n(), SIDE], sentence: "{side:opponent draws|draw} {n}" },
  // `to` names the Drop Area as well as the Warp (#137): left out it always
  // meant the Drop, and naming that default is what lets `ops.rules`'s
  // `discard` macro put the destination in its move without guessing. The
  // sentence still says "to the Warp" for the Warp alone.
  discard: {
    fields: [n(), SIDE, { name: "to", type: { enum: ["drop", "warp"] }, default: "drop" }],
    sentence: (raw, r) => renderTemplate(`{side:opponent discards|discard} {n}${(raw as OpOf<"discard">).to === "warp" ? " to the Warp" : ""}`, raw as unknown as Record<string, unknown>, OP_SCHEMA.discard.fields, r),
    doc: 'cards leave a hand for the Drop (20-7); "to":"warp" for the Warp',
  },
  // The runtime default is "opponent" (`stepScript`'s `case "damage"`), not
  // `SIDE`'s "you" — damage is dealt to *someone*, and nearly every card that
  // omits `side` means the other player's life, never its own.
  // "inflict 2 damage to your life" (EX03-11) is `side: "you"`, and says so.
  damage: {
    fields: [n(), { name: "side", type: "side", default: "opponent" }],
    sentence: (raw, r) => renderTemplate(`${(raw as OpOf<"damage">).side === "you" ? "take" : "deal"} {n} damage`, raw as unknown as Record<string, unknown>, OP_SCHEMA.damage.fields, r),
    doc: "life to hand",
  },
  mill: { fields: [n(), SIDE, { name: "as", type: "string" }], sentence: "{n} from the top of {side:your opponent's|the} deck to the Drop", doc: 'deck to Drop; "as" names the cards for a later clause ("if that card is red")' },
  addLife: { fields: [n(), SIDE], sentence: "add {n} to life" },
  lifeDownTo: { fields: [{ name: "n", type: "number", required: true }, SIDE], sentence: "life down to {n}, the cards going to hand", doc: "add cards from life to hand until that many life remain (21-3-2)" },
  declare: {
    fields: [{ name: "max", type: "number", required: true }, { name: "min", type: "number" }],
    sentence: (raw) => {
      const op = raw as OpOf<"declare">;
      return `declare a number from ${op.min ?? 0} to ${op.max}`;
    },
    doc: 'the master names a whole number, which the rest of the program reads as X ("the declared number"); asked as a "choose one" among the numbers',
  },
  win: { fields: [SIDE], sentence: "{side:your opponent wins|you win} the game", doc: "a skill ends the game with its master (or, with side, the other player) the winner; nothing after it in the program is played" },
  shuffle: { fields: [SIDE, { name: "areas", type: { list: { enum: ["deck", "life"] } } }, { name: "inspectedOnly", type: "boolean" }], sentence: "shuffle" },
  invokeSkill: {
    fields: [{ name: "trait", type: "string" }, { name: "sel", type: "selector" }, { name: "skillKind", type: { enum: ["activate:main", "activate:main/battle"] }, required: true }, { name: "from", type: { enum: ["hand"] }, required: true }, { name: "maxCost", type: { enum: ["currentEnergy"] } }],
    sentence: (raw) => {
      const op = raw as OpOf<"invokeSkill">;
      return "trait" in op ? `activate the chosen ${op.trait} card's ${op.skillKind} skill` : `activate up to 1 ${op.skillKind} skill of ${describeSelector(op.sel)} for free`;
    },
    doc: "12-2-4: use either trait + currentEnergy with an Activate: Main line (SD7-01), a one-card hand selector whose filter is bounded by current energy with an Activate: Main line (the coloured Desire cards, #979), or an optional one-card hand selector with an Activate: Main/Battle line (BT31-116). The chosen Extra's original energy and skill costs are waived; its activation still occurs.",
  },
  energyMarker: { fields: [n(), SIDE], sentence: "{n} energy marker" },
  choose: {
    fields: CHOOSE_FIELDS,
    sentence: (raw, r) => {
      const op = raw as OpOf<"choose">;
      // "Any number of …, up to the number of …" (BT29-139): the selector's own
      // count is not read, so it is not said either.
      if (op.atMost !== undefined) {
        const cards = describeSelector({ ...op.sel, count: 99, upTo: false }).replace(/^all /, "");
        const bound = typeof op.atMost === "object" && "count" in op.atMost && op.atMost.times === undefined && op.atMost.per === undefined ? `the number of ${describeEach(op.atMost.count)}` : describeAmount(op.atMost);
        return `choose any number of ${cards}, up to ${bound}`;
      }
      if (op.exactly !== undefined) {
        const cards = describeSelector({ ...op.sel, count: 99, upTo: false }).replace(/^all /, "");
        return `choose exactly ${describeAmount(op.exactly)} of ${cards}`;
      }
      return renderTemplate("choose {sel}{sumTo? whose {sumAttr} adds up to exactly {sumTo}}{specifiedCostAtMost? with a specified cost of no more than {specifiedCostAtMost}}", raw as unknown as Record<string, unknown>, CHOOSE_FIELDS, r ?? {});
    },
    doc: 'binds the chosen cards to the name in "as"; "chooser":"opponent" when the card says *they* choose ("your opponent sends 1 Battle Card…"); "bindX":true also binds X to how many were chosen (20-5)',
  },
  look: {
    fields: [n(), { name: "as", type: "string", required: true }, SIDE, { name: "from", type: POSITION, default: "top" }, { name: "area", type: "area", default: "deck" }],
    // #907 round 4: the reading said "the top" for a look the op takes from the bottom ("look at
    // the bottom card of your deck", BT11-062b, BT11-104, EB1-54) - the op was right, the words wrong.
    sentence: (raw, r) => renderTemplate(`look at the ${(raw as OpOf<"look">).from === "bottom" ? "bottom" : "top"} {n}`, raw as unknown as Record<string, unknown>, OP_SCHEMA.look.fields, r),
    doc: "top of your deck, seen only by you; the cards are bound to the name in \"as\" (20-11)",
  },
  // `audience` (#137): who sees the cards. "you" is a look — 20-11's same
  // act with the narrower audience — and reads as the `look` it stands for
  // when it is exactly the shape `ops.rules`'s `look` lowers to (`revealAs`).
  reveal: {
    fields: [{ name: "sel", type: "selector", required: true }, { name: "as", type: "string", required: true }, { name: "audience", type: { enum: ["you", "both"] }, default: "both" }],
    sentence: (raw, r) => {
      const op = raw as OpOf<"reveal">;
      const as = revealAs(op);
      if (as.op !== "reveal") return describeScript([as], r);
      return renderTemplate(`${op.audience === "you" ? "look at" : "reveal"} {sel}`, raw as unknown as Record<string, unknown>, OP_SCHEMA.reveal.fields, r);
    },
    doc: 'shown to both players; the cards stay where they are (20-11-2). "audience":"you" is a look — shown to you alone, nothing logged (20-11); prefer "look", the spelling it means',
  },
  ko: { fields: [TARGET], sentence: "KO {target}" },
  moveTo: {
    fields: [
      TARGET,
      { name: "to", type: "area", required: true },
      { name: "position", type: POSITION },
      { name: "mode", type: MODE },
      { name: "reveal", type: "boolean" },
      { name: "under", type: "ref" },
      { name: "owner", type: "side" },
      { name: "faceUp", type: "boolean" },
      { name: "cause", type: { enum: MOVE_REASONS }, default: "effect" },
    ],
    // A move a macro lowered to reads as the spelling it stands for (#137,
    // `moveAs`) — "life down to 3", not a selector counted by an expression.
    sentence: (raw, r) => {
      const as = moveAs(raw as Op);
      if (as.op !== "moveTo" && as.op !== "note") return describeScript([as], r);
      return renderTemplate("move {target} to {to}{faceUp? face up}", raw as unknown as Record<string, unknown>, OP_SCHEMA.moveTo.fields, r);
    },
    doc: '"to":"under" puts the card under "under" (or under this card, 23-2); "owner":"opponent" for "place it in your opponent\'s energy" — the area is theirs, not the card owner\'s (3-8); "cause" is "damage"/"ko"/"combo"/"effect"/a plain "draw" told apart (spec §2.5-2), read by a replacement\'s own scope and, on the rules engine, by `triggers.rules`\'s `moved(cause: …)`',
  },
  play: {
    fields: [TARGET, { name: "mode", type: MODE }, { name: "onto", type: "ref" }, { name: "alsoUnder", type: "ref", offCard: "more cards that go under the played card as part of the same play (22-13-5-4: [Union-Potara]'s second material) — none moves when the play fails" }, { name: "negated", type: { enum: ["turn", "game"] } }, {
        name: "activating",
        type: "boolean",
        offCard: "\"activate {Tragedy Overground}\" (22-3-3): a card with a [Field] skill is activated through that skill, its price waived, not played; any other card is played as before",
      }, {
        name: "counterWindow",
        type: "boolean",
        offCard: "opens the [Counter: Play] window a declared play opens (9-6, 22-10) before the card lands — the play a keyword's own move makes ([Arrival], [Revive], [Successor]), where a play a card's skill makes opens none (5-5-3)",
      },
      {
        name: "markers",
        type: "amount",
        offCard: "the markers a Unison arrives with, paid for as its cost (13-2-3) — part of the arrival, so markers a [Empower] carries across land after them (22-45-3, #157); the `playUnison` move's own word",
      },
      {
        name: "using",
        type: { enum: ["Over Realm", "Evolve", "EX-Evolve", "Xeno-Evolve", "Union-Fusion", "Union-Potara", "Union-Absorb"] },
      },
    ],
    sentence: (raw, r) => {
      const op = raw as OpOf<"play">;
      if (op.using === "Evolve" || op.using === "EX-Evolve" || op.using === "Xeno-Evolve") {
        const base = op.onto && "sel" in op.onto && op.onto.sel.filter
          ? describeSelector({ side: "you", area: "battle", filter: op.onto.sel.filter, count: 1 }).replace(/^1 /, "") : "base";
        const source = "sel" in op.target && op.target.sel.area === "drop" ? " from its Drop Area" : "";
        const warp = op.using === "Xeno-Evolve" ? " (sending the base to the Warp)" : "";
        return `evolve the chosen ${base} into ${describeRef(op.target)}${source}${warp}`;
      }
      const played = renderTemplate(`${op.activating ? "activate (its [Field] skill, else play)" : "play"} {target}{mode? in {mode} mode}{counterWindow? through a [Counter: Play] window}`, raw as unknown as Record<string, unknown>, OP_SCHEMA.play.fields, r)
        // "…on top of this card with its skills negated for the game" (BT31-088/089, BT10-073): where it lands and what it arrives with.
        + (op.onto ? ` on top of ${describeRef(op.onto)}` : "")
        + (op.negated ? ` with its skills negated${op.negated === "game" ? " for the game" : " for the turn"}` : "");
      // "…with a marker on it" (13-2-3, #980): what the card arrives with.
      const on = op.markers === undefined ? "" : ` with ${describeAmount(op.markers)} marker${op.markers === 1 ? "" : "s"} on it`;
      return played + on;
    },
    doc: '"onto" plays it on top of another card ([Union-Absorb], 22-13-6-3); "negated" is "played with its skills negated" (9-1-5). "using: Evolve/EX-Evolve/Xeno-Evolve" marks evolution (22-5-2-3): requires the chosen eligible base, sends it to Warp for Xeno, and announces evolved-into only on successful play. "using: Over Realm" is that keyword\'s own play and marks its arrival (22-15). "using: Union-Fusion/Union-Potara/Union-Absorb" (#929) marks a [Union] play: its card, host and materials are bound at the declaration, a card that fails to enter play goes to the Drop (22-13), and a second [Counter: Play] window follows the arrival; "alsoUnder" puts [Union-Potara]\'s second material under the card as part of the play.',
  },
  switchMode: {
    fields: [
      TARGET,
      { name: "mode", type: MODE, required: true },
      {
        name: "by",
        type: { enum: KEYWORD_NAMES },
        offCard:
          "the keyword whose skill does the switching — [Alliance]'s rest-as-cost (22-32-3) is the moment \"switched to Rest Mode by an [Alliance] skill\" and not \"…by one of your skills\" (1-10); left out, the switch is the skill's own",
      },
    ],
    sentence: "switch {target} to {mode} mode{by? by a [{by}] skill}",
  },
  skip: {
    fields: [
      { name: "what", type: { enum: SKIP_WHATS }, required: true },
      { name: "side", type: "side", default: "you" },
      { name: "when", type: { enum: ["this", "next"] }, default: "next" },
    ],
    sentence: (raw) => {
      const op = raw as OpOf<"skip">;
      const whose = op.side === "opponent" ? "your opponent" : op.side === "both" ? "each player" : "you";
      const verb = op.side === "you" || op.side == null ? "skip" : "skips";
      const their = op.side === "you" || op.side == null ? "your" : "their";
      if (op.what === "turn") return `${whose} ${verb} ${their} next turn`;
      if (op.what === "span") return `${whose} ${verb} every phase until the Charge Phase of ${their} next turn, then start ${their} Main Phase`;
      const which = op.when === "this" ? "this turn's" : "the next";
      const what = op.what === "offense" || op.what === "defense" ? `${op.what === "offense" ? "Offense" : "Defense"} Step` : `${{ charge: "Charge", main: "Main", end: "End" }[op.what]} Phase`;
      return `${whose} ${verb} ${which} ${what}`;
    },
    doc: 'the phase or step is not performed (20-13): no [Auto] answers to its start or end, no action can be declared in it, and no checkpoint happens inside it. "when":"this" is the occurrence in the turn the skill resolved on, "next" the first one in a later turn. Effects that were to end in it end as it is skipped (20-13-5). "what":"turn" refuses the player\'s whole next turn, checked once at that turn\'s own start rather than at any one phase (BT31-097). "what":"span" reaches further: the rest of the turn this resolves in, the opponent\'s whole next turn, and this player\'s own next Charge Phase, landing at that Main Phase (BT21-104) — three ordinary entries under one name rather than a mechanism of its own.',
  },
  control: {
    fields: [TARGET, { name: "to", type: "side", default: "you" }, { name: "until", type: "duration" }],
    sentence: (raw, r) => {
      const op = raw as OpOf<"control">;
      return `${op.to === "opponent" ? "your opponent gains" : "gain"} control of ${describeRef(op.target)}${forThe(op.until, r)}`;
    },
    doc: 'the card moves to that player\'s Battle Area and they become its master (20-9-1); it keeps its mode, its markers and the effects on it (20-9-2). Leave "until" out for control that does not end \u2014 with it, the card goes back when the duration does. A Leader or a Unison Card can\'t change hands, and a KO still sends the card to its **owner\'s** Drop Area (5-12-1)',
  },
  modifyAttr: {
    fields: MODIFY_ATTR_FIELDS,
    // Three sentences: the two numbers and the four lists are different
    // sentences in English ("+5000 power for the turn" against "also
    // counts as ≪Saiyan≫"), and the six card attributes plus the two
    // widened subjects (spec §2.5-1/§2.5-3, #275) read as the spelling
    // `modifyAttrAs` says they stand for — the same precedent `negate`'s
    // sentence set. They are all the same mechanism, which is the point of
    // the row, but a reading that said "power: +≪Saiyan≫" or "mode: active"
    // would be worse than no row at all.
    sentence: (raw, r) => {
      const op = raw as OpOf<"modifyAttr">;
      if (op.attr === "power" || op.attr === "comboPower")
        return renderTemplate(`{target} {amount:${op.attr === "power" ? "power" : "combo power"}}{until}`, raw as unknown as Record<string, unknown>, MODIFY_ATTR_FIELDS, r);
      if (op.attr === "colors" || op.attr === "characters" || op.attr === "traits" || op.attr === "alsoNames") {
        const words = (op.values ?? []).join(", ");
        const said = op.attr === "traits" ? `\u226a${words}\u226b` : op.attr === "characters" ? `<${words}>` : op.attr === "alsoNames" ? `the card named ${words}` : words;
        return `${describeRef(op.target ?? { sel: { special: "self" } })} also counts as ${said}${forThe(op.until, r)}`;
      }
      return describeScript([modifyAttrAs(raw as Op)], r);
    },
    doc: 'the primitive under "power", "comboPower", "gains" and — since spec §2.5-1/§2.5-3 (#275) — "switchMode", "addMarker", "removeMarker", "grant", "hidden", "faceUp", "flip", "energyMarker" and "redirectAttack": one attribute of one subject, "amount" for a delta, "values" for the lists a card also counts as, and "mode"/"sign"/"keyword"/"flag" for the shapes those two have no room for. Those nine short spellings are still what the compiler writes and what a stored rule holds — prefer them; this row is what they mean',
  },
  power: {
    fields: [TARGET, { name: "amount", type: "amount", required: true }, UNTIL],
    sentence: "{target} {amount:power}{until}",
    doc: 'an amount may also be {"count":SELECTOR,"times":5000} (so much for each card; add "per":2 for "for every 2 cards", rounded down), {"sumPower":{"var":"rested"}} (the total power of named cards) or {"sumOf":SELECTOR,"attr":"comboPower"} (any measure of them, added up)',
  },
  comboPower: { fields: [TARGET, { name: "amount", type: "amount", required: true }, UNTIL], sentence: "{target} {amount:combo power}{until}" },
  grant: { fields: [TARGET, { name: "keyword", type: "keyword", required: true }, UNTIL], sentence: "{target} gains [{keyword}]{until}" },
  copySkills: {
    fields: COPY_SKILLS_FIELDS,
    sentence: (raw, r) => {
      const op = raw as OpOf<"copySkills">;
      const kind = op.only === "keyword" ? "keyword skills" : "skills";
      // #1166: this card's own line in quotation marks, granted.
      if (op.quoted) return renderTemplate(`{target} gains this card's quoted skill (line ${Math.floor((op.skill ?? 0) / 10) + 1}){until}`, raw as unknown as Record<string, unknown>, COPY_SKILLS_FIELDS, r);
      const template =
        op.which === "all"
          ? `{target} gains all of the ${kind} of {from}{until}`
          : op.skill != null
            ? "{target} gains skill {skill} of {from}{until}"
            : `choose 1 of the ${kind} of {from}, and {target} gains that skill{until}`;
      return renderTemplate(template, raw as unknown as Record<string, unknown>, COPY_SKILLS_FIELDS, r);
    },
    doc: '20-18: one card takes on another\'s printed skills. "which":"all" copies every one of them, "skill" copies one by its index on the source, and neither lets the master pick one as the skill resolves — which is what "choose up to 1 keyword skill … and this card gains that skill" says. "only":"keyword" narrows the pick and the copy to keyword skills. "quoted":true (#1166) is a quoted grant: "from" is this card and "skill" the index of its own line printed in quotation marks after "…gains the following skill", whose record is the program granted; only that line is copied, and "this card\'s skill" in it names the granting card. The printed face is snapshotted when the effect is made (9-9), so the copy outlives the source leaving play',
  },
  negate: {
    fields: NEGATE_FIELDS,
    // The sentence is the spelling's own, so the workbench reads a lowered
    // program in the same words as the record it came from.
    sentence: (raw, r) => describeScript([negateAs(raw as OpOf<"negate">)], r),
    doc: 'the primitive under "negateSkills", "negateSkillsOfKind", "negateKeyword" and "negateOwnSkill" (docs/arena-ruleset-spec.md §2.2): a rule stops applying (9-1-5). "what" says which — "skills" is every skill of the target, "kind" one printed kind of them (say which in "kind"), "keyword" one named keyword in every area (say which in "keyword"), "own" the skill resolving now. "until" left out is for the game. "keyword" with "chosen" and no "keyword" lets the master pick one of the keyword skills the target has in force as the step resolves ("negateChosenKeyword"). Those five spellings are still what the compiler writes and what a stored rule holds — prefer them; this row is what they mean',
  },
  negateSkills: { fields: [TARGET, UNTIL], sentence: "negate the skills of {target}{until}" },
  negateChosenKeyword: {
    fields: [TARGET, UNTIL],
    sentence: "choose up to 1 keyword skill of {target} and negate it{until}",
    doc: '"choose up to 1 keyword skill on your opponent\'s Battle Cards and negate that skill for the turn" (9-1-5): the master picks one keyword skill among those the target cards have in force as the step resolves, and only that one is negated, on that card, for the duration. A card with no keyword skills is not asked about',
  },
  negateSkillsOfKind: {
    fields: [TARGET, { name: "kind", type: { enum: SKILL_KIND_PREFIXES }, required: true }, UNTIL],
    sentence: "negate the [{kind:auto=Auto|activate=Activate|counter=Counter|permanent=Permanent}] skills of {target}{until}",
    doc: '"negate that card\'s [Auto] skill for the turn" — one kind, not the whole card (9-1-5)',
  },
  hidden: { fields: [TARGET, { name: "hidden", type: "boolean", required: true }, { name: "sameHiding", type: "boolean" }], sentence: "switch {target} to {hidden:Hidden|Revealed} Mode{sameHiding? (only a card still in the Hidden Mode this skill switched it to)}", doc: "Hidden Mode / Revealed Mode (23-5). `sameHiding` (BT28-121, official Q&A): reveal only a card still in the Hidden Mode this skill switched it to — not one revealed by another skill and hidden again since" },
  redirectAttack: { fields: [TARGET], sentence: "switch the target of the attack to {target}", doc: '"switch the target of the attack to it" (22-4-2)' },
  swapBattle: {
    fields: [TARGET],
    sentence: "switch your card that's in a battle with {target}",
    doc: '"switch your card that\'s in a battle with this card / the chosen card" (8-1-7-2): the target, your own card in your Battle Area or Leader Area, becomes the attack card or the guard card in place of yours, and the battle goes on with it. Its "when this card attacks / is attacked" are not made pending',
  },
  placeOnTop: {
    fields: [TARGET],
    sentence: "place {target} on top of this card, from under it",
    doc: '"place a Z-Extra from under this card on top of this card" (23-2, 21-5-2): the target, a card in this card\'s pile, becomes the top card where this card stands and this card goes directly under it, the rest of the pile following in its order. Placed, not played (5-5). The new top card takes over this card\'s position, the continuous effects on its power and its seat in a battle; this card\'s other effects end. Never in a Leader Area',
  },
  comboFrom: { fields: [TARGET, { name: "negated", type: "boolean" }], sentence: "use {target} in a combo{negated? with its skills negated}", doc: '"use it in a combo from your Drop (with its skills negated)" (5-7)' },
  flip: { fields: [TARGET], sentence: "flip {target} over", doc: 'a Leader awakens ("flip this card over", 22-2-4)' },
  faceUp: { fields: [TARGET, { name: "faceUp", type: "boolean", default: true }], sentence: "turn {target} face {faceUp:up|down}", doc: "turn a card in a life area face up (3-9-2-1); false turns it back down" },
  addMarker: { fields: [TARGET, n()], sentence: "add {n} marker" },
  removeMarker: { fields: [TARGET, n()], sentence: "remove {n} marker" },
  token: {
    fields: [
      { name: "name", type: "string", required: true },
      { name: "power", type: "number", required: true },
      { name: "comboCost", type: "number", required: true, nullable: true },
      { name: "comboPower", type: "number", required: true, nullable: true },
      { name: "colors", type: { list: { enum: COLORS } }, required: true },
      n(),
      SIDE,
      { name: "as", type: "string" },
    ],
    sentence: "play {n} {name} ({power} power)",
    doc: 'a token (19): {"op":"token","name":"Saibaman Token","power":10000,"comboCost":0,"comboPower":5000,"colors":[],"n":2}; "as" names the tokens this play made (exactly them, empty when none), for a later "and they gain [Blocker]"',
  },
  costModifier: {
    fields: COST_MODIFIER_FIELDS,
    // The sentence is the spelling's own, so the workbench reads a lowered
    // program in the same words as the record it came from — the same choice
    // `negate`'s row makes.
    sentence: (raw, r) => describeScript([costModifierAs(raw as OpOf<"costModifier">)], r),
    doc: 'the primitive under "costReduction" and "altCost" (docs/arena-ruleset-spec.md §2.5-4): a price is not a number. "pay" present is the whole price replaced — "none"/"life"/"program"/"energy", with "alt" the program for "program" and "orbs" the reduced price for "energy" (altCost\'s own shape); "pay" absent is the number changed by "amount"/"what"/"colors"/"skillKind" (costReduction\'s). Those two spellings are still what the compiler writes and what a stored rule holds — prefer them; this row is what they mean',
  },
  costReduction: {
    fields: COST_REDUCTION_FIELDS,
    // "Specified" is not "costs N less" — that would say the total moved,
    // which is exactly what the owner's ruling on BT19-039 (9 Sep 2026) says
    // it does not — so it gets its own sentence rather than sharing the
    // generic template's `{amount:less|more}`, which knows only a flat
    // number and would print a true-looking but wrong reading.
    sentence: (raw, r) => {
      const op = raw as OpOf<"costReduction">;
      if (op.what !== "specified") {
        if ((op.what === undefined || op.what === "energy" || op.what === "combo" || op.what === "zEnergy") && !op.skillKind) {
          const once = op.uses == null ? "" : op.uses === 1 ? " the next time it is paid" : ` the next ${op.uses} times it is paid`;
          // "…by {b}{w}" (BT29-140) takes those colours' orbs off, which "costs
          // 2 less" alone would not say.
          const orbs = op.colors?.length ? ` (${op.colors.map((c) => `{${c}}`).join("")})` : "";
          // The combo cost and the Z-Energy cost are other prices than the energy cost (20-21): the reading said
          // "costs 1 less" for "-1 combo cost" (BT22-055b), the same words as an energy reduction (#907 round 6).
          const price = op.what === "combo" ? " (combo cost)" : op.what === "zEnergy" ? " (Z-Energy cost)" : "";
          return renderTemplate("{target} costs {amount:less|more}", raw as unknown as Record<string, unknown>, COST_REDUCTION_FIELDS, r) + price + orbs + once;
        }
        const noun = op.what === "combo" ? "combo cost" : op.what === "zEnergy" ? "Z-Energy cost" : op.what === "skill" ? "skill cost" : op.what === "evolve" ? "[Evolve] cost" : "cost";
        const scoped = op.tag ? ` for [${op.tag}] skills` : op.skillKind ? ` for [${op.skillKind === "activate" ? "Activate" : op.skillKind === "counter" ? "Counter" : op.skillKind === "auto" ? "Auto" : "Permanent"}] skills` : "";
        // EX03-16: a change scoped to the card the [Evolve] lands on.
        // "The next time you activate …" (BT31-096): spent by the activations it reaches.
        const budget = op.uses == null ? "" : op.uses === 1 ? " the next time it is paid" : ` the next ${op.uses} times it is paid`;
        if (op.onto) return `the ${noun}${scoped} of ${describeRef(op.target)} is ${describeCostChange(op.amount)} when evolving onto ${describeRef(op.onto)}${budget}`;
        return `${describeRef(op.target)}'s ${noun}${scoped} is ${describeCostChange(op.amount)}${budget}`;
      }
      if (op.all) return `${describeRef(op.target)} has no specified cost`;
      const once = op.uses == null ? "" : op.uses === 1 ? " the next time it is paid" : ` the next ${op.uses} times it is paid`;
      const counts = new Map<string, number>();
      for (const c of op.colors ?? []) counts.set(c, (counts.get(c) ?? 0) + 1);
      const orbs = [...counts.entries()].map(([c, n]) => `${n} ${c === "any" ? "energy" : c.toLowerCase()}`).join(", ");
      const amt = typeof op.amount === "number" ? op.amount : 0;
      return `${describeRef(op.target)}'s specified cost is ${amt < 0 ? `${-amt} more` : `${amt} less`}${orbs ? ` (${orbs})` : ""}${once}`;
    },
    doc: '[Permanent] only unless a duration is given (20-21): "reduce the energy cost of your <Son Goku> cards in your hand by 1" — the selector names the area the text names, usually the hand; "skill"/"evolve" are orb costs read by `orbTotals` for one skill on one card, and "onto" scopes an "evolve" change to an [Evolve] played onto those cards (EX03-16: onto: [self]); "zEnergy" is the Z-Energy cost a Z-Card pays from the Z-Energy Area (5-4), read by `zEnergyCostOf`, never `d.zEnergyCost` raw. "specified" is the coloured part of an X-cost card\'s price (owner\'s ruling on BT19-039, 9 Sep 2026): it never touches the total, only which colours `playCost` demands, and `colors` carries the orbs it relaxes — always printed as `{u}`/`{y}{y}`/…, never a bare count. "uses" (with "skill"/"evolve" and a duration) is how many activations the change reaches before it ends — "the next time you activate an [Activate] skill of your Leader during this turn, reduce its skill cost by {b}" (BT31-096) is uses 1, until "turn"; the activation that pays a line it reaches spends one, and "until" still ends it unused. "tag" (with "skill"/"evolve") narrows the change to one keyword\'s line, lower-case — "z-awaken", "arrival", "swap", "union", "successor", "ex-evolve", "xeno-evolve" (a bare [Evolve] is all three variants, 22-5-2-2, and needs none); "skillKind" does the same for [Activate]/[Auto]/[Counter]. A skill-cost change said in a colour does nothing to a {1} orb and one said as {1} does nothing to a coloured orb (5-8-2-4). "uses" is also read on an energy cost ("what" absent) and on "specified": "the next time you play X, reduce its energy cost by {r}" is spent by the play or Extra activation that pays the card\'s price. The effects one op puts in force share its uses (a "group"): paying any one ends them all. An energy cost reduced by a plain number comes off the total alone, floored at the specified orbs that remain (FAQ Skills Q24, 1-2-2-1); one reduced "by {r}" takes that colour off the specified cost as well, as many as the card demands (20-21-2, 20-21-2-1).',
  },
  negateKeyword: { fields: [{ name: "keyword", type: { enum: KEYWORD_NAMES }, required: true }, SELF], sentence: "negate the [{keyword}] skill of {target}", doc: 'take one named keyword away ("negate this card\'s [Energy-Exhaust] skill in all areas", 9-1-5); the keyword is its printed name, e.g. "Blocker"' },
  gains: {
    fields: [
      { name: "traits", type: { list: "string" } },
      { name: "characters", type: { list: "string" } },
      { name: "colors", type: { list: { enum: COLORS } } },
      { name: "names", type: { list: "string" } },
      SELF,
      { name: "allAreas", type: "boolean" },
    ],
    // A literal brace cannot appear in a template — `renderTemplate` reads it
    // as a field — so a gained card name is written out in words instead.
    sentence: "{target} also counts as{traits? ≪{traits}≫}{characters? <{characters}>}{colors? {colors}}{names? the card named {names}}",
    doc: 'the card counts as having these too, wherever it is ("gains ≪Saiyan≫ in all areas", "is also treated as red", 20-1); "names" is a whole card name it is also treated as ("also treated as {Planet M-2}"), never a replacement for its own',
  },
  replaceLeave: {
    fields: [{ name: "from", type: { list: { enum: ["battle", "combo"] } } }, { name: "to", type: "area", required: true }, { name: "by", type: { enum: ["skill", "ko", "skillOrKo", "skillOrKoBySkill"] } }, { name: "bySide", type: { enum: ["opponent", "you"] } }, { name: "mode", type: MODE }, { name: "position", type: { enum: ["top", "bottom"] } }, { name: "requestedTo", type: { enum: ["hand"] } }, { name: "until", type: "duration" }, { name: "optional", type: "boolean" }, SELF],
    sentence: (raw) => {
      const op = raw as OpOf<"replaceLeave">;
      // `bySide: "opponent"` is the opponent of the card's OWNER: aimed at their cards (BT29-040: "returned to its owner's hand by a skill on
      // your card") it is a skill of yours, not "an opponent's".
      const aimedAtTheirs = op.target && "sel" in op.target && op.target.sel.side === "opponent";
      const whose = op.bySide === "opponent" ? (aimedAtTheirs ? "one of your skills" : "an opponent's skill") : op.bySide === "you" ? (aimedAtTheirs ? "an opponent's skill" : "one of your skills") : "a skill";
      const cause = op.from ? `leave the ${op.from.join(" or ")} area` : op.by === "ko" ? "be KO'd" : op.by === "skill" ? `be removed from the Battle Area by ${whose}` : op.by === "skillOrKoBySkill" ? `be removed from the Battle Area or KO'd by ${whose}` : op.by === "skillOrKo" ? `be removed from the Battle Area by ${whose} or KO'd` : "leave the Battle Area";
      const request = op.requestedTo ? ` to the ${op.requestedTo}` : "";
      const duration = op.until ? DURATION_IN_WORDS[op.until] : "";
      const position = op.position === "bottom" ? " to the bottom of" : op.position === "top" ? " to the top of" : " to the";
      return `if ${describeRef(op.target ?? { sel: { special: "self" } })} would ${cause}${request}, it ${op.optional ? "may go" : "goes"}${position} ${op.to}${op.mode === "rest" ? " in Rest Mode" : ""}${duration} instead`;
    },
    doc: '9-10: "to" is the replacement destination; "from" explicitly names valid departure areas (including Combo), otherwise ordinary in-play departure scope applies; "by" narrows the cause ("skillOrKoBySkill": a skill\'s move or a skill\'s KO, never the battle\'s — owner ruling 26 Oct 2026, "if this card would be removed from the Battle Area by your opponent\'s skill, … instead"), "bySide" narrows whose skill, and "requestedTo" narrows the original requested destination. "position" specifies top or bottom of a pile. Omit "until" for a [Permanent] (9-5-1); a timed effect records this redirect for the stated duration. Omit "target" for this card',
  },
  replace: {
    fields: [
      { name: "from", type: { list: { enum: ["battle", "combo"] } } },
      { name: "event", type: { enum: REPLACE_EVENTS }, required: true },
      { name: "with", type: "ops", required: true },
      { name: "by", type: { enum: ["skill", "ko", "skillOrKo", "skillOrKoBySkill", "attack"] } },
      { name: "bySide", type: { enum: ["opponent", "you"] } },
      { name: "to", type: { enum: ["hand", "drop"] } },
      { name: "optional", type: "boolean" },
      SELF,
    ],
    sentence: (raw, r) => {
      // An attack or a counter replaced by nothing reads as the spelling it
      // stands for (#137), the precedent `negate`'s own sentence set.
      const as = replaceAs(raw as Op);
      if (as.op !== "replace") return describeScript([as], r);
      const op = raw as OpOf<"replace">;
      const who = describeRef(op.target ?? { sel: { special: "self" } });
      const whose = op.bySide === "opponent" ? "an opponent's skill" : op.bySide === "you" ? "one of your skills" : "a skill";
      const instead = `${op.optional ? "you may have this happen" : "this happens"} instead: ${describeScript(op.with, r)}`;
      // 13-5-2: the one marker loss a replacement is read at (`by` is always "attack").
      if (op.event === "marker") return `if ${who} would lose a marker from an opponent's attack, ${instead}`;
      const moment =
        op.event === "play"
          ? "the card being played would be played"
          : op.event === "life"
            ? `${who} would move from your life to your ${op.to === "drop" ? "Drop Area" : op.to === "hand" ? "hand" : "hand or your Drop Area"}`
            : op.event === "ko" || op.by === "ko"
              ? `${who} would be KO'd${op.bySide === "opponent" ? " by an opponent's skill" : ""}`
              : op.by === "skill"
                ? `${who} would be removed from the Battle Area by ${whose}`
                : op.by === "skillOrKo"
                  ? `${who} would be removed from the Battle Area by ${whose} or KO'd`
                  : op.by === "skillOrKoBySkill"
                    ? `${who} would be removed from the Battle Area or KO'd by ${whose}`
                  : `${who} would leave ${op.from ? `the ${op.from.join(" or ")} area` : "the Battle Area"}`;
      return `if ${moment}, ${instead}`;
    },
    doc: 'an event happens differently, or not at all (9-10) — the primitive "replaceLeave" and the "instead" half of "resolvingPlay" are macros over. "from" optionally names the Battle/Combo departure areas for a leave redirect; "event" is the moment: "leave" (the card would leave the Battle Area, narrowed by "by", and by "bySide" to the opponent\'s skill), "ko" (it would be KO\'d), "play" (the play being resolved, 9-6, [Counter: Play] only), "life" (a life card\'s own move to the hand or the Drop Area, 8-4-6-1\'s damage — narrowed by "to", absent for either destination; "by"/"bySide" mean nothing here, since nobody\'s skill puts a card out of the life area; with a "target" it is the rule of the life card that prints it — "if you would reveal this card from your life to add it to your hand" (BT10-036, 9-1-3-3) — read while that card lies in the Life Area and answering only when it is the card taken), "marker" (this Unison would lose a marker, only with "by":"attack" — 13-5-2\'s removal by an opponent\'s attack, asked once per marker on the Damage Step (5-13-4-2); always a substitute, so the marker stays and "with" runs), "attack" (the attack in progress, 8-1-6-1) and "counter" (the [Counter] this one answers, 9-7) — those two only with an empty "with", read back as "negateAttack"/"negateCounter" (#137). "by":"ko" on a "leave" is the same moment as "ko", the spelling "replaceLeave" lowers to; "by":"skillOrKoBySkill" is a departure a skill causes or a skill\'s KO, never the battle\'s ("once per turn, this card can\'t be removed from a Battle Area by skills", BT22-117, P-638). "with" is what happens in its place: one move of the card itself is a redirect, anything else is a substitute — the departure does not happen at all, the card stays, and the program runs with it bound as "subject". It may ask a question, and then it only applies where somebody can hear it (#107, #272); "optional" is 9-10-3\'s "you may". A "leave"/"ko"/"life"/"marker" replacement is [Permanent] only — or, for "leave", the leaf of a keyword\'s wouldLeave hook: [Ultimate]\'s "removed from the game instead" (22-14-3), read as a redirect after any [Permanent]\'s',
  },
  altCost: {
    fields: [
      { name: "pay", type: { enum: ["none", "life", "program", "energy"] }, required: true },
      { name: "n", type: "number" },
      { name: "for", type: { enum: ["counter", "play", "activate:battle"] }, default: "counter" },
      { name: "ops", type: "ops" },
      { name: "orbs", type: { list: { enum: ["any", ...COLORS] } } },
      {
        name: "rest",
        type: "selector",
        offCard:
          'with pay: "energy", the only cards that may pay that price, one per orb, rested where they stand — [Invoker]\'s active Red/Blue multicolour energy in place of an Extra\'s energy cost (22-37), the leaf of its altPayment hook',
      },
      SELF,
      { name: "until", type: "duration" },
    ],
    sentence: (raw, r) => {
      const op = raw as OpOf<"altCost">;
      const price =
        op.pay === "none"
          ? "for no energy"
          : op.pay === "program"
            ? `by: ${describeScript(op.ops ?? [], r)}`
            : op.pay === "energy" && op.rest
              ? `by switching ${describeSelector({ ...op.rest, count: (op.orbs ?? []).length || 1 })} to Rest Mode`
              : op.pay === "energy"
                ? `for ${(op.orbs ?? []).map((o) => (o === "any" ? "{any}" : `{${o}}`)).join("")}`
                : `by adding ${op.n ?? 1} from your life to your hand`;
      const who = op.target ? describeRef(op.target) : "this card";
      const until = op.until ? ` until ${op.until === "game" ? "the game ends" : op.until}` : "";
      const move = op.for === "play" ? `${who} may be played` : op.for === "activate:battle" ? `${who}'s [Activate: Battle] may be activated from your hand` : `${who}'s [Counter] may be activated`;
      return `${move} ${price}${until}`;
    },
    doc: 'another way to pay for a [Counter] (or a play, "for":"play"; or an Extra\'s [Activate: Battle] line used from the hand, "for":"activate:battle" — the energy cost of 12-2-2-2 only, the line\'s own price still paid, #742) (5-3) — "none", "life" (n cards), a reduced "energy" price ("orbs"), or a "program" the card asks for instead. Printed on the card itself this is [Permanent]-only and omits "target"/"until"; a card that grants it to *other* cards for a span carries both — "Until the start of your next turn, you can activate mono-blue cards with [Counter] skills from your hand by …" (BT11-033)',
  },
  payWith: {
    fields: [
      { name: "as", type: { enum: ["energy", ...COLORS] }, default: "energy" },
      SELF,
      { name: "until", type: "duration" },
      { name: "forSkillsOf", type: "filter" },
      { name: "max", type: "number" },
      { name: "oncePerTurn", type: "boolean" },
    ],
    sentence: (raw) => {
      const op = raw as OpOf<"payWith">;
      const who = op.target ? describeRef(op.target) : "this card";
      const as = !op.as || op.as === "energy" ? "energy" : `{${op.as}}`;
      const until = op.until ? ` until ${op.until === "game" ? "the game ends" : op.until}` : "";
      if (op.forSkillsOf) {
        const payers = op.target && "sel" in op.target ? describeSelector({ ...op.target.sel, count: op.max ?? 99, upTo: !!op.max }) : who;
        return `${once(op)}${payers} may be rested as ${as} to pay the skill cost of a skill on ${describeFilter(op.forSkillsOf, { plural: false })}${until}`;
      }
      return `${who} may be rested to pay an energy cost as ${as}, wherever it is${until}`;
    },
    doc: 'a card that may be rested to pay an energy cost although it is not in the Energy Area (20-19) — "[Permanent] You can use this card to pay energy costs even when it\'s in your Battle Area" (BT3-039). The card does not move; it is rested exactly as an energy card is and stands in for one energy, of its own colours ("as":"energy") or of the colour named. Printed on the card itself this is [Permanent]-only and omits "target"/"until", the way "altCost" does; both are for a card granting the permission to others for a span. With "forSkillsOf" it is scoped (BT28-106): only the **skill costs** of skills on cards that filter describes, wherever those cards are, at most "max" of the cards on one payment, and — with "oncePerTurn" — spent for the turn once it has paid. Any other scope (one play, the energy cost of cards in the hand) is left unread rather than offered wider than it prints',
  },
  resolvingPlay: {
    fields: [{ name: "instead", type: "area" }, { name: "position", type: POSITION }, { name: "mode", type: { enum: ["rest"] } }, { name: "negated", type: "boolean" }],
    sentence: (raw) => {
      const op = raw as OpOf<"resolvingPlay">;
      return op.instead
        ? `the card being played is not played and goes to the ${op.instead} instead`
        : op.mode === "rest"
          ? `the card being played is played in Rest Mode${op.negated ? " with its skills negated" : ""}`
          : "the card being played is played with its skills negated";
    },
    doc: '[Counter: Play] only (9-6). With "instead" the play is negated and the card goes there; without it the play happens and only the manner changes ("mode":"rest" or "negated":true)',
  },
  negateAttack: { fields: [], sentence: "negate the attack" },
  negateCounter: { fields: [], sentence: "negate the counter being answered", doc: "negate the [Counter] this one is answering (9-7)" },
  negateOwnSkill: { fields: [{ name: "until", type: { enum: ["turn", "battle"] } }], sentence: "this skill does not happen again{until? this {until}}", doc: '"negate this skill for the game / turn / battle" (9-1-5)' },
  forbid: {
    fields: [
      { name: "what", type: { enum: FORBIDDEN_ACTIONS }, required: true },
      UNTIL,
      { name: "target", type: "ref" },
      { name: "side", type: "side" },
      { name: "filter", type: "filter" },
      { name: "attackTarget", type: "filter" },
      { name: "attackOnly", type: "ref" },
      { name: "against", type: "ref" },
      { name: "fromArea", type: { enum: ["hand", "battle", "drop", "deck", "energy", "unison", "any"] } },
      { name: "fromOwnArea", type: "boolean" },
      { name: "sameNameAsSelf", type: "boolean" },
      { name: "bySkill", type: "boolean" },
      { name: "exceptEvolve", type: "boolean" },
      { name: "exceptUnion", type: { list: { enum: ["Fusion", "Potara", "Absorb"] } } },
      { name: "uses", type: "amount" },
      { name: "unless", type: "cond" },
      { name: "unlessPay", type: "ops" },
      { name: "byTypes", type: { list: { enum: ["LEADER", "BATTLE", "EXTRA", "UNISON"] } } },
      { name: "turnPlayer", type: "boolean" },
      { name: "counterKind", type: { enum: ["play", "attack", "battleCardAttack", "counter"] } },
      { name: "otherCards", type: "boolean" },
      { name: "extraCardActivation", type: "boolean" },
      { name: "skillKinds", type: { list: "string" } },
      { name: "exceptOwnSkills", type: "boolean" },
      { name: "exceptSourceName", type: "string" },
      { name: "toArea", type: { enum: ["hand", "deck", "drop", "warp", "energy", "life"] } },
      { name: "toBottom", type: "boolean" },
      { name: "byFilter", type: "filter" },
      { name: "cardsOf", type: "side" },
      { name: "exceptKeyword", type: "string" },
      { name: "costVsEnergy", type: { enum: ["above", "atLeast"] } },
      { name: "keywordSkill", type: "string" },
      { name: "exceptCards", type: "ref" },
    ],
    sentence: (raw, r) => {
      const op = raw as OpOf<"forbid">;
      // P-219, P-299: the attacker's energy cost against its controller's energy.
      const measure = op.costVsEnergy ? ` (only cards whose energy cost is ${op.costVsEnergy === "above" ? "greater than" : "at least"} the number of cards in their controller's Energy Area)` : "";
      // 20-14-1's price, said from the payer's side: the program's "you" is
      // whoever takes the action, not this card's controller.
      // An escape that is a condition turned round ("…when this card is in a
      // battle", BT14-097) is said the way the card says it.
      // A price's "other than this card" is the card the price is paid for
      // (the one being played, attacking or activated), never this one.
      // An attack's price runs with the attacker as "this card", so a power
      // change in it (BT13-030, 20-14-1's example) is given to the attacking card.
      const priceSaid = op.unlessPay?.length ? describeScript(op.unlessPay).replace(/ other than this card\b/g, op.what === "attack" ? " other than the attacking card" : op.what === "play" ? " other than the card being played" : " other than the card whose skill it is").replace(/(^|, )this card ([+-]\d+ power)/g, (_m, lead: string, power: string) => (op.what === "attack" ? `${lead}give the attacking card ${power}` : `${lead}this card ${power}`)) : "";
      const escape = op.unless ? (op.unless.kind === "not" ? ` only while ${describeCond(op.unless.cond)}` : ` unless ${describeCond(op.unless)}`) : priceSaid ? ` unless, each time, the player doing it first pays: ${priceSaid}` : "";
      // #716: "you can't activate the [Counter: Play] skills of other cards".
      if (op.what === "activateCounter" && (op.counterKind || op.otherCards || op.filter || op.unlessPay?.length)) {
        const who = op.target ? describeRef(op.target) : op.side === "opponent" ? "your opponent" : op.side === "both" ? "each player" : "you";
        const kind = op.counterKind ? `[Counter: ${op.counterKind === "battleCardAttack" ? "Battle Card Attack" : op.counterKind[0].toUpperCase() + op.counterKind.slice(1)}]` : "[Counter]";
        return `${who} can't activate ${kind} skills${op.filter ? ` of ${describeFilter(op.filter, { plural: true })}` : ""}${op.otherCards ? " of other cards" : ""}${escape}${forThe(op.until, r)}`;
      }
      // #677: 12-1-3's "activating an Extra Card" (BT10-097), and the skills
      // of particular cards (BT23-140's "the skills of Battle Cards").
      if (op.what === "activateSkill" && !op.target && (op.extraCardActivation || op.filter)) {
        const who = op.side === "opponent" ? "your opponent" : op.side === "both" ? "each player" : "you";
        const which = op.extraCardActivation ? "Extra Cards" : `the skills of ${describeFilter(op.filter!, { plural: true })}`;
        return `${who} can't activate ${which}${escape}${forThe(op.until, r)}`;
      }
      // Owner ruling 26 Oct 2026 (A2): the [Blocker] of the cards a "can't
      // activate skills" rule describes (BT18-019, BT14-097, P-093).
      if (op.what === "block" && !op.target && op.filter) {
        const who = op.side === "opponent" ? "your opponent" : op.side === "both" ? "each player" : "you";
        return `${who} can't activate [Blocker] on ${describeFilter(op.filter, { plural: true })}${escape}${forThe(op.until, r)}`;
      }
      // Prohibition batch 5's sentences, each said the way the card says it.
      {
        const who = op.turnPlayer ? "the turn player" : op.side === "opponent" ? "your opponent" : op.side === "both" ? "each player" : "you";
        // "You may not activate [EX-Evolve]" (BT4-003).
        if (op.what === "activateSkill" && op.keywordSkill && !op.target) return `${who} can't activate [${op.keywordSkill}]${escape}${forThe(op.until, r)}`;
        // BT30-146: the Charge Phase's switch of that player's cards in one area.
        if (op.what === "switchToActiveInCharge" && !op.target) {
          const cards = op.filter ? describeFilter(op.filter, { plural: true }) : "cards";
          const where = op.fromArea === "unison" ? " in their Unison Area" : op.fromArea === "battle" ? " in their Battle Area" : "";
          return `${who} can't switch ${cards}${where} to Active Mode in the Charge Phase${escape}${forThe(op.until, r)}`;
        }
        // BT4-104: a play by the skills of the cards `byFilter` describes.
        if (op.what === "play" && op.byFilter && op.bySkill === true && !op.target) {
          const cards = op.filter ? describeFilter(op.filter, { plural: true }) : "cards";
          const from = op.fromArea === "hand" ? " from their hand" : "";
          return `${who} can't play ${cards}${from} with the skills of ${describeFilter(op.byFilter, { plural: true })}${escape}${forThe(op.until, r)}`;
        }
        // P-676: a skill taking markers off cards in a player's areas.
        if (op.what === "removeMarkers") {
          const cards = op.target ? describeRef(op.target) : `${op.cardsOf === "opponent" ? "your opponent's" : op.cardsOf === "you" ? "your" : "the"} ${op.filter ? describeFilter(op.filter, { plural: true }) : "cards"}`;
          const whose = op.side === "opponent" ? "your opponent's skills" : op.side === "you" ? "your skills" : "skills";
          return `markers on ${cards} can't be removed by ${whose}${escape}${forThe(op.until, r)}`;
        }
        // BT8-089: the attackers, with the cards the rule lets through.
        if (op.what === "attack" && op.exceptCards && op.filter && !op.target) return `${who} can't attack with ${describeFilter(op.filter, { plural: true })} other than ${describeRef(op.exceptCards)}${escape}${forThe(op.until, r)}`;
      }
      // A move, KO, switch or choice a skill makes (`beMovedBySkill`,
      // `beKOdBySkill`, `beRestedBySkill`, `beChosen`): `side` is whose skills
      // (the acting player), never the subject — "your opponent can't be
      // removed from a Battle Area …" said the opposite of the rule. The
      // subject is the card(s), or the area `cardsOf`/`fromArea` names.
      const passive = passiveSentence(op, escape, r);
      if (passive) return passive;
      // A rule aimed at a card reads the other way round: the card is what is
      // played, not what plays. "You can't play …" is the player's version.
      const who = op.target ? describeRef(op.target) : op.turnPlayer ? "the turn player" : op.side === "opponent" ? "your opponent" : op.side === "both" ? "each player" : "you";
      // #1005: the attackers (`filter`) and the defender (`attackTarget`) are two
      // different sets of cards, and the sentence has to keep them apart.
      if (op.what === "attack" && op.attackOnly) return `${who} can only attack ${describeRef(op.attackOnly)}${op.filter ? ` with ${describeFilter(op.filter)}` : ""}${escape}${forThe(op.until, r)}`;
      // BT15-122: "your opponent's skill-less cards can't attack this card".
      if (op.what === "attack" && op.against) return `${who} can't attack ${describeRef(op.against)}${op.filter ? ` with ${describeFilter(op.filter)}` : ""}${escape}${forThe(op.until, r)}`;
      if (op.what === "attack" && op.attackTarget) return `${who} can't attack ${describeFilter(op.attackTarget)}${op.filter ? ` with ${describeFilter(op.filter)}` : ""}${measure}${escape}${forThe(op.until, r)}`;
      // `uses` is how many attacks are still allowed before the ban bites (BT3-104: "can only attack one more time"): said as the allowance, not as a ban.
      if (op.what === "attack" && op.filter && !op.target && op.uses != null) return `${who} can attack with ${describeFilter(op.filter)} only ${op.uses === 1 ? "one more time" : `${describeAmount(op.uses)} more times`}${escape}${forThe(op.until, r)}`;
      if (op.what === "attack" && op.filter && !op.target) return `${who} can't attack with ${describeFilter(op.filter)}${measure}${op.uses != null ? (op.uses === 1 ? " once more" : ` ${describeAmount(op.uses)} more times`) : ""}${escape}${forThe(op.until, r)}`;
      // #930: "you can only play Battle Cards by using [Union-Fusion]" (P-069, P-226).
      if (op.what === "play" && op.exceptUnion?.length) return `${who} can only ${op.target ? "be played" : `play ${op.filter ? describeFilter(op.filter, { plural: true }) : "cards"}`} by using ${op.exceptUnion.map((v) => `[Union-${v}]`).join(" or ")}${escape}${forThe(op.until, r)}`;
      const what = op.target && op.what === "play" ? `be played${op.bySkill === true ? (op.exceptEvolve ? " by a skill other than an [Evolve]" : " by a skill") : op.bySkill === false ? " except by a skill" : ""}` : FORBIDDEN_IN_WORDS[op.what];
      // Which cards the ban is about, when it is about cards rather than the
      // player: "you can't play cards" said nothing about *which*.
      const which = op.sameNameAsSelf ? "another copy of this card" : op.filter ? describeFilter(op.filter) : "";
      // "…can't play **cards**" already names the object, so a description
      // of *which* cards replaces that word rather than following it.
      const verb = which ? what.replace(/\s+cards?$/, "") : what;
      const budget = op.uses != null ? ` ${op.uses === 1 ? "once more" : `${describeAmount(op.uses)} more times`}` : "";
      // BT8-051: whose skill it has to be.
      const by = op.byTypes?.length ? ` with the skill of ${op.byTypes.map((t) => (t === "LEADER" ? "a Leader Card" : t === "BATTLE" ? "a Battle Card" : t === "EXTRA" ? "an Extra Card" : "a Unison Card")).join(" or ")}` : "";
      // "…from the Battle Area", "…from your hand", "…from your Drop Area".
      // BT18-052: "this card **in your Energy Area**" — where the card is, not where it comes from.
      const from = op.fromArea === "energy" ? " while in the Energy Area" : op.fromArea === "any" ? "" : op.fromArea ? ` from ${op.fromOwnArea ? "their own" : "the"} ${op.fromArea === "hand" ? "hand" : op.fromArea === "battle" ? "Battle Area" : op.fromArea === "deck" ? "deck" : "Drop Area"}` : "";
      // "…the [Activate: Main] skill on copies of this card" (BT12-031).
      const KIND_WORDS: Record<string, string> = { "activate:main": "[Activate: Main]", "activate:battle": "[Activate: Battle]", "activate:main/battle": "[Activate: Main/Battle]", auto: "[Auto]", permanent: "[Permanent]" };
      if ((op.what === "activateSkill" || op.what === "activateCounter") && op.sameNameAsSelf && !op.target) {
        const kinds = op.what === "activateCounter" ? "[Counter] skills" : op.skillKinds?.length ? `the ${op.skillKinds.map((k) => KIND_WORDS[k] ?? k).join(" or ")} skills` : "skills";
        return `${who} can't activate ${kinds} on copies of this card${from}${escape}${forThe(op.until, r)}`;
      }
      // "…by skills other than its own" (EB1-27), "…other than {Jaguar's Island}'s skills" (BT22-072).
      const except = op.exceptOwnSkills ? " except by this card's own skills" : op.exceptSourceName ? ` except by the skills of {${op.exceptSourceName}}` : op.exceptKeyword ? ` except by [${op.exceptKeyword}]` : "";
      // DB2-156: "cards in your hand", the hand as a zone.
      const whose = op.cardsOf ? ` (only cards in ${op.cardsOf === "opponent" ? "your opponent's" : "your"} areas)` : "";
      // "…can't be returned to your hand by your skills" (DB2-040), "…at the bottom of their owner's deck" (P-672).
      const AREA_WORDS: Record<string, string> = { hand: "a hand", deck: "a deck", drop: "a Drop Area", warp: "a Warp", energy: "an Energy Area", life: "a Life Area" };
      const to = op.toArea ? ` to ${op.toBottom ? `the bottom of ${AREA_WORDS[op.toArea]}` : AREA_WORDS[op.toArea]}` : "";
      // "…in battle against Battle Cards with energy costs of 3 or less" (P-481).
      const against = op.byFilter ? ` by ${describeFilter(op.byFilter, { plural: true })}` : "";
      const kinds = op.what === "activateSkill" && op.skillKinds?.length ? ` (${op.skillKinds.map((k) => KIND_WORDS[k] ?? k).join(" or ")} skills only)` : "";
      return `${who} can't ${verb}${which ? ` ${which}` : ""}${kinds}${from}${whose}${to}${by}${against}${measure}${except}${budget}${escape}${forThe(op.until, r)}`;
    },
    doc: `forbid an action (20-14): a "target" for a rule about particular cards, or a "side" for one about a player, narrowed by a "filter"; "attackTarget" narrows an attack prohibition to a prospective defender and is checked only when declaring an attack, never for Blocker redirection; "attackOnly" (a ref, \`what\`:"attack" only, never beside "attackTarget") is the opposite — the only cards an attack by the rule\'s attackers may be declared against ("can only attack this card", #1005), resolved when the rule is read; "against" (a ref, \`what\`:"attack" only) narrows the rule to attacks on those cards ("…can't attack this card", BT15-122), also resolved when the rule is read; "fromArea" ("hand" | "battle" | "drop" | "deck" | "energy" | "unison" | "any") narrows a rule to cards used or moved from that area — a combo "from the Battle Area" (EB1-21), a play "from their owner's hands" (EX23-05), a move out of a Drop (BT6-028), a search of a deck (DB3-092), a card's own rule while it is in the Energy Area (BT18-052), a move from any area at all (BT17-032) — and "fromOwnArea":true to the acting player's own such area ("from your Drop Area", BT16-001); "sameNameAsSelf":true narrows a play rule to copies of this card; "uses" is how many times that action may still happen before the prohibition starts applying, and "unless" is the escape condition. "unlessPay" is 20-14-1's other escape, a price: a program the acting player runs, in their own frame ("you" is whoever acts), before the action and every time they take it — refused when they cannot pay it; "what":"attack" (BT30-100), "play" (a play the player declares — the price is paid as the play is declared, ahead of the [Counter: Play] window, BT31-093) and "switchEnergyToActive" (asked mid-resolution of the skill doing the switch: pay, or that energy stays where it is, BT8-051) take one. "byTypes" narrows a rule to an action a skill of those card types takes ("the skill of a Battle Card or Extra Card"), and "turnPlayer":true to whoever's turn it is ("if the turn player would …"). With "what":"activateCounter", "counterKind" narrows it to one [Counter] kind ("[Counter: Play] skills") and "otherCards":true leaves the card that made the rule out of it ("…of other cards", BT10-008). "what":"activateSkill" and "activateCounter" take an "unlessPay" too (#677): the price of every skill activation the rule governs — [Activate], [Auto] and [Counter] alike — paid at the activation as its additional cost; "extraCardActivation":true narrows an "activateSkill" rule to 12-1-3's "activating an Extra Card" ([Activate] or [Counter] skills of Extra Cards used from the hand, BT10-097). "skillKinds" (a list of line kinds such as "activate:main" or "auto") narrows an "activateSkill" rule to those lines ("you can't activate the [Activate: Main] skill on copies of this card", BT12-031). "exceptOwnSkills":true and "exceptSourceName" (a card name) let one skill through: the rule's own card's ("…by skills other than its own", EB1-27) or a card of that name's ("…other than {Jaguar's Island}'s skills", BT22-072). "toArea" ("hand" | "deck" | "drop" | "warp" | "energy" | "life", with "toBottom":true for the bottom of a deck) narrows a "beMovedBySkill" rule to a move there ("…can't be returned to your hand by your skills", DB2-040); a "beMovedBySkill" rule with no "fromArea" is about the Battle Area, and "fromArea":"hand" about cards in a hand. "byFilter" describes the card whose action it is — for "beKOdInBattle", the attacking card ("…can't be KO'd in battle against Battle Cards with energy costs of 3 or less", P-481). "cardsOf" ("you" | "opponent") narrows a rule about no card in particular to cards in that player's areas, wherever they come from — "cards in your hand can't be returned to your deck by your opponent's skills for the turn" (DB2-156) is the hand as a zone, a card drawn later included. "exceptKeyword" (a keyword name, "what":"play" with "bySkill":true) lets that keyword's own play through ("…with skills other than [Revive Blue/Green]"). "costVsEnergy" ("above" | "atLeast") narrows the rule to cards whose energy cost is greater than (or at least) the number of cards in their controller's Energy Area ("Battle Cards with energy costs greater than their current energy", P-219, P-299). "exceptUnion" (a list of "Fusion" | "Potara" | "Absorb", "what":"play" only) lets through only a [Union] play of those variants — "you can only play Battle Cards by using [Union-Fusion]" (P-069, P-226, #930) forbids every other play of those cards: declared, by any other skill, an evolution. "keywordSkill" (a keyword name, "what":"activateSkill" only) narrows the rule to lines of that keyword skill ("you may not activate [EX-Evolve]", BT4-003; "Evolve" is every [Evolve] skill, 22-5-2-2). "exceptCards" (a ref, resolved when the rule is read) lets those cards through ("…other than the card they attacked with", BT8-089). "fromArea":"unison" is the Unison Area (BT30-146's Unisons). "what":"removeMarkers" is a skill taking markers off the card, with "side" as whose skill (P-676). "what" is one of ${FORBIDDEN_ACTIONS.map((w) => `"${w}"`).join(" | ")}`,
  },
  immune: {
    fields: [UNTIL, SELF, { name: "from", type: "side" }, { name: "fromFilter", type: "filter" }],
    sentence: (raw, r) => {
      const op = raw as OpOf<"immune">;
      return `${describeRef(op.target ?? { sel: { special: "self" } })} isn't affected by ${whoseSkills(op.from, op.fromFilter)}${forThe(op.until, r)}`;
    },
    doc: '9-1-4: a card no skill may touch (stronger than "forbid":"beChosen", which only stops a skill choosing it); "from" and "fromFilter" narrow whose skills — "from":"you" its own controller\'s, "from":"opponent" the other player\'s, and "both" or no "from" at all every skill, the card\'s own side\'s included',
  },
  permit: {
    fields: PERMIT_FIELDS,
    sentence: (raw, r) => {
      const op = raw as OpOf<"permit">;
      if (op.what === "comboRest") {
        const cards = op.filter ? describeFilter(op.filter, { plural: true }) : "Battle Cards";
        return `you can use your ${cards} in Rest Mode in combos${forThe(op.until, r)}`;
      }
      if (op.what === "overRealmFromWarp") {
        return renderTemplate("{target}'s [Over Realm] skill can be activated from its owner's Warp under the same conditions as from the hand", raw as unknown as Record<string, unknown>, PERMIT_FIELDS, r);
      }
      if (op.what === "unionFusionDropBottom") return "this card’s [Union-Fusion] skill from hand may choose its specified equal-power Battle Cards from your Drop as well; put only the chosen Drop cards on the bottom of your deck in your privately chosen order";
      if (op.what === "unionFusionWarp") return `this card’s [Union] skill from hand may choose its specified Battle Cards in your Warp as well (a Fusion’s go to the Drop, a Potara’s to the Battle Area)`;
      if (op.what === "unionLine") return `${describeRef(op.target)} gain the skill: ${op.line ?? ""}`;
      if (op.what === "unionEnergy") return `this card’s [Union] skill from hand may choose Battle Cards in your energy`;
      if (op.what === "unionFusionAreas") return `${op.filter ? describeFilter(op.filter, { plural: true }) : "Battle Cards"}' [Union-Fusion] can choose its specified cards in your Battle Area or Drop, those going to their owner's Warp${forThe(op.until, r)}`;
      if (op.what === "evolveEnergyBases") return `${describeRef(op.target)}'s [Evolve] skill used from hand may choose its specified Battle Card from your energy; that energy-base evolution plays this card in Active Mode`;
      if (op.what === "evolveFromZEnergy") return `${describeRef(op.target)}'s [Evolve] skill can also be activated from your Z-Energy; its base is still chosen in the Battle Area`;
      if (op.what === "aegisAltDrop") return `you can pay your [Aegis] skills by sending 1 ${(op.filter?.colors ?? []).join(" card and 1 ").toLowerCase()} card from your Drop to your Warp instead of discarding cards from your hand${forThe(op.until, r)}`;
      if (op.what === "aegisAltOpponentHand") return `${describeRef(op.target)}'s [Aegis] skill can be paid by sending 1 card from your opponent's hand to the bottom of their deck instead of discarding cards from your hand${forThe(op.until, r)}`;
      if (op.what === "attackUnnegatable") return `${describeRef(op.target)}'s attacks can't be negated${forThe(op.until, r)}`;
      if (op.what === "unionSourceUnder") return `${op.filter ? describeFilter(op.filter, { plural: true }) : "Battle Cards"}' [Union-Potara] from hand can choose its specified Battle Cards from under your ${op.source ? describeFilter(op.source, { plural: false }) : "Unison"}${forThe(op.until, r)}`;
      if (op.what === "unionSourceOpponentBattle") return `${describeRef(op.target)}'s [Union-Potara] from hand can choose its specified Battle Cards you own in your opponent's Battle Area`;
      if (op.what === "playInOpponentBattle") return `${describeRef(op.target)} is played from your hand in your opponent's Battle Area`;
      if (op.what === "absorbMaterialUnder") return `when placing Battle Cards under other cards to pay the skill costs of your ${op.filter ? describeFilter(op.filter, { plural: false }) : "card"}s' [Union-Absorb], you can use Battle Cards from under ${describeRef(op.target)} instead, one for one`;
      if (op.what === "startLife") return `you start the game with ${op.n ?? 8} life`;
      if (op.what === "fieldBattle") return `the [Field] skill on ${describeRef(op.target)} in your hand can also be activated at [Activate: Battle] timings`;
      return renderTemplate("{target} can attack {filter:cards} in Active Mode{until}", raw as unknown as Record<string, unknown>, PERMIT_FIELDS, r);
    },
    doc: '"evolveFromZEnergy" (BT19-077/078/081/082; 22-5-2 and the official card Q&A on BT19-077) lets the target card use its own [Evolve] skill while the card is in your Z-Energy as well as from the hand: only the source area widens, the base is still chosen in the Battle Area and Active Mode is not granted. "evolveEnergyBases" (22-5-3-1-1, DB3 Great Apes) permits this hand copy to select a qualifying energy base; preliminary placement suppresses movement triggers and the resulting energy-base evolution enters Active Mode. It does not widen the evolving card source. "aegisAltDrop" / "aegisAltOpponentHand" (BT22-035, BT22-140; 22-30-3 "instead of", 20-1-11) are other ways to pay an [Aegis] skill than the hand cards: one card of each colour in the filter from your Drop to your Warp, or (this card\'s own [Aegis] only) one card of your opponent\'s hand to the bottom of their deck. Otherwise, a rule of the game a card may lift: "this card can attack Battle Cards in Active Mode" (8-1-1, "attackActive"), or "you can use your … Rest Mode … cards in combos" (5-7, "comboRest", whose target is the card granting it), "the [Field] skill on this card in your hand can also be activated at [Activate: Battle] timings" (22-3, "fieldBattle", BT29-041/-042: read from the hand, where the [Field] line is used, and offered at the combo prompt as well as the Main Phase), or "this card\'s [Over Realm] skill can be activated from its owner\'s Warp under the same conditions as if it were in your hand" (22-15, "overRealmFromWarp", BT31-150: read while the card is in the Warp, where its [Over Realm] line is then offered with every other gate unchanged), or "you can choose the specified Battle Cards in your Battle Area or your Drop when choosing cards to use with the [Union] skill of a red <Veku> or <Gogeta> card from your hand" (22-13-4-2-1, "unionFusionAreas", BT31-001: read in play, widens [Union-Fusion] only, the filter naming the cards whose skill it widens). `attackUnnegatable` (EX03-14, #936) is "its attacks can\'t be negated": the attacks of the target (timed, or a [Permanent] standing one) stay un-negated when a skill would negate them, while a ban on attacking and removal of the attacker still work. `unionFusionDropBottom` (EX23-36 / P-519) is this hand copy’s own Fusion material-area permission: specified equal-power Battle Cards may come from hand and Drop together; only chosen Drop cards go to the deck bottom in the owner’s private order, while hand materials go to Drop. `absorbMaterialUnder` (BT17-082 back, #930; owner-accepted default of 25 Oct 2026) is read in play: when its master pays a [Union-Absorb] skill cost on a card the filter describes (≪Namekian≫) by placing cards under that card, each such card may instead be a Battle Card from under the granting card that the cost’s own description fits, one for one; the energy of the cost is untouched. `unionFusionWarp` (BT12-136/137, P-286; official FAQ Q1 for each) is read from hand and applies only to the card granting it: each equal-power named Fusion material may come from hand or Warp, and all go to Drop. The filter says *which* cards — leave it out only when the card does',
  },
  if: { fields: [{ name: "cond", type: "cond", required: true }, { name: "then", type: "ops", required: true }, { name: "else", type: "ops" }], sentence: "if {cond}: {then:nothing}{else?, otherwise {else}}" },
  chooseMode: {
    fields: [{ name: "modes", type: "modes", required: true }, { name: "reason", type: "string" }, { name: "chooser", type: "side" }],
    sentence: "choose one — {modes}",
    doc: '"Choose one— ・A ・B" (20-2): the master picks one printed option, or "chooser" does when the choice is not theirs — the field `may` reads too, since `may` is this op with the second option empty',
  },
  may: {
    fields: [{ name: "ops", type: "ops", required: true }, { name: "reason", type: "string" }, { name: "chooser", type: "side" }],
    sentence: "{chooser:your opponent|you} may: {ops}",
    doc: '"You may …" (20-16): wrap only the optional part; {"kind":"did","what":"may"} then reads the answer for "if you do" / "if you don\'t". "chooser":"opponent" when it is theirs to decline. A clause that is already an "up to" choice declines by choosing nothing — do not wrap those',
  },
  delay: {
    fields: [{ name: "at", type: { enum: DELAY_TIMINGS }, required: true }, { name: "scope", type: { enum: DELAY_SCOPES }, default: "thisTurn" }, { name: "ops", type: "ops", required: true }, { name: "label", type: "string" }],
    sentence: "{label:later}: {ops}",
    doc: 'the inner operations happen later (1-7-2-1-1): "At the end of the turn, KO it" is a choose, then a delay at "turnEnd" whose ops KO {"var":"t"}. A delayed program keeps the variables bound before it',
  },
  note: {
    fields: [{ name: "text", type: "string", required: true }, { name: "shown", type: "boolean", offCard: "the remark is the card's whole effect (\"You and your opponent compliment each other\", #907): the reading says it, where an engine remark says nothing" }],
    sentence: (raw) => ((raw as OpOf<"note">).shown ? `say in the log: “${(raw as OpOf<"note">).text}”` : ""),
    doc: "a remark in the log; does nothing",
  },
  setPlayerAttr: {
    fields: [
      { name: "name", type: "string", required: true },
      { name: "value", type: "boolean", default: true },
      SIDE,
      {
        name: "add",
        type: "number",
        offCard: "a counted fact (`value: number`) goes up by this much instead of being set — [Over Realm]'s use this turn (22-15-3, #157); `value` is not read with it",
      },
    ],
    sentence: "{side:your opponent's|your} {name} is set{add? (plus {add})}",
    doc: 'set a `DEFINE ATTRIBUTE of: player` fact — 13-3\'s growUnison marks its own "grewUnison" true once it resolves, so a later REFUSE reads it rather than the move being asked twice in one turn (issue #269)',
  },
  battleDamage: {
    fields: [
      { name: "atLeast", type: "amount" },
      { name: "to", type: { enum: ["drop"] } },
      { name: "allMarkers", type: "boolean" },
      { name: "wins", type: "boolean" },
    ],
    sentence: (raw) => {
      const op = raw as OpOf<"battleDamage">;
      const parts: string[] = [];
      if (op.atLeast !== undefined) parts.push(`at least ${describeAmount(op.atLeast)} life damage, and as many markers off a Unison`);
      if (op.to) parts.push(`the life cards go to the ${op.to} face up instead of the hand`);
      if (op.allMarkers) parts.push("every marker off a Unison");
      if (op.wins) parts.push("its master wins once life damage lands");
      return `this card's battle damage: ${parts.length ? parts.join("; ") : "as usual"}`;
    },
    offCard:
      "how the battle damage a card deals by attacking lands (8-4-6), the leaf of a keyword's beforeDamage hook — atLeast raises life damage and the markers taken off a Unison to that much ([Strike], 22-7), to: drop sends the life cards to the Drop face up ([Critical], 22-6), allMarkers takes every marker off a Unison and wins ends the game once life damage lands ([Victory Strike], 22-18)",
  },
  printedEffect: {
    fields: [],
    sentence: "the line's printed effect resolves",
    offCard:
      "the line's own printed effect, announced as printed and run at this point of a keyword's DO with everything the DO bound — [Alliance] rests its cost and only then runs the effect that reads the cards it rested (22-32-3); nothing on a program that is not a keyword moment's",
  },
  payActionPrice: {
    fields: [],
    sentence: "the line's printed action price is paid",
    offCard:
      "where a keyword move's printed action price (the action before its colon, \"draw 1 card\") is paid on the strict action-price host, in front of the rest of the DO — [Union-Fusion] after its materials are in the Drop (22-13-4-4-1), [Union-Potara] and the [Evolve] family first (#926); a price that cannot be paid in full fails the activation (5-8-4); nothing on a line with no action price",
  },
  carryMarkers: {
    fields: [
      { name: "upTo", type: "amount", required: true },
      { name: "color", type: { enum: COLORS }, nullable: true },
    ],
    sentence: "carry up to {upTo:marker} from the Unison this one replaces{color? if it is {color}}",
    offCard:
      "the leaf of a keyword's markerCarry hook: a Unison played over another may take up to this many of its markers, the master's choice from none to the most it has (22-45-3, [Empower]); with a colour, only from a Unison of that colour",
  },
};

/**
 * Primitive or macro, one decision per op — `docs/arena-ruleset-spec.md` §2.3,
 * which carries the reason beside each row and is checked against this table
 * by `scripts/verify/language.ts`.
 *
 * A primitive says something no combination of the others can; everything else
 * is a macro, re-declared over its primitive in Stage 3's `DEFINE OP` grammar
 * (#137) without any op losing its name, its row or its printed form. The
 * `Record` type is the point: a new op fails `npm run typecheck` until it has
 * been decided, rather than arriving as one more spelling of something the
 * language already says.
 *
 * The value is the doc's own words, so the two cannot drift apart in the half
 * that matters — which primitive a row lowers to. Some of those primitives are
 * the general form of a row that exists (`move` is `moveTo`, `negate` is
 * `negateSkills`) and some are Stage 2 issues not yet built (`control`/`skip`
 * #126); §2.2 lists them all.
 */
export type OpClass = "primitive" | `macro over ${string}`;

export const OP_CLASS: Record<Op["op"], OpClass> = {
  costModifier:       "primitive",
  draw:               "macro over `move`",
  discard:            "macro over `choose` + `move`",
  damage:             "macro over `move`",
  mill:               "macro over `move`",
  addLife:            "macro over `move`",
  lifeDownTo:         "macro over `move`",
  shuffle:            "primitive",
  win:                "primitive",
  declare:            "primitive",
  invokeSkill:        "primitive",
  energyMarker:       "macro over `modifyAttr`",
  choose:             "primitive",
  look:               "macro over `reveal`",
  reveal:             "primitive",
  ko:                 "macro over `move`",
  moveTo:             "primitive",
  play:               "primitive",
  switchMode:         "macro over `modifyAttr`",
  modifyAttr:         "primitive",
  power:              "macro over `modifyAttr`",
  comboPower:         "macro over `modifyAttr`",
  grant:              "macro over `modifyAttr`",
  copySkills:         "primitive",
  negate:             "primitive",
  negateSkills:       "macro over `negate`",
  negateSkillsOfKind: "macro over `negate`",
  negateChosenKeyword: "macro over `negate`",
  hidden:             "macro over `modifyAttr`",
  redirectAttack:     "macro over `modifyAttr`",
  swapBattle:         "primitive",
  placeOnTop:         "primitive",
  comboFrom:          "macro over `move` + `negate`",
  flip:               "macro over `modifyAttr`",
  faceUp:             "macro over `modifyAttr`",
  addMarker:          "macro over `modifyAttr`",
  removeMarker:       "macro over `modifyAttr`",
  token:              "primitive",
  costReduction:      "macro over `costModifier`",
  negateKeyword:      "macro over `negate`",
  gains:              "macro over `modifyAttr`",
  replace:            "primitive",
  control:            "primitive",
  skip:               "primitive",
  replaceLeave:       "macro over `replace`",
  altCost:            "macro over `costModifier`",
  payWith:            "primitive",
  resolvingPlay:      "macro over `replace`",
  negateAttack:       "macro over `replace`",
  negateCounter:      "macro over `replace`",
  negateOwnSkill:     "macro over `negate`",
  forbid:             "primitive",
  immune:             "primitive",
  permit:             "primitive",
  if:                 "primitive",
  chooseMode:         "primitive",
  may:                "macro over `chooseMode`",
  delay:              "primitive",
  note:               "primitive",
  setPlayerAttr:      "primitive",
  battleDamage:       "primitive",
  printedEffect:      "primitive",
  payActionPrice:     "primitive",
  carryMarkers:       "primitive",
};

/**
 * `costModifier` read as the spelling it stands for (spec §2.5-4, #277) — the
 * one dispatch `stepScript`'s main loop, `collectStatics` and `vm/effects.ts`'s
 * `permanents` all run through, so any other step comes back as it was and
 * `costReduction`/`altCost`'s own cases are the only reading of a price
 * change on either engine.
 *
 * `pay` present is `altCost`: the whole price replaced. Absent is
 * `costReduction`: the number changed. A call with neither `pay` nor `amount`
 * is a `note` rather than a guess — the same rule `negateAs` holds a missing
 * field to.
 */
export function costModifierAs(op: Op): Op {
  if (op.op !== "costModifier") return op;
  const target = op.target ?? { sel: { special: "self" } };
  if (op.pay !== undefined) {
    return {
      op: "altCost",
      pay: op.pay,
      target,
      ...(op.n !== undefined ? { n: op.n } : {}),
      ...(op.for !== undefined ? { for: op.for } : {}),
      ...(op.alt ? { ops: op.alt } : {}),
      ...(op.orbs?.length ? { orbs: op.orbs } : {}),
      ...(op.until !== undefined ? { until: op.until } : {}),
    };
  }
  if (op.amount === undefined) return { op: "note", text: "costModifier: no amount named" };
  return {
    op: "costReduction",
    target,
    amount: op.amount,
    ...(op.what !== undefined ? { what: op.what } : {}),
    ...(op.skillKind ? { skillKind: op.skillKind } : {}),
    ...(op.tag ? { tag: op.tag } : {}),
    ...(op.colors?.length ? { colors: op.colors } : {}),
    ...(op.until !== undefined ? { until: op.until } : {}),
    ...(op.onto ? { onto: op.onto } : {}),
    ...(op.uses !== undefined ? { uses: op.uses } : {}),
  };
}

/**
 * A condition in the same form as an op: its fields, and the sentence it makes.
 *
 * The same reason `OP_SCHEMA` exists. A condition kind used to be written in
 * three places — the `Cond` union, the interpreter in `state.ts`, and a
 * hand-written `switch` in `describeCond` — and nothing checked its fields at
 * all: the validator accepted any object carrying a `kind`, so
 * `{"kind":"count"}` with no selector passed, was stored, and threw when the
 * engine read it. Adding a kind is now one interpreter case and one row here.
 *
 * Most sentences turn on which bound is set ("2 or more" against "no"), so
 * they are functions rather than templates; the fields beside them are what
 * the validator and the workbench's editor read.
 */
export interface CondSpec {
  fields: OpField[];
  sentence: (cond: Cond) => string;
  doc?: string;
}

type CondOf<K extends Cond["kind"]> = Extract<Cond, { kind: K }>;

const SEL: OpField = { name: "sel", type: "selector", required: true };
const AT_LEAST: OpField = { name: "atLeast", type: "number" };
const AT_MOST: OpField = { name: "atMost", type: "number" };

/** "2 or more", "no", "any" — the bound a counting condition puts on a number. */
function bound(c: { atLeast?: number; atMost?: number }, most = "or fewer"): string {
  if (c.atMost === 0) return "no";
  if (c.atLeast != null) return `${c.atLeast} or more`;
  if (c.atMost != null) return `${c.atMost} ${most}`;
  return "any";
}

const DID_IN_WORDS: Record<CondOf<"did">["what"], string> = {
  addToHand: "you added a card to your hand",
  play: "you played a card",
  negateAttack: "you negated the attack",
  negateLeaderAttack: "you negated a Leader's attack",
  ko: "you KO'd a card",
  draw: "you drew a card",
  may: "the offer was taken",
};
const DID_WHATS = Object.keys(DID_IN_WORDS) as readonly CondOf<"did">["what"][];

export const COND_SCHEMA: Record<Cond["kind"], CondSpec> = {
  count: {
    fields: [SEL, AT_LEAST, AT_MOST],
    sentence: (raw) => {
      const c = raw as CondOf<"count">;
      // One named card asked about — "if the Battle Card being played has an
      // energy cost of 3 or less" (BT29-112): the question is what it is, and
      // "there are 1 or more the card being played" said neither.
      if (c.sel.special && c.sel.special !== "onTop" && (c.atLeast ?? 1) === 1 && c.atMost === undefined) {
        const what = describeSelector({ special: c.sel.special });
        // Everything said about it, each as "is …": what it is, its mode, face
        // down or up, and where it is (9-1-3-2's "this card in your hand").
        const is: string[] = [];
        if (c.sel.filter) {
          const noun = describeFilter(c.sel.filter, { plural: false });
          is.push(`${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`);
        }
        if (c.sel.mode) is.push(`in ${c.sel.mode} mode`);
        if (c.sel.hidden !== undefined) is.push(c.sel.hidden ? "in Hidden Mode" : "in Revealed Mode");
        const areas = c.sel.areas?.length ? c.sel.areas : c.sel.area ? [c.sel.area] : [];
        if (areas.length) is.push(`in ${areas.map((a) => (a === "play" ? "play" : `your ${ZONE_NOUNS[a as keyof typeof ZONE_NOUNS] ?? a}`)).join(" or ")}`);
        return is.length ? `${what} is ${is.join(" and ")}` : `there is ${what}`;
      }
      // "all" is the count this borrows to name the cards; what is left says
      // which and where, noun included — "blue cards in your Drop Area" (#478).
      const what = describeSelector({ ...c.sel, count: 99 }).replace(/^all /, "");
      return `there are ${bound(c)} ${what}`;
    },
    doc: "how many cards a selector finds",
  },
  life: {
    fields: [{ name: "side", type: "side", required: true }, AT_LEAST, AT_MOST],
    sentence: (raw) => {
      const c = raw as CondOf<"life">;
      const whose = c.side === "opponent" ? "their" : "your";
      if (c.atMost != null) return `${whose} life is ${c.atMost} or less`;
      if (c.atLeast != null) return `${whose} life is ${c.atLeast} or more`;
      return `${whose} life`;
    },
  },
  lifeVsOpponent: {
    fields: [
      { name: "atLeast", type: "boolean" },
      { name: "atMost", type: "boolean" },
    ],
    sentence: (raw) => ((raw as CondOf<"lifeVsOpponent">).atLeast ? "your life is at least theirs" : "your life is no more than theirs"),
    doc: "the two life counts against each other",
  },
  leaderColor: {
    fields: [{ name: "color", type: { enum: COLORS }, required: true }],
    sentence: (raw) => `your leader is ${(raw as CondOf<"leaderColor">).color}`,
  },
  leaderMatches: {
    fields: [
      { name: "filter", type: "filter", required: true },
      { name: "side", type: "side" },
      { name: "back", type: "boolean" },
    ],
    sentence: (raw) => {
      const c = raw as CondOf<"leaderMatches">;
      const f = c.filter;
      // "-only" (BT29-108) and "<Baby> or ≪Brainwashed≫" are said as printed:
      // without them the reading claims a wider Leader than the card does.
      const chars = anyOfNames(f.characters.map((x, i) => `<${x}>${f.onlyCharacters && i === f.characters.length - 1 ? "-only" : ""}`));
      // "≪Saiyan≫-only" (#932), on the last trait named, as printed.
      const traits = anyOfNames(f.traits.map((x, i) => `\u226a${x}\u226b${f.onlyTraits && i === f.traits.length - 1 ? "-only" : ""}`));
      // "a Green <Trunks: Future> <Mai: Future> card" (BT23-073, #768): every
      // name of an all-of list is required, so each is said, characters as `<…>`
      // and card names as `{…}`, the way the other name lists are.
      const allOf = [...(f.charactersAll ?? []).map((x) => `<${x}>`), ...(f.traitsAll ?? []).map((x) => `≪${x}≫`), ...(f.namesAll ?? []).map((x) => `{${x}}`)];
      // "or has <GT> in its character name" (BT31-049), said as `describeFilter` says it.
      const including = (f.charactersIncluding ?? []).map((x) => `a card with <${x}> in its character name`);
      const bits = [...f.colors, ...(f.characterOrTrait && chars.length && traits.length ? [...chars, "or", ...traits] : [...chars, ...traits]), ...allOf, ...including];
      // "with 10000 power or less" (#990): the bound is part of the Leader
      // description, and the VM asks it. Left out, the reading claims a wider
      // Leader than the card does.
      const power =
        f.powerMin != null && f.powerMin === f.powerMax
          ? `with ${f.powerMin} power`
          : f.powerMin != null && f.powerMax != null
            ? `with power between ${f.powerMin} and ${f.powerMax}`
            : f.powerMax != null
              ? `with ${f.powerMax} power or less`
              : f.powerMin != null
                ? `with ${f.powerMin} power or more`
                : "";
      const said = [bits.join(" ") || f.names?.join("/") || (power ? "a card" : "a match"), power].filter(Boolean).join(" ");
      return `${c.side === "opponent" ? "their" : "your"} leader${c.back ? "'s back side" : ""} is ${said}`;
    },
    doc: '"If your Leader is a <Baby> card" — colour, character name and traits alike',
  },
  markers: {
    fields: [SEL, AT_LEAST, AT_MOST],
    sentence: (raw) => {
      const c = raw as CondOf<"markers">;
      return `${describeSelector(c.sel)} has ${bound(c)} markers`;
    },
  },
  inBattle: {
    fields: [SEL, { name: "not", type: "boolean" }, { name: "role", type: { enum: ["attacker", "guard"] } }],
    sentence: (raw) => {
      const c = raw as CondOf<"inBattle">;
      return `${describeSelector(c.sel, "any of the")} is ${c.not ? "not " : ""}${c.role === "guard" ? "being attacked" : c.role === "attacker" ? "attacking" : "in a battle"}`;
    },
  },
  battled: { fields: [SEL], sentence: (raw) => `${describeSelector((raw as CondOf<"battled">).sel, "any of the")} has been in a battle this turn` },
  playedUsing: {
    fields: [SEL, { name: "what", type: { enum: ["Over Realm", "Union", "Union-Fusion", "Union-Potara", "Union-Absorb"] }, required: true }],
    sentence: (raw) => {
      const c = raw as CondOf<"playedUsing">;
      return c.what === "Union"
        ? `${describeSelector(c.sel, "any of the")} was played using a [Union] skill`
        : c.what.startsWith("Union-")
          ? `${describeSelector(c.sel, "any of the")} was played using [${c.what}]`
          : `${describeSelector(c.sel, "any of the")} was played with [${c.what}] this turn`;
    },
    doc: "was one of these cards played this turn by the keyword's own move — \"during the turn you played it with [Over Realm]\" (P-048, 22-15)? The card remembers the play its `play … using:` made until the turn ends or it changes area (3-1-4). `what: Union` (#930) is \"if you played this card using [union]\" (BT5-037, BT6-036): did the copy enter by a successful [Union-(type)] play — not a negated, replaced or failed one — at any time while it has stayed in the area (3-1-4); \"this card\" after it left as its own [Activate] cost is read as it was when activated, and an [Auto] reads it as it was when triggered — BT6-036 KO'd before its on-play [Auto] resolves still counts (owner's ruling, 25 Oct 2026). `what: Union-Fusion` / `Union-Potara` / `Union-Absorb` is that [Union] keyword only. As the lone IF of an [Auto] on `played` — \"when this card is played using [Union]\" (BT14-114, BT28-097 …) — it is the trigger's own condition: `resolvePlay` withdraws the Auto from any play that was not such an entry, so it is never triggered by an ordinary, failed or other-variant play. With `sel: subject`, beside the description of the played card in an `all`, on an [Auto] on `youPlayed` — \"when your <X> card is played by a [Union] skill\" (BT22-033, BT25-036 back, P-682), \"when you play a Battle Card using a [Union-Fusion] skill\" (BT12-122) — it is the same trigger condition about that card, and the [Auto] carries the subject's entry as it was when triggered",
  },
  placedThisTurn: {
    fields: [SEL],
    sentence: (raw) => `${describeSelector((raw as CondOf<"placedThisTurn">).sel, "any of the")} was placed in a Battle Area this turn`,
    doc: "did one of these cards arrive in a Battle Area this turn, played or placed by a skill (5-5-1, 5-5-4)? \"At the end of a turn in which this card was placed in a Battle Area\" (BT15-118). The card remembers the arrival until the turn ends or it changes area (3-1-4)",
  },
  every: {
    fields: [SEL, { name: "matching", type: "selector", required: true }],
    sentence: (raw) => {
      const c = raw as CondOf<"every">;
      // Both selectors are built by `parseTarget` with the count deleted (see
      // `compile.ts`), so the quantifier is the sentence's own word: "all of
      // all in your energy is all mono-colour blue in your energy" was the
      // stutter that came of letting each of them claim one. Each is given a
      // count only to settle its noun, which the sentence then drops: "every
      // card in your Energy Area is also among the cards … in Rest Mode".
      const one = describeSelector({ ...c.sel, count: 1, upTo: false }).replace(/^1 /, "");
      const all = describeSelector({ ...c.matching, count: 99 }).replace(/^all /, "");
      return `every ${one} is also among the ${all}`;
    },
    doc: "every card the first selector finds is also one the second finds; false when there is nothing to find (0-2-4-1)",
  },
  any: { fields: [{ name: "conds", type: "conds", required: true }], sentence: (raw) => (raw as CondOf<"any">).conds.map(describeCond).join(", or "), doc: "at least one of the conditions holds (disjunction)" },
  all: {
    fields: [{ name: "conds", type: "conds", required: true }],
    // "(black, or ≪Universe≫) and 2 or more energy" (BT30-096, #537): an
    // "or" inside an "and" is bracketed, or the sentence reads the other way.
    sentence: (raw) => (raw as CondOf<"all">).conds.map((c) => (c.kind === "any" ? `(${describeCond(c)})` : describeCond(c))).join(" and "),
    doc: "every condition holds (conjunction)",
  },
  leaderFlipped: {
    fields: [
      { name: "side", type: "side" },
      { name: "flipped", type: "boolean" },
    ],
    sentence: (raw) => {
      const c = raw as CondOf<"leaderFlipped">;
      return `${c.side === "opponent" ? "their" : "your"} leader ${c.flipped === false ? "has not" : "has"} awakened`;
    },
  },
  power: {
    fields: [SEL, AT_LEAST, AT_MOST],
    sentence: (raw) => {
      const c = raw as CondOf<"power">;
      return `${describeSelector(c.sel)} has ${bound(c, "or less")} power`;
    },
  },
  did: {
    fields: [{ name: "what", type: { enum: DID_WHATS }, required: true }],
    sentence: (raw) => DID_IN_WORDS[(raw as CondOf<"did">).what],
    doc: 'whether an earlier step of this same skill did that — {"what":"may"} reads the answer to a "you may"',
  },
  not: { fields: [{ name: "cond", type: "cond", required: true }], sentence: (raw) => `not (${describeCond((raw as CondOf<"not">).cond)})` },
  chose: {
    fields: [{ name: "var", type: "string", required: true }, AT_LEAST],
    sentence: (raw) => {
      const c = raw as CondOf<"chose">;
      return c.atLeast && c.atLeast > 1 ? `you took all ${c.atLeast}` : "you took that choice";
    },
    doc: '"If you do so" (20-16): whether an earlier choice was answered, and with how many',
  },
  varAttrIsX: {
    fields: [{ name: "var", type: "string", required: true }, { name: "attr", type: { enum: ["power", "comboPower", "energyCost", "comboCost", "originalPower", "specifiedCost"] }, required: true }],
    sentence: (raw) => {
      const c = raw as CondOf<"varAttrIsX">;
      return `that card's ${c.attr === "energyCost" ? "energy cost" : c.attr} is the declared number`;
    },
    doc: '"if the revealed card\'s energy cost is the same as the declared number" (BT22-090): the card a reveal or a look bound, measured against the X a `declare` bound',
  },
  varMatches: {
    fields: [
      { name: "var", type: "string", required: true },
      { name: "filter", type: "filter", required: true },
    ],
    sentence: (raw) => `that card is ${describeFilter((raw as CondOf<"varMatches">).filter)}`,
  },
  isTurnPlayer: {
    fields: [{ name: "who", type: { enum: ["you", "opponent"] } }],
    sentence: (raw) => ((raw as CondOf<"isTurnPlayer">).who === "opponent" ? "it is your opponent's turn" : "it is your turn"),
    doc: 'whose turn it is (7-1) — "during your opponent\'s turn" is this, not a duration',
  },
  forbidden: {
    fields: [
      { name: "what", type: { enum: FORBIDDEN_ACTIONS }, required: true },
      { name: "bySkill", type: "boolean" },
      { name: "from", type: { enum: ["hand", "battle", "drop"] } },
    ],
    sentence: (raw) => `a rule in force stops you ${FORBIDDEN_IN_WORDS[(raw as CondOf<"forbidden">).what]}`,
    doc: 'whether a prohibition in force (20-14) stops this, asked of the card and the player the move is about. No card says this — it is the word a `DEFINE ACTION`\'s `REFUSE` gates a move on, and it is the same predicate `forbids()` is. "bySkill" tells the two halves of one wording apart: false is a move the player declares ("…except by skills"), true a move a skill makes; "from" names the area the move takes cards out of when that is not where the candidate stands — the price of [Over Realm] empties the Drop into the Warp, asked of a card in the hand (`dropToWarp`, BT6-028)',
  },
  asking: {
    fields: [{ name: "prompt", type: { enum: PROMPT_KINDS }, required: true }],
    sentence: (raw) => `the question on the table is the ${(raw as CondOf<"asking">).prompt} question`,
    doc: "which question is on the table. No card says this — it is the word an earlier `DEFINE ACTION`'s `REFUSE` told two windows of one move apart with, before `playerAttr` gave a fact its own name (issue #269)",
  },
  playerAttr: {
    fields: [
      { name: "name", type: "string", required: true },
      { name: "side", type: { enum: ["you", "opponent"] } },
      {
        name: "atLeast",
        type: "number",
        offCard: "reads a counted fact (`value: number`): it holds when the count is at least this — [Over Realm]'s one use a turn, two with [Wormhole] (22-15-3, 22-24, #157)",
      },
    ],
    sentence: (raw) => {
      const c = raw as CondOf<"playerAttr">;
      return `${c.side === "opponent" ? "your opponent" : "you"} ${c.name}${c.atLeast !== undefined ? ` at least ${c.atLeast} time${c.atLeast === 1 ? "" : "s"}` : ""}`;
    },
    doc: 'a `DEFINE ATTRIBUTE of: player` fact, read — "you have already had your charge this turn" (7-2-11) and "you have not already grown a Unison this turn" (13-3) are both `NOT playerAttr(name: …)`, over the declared name (issue #269)',
  },
  sameCard: {
    fields: [
      { name: "a", type: "selector", required: true },
      { name: "b", type: "selector", required: true },
    ],
    sentence: (raw) => {
      const c = raw as CondOf<"sameCard">;
      return `${describeSelector(c.a, "")} is the same card as ${describeSelector(c.b, "")}`;
    },
    doc: 'do these two selectors each resolve to one card of the same printed identity? "a copy of the Unison Card" (13-3) is this, over the candidate and the card in the Unison Area — the filter grammar has no word for another card\'s identity, so this reads two selectors instead (issue #269)',
  },
  flag: {
    fields: [{ name: "value", type: "boolean", required: true }],
    sentence: (raw) => ((raw as CondOf<"flag">).value ? "always" : "never"),
    doc: "a keyword's boolean parameter, read as a condition. No card says this: once `$dark` is bound off the printed keyword, `flag(value: $dark)` tells [Dark Over Realm] from [Over Realm] (22-23, #157)",
  },
  oneOf: {
    fields: [
      { name: "value", type: "string", required: true },
      { name: "of", type: { list: "string" }, required: true },
    ],
    sentence: (raw) => {
      const c = raw as CondOf<"oneOf">;
      if (!c.of.length) return `${JSON.stringify(c.value)} is one of nothing`;
      return `${JSON.stringify(c.value)} is ${c.of.length === 1 ? JSON.stringify(c.of[0]) : `one of ${c.of.map((w) => JSON.stringify(w)).join(", ")}`}`;
    },
    doc: 'is this word one of those? No card says this — it is the word a `DEFINE KEYWORD` body tells the variants of one keyword apart with, once `$variant` is bound off the printed keyword: `oneOf(value: $variant, of: ["Xeno-Evolve"])` (22-5-6, Stage 7)',
  },
  eachNamed: {
    fields: [
      { name: "sel", type: "selector", required: true },
      { name: "samePower", type: "boolean" },
    ],
    sentence: (raw) => {
      const c = raw as CondOf<"eachNamed">;
      return `every character this line names is a different one of ${describeSelector(c.sel, "")}${c.samePower ? ", all of one power" : ""}`;
    },
    doc: "does every character the keyword line prints in ‹…› stand on a different card among these — and, with samePower, are they of one power? [Union]'s check before it is offered (22-13-4, 22-13-5). No card's record says this; it is read off the line a keyword's own program belongs to, like the `asPrinted` selector flag",
  },
  permits: {
    fields: [{ name: "what", type: { enum: ["unionFusionAreas", "unionFusionWarp", "unionFusionDropBottom", "unionEnergy", "evolveEnergyBases", "evolveFromZEnergy", "aegisAlt"] }, required: true }],
    sentence: (raw) => ((raw as { what?: string }).what === "aegisAlt" ? "a [Permanent] of yours lets this card's [Aegis] be paid another way, and that payment can be made now" : (raw as { what?: string }).what === "evolveFromZEnergy" ? "this card's own [Permanent] lets its [Evolve] be activated from your Z-Energy" : (raw as { what?: string }).what === "evolveEnergyBases" ? "this hand copy's [Permanent] permits energy-area evolution bases and Active Mode on that path" : (raw as { what?: string }).what === "unionFusionDropBottom" ? "this hand copy may choose its specified Fusion materials from Drop, putting those Drop cards on its deck bottom in a privately chosen order" : (raw as { what?: string }).what === "unionFusionWarp" ? "this card's own [Permanent] lets its [Union] skill from hand choose its specified materials from the Warp as well" : (raw as { what?: string }).what === "unionEnergy" ? "this card's own [Permanent] lets its [Union] skill from hand choose its specified Battle Cards in your energy as well" : "a [Permanent] of yours widens where this card's [Union-Fusion] may choose its cards from"),
    doc: "`evolveFromZEnergy`: does this exact copy, in the Z-Energy Area, have its own source-area permission? Never widens the base area. `evolveEnergyBases`: does this exact hand copy have its own energy-base permission? Independent of source-area permissions. `aegisAlt`: does a `permit` of `aegisAltDrop` or `aegisAltOpponentHand` stand for this [Aegis] card, with the alternative payment it names payable on the board now (BT22-035, BT22-140; 22-30-3 \"instead of\")? `unionFusionAreas`: does a `permit` of this kind stand for the card whose line this program is? [Union-Fusion]'s widened areas (22-13-4-2-1, BT31-001's `unionFusionAreas`): the permission's filter is asked of the card using the skill, not of the leader that grants it. `unionFusionWarp` / `unionEnergy`: the card granting the permission must itself be the card activating its [Union] and must be in hand (#930: the Warp one serves [Union-Potara] BT10-132 / P-230 as well as Fusion; the energy one BT10-046 / BT10-053 / P-220). A `DEFINE KEYWORD` body's word; no card's record says this",
  },
  covers: {
    fields: [
      { name: "sel", type: "selector", required: true },
      { name: "colors", type: { list: { enum: COLORS } }, required: true },
      { name: "original", type: "boolean" },
    ],
    sentence: (raw) => {
      const c = raw as CondOf<"covers">;
      return `${describeSelector(c.sel, "")} carry ${c.original ? "original " : ""}${c.colors.join(" and ")} between them`;
    },
    doc: "do these cards carry every one of the colours between them — one card of each, or one multicolour card for two? [Arrival]'s Combo Area and [Revive]'s hand (22-29-3, 22-34-3), with the colours bound off the printed keyword (`colors: $colors`). `original: true` reads the shown face before identity effects (22-29-3, 22-30-3, 22-34-3); absent reads effective colours. A `DEFINE KEYWORD` body's word; no card's record says this (#155, #597)",
  },
  sumsTo: {
    fields: [
      { name: "sel", type: "selector", required: true },
      { name: "attr", type: { enum: AMOUNT_ATTRS }, required: true },
      { name: "total", type: "amount", required: true },
    ],
    sentence: (raw) => {
      const c = raw as CondOf<"sumsTo">;
      return `some of ${describeSelector(c.sel, "")} have a total ${c.attr} of exactly ${describeAmount(c.total)}`;
    },
    doc: "can some of these cards — at least one, and a total above 0 — be picked so that their measure adds up to exactly this much? [Successor]'s check before it is offered (22-38-2); the `choose` op's `sumTo` then picks that set one card at a time. A `DEFINE KEYWORD` body's word (#155)",
  },
  attacked: {
    fields: [SEL, { name: "atLeast", type: "amount", required: true }],
    sentence: (raw) => {
      const c = raw as CondOf<"attacked">;
      return `${describeSelector(c.sel, "any of the")} has attacked ${describeAmount(c.atLeast)} or more times this turn`;
    },
    doc: "has one of these cards declared at least this many attacks this turn, the one in progress included (8-1)? [Dual Attack]/[Triple Attack]'s X−1 stands a turn (22-8-3): `NOT attacked(sel: [self], atLeast: $x)`. A `DEFINE KEYWORD` body's word (#156)",
  },
  markerSkillUsed: {
    fields: [SEL],
    sentence: (raw) => {
      const c = raw as CondOf<"markerSkillUsed">;
      return `${describeSelector(c.sel, "any of the")} has used a marker skill this turn`;
    },
    doc: "has one of these cards used a skill with a marker price this turn (13-4-2: one a turn per card)? [Rejuvenate]'s gate, `NOT markerSkillUsed(sel: [self])`; a keyword move refused by it on its own card is a marker skill itself, and using it spends the card's one (22-42-2). A `DEFINE KEYWORD` body's word (#155)",
  },
  comboFrom: {
    fields: [SEL, { name: "areas", type: { list: { enum: AREAS } }, required: true }],
    sentence: (raw) => {
      const c = raw as CondOf<"comboFrom">;
      const where = c.areas.map((a) => (a in ZONE_NOUNS ? ZONE_NOUNS[a as keyof typeof ZONE_NOUNS] : a)).join(" or ");
      return `${describeSelector(c.sel, "any of the")} was used in a combo from the ${where}`;
    },
    doc: "did one of these cards enter the Combo Area of the battle in progress from one of these areas — \"this card was used in a combo from your deck or hand\" (BT12-071, -072, -074, -075)? The engine keeps the area a combo card left (`VmBattle.comboOrigins`) until the card leaves the Combo Area at the end of the battle, so the question is asked of the battle; a card in no Combo Area has no origin and answers false",
  },
};

/** Primitive or macro for a condition — `docs/arena-ruleset-spec.md` §2.4, and see `OP_CLASS` above. */
export const COND_CLASS: Record<Cond["kind"], OpClass> = {
  count:          "primitive",
  life:           "macro over `count`",
  lifeVsOpponent: "macro over `count`",
  leaderColor:    "macro over `count`",
  leaderMatches:  "macro over `count`",
  markers:        "macro over `count`",
  inBattle:       "macro over `count`",
  battled:        "macro over `count`",
  playedUsing:    "macro over `count`",
  placedThisTurn: "macro over `count`",
  every:         "macro over `count` + `not`",
  any:            "primitive",
  all:            "macro over `any` + `not`",
  leaderFlipped:  "macro over `count`",
  power:          "macro over `count`",
  did:            "primitive",
  not:            "primitive",
  chose:          "macro over `count`",
  varMatches:     "macro over `count`",
  varAttrIsX:     "primitive",
  isTurnPlayer:   "primitive",
  asking:         "primitive",
  forbidden:      "primitive",
  playerAttr:     "primitive",
  sameCard:       "primitive",
  flag:           "primitive",
  oneOf:          "primitive",
  eachNamed:      "primitive",
  permits:        "primitive",
  covers:         "primitive",
  sumsTo:         "primitive",
  attacked:       "macro over `count`",
  markerSkillUsed: "macro over `count`",
  comboFrom:      "primitive",
};

/**
 * The conditions no printed card says, and that nothing writing a *card's*
 * rule may therefore be offered.
 *
 * `COND_SCHEMA` is the one definition of the effect language and everything in
 * it is part of that language — the reference page at `/arena/rules/language`
 * lists the lot, because a `.rules` file may write any of it. But two readers
 * are narrower than the language: the referee is ruling on **one skill of one
 * card** and the workbench's chip editor is writing **one card's record**, and
 * a word no card's text contains is one neither should be shown. `asking` is
 * the first: it says which question is on the table, which is what a `DEFINE
 * ACTION`'s `REFUSE` needs to tell two windows of one move apart (7-2-11,
 * #145) and what no skill has ever been printed asking. `forbidden` is the
 * second, and for the same reason: 20-14's prohibitions are a *gate* on a move,
 * and a card that is under one says so by printing the ban, never by asking
 * whether one is in force.
 *
 * Not a validation rule — `validateProgram` accepts every schema row, because a
 * stored program is checked against the language and not against this list.
 */
export const CONDITIONS_OFF_A_CARD: readonly Cond["kind"][] = ["asking", "forbidden", "flag", "oneOf", "eachNamed", "permits", "covers", "sumsTo", "attacked", "markerSkillUsed"];

// ── validation, for programs that did not come from the compiler ───────────

/**
 * Structural check for a program supplied by the referee, the workbench or a
 * stored row: every op is in the schema, every required field is there and
 * every enumerated field holds one of its values. It only proves the shape is
 * executable — the engine still enforces every rule while running it, so a
 * bad ruling can be wrong but never illegal. Nested programs are checked to
 * the depth a real card ever needs.
 */
/**
 * The `negate` primitive, read as the spelling it stands for (9-1-5, #276).
 *
 * `negateSkills`, `negateSkillsOfKind`, `negateKeyword` and `negateOwnSkill`
 * are what the compiler writes and what a record holds; `negate` is what they
 * mean (docs/arena-ruleset-spec.md §2.2), and this is the one place the two
 * meet. The interpreter (`stepScript`), the legacy statics collector, the
 * rules engine's [Permanent] walk and the row's own sentence each pass a step
 * through here first, so a program written either way runs through the same
 * case, puts the same effect in force and reads in the same words — one
 * dispatch, never a second reading of negation. Any other step comes back as
 * it was.
 *
 * A scope missing the field it needs — `kind` with no skill kind, `keyword`
 * with no keyword, `own` for a span that is neither the turn, the battle nor
 * the game — is a `note` rather than a guess: unread beats wrongly read.
 */
export function negateAs(op: Op): Op {
  if (op.op !== "negate") return op;
  const target: Ref = op.target ?? { sel: { special: "self" } };
  const until: Duration = op.until ?? "game";
  switch (op.what) {
    case "skills":
      return { op: "negateSkills", target, until };
    case "kind":
      return op.kind ? { op: "negateSkillsOfKind", target, kind: op.kind, until } : { op: "note", text: "negate: no skill kind named" };
    case "keyword":
      // "Choose up to 1 keyword skill on … and negate it": the keyword is the
      // master's pick at resolution, so the call names none. Naming one *and*
      // saying chosen is two answers to one question, and reads as neither.
      if (op.chosen) return op.keyword ? { op: "note", text: "negate: a chosen keyword names none" } : { op: "negateChosenKeyword", target, until };
      return op.keyword ? { op: "negateKeyword", keyword: op.keyword, ...(op.target ? { target: op.target } : {}) } : { op: "note", text: "negate: no keyword named" };
    case "own":
      if (until === "turn" || until === "battle") return { op: "negateOwnSkill", until };
      return until === "game" ? { op: "negateOwnSkill" } : { op: "note", text: `negate: this skill cannot be negated ${DURATION_IN_WORDS[until].trim()}` };
  }
}

/**
 * The `modifyAttr` primitive, read as the spelling it stands for
 * (docs/arena-ruleset-spec.md §2.5-1/§2.5-3, #275) — the same precedent
 * `negateAs` and `costModifierAs` set. `subject` says which of the three
 * this call is about; the six card attributes and the two subjects' own
 * attributes each read the exactly one field their existing op needs and
 * refuse by name (a `note`) when the call leaves it out, the same
 * discipline `negateAs`'s "kind"/"keyword" branches keep. `power`,
 * `comboPower` and the four list attributes (`gains`) are untouched here —
 * the interpreter's own `modifyAttr` case and `collectStatics`/`permanents`
 * already read those, which is what this function must not duplicate.
 */
export function modifyAttrAs(op: Op): Op {
  if (op.op !== "modifyAttr") return op;
  const subject = op.subject ?? "card";
  if (subject === "player") {
    if (op.attr !== "energyMarkers") return { op: "note", text: `modifyAttr: no player attribute named ${JSON.stringify(op.attr)}` };
    return { op: "energyMarker", side: op.side ?? "you", n: op.amount ?? 0 };
  }
  if (subject === "battle") {
    if (op.attr !== "guard") return { op: "note", text: `modifyAttr: no battle attribute named ${JSON.stringify(op.attr)}` };
    return op.target ? { op: "redirectAttack", target: op.target } : { op: "note", text: "modifyAttr: no target named for the battle's guard" };
  }
  const target: Ref = op.target ?? { sel: { special: "self" } };
  switch (op.attr) {
    case "mode":
      return op.mode ? { op: "switchMode", target, mode: op.mode } : { op: "note", text: "modifyAttr: no mode named" };
    case "markers":
      return op.sign === "remove" ? { op: "removeMarker", target, n: op.amount ?? 0 } : { op: "addMarker", target, n: op.amount ?? 0 };
    case "keywords":
      return op.keyword && op.until ? { op: "grant", target, keyword: op.keyword, until: op.until } : { op: "note", text: "modifyAttr: no keyword or duration named" };
    case "hidden":
      return { op: "hidden", target, hidden: op.flag ?? true };
    case "faceUp":
      return { op: "faceUp", target, faceUp: op.flag ?? true };
    case "flipped":
      return { op: "flip", target };
    default:
      return op;
  }
}

/** Every key of `o` is one of `keys`: a lowered shape is read back only when it carries nothing the spelling would drop. */
const only = (o: object, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k));

/**
 * The `replace` primitive, read as the spelling it stands for (#137) — the
 * precedent `negateAs`, `costModifierAs` and `modifyAttrAs` set. The attack in
 * progress and the [Counter] being answered are two moments a replacement
 * stands in front of only with *nothing*: `negateAttack` and `negateCounter`
 * lower to `replace(event: attack | counter, with: {})`, and this reads that
 * back, so their own cases stay the one reading of either on both engines and
 * no collector of standing offers ever mistakes one for a departure. Anything
 * else said about those two moments — a program in their place, a target, a
 * narrowing — is a `note`: unread beats wrongly read. Every other `replace` —
 * a departure, a KO, a life card, the play being resolved — is the primitive's
 * own business and comes back as it was.
 */
export function replaceAs(op: Op): Op {
  if (op.op === "replace" && op.event === "play") return resolvingPlayOf(op) ?? op;
  if (op.op !== "replace" || (op.event !== "attack" && op.event !== "counter")) return op;
  if (op.with.length || !only(op, ["op", "event", "with"])) return { op: "note", text: `replace: ${op.event === "attack" ? "the attack" : "the counter being answered"} can only be replaced by nothing` };
  return op.event === "attack" ? { op: "negateAttack" } : { op: "negateCounter" };
}

/** `[resolving]`, exactly: the card being played and nothing said about it. */
const isResolving = (ref: unknown): boolean => {
  const sel = (ref as { sel?: Record<string, unknown> } | undefined)?.sel;
  return !!sel && only(sel, ["special"]) && sel.special === "resolving";
};

/**
 * The play being resolved, replaced (9-6, #137): the two shapes `ops.rules`'s
 * `resolvingPlay` lowers to, read back as that op so its own case — the one
 * that hands `replaceResolvingPlay` its move, or marks the arrival rested or
 * negated for the turn — stays the one reading on both engines.
 *
 * - `with: { moveTo(target: [resolving], to, position?) }` is the play not
 *   happening, the card going elsewhere: `resolvingPlay(instead: to)`.
 * - `with: { play(target: [resolving], mode?: rest, negated?: turn) }` is the
 *   same play in another manner: `resolvingPlay(mode, negated: true)`.
 *
 * Anything else in a play's place is the primitive's own business (`null`).
 */
function resolvingPlayOf(op: OpOf<"replace">): Op | null {
  if (!only(op, ["op", "event", "with"]) || op.with.length !== 1) return null;
  const step = op.with[0];
  if (step.op === "moveTo" && only(step, ["op", "target", "to", "position"]) && isResolving(step.target))
    return { op: "resolvingPlay", instead: step.to, ...(step.position ? { position: step.position } : {}) };
  if (step.op === "play" && only(step, ["op", "target", "mode", "negated"]) && isResolving(step.target) && step.mode !== "active" && step.negated !== "game" && (step.mode || step.negated))
    return { op: "resolvingPlay", ...(step.mode ? { mode: step.mode } : {}), ...(step.negated ? { negated: true } : {}) };
  return null;
}

/**
 * The `moveTo` primitive, read as the spelling it stands for (#137). `draw`,
 * `damage` and `addLife` each lower to one move of the top `n` cards of one
 * pile — `TOP $n IN $side.deck` to the hand with the cause `draw`, `TOP $n IN
 * $side.life` to the hand with the cause `damage`, `TOP $n IN $side.deck` to
 * life — and this reads exactly those three shapes back. Their own cases are
 * the reading that matters: a draw from an empty deck (2-2), damage's own
 * moments (21-3) and "both players" (one pile each, not the top `n` of the two
 * together) are what the cases know and a plain move does not.
 *
 * The count is the call's own `amount` (`rulesets/holes.ts`'s `count` slot):
 * a number, or an expression — X, "until you have 4 cards in your hand" —
 * that only one of these three cases evaluates. A move whose top-level
 * selector carries an expression in any other shape is a `note`, because no
 * selector counts by one (`resolveSelector` slices by a number).
 */
export function moveAs(op: Op): Op {
  if (op.op !== "moveTo" || !("sel" in op.target)) return op;
  const sel = op.target.sel;
  const counted = typeof sel.take !== "number" && sel.take !== undefined;
  if (only(op, ["op", "target", "to", "cause"]) && only(sel, ["take", "side", "area"]) && sel.take !== undefined && sel.side) {
    const n = sel.take as unknown as Amount;
    if (op.cause === "draw" && sel.area === "deck" && op.to === "hand") return { op: "draw", n, side: sel.side };
    if (op.cause === "damage" && sel.area === "life" && op.to === "hand") return { op: "damage", n, side: sel.side };
    if (op.cause === undefined && sel.area === "deck" && op.to === "life") return { op: "addLife", n, side: sel.side };
    // `lifeDownTo` (21-3-2): the top `life(side) - n` of a life, to the hand,
    // with no cause — losing life this way is not damage (1-13-2). The case
    // reads "both players" one pile at a time, which the count cannot.
    const down = lifeDownCount(n, sel.side);
    if (op.cause === undefined && sel.area === "life" && op.to === "hand" && down !== null) return { op: "lifeDownTo", n: down, side: sel.side };
  }
  return counted ? { op: "note", text: "moveTo: a selector counts by a number" } : op;
}

/** `life(side) - n`, exactly, as `lifeDownTo` lowers its count: the `n`, or `null` for any other expression. */
function lifeDownCount(n: Amount, side: Side): number | null {
  if (typeof n !== "object" || !("plus" in n) || typeof n.plus[1] !== "number") return null;
  const life = n.plus[0];
  if (typeof life !== "object" || !("life" in life) || !only(life, ["life"]) || life.life !== side) return null;
  return -n.plus[1];
}

/**
 * The `reveal` primitive, read as the spelling it stands for (#137). `look` is
 * a reveal to the master alone (20-11), and lowers to one of three shapes —
 * `TOP $n IN $side.deck`, `BOTTOM $n IN $side.deck`, or a whole area that is
 * not the deck — each read back here, so `look`'s own case stays the one
 * reading: it evaluates the count (an expression, often), and it takes one
 * player's pile even for "both". Its count is not read for a whole area, so
 * the call's own is lost in the lowering and given back as the area's size.
 * Any other reveal — to both players, or of cards chosen some other way —
 * comes back as it was.
 */
export function revealAs(op: Op): Op {
  if (op.op !== "reveal" || op.audience !== "you" || !only(op, ["op", "sel", "as", "audience"])) return op;
  const sel = op.sel as Selector & Record<string, unknown>;
  if (!sel.side || !sel.area) return op;
  if (sel.area === "deck" && sel.take !== undefined && only(sel, ["take", "side", "area", "fromEnd"]))
    return { op: "look", n: sel.take as unknown as Amount, as: op.as, side: sel.side, ...(sel.fromEnd ? { from: "bottom" as const } : {}) };
  if (sel.area !== "deck" && only(sel, ["side", "area"])) return { op: "look", n: { count: { side: sel.side, area: sel.area } }, as: op.as, side: sel.side, area: sel.area };
  return op;
}

/** One lowered step or a run of them, read back as the one step they stand for: the op, and how many steps it takes the place of. */
export interface Folded {
  op: Op;
  span: number;
}

/**
 * `comboFrom`'s lowering, read back as the one step it stands for (5-7, #137):
 * `moveTo(target: $target, to: combo, reveal: true, cause: combo)`, and — when
 * the call said `negated` — `negate(target: $target, what: skills)` right
 * after it. `comboFrom`'s own case is what checks 5-7-2 (a battle on its
 * master's side) and pends `youCombo`/`opponentCombos`, one card at a time,
 * negating only the cards it moved; a plain move with the cause `combo`
 * neither checks nor pends. `null` when the step at `ip` is not that move.
 */
export function comboFromAs(ops: readonly Op[], ip: number): Folded | null {
  const move = ops[ip];
  if (move?.op !== "moveTo" || move.cause !== "combo" || move.to !== "combo" || move.reveal !== true || !only(move, ["op", "target", "to", "reveal", "cause"])) return null;
  const next = ops[ip + 1];
  const negated = next?.op === "negate" && next.what === "skills" && only(next, ["op", "target", "what"]) && JSON.stringify(next.target) === JSON.stringify(move.target);
  return { op: { op: "comboFrom", target: move.target, ...(negated ? { negated: true } : {}) }, span: negated ? 2 : 1 };
}

/** The name `ops.rules`'s `discard` binds its choice to, read back below. */
export const DISCARDED = "discarded";

/**
 * `discard`'s two steps, read back as the one step they stand for (#137). The
 * macro lowers to `choose(sel: $n IN $side.hand, as: "discarded", chooser:
 * $side)` and `moveTo(target: $discarded, to: $to, reveal: true)` — 20-7's
 * "the owner of the hand chooses, and the cards go" — and `discard`'s own case
 * is what asks each player in turn with the prompt that names the count, and
 * evaluates an X there. This is the one read-back that spans two steps, so
 * `stepScript` calls it on the program rather than on one op: the pair at `ip`
 * comes back as the `discard` it stands for, or `null` when it is not that
 * pair exactly. (`comboFromAs` above is the other.)
 */
export function discardAs(ops: readonly Op[], ip: number): Folded | null {
  const choose = ops[ip];
  const move = ops[ip + 1];
  if (choose?.op !== "choose" || move?.op !== "moveTo") return null;
  if (choose.as !== DISCARDED || !only(choose, ["op", "sel", "as", "chooser"]) || !only(choose.sel, ["count", "side", "area"])) return null;
  if (choose.sel.area !== "hand" || !choose.sel.side || choose.sel.side !== choose.chooser || choose.sel.count === undefined) return null;
  if (!only(move, ["op", "target", "to", "reveal"]) || move.reveal !== true || (move.to !== "drop" && move.to !== "warp")) return null;
  if (!("var" in move.target) || move.target.var !== DISCARDED || move.target.minus !== undefined) return null;
  return { op: { op: "discard", n: choose.sel.count as unknown as Amount, side: choose.sel.side, ...(move.to === "warp" ? { to: "warp" as const } : {}) }, span: 2 };
}

export function validateProgram(ops: unknown, depth = 0, xBound = false): ops is Op[] {
  return programProblem(ops, depth, xBound) === null;
}

/**
 * Why a program is not one the engine can run, naming the step and the field
 * (3 Oct 2026) — or `null` when it is. `validateProgram` is this answered yes
 * or no; the workbench's Save and every other writer say the reason.
 *
 * Every key is checked, not only the ones a step needs: BT31-132's stored rule
 * said `"from": "looked"` where a selector says `fromVar`, the interpreter
 * ignored the word it did not know, and the choice was offered from the
 * Battle Area instead of the cards looked at. A misspelt field is refused by
 * name rather than dropped, on a step, a condition, a selector, a ref, an
 * amount and a filter alike.
 */
export function programProblem(ops: unknown, depth = 0, xBound = false, at = "ops"): string | null {
  if (!Array.isArray(ops)) return `${at} is not a list of steps`;
  if (depth > 4) return `${at} is nested too deeply`;
  // 20-5: X is legal only once something has bound it — the price, said by
  // `CostRecord.x` and passed in as `xBound`, or a `choose` earlier in this
  // same program carrying `bindX`. A step is checked against what is bound
  // *before* it, so "draw X, then choose X cards" is refused and "choose any
  // number of cards, then draw X" is not.
  let bound = xBound;
  const chosen = new Set<string>();
  for (const [i, raw] of ops.entries()) {
    const here = `${at}[${i}]`;
    if (!isRecord(raw)) return `${here} is not a step`;
    const o = raw;
    const spec = typeof o.op === "string" ? OP_SCHEMA[o.op as Op["op"]] : undefined;
    if (!spec) return `${here}: the engine has no step called ${JSON.stringify(o.op)}`;
    const step = `${here} (${o.op as string})`;
    const stray = unknownKey(o, ["op", ...spec.fields.map((f) => f.name)]);
    if (stray) return `${step} has no field ${JSON.stringify(stray)}${hintFor(stray, spec.fields)}`;
    for (const f of spec.fields) {
      const bad = fieldProblem(f, o[f.name], depth, bound, `${step}.${f.name}`);
      if (bad) return bad;
    }
    if (o.op === "permit" && o.what === "unionLine" && (typeof o.line !== "string" || !o.line || !isRecord(o.price))) return `${step}: a granted Union line needs its typed skill price; regenerate the grant`;
    if (o.op === "permit" && o.what === "unionLine") {
      if (!["Fusion", "Potara"].includes(String(o.unionVariant))) return `${step}: missing typed Union grant identity; regenerate rules and rebuild saved matches/exports`;
      if (o.unionVariant === "Potara") {
        const problem = potaraMaterialsProblem((o.price as {potara?: unknown}).potara);
        if (problem) return `${step}: ${problem}`;
      }
      if (o.unionVariant === "Fusion") {
        const problem = fusionMaterialsProblem((o.price as { fusion?: unknown }).fusion);
        if (problem) return `${step}: ${problem}`;
      }
    }
    // 12-2-4: Desire and the optional hand-Extra choice are two bounded
    // readings. Mixing their fields would silently change the old cost gate.
    if (o.op === "invokeSkill") {
      const desire = typeof o.trait === "string" && o.maxCost === "currentEnergy" && o.sel === undefined && o.skillKind === "activate:main";
      // #979: the Desire cards that name colours say it as a one-card hand
      // selector with the energy bound, for the Main line alone.
      const selected = o.trait === undefined && o.maxCost === undefined && isRecord(o.sel)
        && o.sel.side === "you" && o.sel.area === "hand" && o.sel.count === 1
        && (o.skillKind === "activate:main/battle"
          ? o.sel.upTo === true
          : o.skillKind === "activate:main" && isRecord(o.sel.filter) && o.sel.filter.costAtMostEnergy === true);
      if (!desire && !selected) return `${step}: use either Desire's trait/current-energy Main line, a one-card hand selector bounded by current energy for a Main line, or an optional one-card hand selector for a Main/Battle line`;
    }
    // A marker loss is read at one moment only — 13-5-2's, an attack on a
    // Unison — so `event: marker` names it and `by: attack` belongs to it
    // alone: either without the other is a moment nothing reads.
    if (o.op === "replace" && (o.event === "marker") !== (o.by === "attack")) return `${step}: "event": "marker" and "by": "attack" are only ever written together`;
    // 20-14-1: a tax is charged where the action is taken, and only the
    // attack, a declared play, a skill's switch of energy to Active Mode and
    // a skill activation (#677: [Activate], [Auto] and [Counter]) charge one —
    // a price on any other action would be a rule that silently stopped
    // forbidding anything.
    if (o.op === "forbid" && o.unlessPay !== undefined && (!TAXABLE.has(o.what as ForbiddenAction) || !(o.unlessPay as unknown[]).length || o.unless !== undefined))
      return `${step}: only an attack, a declared play, a switch of energy to Active Mode or a skill activation is taxed with "unlessPay", and never beside "unless"`;
    if (o.op === "forbid" && o.attackTarget !== undefined && o.what !== "attack") return `${step}: "attackTarget" only qualifies an attack declaration`;
    if (o.op === "forbid" && o.attackOnly !== undefined && (o.what !== "attack" || o.attackTarget !== undefined)) return `${step}: "attackOnly" only qualifies an attack declaration, and not beside "attackTarget"`;
    if (o.op === "choose" && o.bindX === true) bound = true;
    if (o.op === "declare") bound = true;
    // #970: "not these cards" names choices already made, in this program.
    if (o.op === "choose") {
      const barred = isRecord(o.sel) && Array.isArray(o.sel.notIn) ? o.sel.notIn : [];
      const unbound = barred.find((n) => !chosen.has(n as string));
      if (unbound !== undefined) return `${step}.sel.notIn names ${JSON.stringify(unbound)}, which no earlier choose of this program binds`;
      if (typeof o.as === "string") chosen.add(o.as);
    }
    const stray2 = strayBound(o, step);
    if (stray2) return stray2;
  }
  return null;
}

/**
 * The steps that stop and ask somebody something. `discard` is one of them: it
 * is rewritten by `stepScript` into a `choose` the owner answers and a move.
 */
const PROMPTING_OPS = new Set<Op["op"]>(["choose", "chooseMode", "may", "look", "discard", "negateChosenKeyword"]);

/**
 * Does this program stop to ask a question, anywhere inside it? Read by
 * `replacementFor` (#107), which leaves an asking substitute unapplied at the
 * 46 call sites that cannot wait for the answer, and by the two that can, to
 * know whether to run it inline or as a frame on the flow.
 */
export function asksAQuestion(ops: unknown): boolean {
  if (!Array.isArray(ops)) return false;
  return ops.some((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const o = raw as Record<string, unknown>;
    if (typeof o.op === "string" && PROMPTING_OPS.has(o.op as Op["op"])) return true;
    // A reveal to the master alone is the `look` it lowers from (#137).
    if (o.op === "reveal" && o.audience === "you") return true;
    // A keyword picked as the step resolves is the `negateChosenKeyword` it stands for.
    if (o.op === "negate" && o.what === "keyword" && o.chosen === true) return true;
    if (asksAQuestion(o.ops) || asksAQuestion(o.then) || asksAQuestion(o.else) || asksAQuestion(o.with)) return true;
    return Array.isArray(o.modes) && o.modes.some((m) => asksAQuestion((m as { ops?: unknown }).ops));
  });
}

/**
 * Does this amount read an `X` that nothing has bound? The expression tree is
 * walked because `plus` nests one amount inside another; every other shape
 * holds selectors and refs, which cannot carry an amount.
 */
function readsUnboundX(v: unknown, xBound: boolean): boolean {
  if (xBound || typeof v !== "object" || v === null) return false;
  const a = v as Record<string, unknown>;
  if (a.x === true) return true;
  return Array.isArray(a.plus) && readsUnboundX(a.plus[0], xBound);
}

/**
 * A `per` divides a reading into whole steps (2 Oct 2026), so it is a whole
 * number of at least 2 — 1 says nothing a missing `per` doesn't, and 0 or a
 * fraction is a division the rule manual's rounding has no answer for. Walked
 * through `plus` the same way `readsUnboundX` is.
 */
function perHolds(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return true;
  const a = v as Record<string, unknown>;
  if (Array.isArray(a.plus)) return perHolds(a.plus[0]);
  if (a.per === undefined) return true;
  return ("count" in a || "markers" in a || "life" in a) && Number.isInteger(a.per) && (a.per as number) >= 2;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The first key of `o` not among `allowed`, if any. A key holding `undefined` is no key at all, the way JSON drops it. */
function unknownKey(o: Record<string, unknown>, allowed: readonly string[]): string | null {
  return Object.keys(o).find((k) => o[k] !== undefined && !allowed.includes(k)) ?? null;
}

/**
 * The words that have been written for a field that is called something else.
 * `from` is BT31-132's; the rest are the same mistake's neighbours. Only a
 * hint — the refusal names the stray key whether or not one is known.
 */
const FIELD_ALIASES: Record<string, string> = { from: "fromVar", var: "fromVar", zone: "area", zones: "areas", upto: "upTo", player: "side", owner: "side", amount: "n" };

function hintFor(stray: string, known: readonly (string | OpField)[]): string {
  const names = known.map((k) => (typeof k === "string" ? k : k.name));
  const alias = FIELD_ALIASES[stray] ?? FIELD_ALIASES[stray.toLowerCase()];
  const near = alias && names.includes(alias) ? alias : names.find((n) => n.toLowerCase() === stray.toLowerCase());
  return near ? ` — did you mean ${JSON.stringify(near)}?` : ` (it takes ${names.map((n) => JSON.stringify(n)).join(", ")})`;
}

/**
 * Every key a `Selector` may carry. `satisfies` keeps it the type's own list:
 * a field added to `Selector` and not here fails the typecheck, and a key
 * written here that the type lacks does too.
 */
const SELECTOR_KEYS = {
  side: 1,
  area: 1,
  areas: 1,
  areaSides: 1,
  filter: 1,
  special: 1,
  mode: 1,
  hidden: 1,
  fromVar: 1,
  underHost: 1,
  count: 1,
  upTo: 1,
  minCount: 1,
  take: 1,
  fromEnd: 1,
  ignoreBarrier: 1,
  notInBattle: 1,
  atRandom: 1,
  ownedByOpponent: 1,
  notSelf: 1,
  differentNames: 1,
  differentCharacters: 1,
  eachUnionName: 1,
  distinctColors: 1,
  notIn: 1,
  sumAtMost: 1,
  printed: 1,
} as const satisfies Record<keyof Selector, 1>;
const SELECTOR_KEY_NAMES = Object.keys(SELECTOR_KEYS);
const NOT_SELF = ["card", "copies", "name"] as const satisfies readonly NonNullable<Selector["notSelf"]>[];
const SELECTOR_MODES = ["active", "rest"] as const satisfies readonly NonNullable<Selector["mode"]>[];

/** A `DEFINE KEYWORD` body's parameter (`$colors`, #155): filled in when the keyword is expanded, so any value may stand there until then. */
const isHoleValue = (v: unknown): boolean => isRecord(v) && ((typeof v.hole === "string" && Object.keys(v).length === 1) || (isRecord(v.neg) && typeof v.neg.hole === "string"));
const isCount = (v: unknown): boolean => typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * Why a selector is not one, or `null`. Every field is checked by its type and
 * an unknown one is refused by name — the engine reads a selector by its keys,
 * so a key it does not know is a measure silently dropped, which always widens
 * the choice (ground rule 5).
 */
export function selectorProblem(v: unknown, at = "sel", depth = 0): string | null {
  if (!isRecord(v)) return `${at} is not a selector`;
  if (depth > 4) return `${at} is nested too deeply`;
  const stray = unknownKey(v, SELECTOR_KEY_NAMES);
  if (stray) return `${at} has no field ${JSON.stringify(stray)}${hintFor(stray, SELECTOR_KEY_NAMES)}`;
  const wrong = (field: string, what: string) => `${at}.${field} is ${what}, not ${JSON.stringify(v[field])}`;
  const is = (x: unknown, list: readonly string[]) => typeof x === "string" && list.includes(x);
  if (v.special !== undefined && !is(v.special, SPECIAL_TARGETS)) return wrong("special", `one of ${SPECIAL_TARGETS.join(", ")}`);
  if (v.side !== undefined && !is(v.side, SIDES)) return wrong("side", "you, opponent or both");
  if (v.area !== undefined && !is(v.area, AREAS)) return wrong("area", "an area");
  if (v.areas !== undefined && !(Array.isArray(v.areas) && v.areas.length > 0 && v.areas.every((a) => is(a, AREAS)))) return wrong("areas", "a list of areas");
  // #930: an owner per area ("your Drop or your opponent's Battle Area"), one for each of `areas`, in place of `side`.
  if (v.areaSides !== undefined) {
    if (!(Array.isArray(v.areaSides) && v.areaSides.every((x) => x === "you" || x === "opponent"))) return wrong("areaSides", "a list of you or opponent");
    if (!Array.isArray(v.areas) || v.areas.length !== v.areaSides.length || v.side !== undefined) return `${at}.areaSides needs areas of the same length and no side`;
  }
  if (v.mode !== undefined && !is(v.mode, SELECTOR_MODES)) return wrong("mode", "active or rest");
  if (v.notSelf !== undefined && !is(v.notSelf, NOT_SELF)) return wrong("notSelf", "card, copies or name");
  if (v.notInBattle !== undefined && v.notInBattle !== true) return wrong("notInBattle", "true");
  if (v.atRandom !== undefined && v.atRandom !== true) return wrong("atRandom", "true");
  if (v.ownedByOpponent !== undefined && v.ownedByOpponent !== true) return wrong("ownedByOpponent", "true");
  if (v.fromVar !== undefined && typeof v.fromVar !== "string") return wrong("fromVar", "a bound name");
  // A printed count is a whole number; a lowered one — `draw(n: X)` becomes
  // `TOP X IN you.deck` (`rulesets/*.rules`) — is the amount it was handed,
  // which the step that wrote it has already checked for an unbound X.
  for (const k of ["count", "take"]) {
    if (v[k] === undefined || isCount(v[k])) continue;
    if (!isRecord(v[k]) || amountProblem(v[k], true, `${at}.${k}`)) return wrong(k, "a whole number or an amount");
  }
  for (const k of ["upTo", "fromEnd", "ignoreBarrier", "hidden"]) if (v[k] !== undefined && typeof v[k] !== "boolean") return wrong(k, "true or false");
  if (v.minCount !== undefined) {
    if (!isCount(v.minCount)) return wrong("minCount", "a non-negative whole number");
    if (!isCount(v.count) || (v.minCount as number) > (v.count as number) || v.upTo || v.take !== undefined || v.special !== undefined) return `${at}.minCount requires count >= minCount and no upTo, take or special`;
  }
  for (const k of ["differentNames", "differentCharacters", "distinctColors", "printed", "eachUnionName"]) if (v[k] !== undefined && v[k] !== true) return wrong(k, "true or left out");
  // #970: the variables of earlier choices this one never repeats. Where they
  // must be bound, and that only a choose may carry them, is `programProblem`'s.
  if (v.notIn !== undefined && !(Array.isArray(v.notIn) && v.notIn.length > 0 && v.notIn.every((n) => typeof n === "string" && n !== ""))) return wrong("notIn", "a list of bound names");
  // `TOTAL energyCost <= 5` (BT3-036): a measure and an amount, and a bound
  // on a set — so never on a special, which names one card. Where it may
  // stand at all is `strayBound`'s question.
  if (v.sumAtMost !== undefined) {
    const sum = v.sumAtMost;
    if (!isRecord(sum)) return wrong("sumAtMost", "{ attr, total }");
    const strayed = unknownKey(sum, ["attr", "total"]);
    if (strayed) return `${at}.sumAtMost has no field ${JSON.stringify(strayed)}${hintFor(strayed, ["attr", "total"])}`;
    if (!(AMOUNT_ATTRS as readonly unknown[]).includes(sum.attr)) return `${at}.sumAtMost.attr is one of ${AMOUNT_ATTRS.join(", ")}, not ${JSON.stringify(sum.attr)}`;
    if (sum.total === undefined) return `${at}.sumAtMost.total is required`;
    const bad = amountProblem(sum.total, true, `${at}.sumAtMost.total`);
    if (bad) return bad;
    if (v.special !== undefined) return `${at}.sumAtMost bounds a set of cards, and ${JSON.stringify(v.special)} names one`;
  }
  if (v.underHost !== undefined) {
    const bad = selectorProblem(v.underHost, `${at}.underHost`, depth + 1);
    if (bad) return bad;
  }
  if (v.filter !== undefined) return filterProblem(v.filter, `${at}.filter`);
  return null;
}

const CARD_TYPES = ["LEADER", "BATTLE", "EXTRA", "UNISON"] as const satisfies readonly NonNullable<CardFilter["type"]>[];
const POWER_REL_OF: readonly unknown[] = ["self", "chosen"] satisfies NonNullable<CardFilter["powerRel"]>["of"][];
const POWER_REL_CMP: readonly unknown[] = ["<=", "<", ">=", ">"] satisfies NonNullable<CardFilter["powerRel"]>["cmp"][];

function filterValueHolds(kind: FilterFieldType, x: unknown): boolean {
  switch (kind) {
    case "strings":
    case "keywords":
      return Array.isArray(x) && x.every((y) => typeof y === "string");
    case "colors":
      return Array.isArray(x) && x.every((y) => typeof y === "string" && (COLORS as readonly string[]).includes(y));
    case "cardType":
      return x === null || (typeof x === "string" && (CARD_TYPES as readonly string[]).includes(x));
    case "skillKind":
      return x === null || (typeof x === "string" && (SKILL_KIND_PREFIXES as readonly string[]).includes(x));
    case "boolean":
      return typeof x === "boolean";
    case "tri":
      return x === null || typeof x === "boolean";
    case "number":
      return x === null || (typeof x === "number" && Number.isFinite(x));
    case "variable":
      return x === null || (typeof x === "string" && /^[A-Za-z_]\w*$/.test(x));
    case "powerRel":
      return x === null || (isRecord(x) && !unknownKey(x, ["of", "cmp", "var"]) && POWER_REL_OF.includes(x.of) && POWER_REL_CMP.includes(x.cmp) && (x.var === undefined || typeof x.var === "string"));
    case "filters":
      return Array.isArray(x) && x.length >= 2 && x.every((y) => filterProblem(y) === null);
  }
}

/**
 * Why a filter is not a `CardFilter`, or `null`. A filter may be **partial** —
 * Claude writes only the measures it means, and older rows were stored that
 * way — and the rest are read at rest (`completeFilter`). What it may not do
 * is name a measure that does not exist, or give one a value of the wrong
 * kind: either is a measure the predicate never applies.
 */
export function filterProblem(v: unknown, at = "filter"): string | null {
  if (!isRecord(v)) return `${at} is not a filter`;
  const names = Object.keys(FILTER_FIELDS);
  const stray = unknownKey(v, names);
  if (stray) return `${at} has no measure ${JSON.stringify(stray)}${hintFor(stray, names)}`;
  for (const [name, kind] of Object.entries(FILTER_FIELDS) as [keyof CardFilter, FilterFieldType][]) {
    const x = v[name];
    if (x === undefined || isHoleValue(x)) continue;
    if (!filterValueHolds(kind, x)) return `${at}.${name} cannot be ${JSON.stringify(x)}`;
  }
  return null;
}

/** A filter with every measure it leaves out at rest — the shape the engine, the printer and the workbench all read. */
export function completeFilter(f: Partial<CardFilter>): CardFilter {
  return { ...emptyFilter(), ...f };
}

/** The fields that hold a `CardFilter`: a selector's own, and every op or condition field the schema types `filter`. */
const FILTER_KEYS = new Set(["filter", ...[...Object.values(OP_SCHEMA), ...Object.values(COND_SCHEMA)].flatMap((spec) => spec.fields.filter((f) => f.type === "filter").map((f) => f.name))]);

/**
 * The same value with every filter in it made whole (`completeFilter`). What a
 * rule is stored as: a partial filter is a shape Claude writes and older rows
 * hold, and every reader since 3 Oct 2026 tolerates one, but a row that says
 * each measure is one no reader has to.
 */
export function completeFilters<T>(v: T): T {
  if (Array.isArray(v)) return v.map(completeFilters) as T;
  if (!isRecord(v)) return v;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, FILTER_KEYS.has(k) && isRecord(x) && !isHoleValue(x) ? completeFilter(x as Partial<CardFilter>) : completeFilters(x)])) as T;
}

const REF_KEYS = ["var", "minus", "sel"];

function refProblem(v: unknown, at: string): string | null {
  if (!isRecord(v)) return `${at} is not a card reference`;
  const stray = unknownKey(v, REF_KEYS);
  if (stray) return `${at} has no field ${JSON.stringify(stray)}${hintFor(stray, REF_KEYS)}`;
  // A ref is a bound name or a selector — a bare selector written where a
  // ref belongs ({"special":"self"} for {"sel":{"special":"self"}}) is the
  // mistake Claude makes most, and read as a ref it threw while being
  // described. Refused here, by name.
  if (typeof v.var === "string") {
    if (v.sel !== undefined) return `${at} is a bound name or a selector, not both`;
    return v.minus === undefined || typeof v.minus === "string" ? null : `${at}.minus is a bound name`;
  }
  if (v.var !== undefined) return `${at}.var is a bound name`;
  if (v.minus !== undefined) return `${at}.minus belongs to a bound name`;
  if (v.sel === undefined) return `${at} is neither a bound name ("var") nor a selector ("sel")`;
  return selectorProblem(v.sel, `${at}.sel`);
}

const AMOUNT_KEYS = ["var", "count", "per", "times", "sumPower", "handUpTo", "markers", "x", "life", "attr", "name", "sumOf", "plus"];

function amountProblem(v: unknown, xBound: boolean, at: string): string | null {
  if (typeof v === "number") return Number.isFinite(v) ? null : `${at} is not a number`;
  if (!isRecord(v)) return `${at} is not an amount`;
  if (isHoleValue(v)) return null;
  const stray = unknownKey(v, AMOUNT_KEYS);
  if (stray) return `${at} has no field ${JSON.stringify(stray)}${hintFor(stray, AMOUNT_KEYS)}`;
  if (readsUnboundX(v, xBound)) return `${at} says X, and nothing before it binds one — X may only be used when the price charges an X or its own choice binds one`;
  if (!perHolds(v)) return `${at}.per is a whole number of at least 2, on a count, markers or life`;
  for (const k of ["count", "markers", "sumOf"]) {
    if (v[k] === undefined) continue;
    const bad = selectorProblem(v[k], `${at}.${k}`);
    if (bad) return bad;
  }
  if (v.attr !== undefined) {
    const bad = refProblem(v.attr, `${at}.attr`);
    if (bad) return bad;
  }
  if (v.plus !== undefined) {
    if (!Array.isArray(v.plus) || v.plus.length !== 2 || typeof v.plus[1] !== "number") return `${at}.plus is an amount and a printed number`;
    return amountProblem(v.plus[0], xBound, `${at}.plus[0]`);
  }
  return null;
}

/**
 * Why a summed bound (`Selector.sumAtMost`) is written where nothing reads it,
 * or `null`. Only a `choose` reads it, and only on its own selector —
 * `resolveSelector` does not — so on a `ko`'s target, inside a `count`, under
 * a host or beside a `sumTo` it would be every card the selector describes,
 * the bound read as nothing (BT3-036). Nested programs are walked too: a
 * `choose` inside one is still a choose.
 */
function strayBound(v: unknown, at: string, top = true): string | null {
  if (Array.isArray(v)) {
    for (const x of v) {
      const bad = strayBound(x, at, false);
      if (bad) return bad;
    }
    return null;
  }
  if (!isRecord(v)) return null;
  if (!top && v.sumAtMost !== undefined) return `${at}: "sumAtMost" (TOTAL … <=) bounds a choice, so only a choose's own selector may carry it — anywhere else it is read as every card`;
  if (!top && v.minCount !== undefined) return `${at}: "minCount" bounds a choice, so only a choose's own selector may carry it`;
  if (!top && v.notIn !== undefined) return `${at}: "notIn" (EXCEPT $…) excludes the cards earlier choices bound, so only a choose's own selector may carry it`;
  const rest = (o: Record<string, unknown>, skip: string) => Object.entries(o).filter(([k]) => k !== skip).map(([, x]) => x);
  if (v.op === "choose" && isRecord(v.sel)) {
    if (v.sel.sumAtMost !== undefined && v.sumTo !== undefined) return `${at}: a choice adds up to exactly "sumTo" or stays under "sumAtMost", not both`;
    if (v.sel.minCount !== undefined && (v.atMost !== undefined || v.sumTo !== undefined || v.namedSet || v.sel.sumAtMost !== undefined)) return `${at}: minCount cannot combine with another choice bound`;
    if (v.exactly !== undefined && (v.atMost !== undefined || v.sumTo !== undefined || v.namedSet || v.sel.sumAtMost !== undefined || v.sel.minCount !== undefined || v.sel.upTo)) return `${at}: "exactly" is a count of its own and cannot combine with another choice bound or "up to"`;
    return strayBound(rest(v.sel, "sumAtMost"), at, false) ?? strayBound(rest(v, "sel"), at, false);
  }
  return strayBound(Object.values(v), at, false);
}


/**
 * A condition's shape, from `COND_SCHEMA`. Until this existed the validator
 * asked only for a `kind`, so a condition missing the selector it counts was
 * stored happily and threw when a game read it.
 */
export function condProblem(v: unknown, depth = 0, xBound = false, at = "cond"): string | null {
  if (!isRecord(v)) return `${at} is not a condition`;
  if (depth > 4) return `${at} is nested too deeply`;
  const spec = typeof v.kind === "string" ? COND_SCHEMA[v.kind as Cond["kind"]] : undefined;
  if (!spec) return `${at}: the engine has no condition called ${JSON.stringify(v.kind)}`;
  const here = `${at} (${v.kind as string})`;
  const stray = unknownKey(v, ["kind", ...spec.fields.map((f) => f.name)]);
  if (stray) return `${here} has no field ${JSON.stringify(stray)}${hintFor(stray, spec.fields)}`;
  for (const f of spec.fields) {
    const bad = fieldProblem(f, v[f.name], depth, xBound, `${here}.${f.name}`);
    if (bad) return bad;
  }
  // A condition never chooses, so a summed bound in one is read as nothing.
  return strayBound(v, here);
}

function fieldProblem(f: OpField, v: unknown, depth: number, xBound: boolean, at: string): string | null {
  if (v === undefined) return f.required ? `${at} is required` : null;
  if (v === null) return f.nullable ? null : `${at} cannot be null`;
  const type = f.type;
  const no = (what: string) => `${at} is ${what}, not ${JSON.stringify(v)}`;
  if (typeof type === "object") {
    if ("enum" in type) return typeof v === "string" && type.enum.includes(v) ? null : no(`one of ${type.enum.join(", ")}`);
    const ok = Array.isArray(v) && v.every((x) => (type.list === "string" ? typeof x === "string" : typeof x === "string" && type.list.enum.includes(x)));
    return ok ? null : no(type.list === "string" ? "a list of words" : `a list of ${type.list.enum.join(", ")}`);
  }
  switch (type) {
    case "amount":
      return amountProblem(v, xBound, at);
    case "ref":
      return refProblem(v, at);
    case "selector":
      return selectorProblem(v, at);
    case "cond":
      return condProblem(v, depth, xBound, at);
    case "conds":
      if (!Array.isArray(v) || !v.length) return `${at} is a list of one condition or more`;
      for (const [i, c] of v.entries()) {
        const bad = condProblem(c, depth + 1, xBound, `${at}[${i}]`);
        if (bad) return bad;
      }
      return null;
    case "filter":
      return filterProblem(v, at);
    case "price":
      return skillPriceProblem(v, depth + 1);
    case "keyword":
      return isRecord(v) && typeof v.name === "string" ? null : no("a keyword skill");
    case "side":
      return typeof v === "string" && (SIDES as readonly string[]).includes(v) ? null : no("you, opponent or both");
    case "area":
      return typeof v === "string" && (AREAS as readonly string[]).includes(v) ? null : no("an area");
    case "duration":
      return typeof v === "string" && (DURATIONS as readonly string[]).includes(v) ? null : no("a duration");
    case "ops":
      return programProblem(v, depth + 1, xBound, at);
    case "modes":
      if (!Array.isArray(v) || !v.length) return `${at} is a list of one mode or more`;
      for (const [i, m] of v.entries()) {
        if (!isRecord(m)) return `${at}[${i}] is not a mode`;
        const stray = unknownKey(m, ["label", "ops"]);
        if (stray) return `${at}[${i}] has no field ${JSON.stringify(stray)} (a mode is a "label" and its "ops")`;
        const bad = programProblem(m.ops, depth + 1, xBound, `${at}[${i}].ops`);
        if (bad) return bad;
      }
      return null;
    case "string":
      return typeof v === "string" ? null : no("a word");
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? null : no("a number");
    case "boolean":
      return typeof v === "boolean" ? null : no("true or false");
  }
}

// ── plain-English rendering, for the inspector, the workbench and the log ───

/**
 * What a filter says, in words. `describeSelector` used to be handed a bare
 * filter for this and printed "undefined in your undefined" — the count and
 * the area it wants are not part of a filter.
 */
/** How a relative power bound is worded, in the words `parseFilter` reads back. */
const POWER_REL_WORDS: Record<NonNullable<CardFilter["powerRel"]>["cmp"], string> = {
  "<=": "less than or equal to",
  "<": "less than",
  ">=": "greater than or equal to",
  ">": "greater than",
};

/**
 * Whose skills an immunity blocks (9-1-4), in words — the one phrase shared
 * by the `immune` op's sentence, the effect label on the board and the
 * refusal a chosen card is turned down with, so the three cannot come to
 * disagree about what the rule claims. `side` is said from the chair the
 * caller is speaking in: the script's master for the op, the effect's master
 * for the label, and the player being refused for the refusal, which is why
 * the refusal reads "your skills" for the same rule the card's own side reads
 * as "your opponent's skills".
 */
export function whoseSkills(side: Side | undefined, filter?: CardFilter): string {
  const who = side === "opponent" ? "your opponent's" : side === "you" ? "your" : "";
  const whose = [who, filter ? describeFilter(filter) : ""].filter(Boolean).join(" ");
  return `${whose ? `${whose} ` : ""}skills`;
}

/**
 * How a sentence names the cards a filter finds. Without it, `describeFilter`
 * writes the filter's own short form — "blue", "battle card" — which is the
 * form `parseFilter` reads back and `lang/print.ts` prints a rule's filter in,
 * so it cannot change. A sentence needs a noun: "3 or more blue" is not
 * English (#478), and the card prints "blue cards" and "Battle Cards".
 */
export interface FilterNoun {
  plural: boolean;
}

/** "Once per turn, " for a scoped `payWith` spent for the turn when it pays (BT28-106). */
const once = (op: { oncePerTurn?: true }): string => (op.oncePerTurn ? "once per turn, " : "");

/** "BATTLE" → "Battle Card", the card type as the card prints it. */
const typeNoun = (type: string, plural: boolean): string => `${type.charAt(0)}${type.slice(1).toLowerCase()} ${plural ? "Cards" : "Card"}`;

/**
 * Names of one kind written side by side are *all* of them (#907 round 5), so an any-of list has to
 * carry its "or" — "<A> or <B>" — to be told from "<A> <B>", both in the reading and on the way
 * back through `parseFilter`.
 */
function anyOfNames(tokens: string[]): string[] {
  return tokens.length > 1 ? [tokens.join(" or ")] : tokens;
}

function allOfPhrases(characters: string[], names: string[]): string[] {
  const tokens = [...characters.map((x) => `<${x}>`), ...names.map((x) => `{${x}}`)];
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 2) out.push(`with both ${tokens[i]} and ${tokens[i + 1] ?? tokens[i]}`);
  return out;
}

export function describeFilter(given: Partial<CardFilter>, noun?: FilterNoun): string {
  // A stored filter may be partial (Claude writes only the measures it means),
  // and a missing list crashed the workbench and the printer on BT31-132.
  const f = completeFilter(given);
  // "A <Veku: Br> card or a red <Son Goku: Br> card" (#537): each alternative
  // in its own words, then whatever the filter asks beside them.
  if (f.anyOf?.length) {
    const either = f.anyOf.map((alt) => describeFilter(alt, noun ?? { plural: false })).join(" or ");
    const { anyOf: _alts, ...rest } = f;
    void _alts;
    const besides = describeFilter(rest, noun);
    return besides === describeFilter({}, noun) ? either : `${either} (and ${besides})`;
  }
  const bits: string[] = [];
  if (f.monoColor) bits.push("mono-colour");
  if (f.multiColor) bits.push("multicolour");
  bits.push(...f.colors.map((c) => c.toLowerCase()));
  if (f.originalColors?.length) bits.push(`with original colours ${f.originalColors.map((c) => c.toLowerCase()).join(" or ")}`);
  // Every measure that *narrows by exclusion* was silent until 9 Sep 2026,
  // and a measure the reading drops always reads as the wider filter — the
  // one direction ground rule 5 forbids. "Non-black Battle Cards" printed as
  // "battle card" is the same sentence as no filter at all.
  bits.push(...f.notColors.map((c) => `non-${c.toLowerCase()}`));
  // "≪Saiyan≫-only" (#932), on the last trait named, as printed.
  bits.push(...anyOfNames(f.traits.map((x, i) => `≪${x}≫${f.onlyTraits && i === f.traits.length - 1 ? "-only" : ""}`)));
  // Traits written side by side are all of them (#907 round 5), the way the cards print them.
  bits.push(...(f.traitsAll ?? []).map((x) => `≪${x}≫`));
  bits.push(...f.notTraits.map((x) => `non-≪${x}≫`));
  // "≪Brainwashed≫ or <Baby>" (BT29-114): the one word that makes it either,
  // and the word `parseFilter` reads the flag back from.
  if (f.characterOrTrait && f.traits.length && f.characters.length) bits.push("or");
  // "<Son Goku>-only" (BT29-108), on the last character named, as printed.
  bits.push(...anyOfNames(f.characters.map((x, i) => `<${x}>${f.onlyCharacters && i === f.characters.length - 1 ? "-only" : ""}`)));
  bits.push(...f.notCharacters.map((x) => `non-<${x}>`));
  bits.push(...anyOfNames(f.names.map((x) => `{${x}}`)));
  // In a sentence a token and a Z-card are the noun itself — "a {Majin}
  // token", "Z-cards" — rather than a word in front of "card".
  const ownNoun = noun && !f.type && !f.notType ? (f.token ? "token" : f.z ? "Z-card" : null) : null;
  if (f.token && !ownNoun) bits.push("token");
  else if (f.notToken) bits.push("non-token");
  // "Z-card Extra Cards" is said "Z-Extra Cards", the way the card types print.
  if (f.z && ownNoun !== "Z-card" && !(noun && f.type)) bits.push("Z-card");
  // "Originally skill-less" (20-3-1) is a prenominal adjective, like the
  // colours above it, and has to sit before the type noun is decided —
  // printed after it, `parseFilter` would still read it (it looks for the
  // phrase anywhere), but the catalog never writes it that way.
  if (f.originallySkillLess) bits.push("originally skill-less");
  // Bare "skill-less" (1-5-9, 9-1-4), in the same place. The adverb is what
  // tells `parseFilter` the two apart, so a filter asking both (no card prints
  // that; a hand-written rule could) says the word twice rather than once.
  if (f.skillLess) bits.push("skill-less");
  // The noun has to be settled before the trailing measures are hung off it,
  // and a name asked for **in part** is one of those — printed after the word
  // it qualifies, the way the card prints it.
  const partial = [
    ...f.charactersIncluding.map((x) => `with <${x}> in its character name`),
    ...f.namesIncluding.map((x) => `with {${x}} in its card name`),
    // "with both <A> and <B>" (#768): the parser reads exactly two tokens, so
    // the names go out in pairs (an odd one is repeated, which says the same).
    ...allOfPhrases(f.charactersAll ?? [], f.namesAll ?? []),
    ...f.notCharactersIncluding.map((x) => `without <${x}> in its character name`),
    ...f.notNamesIncluding.map((x) => `without {${x}} in its card name`),
    // A name the target must *not* have. Written the way the cards write it,
    // which is also the only wording `parseFilter` reads it back from.
    ...f.notNames.map((x) => `other than {${x}}`),
    // "…with [Blocker]", "…with an [Evolve] skill", "…with [Counter] skills".
    // One "with" apiece rather than a list, so the phrase reads back as the
    // same set of keywords it printed.
    // A family an exact name already covers ("Over Realm" under "Over Realm 2")
    // is not printed twice: the number is the narrower claim (#941).
    ...f.keywords.filter((k) => !(f.keywordsExact ?? []).some((e) => e.toLowerCase().startsWith(k.toLowerCase()) || e.toLowerCase().startsWith(`dark ${k.toLowerCase()}`))).map((k) => `with [${k}]`),
    ...(f.keywordsExact ?? []).map((k) => `with [${k}]`),
    ...f.notKeywords.map((k) => `non-[${k}]`),
    ...(f.notKeywordsExact ?? []).map((k) => `non-[${k}]`),
  ];
  if (f.skillKind) partial.push(`with [${f.skillKind === "activate" ? "Activate" : f.skillKind === "counter" ? "Counter" : f.skillKind === "auto" ? "Auto" : "Permanent"}] skills`);
  if (noun) {
    if (f.type) bits.push(`${f.z ? "Z-" : ""}${typeNoun(f.type, noun.plural)}`);
    else if (f.notType) bits.push(`non-${typeNoun(f.notType, noun.plural)}`);
    else bits.push(`${ownNoun ?? "card"}${noun.plural ? "s" : ""}`);
  } else if (f.type) bits.push(`${f.type.toLowerCase()} card`);
  else if (f.notType) bits.push(`non-${f.notType.toLowerCase()} card`);
  else if (!bits.length) bits.push("card");
  // Printed nowhere until 9 Sep 2026, which is what let "choose up to 1 of
  // your Battle Cards **with <Son Gohan> in its character name**" (BT19-130)
  // read as "choose up to 1 in your battle" — a filter the compiler had,
  // printed as though it had none. The reading is the only check on a filter
  // that narrows wrongly, so a measure it cannot print is a measure nobody can
  // sign off.
  bits.push(...partial);
  if (f.faceUp) bits.push(noun?.plural ? "that are face up" : "that is face up");
  // A range said only half of itself: a filter with both bounds printed as
  // "or less" and dropped the floor, and an *exact* cost or power printed as
  // "or less" too — a reading strictly wider than the filter in both cases.
  if (f.costMin != null && f.costMin === f.costMax) bits.push(`with an energy cost of ${f.costMin}`);
  else if (f.costMin != null && f.costMax != null) bits.push(`with an energy cost of between ${f.costMin} and ${f.costMax}`);
  else if (f.costMax != null) bits.push(`with an energy cost of ${f.costMax} or less`);
  else if (f.costMin != null) bits.push(`with an energy cost of ${f.costMin} or more`);
  // 2-9: "a ≪Slug's Army≫ card with a combo cost of 1", in the words `parseFilter` reads back.
  if (f.comboCostMin != null && f.comboCostMin === f.comboCostMax) bits.push(`with a combo cost of ${f.comboCostMin}`);
  else if (f.comboCostMin != null && f.comboCostMax != null) bits.push(`with a combo cost of between ${f.comboCostMin} and ${f.comboCostMax}`);
  else if (f.comboCostMax != null) bits.push(`with a combo cost of ${f.comboCostMax} or less`);
  else if (f.comboCostMin != null) bits.push(`with a combo cost of ${f.comboCostMin} or more`);
  // "An original energy cost of 3" (20-3-1): the printed total, said with its word.
  if (f.originalCostMin != null && f.originalCostMin === f.originalCostMax) bits.push(`with an original energy cost of ${f.originalCostMin}`);
  else if (f.originalCostMin != null && f.originalCostMax != null) bits.push(`with an original energy cost of between ${f.originalCostMin} and ${f.originalCostMax}`);
  else if (f.originalCostMax != null) bits.push(`with an original energy cost of ${f.originalCostMax} or less`);
  else if (f.originalCostMin != null) bits.push(`with an original energy cost of ${f.originalCostMin} or more`);
  if (f.powerMin != null && f.powerMin === f.powerMax) bits.push(`with ${f.powerMin} power`);
  else if (f.powerMin != null && f.powerMax != null) bits.push(`with power between ${f.powerMin} and ${f.powerMax}`);
  else if (f.powerMax != null) bits.push(`with ${f.powerMax} power or less`);
  else if (f.powerMin != null) bits.push(`with ${f.powerMin} power or more`);
  // "An original power of 500" (20-3-1) — the catalog's own word order for
  // this one, number after "of" rather than before it like the bare measure
  // above, so the two never collide on the way back in.
  if (f.originalPowerMin != null && f.originalPowerMin === f.originalPowerMax) bits.push(`with an original power of ${f.originalPowerMin}`);
  else if (f.originalPowerMin != null && f.originalPowerMax != null) bits.push(`with an original power between ${f.originalPowerMin} and ${f.originalPowerMax}`);
  else if (f.originalPowerMax != null) bits.push(`with an original power of ${f.originalPowerMax} or less`);
  else if (f.originalPowerMin != null) bits.push(`with an original power of ${f.originalPowerMin} or more`);
  // 2-8: "cards with 5000 combo power" (BT29-030), in the words `parseFilter`
  // reads back.
  if (f.comboPowerMin != null && f.comboPowerMin === f.comboPowerMax) bits.push(`with ${f.comboPowerMin} combo power`);
  else if (f.comboPowerMin != null && f.comboPowerMax != null) bits.push(`with combo power between ${f.comboPowerMin} and ${f.comboPowerMax}`);
  else if (f.comboPowerMax != null) bits.push(`with ${f.comboPowerMax} combo power or less`);
  else if (f.comboPowerMin != null) bits.push(`with ${f.comboPowerMin} combo power or more`);
  // 13-2: "a red Unison Card with 2 or more markers" (BT10-008, #721), in the words `parseFilter` reads back.
  if (f.markersMin != null) bits.push(`with ${f.markersMin} or more markers`);
  if (f.markersMax != null) bits.push(`with ${f.markersMax} or fewer markers`);
  // 1-2-3: "a red Unison Card with a specified cost of 2" (SD15-01, #728), in the words `parseFilter` reads back.
  if (f.specifiedCostMin != null && f.specifiedCostMin === f.specifiedCostMax) bits.push(`with a specified cost of ${f.specifiedCostMin}`);
  else if (f.specifiedCostMin != null && f.specifiedCostMax != null) bits.push(`with a specified cost of ${f.specifiedCostMin} or more and a specified cost of ${f.specifiedCostMax} or less`);
  else if (f.specifiedCostMax != null) bits.push(`with a specified cost of ${f.specifiedCostMax} or less`);
  else if (f.specifiedCostMin != null) bits.push(`with a specified cost of ${f.specifiedCostMin} or more`);
  if (f.specifiedCostNone) bits.push("with no specified cost");
  {
    // #1011: whose energy the cost is measured against, in the words `parseTarget` reads back.
    const whose = f.energyOfOpponent ? "your opponent's" : "your";
    if (f.costAtMostEnergy) bits.push(`with an energy cost less than or equal to ${whose} current energy`);
    if (f.costBelowEnergy) bits.push(`with an energy cost less than ${whose} current energy`);
    if (f.costAtLeastEnergy) bits.push(`with an energy cost greater than or equal to ${whose} current energy`);
    if (f.costAboveEnergy) bits.push(`with an energy cost greater than ${whose} current energy`);
  }
  if (f.powerRel) bits.push(`with power ${POWER_REL_WORDS[f.powerRel.cmp]} ${f.powerRel.of === "chosen" ? "the chosen card's" : "this card's"} power`);
  if (f.nameInSkillTextOf) bits.push("whose card name is in the text of a skill on the chosen card");
  if (f.sameCharacterAs) bits.push("with the same character name as the card you placed under this card");
  if (f.unionNameOf) bits.push("with a character name the revealed card's [Union] skill requires");
  if (f.noKeywords) bits.push("and no keyword skills");
  return bits.join(" ");
}

/**
 * The filter's words, unless they only repeat what the area already says: a
 * selector over the Battle Area whose filter is "battle card" would read "1
 * battle card in your battle".
 */
function selectorWords(sel: Selector): string {
  if (!sel.filter) return "";
  const words = describeFilter(sel.filter);
  // A type that only repeats the area says nothing — "leader card" in the
  // Leader Area. Not in the Battle Area: a Hidden Mode card there has no card
  // type (23-5-2), so "Battle Cards" there is a narrower choice than "cards".
  const areas = (sel.areas?.length ? sel.areas : [sel.area]).filter((a) => a && a !== "battle").map((a) => `${String(a).toLowerCase()} card`);
  return words === "card" || areas.includes(words) ? "" : words;
}

/**
 * The same cards with their noun, as a sentence names them: "blue cards",
 * "a ≪Saiyan≫ card", "Battle Cards with [Blocker]" — or just "cards" where the
 * filter only repeats the area. "3 or more blue in your drop" was the reading
 * of a card that prints "3 or more blue cards in your Drop Area" (#478).
 */
function selectorNoun(sel: Selector, plural: boolean): string {
  return sel.filter && selectorWords(sel) ? describeFilter(sel.filter, { plural }) : plural ? "cards" : "card";
}

/**
 * An area as the game names it — `words.rules`' `you:` form ("your Drop Area",
 * "the Leader Area") without its determiner, since the owner is the
 * selector's. A copy, because this module cannot import the ruleset loader:
 * the loader is built on `lang/`, which reads this module's constants while it
 * loads. `scripts/verify/describe.ts` asserts it is the same word as
 * `dbsWords().area` for every area, so the declaration is still the source.
 */
export const ZONE_NOUNS: Record<Exclude<ScriptArea, "play" | "under" | "removed">, string> = {
  deck: "deck",
  hand: "hand",
  drop: "Drop Area",
  leader: "Leader Area",
  battle: "Battle Area",
  combo: "Combo Area",
  energy: "Energy Area",
  life: "Life Area",
  warp: "Warp",
  unison: "Unison Area",
  zDeck: "Z-Deck",
  zEnergy: "Z-Energy Area",
};

/**
 * Where a selector looks, in the game's own words for its areas: "in your
 * Drop Area", "in your opponent's Battle Area or Unison Area" — not "in
 * opponent's battle" (#478). The two routes a board never shows a card in
 * (`under`, `play`) and the cards removed from the game have no area to be
 * "in", so they are said the way the card text says them.
 */
function describeWhere(sel: Selector): string {
  const areas: ScriptArea[] = sel.areas?.length ? sel.areas : [sel.area ?? "play"];
  // #930: an owner per area — "in your Drop or your opponent's Battle Area".
  if (sel.areaSides?.length === areas.length) return areas.map((a, i) => `in ${sel.areaSides![i] === "opponent" ? "your opponent's" : "your"} ${ZONE_NOUNS[a as keyof typeof ZONE_NOUNS] ?? a}`).join(" or ");
  const owner = sel.side === "opponent" ? "your opponent's" : sel.side === "both" ? "each player's" : "your";
  const has = sel.side === "opponent" ? "your opponent has" : sel.side === "both" ? "either player has" : "you have";
  const zones = areas.filter((a) => a !== "play" && a !== "under" && a !== "removed").map((a) => ZONE_NOUNS[a as keyof typeof ZONE_NOUNS] ?? a);
  const parts: string[] = [];
  if (zones.length) parts.push(`in ${owner} ${zones.join(" or ")}`);
  if (areas.includes("play")) parts.push(`${has} in play`);
  // The pile under the card whose skill this is (23-2): `areaCards` reads the source card's `under`, whatever the side says; a pile under another card carries its `underHost` and is worded there.
  if (areas.includes("under")) parts.push("under this card");
  if (areas.includes("removed")) parts.push(`${has} out of the game`);
  return parts.join(" or ");
}

/**
 * Which cards, in words. The filter is part of the answer: without it the
 * worklist read "choose up to 1 in your warp" for a skill that can only take
 * a blue ≪Another World Budokai≫ card, which is exactly the detail that tells
 * two cards phrased alike apart.
 *
 * `all` is the word for a selector with no count of its own, which is every
 * card it finds. A condition that *tests* the cards rather than taking them
 * says so differently — `inBattle` and `battled` ask whether **any** of them
 * is, `every` asks about each — so they pass their own word rather than let
 * the sentence claim a quantifier the engine does not use.
 */
export function describeSelector(sel: Selector, all = "all"): string {
  // The one special a filter can narrow and the reading has to keep: "the
  // <Majin Buu> on top of this card" and "the Leader on top of this card" are
  // different cards, and dropping the words would print them the same.
  if (sel.special === "onTop") return `the ${selectorNoun(sel, false)} on top of this card`;
  if (sel.special)
    return {
      self: "this card",
      attacker: "the attacking card",
      guard: "the guard card",
      subject: "that card",
      leader: "your leader",
      opponentLeader: "the opposing leader",
      resolving: "the card being played",
    }[sel.special];
  // A selector with neither a count nor a `take` is every card the filter
  // matches — `resolveSelector` returns the whole area — and printing
  // `${undefined}` said so as "undefined in your energy", on 145 readings.
  // `take` is the area's own order rather than a choice among it (see
  // `Selector.take`), so it is worded as the cards it takes, not as a number
  // of them to pick.
  const count =
    sel.take != null
      ? `the ${sel.fromEnd ? "bottom" : "top"} ${sel.take}`
      : sel.count == null
        ? all
        : sel.count === 99 && sel.minCount !== undefined && sel.minCount < 99
          ? // "Discard 1 or more cards" (BT20-090): a floor and no ceiling.
            `${sel.minCount} or more`
          : sel.count === 99
          ? // "Choose any number of … whose total cost adds up to 5 or less"
            // (BT3-036): every card is not the choice when a sum bounds it.
            // Nor when the choice may stop short of it (`upTo`, minimum 0): "the cards to put on
            // top, the rest to the bottom" (BT10-081, phrasing batch 2) is any number of them.
            sel.upTo
            ? "any number of"
            : "all"
          : sel.minCount !== undefined
            ? `${sel.minCount} to ${sel.count}`
            : sel.upTo
            ? `up to ${sel.count}`
            : `${sel.count}`;
  // One card is "card", any other number — and every card — is "cards".
  const plural = sel.take != null ? sel.take !== 1 : sel.count !== 1;
  // "Up to 1 of the cards looked at" already has its noun.
  const words = sel.fromVar && !selectorWords(sel) ? "" : selectorNoun(sel, plural);
  const host = sel.underHost ? describeUnderHost(sel.underHost) : null;
  const where = sel.fromVar ? "of the cards looked at" : host ? `under ${host}` : describeWhere(sel);
  const mode = describeMode(sel);
  // 22-16-2: a choice that reaches past [Barrier] says so, or the reading of "ignoring [Barrier]" is the same words as a choice that does not.
  return [count, words, where].filter(Boolean).join(" ").replace(/^any number of of /, "any number of ") + mode + describeNotSelf(sel) + (sel.ignoreBarrier ? " ignoring [Barrier]" : "");
}

function describeUnderHost(sel: Selector): string {
  if (sel.special)
    return {
      self: "this card",
      attacker: "the attacking card",
      guard: "the guard card",
      subject: "that card",
      leader: "your leader card",
      opponentLeader: "your opponent's leader card",
      resolving: "the card being played",
      onTop: "the card on top of this card",
    }[sel.special];
  const who = sel.side === "opponent" ? "your opponent's " : sel.side === "both" ? "each player's " : "your ";
  const words = selectorWords(sel);
  const kind =
    sel.area === "leader"
      ? "leader card"
      : sel.area === "unison"
        ? "unison card"
        : sel.area === "battle" || sel.area === "play" || sel.area == null
          ? "card"
          : `${sel.area} card`;
  // "Your <Son Goku> Battle Card": the type word, now kept in the Battle Area
  // (`selectorWords`), already is the noun.
  if (kind === "card" && /\bbattle card$/.test(words)) return `${who}${words}`;
  return `${who}${words ? `${words} ` : ""}${kind}`;
}

/**
 * "In Rest Mode" / "In Hidden Mode" — the two axes a card instance carries
 * (§23-5's Hidden/Revealed is orthogonal to §1-10's Active/Rest). Both are
 * said when both are set: "1 card in your Battle Area in Hidden Mode and in
 * active mode" is the choice BT28-138's price is narrowed to.
 */
const describeMode = (sel: Selector): string => {
  const hidden = sel.hidden === true ? " in Hidden Mode" : sel.hidden === false ? " in Revealed Mode" : "";
  const mode = sel.mode ? ` in ${sel.mode} mode` : "";
  return hidden && mode ? `${hidden} and${mode}` : hidden || mode;
};

/**
 * "…other than this card". Left out of the reading until 9 Sep 2026, when
 * reading "all other Battle Cards" as `notSelf` made it the difference between
 * a board wipe and a board wipe that also takes the card casting it — which
 * the sentence "all in each player's battle" said nothing about either way.
 */
const describeNotSelf = (sel: Selector): string =>
  (sel.notSelf === "card" ? " other than this card" : sel.notSelf === "copies" ? " other than copies of this card" : sel.notSelf === "name" ? " with a different card name from this card" : "") +
  // "…and different card names" (BT29-030, BT18-104): about the set, so said after it.
  (sel.differentNames ? " with different card names" : "") +
  (sel.differentCharacters ? " with different character names" : "") +
  // "for each character name required for the revealed card's [union] skill" (EX13-14, #930).
  (sel.eachUnionName ? " for each character name the revealed card's [Union] skill requires, each card a name of its own" : "") +
  // "for each card color in your Energy Area" (EX19-26): the colors, not the cards, are what is counted.
  (sel.distinctColors ? " (counting the different colors, not the cards)" : "") +
  (sel.notInBattle ? " that is not in a battle" : "") +
  (sel.atRandom ? " at random" : "") +
  (sel.ownedByOpponent ? " whose owner is your opponent" : "") +
  // "…1 <Shu> card" after "1 <Pilaf> card" (#970): a card of its own, not one an earlier slot took.
  (sel.notIn?.length ? " other than the cards already chosen" : "") +
  // "…for which the total cost adds up to 5 or less" (BT3-036): about the set too.
  (sel.sumAtMost ? ` whose total ${ATTR_NOUNS[sel.sumAtMost.attr]} is ${describeAmount(sel.sumAtMost.total)} or less` : "") +
  (sel.printed ? " matching the description printed on this line" : "");

function describeRef(ref: Ref): string {
  // `minus` is "the rest" (script.ts): "place the rest at the bottom of your deck" read "move the chosen
  // cards to deck" for twenty skills whose program was right, which hid a real one beside them (#907 round 6).
  if ("var" in ref && ref.minus !== undefined) return "the rest of the cards looked at";
  return "var" in ref ? "the chosen cards" : describeSelector(ref.sel);
}

/**
 * A number in words. With a `noun` ("power") it is the signed change cards
 * print — "+5000 power", "+5000 power for each of your Battle Cards" — so the
 * noun sits next to the number rather than at the end of the sentence.
 */
/** The measures `attr` and `sumOf` read, as a person names them. */
const ATTR_NOUNS: Record<AmountAttr, string> = { power: "power", originalPower: "original power", comboPower: "combo power", energyCost: "energy cost", comboCost: "combo cost", specifiedCost: "specified cost" };

/** "+2" / "-2": the sign a per-count change is printed with (EX19-26's "-2000 power for each" read "+-2000"). */
const signedTimes = (times: number | undefined): string => ((times ?? 1) >= 0 ? `+${times ?? 1}` : `${times}`);

function describeAmount(a: Amount, noun?: string): string {
  if (noun) {
    if (typeof a === "number") return `${a >= 0 ? "+" : ""}${a} ${noun}`;
    if ("plus" in a) return `${describeAmount(a.plus[0], noun)} and ${a.plus[1] < 0 ? `${-a.plus[1]} less` : `${a.plus[1]} more`}`;
    if ("count" in a) return `${signedTimes(a.times)} ${noun} ${forEvery(a.per)} of ${describeEach(a.count)}`;
    if ("markers" in a) return `${signedTimes(a.times)} ${noun} ${forEvery(a.per, "marker")} on ${describeEach(a.markers)}`;
    if ("x" in a) return a.times === undefined ? `+X ${noun}` : `+${a.times} ${noun} for each X`;
    if ("life" in a) return `${signedTimes(a.times)} ${noun} ${forEvery(a.per, "life", "life")} ${a.life === "opponent" ? "your opponent has" : a.life === "both" ? "either player has" : "you have"}`;
    if ("sumOf" in a) return `${noun} equal to the total ${ATTR_NOUNS[a.attr]} of ${describeEach(a.sumOf)}${a.times === undefined ? "" : ` × ${a.times}`}`;
    if ("attr" in a) return `${noun} equal to ${describeRef(a.attr)}'s ${ATTR_NOUNS[a.name]}${a.times === undefined ? "" : ` × ${a.times}`}`;
    return `+that many ${noun}`;
  }
  if (typeof a === "number") return `${a}`;
  if ("plus" in a) return a.plus[1] < 0 ? `${describeAmount(a.plus[0])} less ${-a.plus[1]}` : `${describeAmount(a.plus[0])} and ${a.plus[1]} more`;
  if ("var" in a) return "that many";
  if ("sumPower" in a) return "the total power of the cards rested";
  if ("handUpTo" in a) return `up to ${a.handUpTo} in hand`;
  if ("x" in a) return a.times === undefined ? "X" : `${a.times} for each X`;
  if ("life" in a) return `${a.times ?? 1} ${forEvery(a.per, "life", "life")} ${a.life === "opponent" ? "your opponent has" : a.life === "both" ? "either player has" : "you have"}`;
  if ("sumOf" in a) return `the total ${ATTR_NOUNS[a.attr]} of ${describeEach(a.sumOf)}${a.times === undefined ? "" : ` × ${a.times}`}`;
  if ("attr" in a) return `${describeRef(a.attr)}'s ${ATTR_NOUNS[a.name]}${a.times === undefined ? "" : ` × ${a.times}`}`;
  if ("markers" in a) return `${a.times ?? 1} ${forEvery(a.per, "marker")} on ${describeEach(a.markers)}`;
  return `${a.times ?? 1} ${forEvery(a.per)} of ${describeEach(a.count)}`;
}

/** "for each marker", or "for every 2 markers" when the reading is divided (`Amount`'s `per`). */
function forEvery(per: number | undefined, noun?: string, plural = `${noun}s`): string {
  if (!per || per < 2) return noun ? `for each ${noun}` : "for each";
  return noun ? `for every ${per} ${plural}` : `for every ${per}`;
}

/** The area as a person would name it, for "for each of your Battle Cards". */
const AREA_NOUNS: Partial<Record<ScriptArea, string>> = {
  play: "cards in play",
  battle: "Battle Cards",
  unison: "Unison Cards",
  leader: "Leader",
  drop: "cards in the Drop",
  hand: "cards in hand",
  deck: "cards in the deck",
  life: "life cards",
  energy: "energy",
  warp: "cards in the Warp",
  combo: "combo cards",
  zDeck: "Z-Deck cards",
  zEnergy: "Z-Energy",
  removed: "removed cards",
  under: "cards underneath",
};

function describeEach(sel: Selector): string {
  if (sel.special) return describeSelector(sel);
  // The cards a name is bound to ("the cards discarded by this skill", BT20-090): said as that, or the reading names the area it falls back on (your cards in play).
  if (sel.fromVar) return `the cards bound to ${sel.fromVar}`;
  const who = sel.side === "opponent" ? "their " : sel.side === "both" ? "" : "your ";
  // A Hidden Mode card has no card type (23-5-2), so it is not a "Battle
  // Card" or a "Unison Card" to count: "your Hidden Mode cards", and the area
  // only when the selector names one.
  if (sel.hidden === true && !sel.filter && !sel.mode) {
    const areas = sel.areas?.length ? sel.areas : [sel.area ?? "play"];
    const where = areas.length === 1 && areas[0] !== "play" ? ` in ${who}${ZONE_NOUNS[areas[0] as keyof typeof ZONE_NOUNS] ?? areas[0]}` : "";
    return `${who}Hidden Mode cards${where}${describeNotSelf(sel)}`;
  }
  // "For each red ≪Saiyan≫ card and/or ≪Bardock's Crew≫ card" (P-293) is a count of those cards, not of
  // "your Battle Cards": the filter is named, or a readings diff cannot show a change to it (#907 round 6;
  // the reading left it out until then). A selector with no filter keeps the area noun below.
  if (sel.filter && !sel.take) return describeSelector({ ...sel, count: undefined, minCount: undefined, upTo: undefined }, "");
  const mode = describeMode(sel);
  const nouns = (sel.areas?.length ? sel.areas : [sel.area ?? "play"]).map((a) => AREA_NOUNS[a] ?? "cards");
  return `${who}${nouns.join(" or ")}${mode}${describeNotSelf(sel)}`;
}

/**
 * A condition in plain words. The workbench shows this back before you keep a
 * reading, and "if a condition holds" would tell you nothing about whether the
 * engine understood the condition you meant.
 */
export function describeCond(c: Cond): string {
  return COND_SCHEMA[c.kind].sentence(c);
}

/** A duration as the inspector says it. A [Permanent] holds while its card is where the skill is valid (9-5-1), so it gets no clause at all. */
const DURATION_IN_WORDS: Record<Duration, string> = {
  turn: " for the turn",
  battle: " for the battle",
  nextTurn: " until the end of your opponent's turn",
  opponentTurn: " until the start of your opponent's next turn",
  afterNextCharge: " through your next Charge Phase",
  afterOpponentCharge: " through your opponent's next Charge Phase",
  nextMain: " until the start of your next Main Phase",
  ownTurn: " until the end of your turn",
  game: " for the rest of the game",
  whileSourceInPlay: " while this card is in a Battle Area",
};
const forThe = (until: Duration | undefined, r: RenderOptions) => (r.permanent || !until ? "" : DURATION_IN_WORDS[until]);

/** The card types of `byTypes` as one list: "Battle, Extra or Unison Cards". */
function typeList(types: readonly string[]): string {
  const words = types.map((t) => t.charAt(0) + t.slice(1).toLowerCase());
  return `${words.length > 1 ? `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}` : words[0]} Cards`;
}

/** Whose skills a passive prohibition is about: "your opponent's skills", "the skills of your Battle Cards", "skills of non-blue non-green cards". */
function whoseSkillsSaid(op: OpOf<"forbid">): string {
  const owner = op.side === "opponent" ? "your opponent's " : op.side === "you" ? "your " : "";
  if (op.byFilter) return `the skills of ${owner}${describeFilter(op.byFilter, { plural: true })}`;
  if (op.byTypes?.length) return `the skills of ${owner}${typeList(op.byTypes)}`;
  return owner ? `${owner}skills` : "skills";
}

const PILE_NAMES: Record<string, string> = { hand: "hand", deck: "deck", drop: "Drop Area", battle: "Battle Area", energy: "Energy Area", life: "life", warp: "Warp", any: "areas" };

/**
 * The passive prohibitions — a skill's move (`beMovedBySkill`), KO
 * (`beKOdBySkill`), switch to Rest Mode (`beRestedBySkill`) and choice
 * (`beChosen`) — said with the cards as the subject and the acting player as
 * whose skills they are. Null for anything else.
 */
function passiveSentence(op: OpOf<"forbid">, escape: string, r: RenderOptions): string | null {
  if (op.what !== "beMovedBySkill" && op.what !== "beKOdBySkill" && op.what !== "beRestedBySkill" && op.what !== "beChosen") return null;
  const by = ` by ${whoseSkillsSaid(op)}`;
  const except = op.exceptOwnSkills ? " other than this card's own" : op.exceptSourceName ? ` other than {${op.exceptSourceName}}'s` : "";
  const tail = `${except}${escape}${forThe(op.until, r)}`;
  if (op.what !== "beMovedBySkill") {
    const subject = op.target ? describeRef(op.target) : op.filter ? describeFilter(op.filter, { plural: true }) : "cards";
    const verb = op.what === "beKOdBySkill" ? "be KO'd" : op.what === "beRestedBySkill" ? "be switched to Rest Mode" : "be chosen";
    return `${subject} can't ${verb}${by}${tail}`;
  }
  const to = op.toArea;
  const passiveVerb = !to
    ? `be removed from ${op.fromArea && op.fromArea !== "battle" ? `the ${PILE_NAMES[op.fromArea] ?? op.fromArea}` : "a Battle Area"}`
    : to === "hand" ? "be returned to the hand"
    : to === "deck" ? (op.toBottom ? "be placed at the bottom of the deck" : "be returned to the deck")
    : to === "warp" ? "be sent to the Warp"
    : `be placed in the ${PILE_NAMES[to] ?? to}`;
  // "Your opponent can't add cards from their deck to their hand using
  // non-Leader Card skills" (DB3-092): the player whose cards they are is the
  // one whose skills are bound, so it is said as what that player can't do.
  if (!op.target && op.cardsOf && op.side === op.cardsOf) {
    const who = op.side === "opponent" ? "your opponent" : "you";
    const their = op.side === "opponent" ? "their" : "your";
    const from = op.fromArea === "any" || !op.fromArea ? `any of ${their} areas` : `${their} ${PILE_NAMES[op.fromArea] ?? op.fromArea}`;
    const verb = to === "hand" ? `add cards from ${from} to ${their} hand` : to ? `place cards from ${from} in ${their} ${to === "deck" && op.toBottom ? "deck (at the bottom)" : PILE_NAMES[to] ?? to}` : `remove cards from ${from}`;
    const using = op.byFilter || op.byTypes?.length ? ` with ${whoseSkillsSaid({ ...op, side: undefined })}` : " with skills";
    return `${who} can't ${verb}${using}${tail}`;
  }
  // "Cards in your hand can't be returned to your deck by your opponent's
  // skills for the turn" (DB2-156): the area itself, a card that enters it later included.
  const subject = op.target
    ? describeRef(op.target)
    : op.cardsOf
      ? `cards in ${op.cardsOf === "opponent" ? "your opponent's" : "your"} ${op.fromArea && op.fromArea !== "any" ? PILE_NAMES[op.fromArea] ?? op.fromArea : "areas"}`
      : op.filter ? describeFilter(op.filter, { plural: true }) : "cards";
  // A target rule about cards in a hand says where they are, unless the subject already does.
  const where = op.target && op.fromArea && to && !/\bin (?:your|your opponent's|their) /.test(subject) ? ` from the ${PILE_NAMES[op.fromArea] ?? op.fromArea}` : "";
  return `${subject} can't ${passiveVerb}${where}${by}${tail}`;
}

/** Whether a field counts as given, for `{field? …}`: unset, false and an empty list are not. */
function given(v: unknown): boolean {
  return v !== undefined && v !== null && v !== false && !(Array.isArray(v) && v.length === 0);
}

/** One field in words, by its type; `hint` is what the template wrote after the colon. */
function describeField(f: OpField, v: unknown, hint: string | undefined, r: RenderOptions): string {
  const t = f.type;
  const two = (flag: boolean) => (hint ? (hint.split("|")[flag ? 0 : 1] ?? "") : String(flag));
  if (typeof t === "object") {
    if ("enum" in t) {
      // "auto=Auto|counter=Counter" maps the values; "A|B" is for a two-valued enum.
      if (hint?.includes("=")) return hint.split("|").map((kv) => kv.split("=")).find(([k]) => k === v)?.[1] ?? String(v);
      return v === undefined ? (hint ?? "") : t.enum.length === 2 && hint ? two(v === t.enum[0]) : String(v);
    }
    return Array.isArray(v) ? v.join(", ") : (hint ?? "");
  }
  switch (t) {
    case "amount":
      return describeAmount(v as Amount, hint);
    case "ref":
      return describeRef(v as Ref);
    case "selector":
      return describeSelector(v as Selector);
    case "side":
      return hint ? two(v === "opponent") : String(v ?? f.default ?? "you");
    case "area":
      return String(v);
    case "duration":
      return forThe(v as Duration | undefined, r);
    case "cond":
      return describeCond(v as Cond);
    case "conds":
      return ((v as Cond[] | undefined) ?? []).map(describeCond).join(" and ");
    case "ops": {
      const inner = describeScript((v as Op[] | undefined) ?? [], r);
      return inner || (hint ?? "");
    }
    case "price":
      return "the recorded skill price";
    case "keyword":
      // "[Double Strike]", not "[Strike]": the number is part of the name
      // the card prints (22), and the reading said a different keyword.
      return keywordName(v as KeywordSkill);
    case "filter":
      return v ? describeFilter(v as CardFilter) : (hint ?? "");
    case "modes":
      return ((v as { ops: Op[] }[]) ?? []).map((m) => describeScript(m.ops, r)).join(" / ");
    case "string":
      return typeof v === "string" && v ? v : (hint ?? "");
    case "number":
      return String(v);
    case "boolean":
      return hint ? two(Boolean(v ?? f.default)) : String(v);
  }
}

/** `costs {amount:less|more}`: 20-21 goes both ways, and "costs -2 less" is not English. */
function describeCostChange(a: Amount): string {
  if (typeof a === "number" && a < 0) return `${-a} more`;
  return `${describeAmount(a)} less`;
}

/**
 * Fill a sentence template from an op. `{f}` and `{f:hint}` render the field;
 * `{f? …}` renders its text, with the same substitutions inside, only when the
 * field is given.
 */
function renderTemplate(template: string, op: Record<string, unknown>, fields: OpField[], r: RenderOptions): string {
  const byName = new Map(fields.map((f) => [f.name, f]));
  const one = (name: string, hint?: string): string => {
    const f = byName.get(name);
    if (!f) return "";
    const v = op[name] ?? f.default;
    if (f.name === "amount" && hint === "less|more") return describeCostChange(v as Amount);
    if (v === undefined && !hint) return "";
    return describeField(f, v, hint, r);
  };
  return template
    .replace(/\{(\w+)\?([^{}]*(?:\{\w+(?::[^{}]*)?\}[^{}]*)*)\}/g, (_, name: string, text: string) => (given(op[name]) ? text.replace(/\{(\w+)(?::([^{}]*))?\}/g, (__, n2: string, h2?: string) => one(n2, h2)) : ""))
    .replace(/\{(\w+)(?::([^{}]*))?\}/g, (_, name: string, hint?: string) => one(name, hint));
}

/**
 * A program in words, one clause per op. `permanent` drops every duration:
 * the compiler stamps `game` on a [Permanent]'s ops (the skill never resolves,
 * so no length of time is the right one), and "for the rest of the game" on
 * a card that simply holds while in play would say something it does not
 * mean.
 */
export function describeScript(ops: Op[], o: RenderOptions = {}): string {
  const parts: string[] = [];
  for (const op of ops) {
    const spec = OP_SCHEMA[op.op];
    if (!spec) continue;
    const text = typeof spec.sentence === "function" ? spec.sentence(op, o) : renderTemplate(spec.sentence, op as unknown as Record<string, unknown>, spec.fields, o);
    if (text) parts.push(text);
  }
  return parts.join(", ");
}

/**
 * What an offered move also costs, said on its button (20-14-1, a `forbid`'s
 * `unlessPay`): " — first pay: discard 2 to the Warp". Empty with no tax. One
 * definition for both engines' menus, so the two labels cannot drift apart.
 */
export function taxLabel(taxes: Op[][]): string {
  return taxes.length ? ` — first pay: ${taxes.map((ops) => describeScript(ops)).join("; ")}` : "";
}

/**
 * #677: how many cards of the payer's own hand several taxes on one action
 * take between them — every exact `discard` and every exact `choose` from the
 * hand. Each tax's own `canPay…Program` asks about that tax alone, so two
 * "send 1 card from your hand" taxes on a one-card hand would each say yes;
 * the sum is the check that the set can be paid whole, so an activation is
 * never offered with a price that runs out half way. Both engines ask it.
 */
export function taxHandNeed(taxes: Op[][]): number {
  let need = 0;
  for (const ops of taxes) {
    for (const o of ops) {
      if (o.op === "discard" && typeof o.n === "number" && (o.side ?? "you") === "you") need += o.n;
      if (o.op === "choose" && !o.sel.upTo && o.sel.area === "hand" && (o.sel.side ?? "you") === "you") need += typeof o.sel.count === "number" ? o.sel.count : 1;
    }
  }
  return need;
}

/**
 * The op's shape as the referee is shown it: `{"op":"draw","n":AMOUNT,"side"?:SIDE}`.
 * Optional fields carry a `?`; the placeholders are defined once under the list.
 */
export function opSignature(name: Op["op"]): string {
  const shape = (t: FieldType): string => {
    if (typeof t === "object") {
      if ("enum" in t) return t.enum.length > 6 ? `${t.enum.slice(0, 3).map((e) => `"${e}"`).join("|")}|…` : t.enum.map((e) => `"${e}"`).join("|");
      return t.list === "string" ? '["…"]' : `[${t.list.enum.map((e) => `"${e}"`).join("|")}]`;
    }
    return { amount: "AMOUNT", ref: "TARGET", selector: "SELECTOR", side: '"you"|"opponent"', area: "AREA", duration: "DURATION", cond: "COND", conds: "[COND]", ops: "[…]", string: '"…"', number: "N", boolean: "true|false", price: "PRICE", keyword: '{"name":"Blocker"}', filter: "FILTER", modes: '[{"label":"…","ops":[…]}]' }[t];
  };
  const fields = OP_SCHEMA[name].fields.filter((f) => !f.offCard).map((f) => `"${f.name}"${f.required ? "" : "?"}:${shape(f.type)}`);
  return `{"op":"${name}"${fields.length ? "," : ""}${fields.join(",")}}`;
}

/** The same, for a condition: `{"kind":"count","sel":SELECTOR,"atLeast"?:N}`. */
export function condSignature(kind: Cond["kind"]): string {
  const shape = (t: FieldType): string => {
    if (typeof t === "object") return "enum" in t ? (t.enum.length > 4 ? `${t.enum.slice(0, 3).map((e) => `"${e}"`).join("|")}|…` : t.enum.map((e) => `"${e}"`).join("|")) : "[…]";
    return { selector: "SELECTOR", side: '"you"|"opponent"', cond: "COND", conds: "[COND]", filter: "FILTER", string: '"…"', number: "N", boolean: "true|false", amount: "AMOUNT", ref: "TARGET", area: "AREA", duration: "DURATION", ops: "[…]", price: "PRICE", keyword: '{"name":"Blocker"}', modes: "[…]" }[t];
  };
  const fields = COND_SCHEMA[kind].fields.filter((f) => !f.offCard).map((f) => `"${f.name}"${f.required ? "" : "?"}:${shape(f.type)}`);
  return `{"kind":"${kind}"${fields.length ? "," : ""}${fields.join(",")}}`;
}
