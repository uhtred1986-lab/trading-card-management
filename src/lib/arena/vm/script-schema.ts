import type { CardFilter } from "../text/filters";
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
const AMOUNT_ATTRS = ["power", "originalPower", "comboPower", "energyCost", "comboCost"] as const satisfies readonly AmountAttr[];
export const SIDES = ["you", "opponent", "both"] as const satisfies readonly Side[];
export const SPECIAL_TARGETS = ["self", "attacker", "guard", "subject", "leader", "opponentLeader", "resolving", "onTop"] as const satisfies readonly SpecialTarget[];
export const REPLACE_EVENTS = ["leave", "ko", "play", "life", "attack", "counter"] as const satisfies readonly ReplaceEvent[];
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
export const DURATIONS = ["battle", "turn", "opponentTurn", "nextTurn", "afterNextCharge", "game", "whileSourceInPlay"] as const satisfies readonly Duration[];
const DELAY_TIMINGS = ["turnStart", "mainStart", "turnEnd", "turnCleanup", "battleEnd"] as const satisfies readonly DelayTiming[];
export const MOVE_REASONS = ["ko", "effect", "rule", "cost", "play", "combo", "damage", "draw", "charge"] as const satisfies readonly MoveReason[];
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
 * `printed: false` since a skill grants it rather than the card printing it).
 * `attributes.rules` also declares three derived `of: card` attributes with
 * no `CardDef` field at all (`costOf`, `comboCostOf`, `zEnergyCostOf`,
 * 20-21) — real values the board computes, so `scripts/verify/rulesets.ts`
 * sets those three aside by name rather than by shape.
 */
export const CARD_ATTRIBUTES = ["id", "name", "type", "colors", "energyCost", "zEnergyCost", "power", "comboCost", "comboPower", "skill", "characters", "traits", "back", "specifiedCost", "alsoNames"] as const satisfies readonly (keyof CardDef)[];
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
  placeEnergy: "place cards in the Energy Area",
  beMovedBySkill: "be removed from a Battle Area by skills",
  beNegated: "have their skills negated",
};
const FORBIDDEN_ACTIONS = Object.keys(FORBIDDEN_IN_WORDS) as readonly ForbiddenAction[];

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
  { name: "colors", type: { list: { enum: ["any", ...COLORS] } } },
  { name: "pay", type: { enum: ["none", "life", "program", "energy"] } },
  { name: "n", type: "number" },
  { name: "for", type: { enum: ["counter", "play"] }, default: "counter" },
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
  UNTIL,
];

type OpOf<K extends Op["op"]> = Extract<Op, { op: K }>;

/** `permit`'s fields, named so its sentence can render the `attackActive` case with them. */
const PERMIT_FIELDS: OpField[] = [{ name: "what", type: { enum: ["attackActive", "comboRest", "fieldBattle"] }, required: true }, UNTIL, TARGET, { name: "filter", type: "filter" }];

/** `choose`'s fields, named so its sentence can render the plain case with them. */
const CHOOSE_FIELDS: OpField[] = [
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
        name: "atMost",
        type: "amount",
        offCard: "any number of the selected cards, up to this many read off the board as the choice is made — \"choose any number of your opponent's Battle Cards up to the number of your Hidden Mode cards\" (BT29-139); the selector's count is not read",
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
  damage: { fields: [n(), { name: "side", type: "side", default: "opponent" }], sentence: "deal {n} damage", doc: "life to hand" },
  mill: { fields: [n(), SIDE, { name: "as", type: "string" }], sentence: "{n} from the top of the deck to the Drop", doc: 'deck to Drop; "as" names the cards for a later clause ("if that card is red")' },
  addLife: { fields: [n(), SIDE], sentence: "add {n} to life" },
  lifeDownTo: { fields: [{ name: "n", type: "number", required: true }, SIDE], sentence: "life down to {n}, the cards going to hand", doc: "add cards from life to hand until that many life remain (21-3-2)" },
  shuffle: { fields: [SIDE], sentence: "shuffle" },
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
      return renderTemplate("choose {sel}{sumTo? whose {sumAttr} adds up to exactly {sumTo}}", raw as unknown as Record<string, unknown>, CHOOSE_FIELDS, r ?? {});
    },
    doc: 'binds the chosen cards to the name in "as"; "chooser":"opponent" when the card says *they* choose ("your opponent sends 1 Battle Card…"); "bindX":true also binds X to how many were chosen (20-5)',
  },
  look: {
    fields: [n(), { name: "as", type: "string", required: true }, SIDE, { name: "from", type: POSITION, default: "top" }, { name: "area", type: "area", default: "deck" }],
    sentence: "look at the top {n}",
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
    fields: [TARGET, { name: "mode", type: MODE }, { name: "onto", type: "ref" }, { name: "negated", type: { enum: ["turn", "game"] } }, {
        name: "counterWindow",
        type: "boolean",
        offCard: "opens the [Counter: Play] window a declared play opens (9-6, 22-10) before the card lands — the play a keyword's own move makes ([Arrival], [Revive], [Successor]), where a play a card's skill makes opens none (5-5-3)",
      },
      {
        name: "markers",
        type: "amount",
        offCard: "the markers a Unison arrives with, paid for as its cost (13-2-3) — part of the arrival, so markers a [Empower] carries across land after them (22-45-3, #157); the `playUnison` move's own word",
      },
    ],
    sentence: "play {target}{mode? in {mode} mode}{counterWindow? through a [Counter: Play] window}",
    doc: '"onto" plays it on top of another card ([Union-Absorb], 22-13-6-3); "negated" is "played with its skills negated" (9-1-5)',
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
      const template =
        op.which === "all"
          ? `{target} gains all of the ${kind} of {from}{until}`
          : op.skill != null
            ? "{target} gains skill {skill} of {from}{until}"
            : `choose 1 of the ${kind} of {from}, and {target} gains that skill{until}`;
      return renderTemplate(template, raw as unknown as Record<string, unknown>, COPY_SKILLS_FIELDS, r);
    },
    doc: '20-18: one card takes on another\'s printed skills. "which":"all" copies every one of them, "skill" copies one by its index on the source, and neither lets the master pick one as the skill resolves — which is what "choose up to 1 keyword skill … and this card gains that skill" says. "only":"keyword" narrows the pick and the copy to keyword skills. The printed face is snapshotted when the effect is made (9-9), so the copy outlives the source leaving play',
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
  hidden: { fields: [TARGET, { name: "hidden", type: "boolean", required: true }], sentence: "switch {target} to {hidden:Hidden|Revealed} Mode", doc: "Hidden Mode / Revealed Mode (23-5)" },
  redirectAttack: { fields: [TARGET], sentence: "switch the target of the attack to {target}", doc: '"switch the target of the attack to it" (22-4-2)' },
  swapBattle: {
    fields: [TARGET],
    sentence: "switch your card that's in a battle with {target}",
    doc: '"switch your card that\'s in a battle with this card / the chosen card" (8-1-7-2): the target, your own card in your Battle Area or Leader Area, becomes the attack card or the guard card in place of yours, and the battle goes on with it. Its "when this card attacks / is attacked" are not made pending',
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
    ],
    sentence: "play {n} {name} ({power} power)",
    doc: 'a token (19): {"op":"token","name":"Saibaman Token","power":10000,"comboCost":0,"comboPower":5000,"colors":[],"n":2}',
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
          // "…by {b}{w}" (BT29-140) takes those colours' orbs off, which "costs
          // 2 less" alone would not say.
          const orbs = op.colors?.length ? ` (${op.colors.map((c) => `{${c}}`).join("")})` : "";
          return renderTemplate("{target} costs {amount:less|more}", raw as unknown as Record<string, unknown>, COST_REDUCTION_FIELDS, r) + orbs;
        }
        const noun = op.what === "combo" ? "combo cost" : op.what === "zEnergy" ? "Z-Energy cost" : op.what === "skill" ? "skill cost" : op.what === "evolve" ? "[Evolve] cost" : "cost";
        const scoped = op.skillKind ? ` for [${op.skillKind === "activate" ? "Activate" : op.skillKind === "counter" ? "Counter" : op.skillKind === "auto" ? "Auto" : "Permanent"}] skills` : "";
        // EX03-16: a change scoped to the card the [Evolve] lands on.
        // "The next time you activate …" (BT31-096): spent by the activations it reaches.
        const budget = op.uses == null ? "" : op.uses === 1 ? " the next time it is paid" : ` the next ${op.uses} times it is paid`;
        if (op.onto) return `the ${noun}${scoped} of ${describeRef(op.target)} is ${describeCostChange(op.amount)} when evolving onto ${describeRef(op.onto)}${budget}`;
        return `${describeRef(op.target)}'s ${noun}${scoped} is ${describeCostChange(op.amount)}${budget}`;
      }
      if (op.all) return `${describeRef(op.target)} has no specified cost`;
      const counts = new Map<string, number>();
      for (const c of op.colors ?? []) counts.set(c, (counts.get(c) ?? 0) + 1);
      const orbs = [...counts.entries()].map(([c, n]) => `${n} ${c === "any" ? "energy" : c.toLowerCase()}`).join(", ");
      const amt = typeof op.amount === "number" ? op.amount : 0;
      return `${describeRef(op.target)}'s specified cost is ${amt < 0 ? `${-amt} more` : `${amt} less`}${orbs ? ` (${orbs})` : ""}`;
    },
    doc: '[Permanent] only unless a duration is given (20-21): "reduce the energy cost of your <Son Goku> cards in your hand by 1" — the selector names the area the text names, usually the hand; "skill"/"evolve" are orb costs read by `orbTotals` for one skill on one card, and "onto" scopes an "evolve" change to an [Evolve] played onto those cards (EX03-16: onto: [self]); "zEnergy" is the Z-Energy cost a Z-Card pays from the Z-Energy Area (5-4), read by `zEnergyCostOf`, never `d.zEnergyCost` raw. "specified" is the coloured part of an X-cost card\'s price (owner\'s ruling on BT19-039, 9 Sep 2026): it never touches the total, only which colours `playCost` demands, and `colors` carries the orbs it relaxes — always printed as `{u}`/`{y}{y}`/…, never a bare count. "uses" (with "skill"/"evolve" and a duration) is how many activations the change reaches before it ends — "the next time you activate an [Activate] skill of your Leader during this turn, reduce its skill cost by {b}" (BT31-096) is uses 1, until "turn"; the activation that pays a line it reaches spends one, and "until" still ends it unused.',
  },
  negateKeyword: { fields: [{ name: "keyword", type: { enum: KEYWORD_NAMES }, required: true }, SELF], sentence: "negate the [{keyword}] skill of {target}", doc: 'take one named keyword away ("negate this card\'s [Energy-Exhaust] skill in all areas", 9-1-5); the keyword is its printed name, e.g. "Blocker"' },
  gains: {
    fields: [
      { name: "traits", type: { list: "string" } },
      { name: "characters", type: { list: "string" } },
      { name: "colors", type: { list: { enum: COLORS } } },
      { name: "names", type: { list: "string" } },
      SELF,
    ],
    // A literal brace cannot appear in a template — `renderTemplate` reads it
    // as a field — so a gained card name is written out in words instead.
    sentence: "{target} also counts as{traits? ≪{traits}≫}{characters? <{characters}>}{colors? {colors}}{names? the card named {names}}",
    doc: 'the card counts as having these too, wherever it is ("gains ≪Saiyan≫ in all areas", "is also treated as red", 20-1); "names" is a whole card name it is also treated as ("also treated as {Planet M-2}"), never a replacement for its own',
  },
  replaceLeave: {
    fields: [{ name: "to", type: "area", required: true }, { name: "by", type: { enum: ["skill", "ko", "skillOrKo"] } }, { name: "bySide", type: { enum: ["opponent"] } }, { name: "mode", type: MODE }, { name: "optional", type: "boolean" }, SELF],
    sentence: (raw) => {
      const op = raw as OpOf<"replaceLeave">;
      const whose = op.bySide === "opponent" ? "an opponent's skill" : "a skill";
      const cause = op.by === "ko" ? "be KO'd" : op.by === "skill" ? `be removed from the Battle Area by ${whose}` : op.by === "skillOrKo" ? `be removed from the Battle Area by ${whose} or KO'd` : "leave the Battle Area";
      return `if ${describeRef(op.target ?? { sel: { special: "self" } })} would ${cause}, it ${op.optional ? "may go" : "goes"} to the ${op.to}${op.mode === "rest" ? " in Rest Mode" : ""} instead`;
    },
    doc: '[Permanent] only (9-10): "if this card would be KO\'d, send it to the Warp instead". "by" is which departure it replaces: omitted = any, "skill" = removed by an effect, "ko" = the KO, "skillOrKo" = either. "bySide" narrows that to the opponent\'s skill. "optional" is 9-10-3\'s "you may". Omit "target" for this card',
  },
  replace: {
    fields: [
      { name: "event", type: { enum: REPLACE_EVENTS }, required: true },
      { name: "with", type: "ops", required: true },
      { name: "by", type: { enum: ["skill", "ko", "skillOrKo"] } },
      { name: "bySide", type: { enum: ["opponent"] } },
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
      const whose = op.bySide === "opponent" ? "an opponent's skill" : "a skill";
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
                  : `${who} would leave the Battle Area`;
      return `if ${moment}, ${op.optional ? "you may have this happen" : "this happens"} instead: ${describeScript(op.with, r)}`;
    },
    doc: 'an event happens differently, or not at all (9-10) — the primitive "replaceLeave" and the "instead" half of "resolvingPlay" are macros over. "event" is the moment: "leave" (the card would leave the Battle Area, narrowed by "by", and by "bySide" to the opponent\'s skill), "ko" (it would be KO\'d), "play" (the play being resolved, 9-6, [Counter: Play] only), "life" (a life card\'s own move to the hand or the Drop Area, 8-4-6-1\'s damage — narrowed by "to", absent for either destination; "by"/"bySide" mean nothing here, since nobody\'s skill puts a card out of the life area), "attack" (the attack in progress, 8-1-6-1) and "counter" (the [Counter] this one answers, 9-7) — those two only with an empty "with", read back as "negateAttack"/"negateCounter" (#137). "by":"ko" on a "leave" is the same moment as "ko", the spelling "replaceLeave" lowers to. "with" is what happens in its place: one move of the card itself is a redirect, anything else is a substitute — the departure does not happen at all, the card stays, and the program runs with it bound as "subject". It may ask a question, and then it only applies where somebody can hear it (#107, #272); "optional" is 9-10-3\'s "you may". A "leave"/"ko"/"life" replacement is [Permanent] only — or, for "leave", the leaf of a keyword\'s wouldLeave hook: [Ultimate]\'s "removed from the game instead" (22-14-3), read as a redirect after any [Permanent]\'s',
  },
  altCost: {
    fields: [
      { name: "pay", type: { enum: ["none", "life", "program", "energy"] }, required: true },
      { name: "n", type: "number" },
      { name: "for", type: { enum: ["counter", "play"] }, default: "counter" },
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
      return `${op.for === "play" ? `${who} may be played` : `${who}'s [Counter] may be activated`} ${price}${until}`;
    },
    doc: 'another way to pay for a [Counter] (or a play, "for":"play") (5-3) — "none", "life" (n cards), a reduced "energy" price ("orbs"), or a "program" the card asks for instead. Printed on the card itself this is [Permanent]-only and omits "target"/"until"; a card that grants it to *other* cards for a span carries both — "Until the start of your next turn, you can activate mono-blue cards with [Counter] skills from your hand by …" (BT11-033)',
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
          ? "the card being played is played in Rest Mode"
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
      { name: "sameNameAsSelf", type: "boolean" },
      { name: "bySkill", type: "boolean" },
      { name: "uses", type: "amount" },
      { name: "unless", type: "cond" },
      { name: "unlessPay", type: "ops" },
    ],
    sentence: (raw, r) => {
      const op = raw as OpOf<"forbid">;
      // A rule aimed at a card reads the other way round: the card is what is
      // played, not what plays. "You can't play …" is the player's version.
      const who = op.target ? describeRef(op.target) : op.side === "opponent" ? "your opponent" : "you";
      const what = op.target && op.what === "play" ? `be played${op.bySkill === true ? " by a skill" : op.bySkill === false ? " except by a skill" : ""}` : FORBIDDEN_IN_WORDS[op.what];
      // Which cards the ban is about, when it is about cards rather than the
      // player: "you can't play cards" said nothing about *which*.
      const which = op.sameNameAsSelf ? "another copy of this card" : op.filter ? describeFilter(op.filter) : "";
      // "…can't play **cards**" already names the object, so a description
      // of *which* cards replaces that word rather than following it.
      const verb = which ? what.replace(/\s+cards?$/, "") : what;
      const budget = op.uses != null ? ` ${op.uses === 1 ? "once more" : `${describeAmount(op.uses)} more times`}` : "";
      // 20-14-1's price, said from the payer's side: the program's "you" is
      // whoever takes the action, not this card's controller.
      const escape = op.unless ? ` unless ${describeCond(op.unless)}` : op.unlessPay?.length ? ` unless, each time, the player doing it first pays: ${describeScript(op.unlessPay)}` : "";
      return `${who} can't ${verb}${which ? ` ${which}` : ""}${budget}${escape}${forThe(op.until, r)}`;
    },
    doc: `forbid an action (20-14): a "target" for a rule about particular cards, or a "side" for one about a player, narrowed by a "filter"; "sameNameAsSelf":true narrows a play rule to copies of this card; "uses" is how many times that action may still happen before the prohibition starts applying, and "unless" is the escape condition. "unlessPay" is 20-14-1's other escape, a price: a program the acting player runs, in their own frame ("you" is whoever acts), before the action and every time they take it — refused when they cannot pay it; only "what":"attack" takes one so far (BT30-100). "what" is one of ${FORBIDDEN_ACTIONS.map((w) => `"${w}"`).join(" | ")}`,
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
      if (op.what === "fieldBattle") return `the [Field] skill on ${describeRef(op.target)} in your hand can also be activated at [Activate: Battle] timings`;
      return renderTemplate("{target} can attack {filter:cards} in Active Mode{until}", raw as unknown as Record<string, unknown>, PERMIT_FIELDS, r);
    },
    doc: 'a rule of the game a card may lift: "this card can attack Battle Cards in Active Mode" (8-1-1, "attackActive"), or "you can use your … Rest Mode … cards in combos" (5-7, "comboRest", whose target is the card granting it), or "the [Field] skill on this card in your hand can also be activated at [Activate: Battle] timings" (22-3, "fieldBattle", BT29-041/-042: read from the hand, where the [Field] line is used, and offered at the combo prompt as well as the Main Phase). The filter says *which* cards — leave it out only when the card does',
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
  note: { fields: [{ name: "text", type: "string", required: true }], sentence: "", doc: "a remark in the log; does nothing" },
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
      const chars = f.characters.map((x, i) => `<${x}>${f.onlyCharacters && i === f.characters.length - 1 ? "-only" : ""}`);
      const traits = f.traits.map((x) => `\u226a${x}\u226b`);
      const bits = [...f.colors, ...(f.characterOrTrait && chars.length && traits.length ? [...chars, "or", ...traits] : [...chars, ...traits])];
      return `${c.side === "opponent" ? "their" : "your"} leader${c.back ? "'s back side" : ""} is ${bits.join(" ") || f.names?.join("/") || "a match"}`;
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
  all: { fields: [{ name: "conds", type: "conds", required: true }], sentence: (raw) => (raw as CondOf<"all">).conds.map(describeCond).join(" and "), doc: "every condition holds (conjunction)" },
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
    ],
    sentence: (raw) => `a rule in force stops you ${FORBIDDEN_IN_WORDS[(raw as CondOf<"forbidden">).what]}`,
    doc: 'whether a prohibition in force (20-14) stops this, asked of the card and the player the move is about. No card says this — it is the word a `DEFINE ACTION`\'s `REFUSE` gates a move on, and it is the same predicate `forbids()` is. "bySkill" tells the two halves of one wording apart: false is a move the player declares ("…except by skills"), true a move a skill makes',
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
  covers: {
    fields: [
      { name: "sel", type: "selector", required: true },
      { name: "colors", type: { list: { enum: COLORS } }, required: true },
    ],
    sentence: (raw) => {
      const c = raw as CondOf<"covers">;
      return `${describeSelector(c.sel, "")} carry ${c.colors.join(" and ")} between them`;
    },
    doc: "do these cards carry every one of the colours between them — one card of each, or one multicolour card for two? [Arrival]'s Combo Area and [Revive]'s hand (22-29-3, 22-34-3), with the colours bound off the printed keyword (`colors: $colors`). A `DEFINE KEYWORD` body's word; no card's record says this (#155)",
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
  every:          "macro over `count` + `not`",
  any:            "primitive",
  all:            "macro over `any` + `not`",
  leaderFlipped:  "macro over `count`",
  power:          "macro over `count`",
  did:            "primitive",
  not:            "primitive",
  chose:          "macro over `count`",
  varMatches:     "macro over `count`",
  isTurnPlayer:   "primitive",
  asking:         "primitive",
  forbidden:      "primitive",
  playerAttr:     "primitive",
  sameCard:       "primitive",
  flag:           "primitive",
  oneOf:          "primitive",
  eachNamed:      "primitive",
  covers:         "primitive",
  sumsTo:         "primitive",
  attacked:       "macro over `count`",
  markerSkillUsed: "macro over `count`",
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
export const CONDITIONS_OFF_A_CARD: readonly Cond["kind"][] = ["asking", "forbidden", "flag", "oneOf", "eachNamed", "covers", "sumsTo", "attacked", "markerSkillUsed"];

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
  if (!Array.isArray(ops) || depth > 4) return false;
  // 20-5: X is legal only once something has bound it — the price, said by
  // `CostRecord.x` and passed in as `xBound`, or a `choose` earlier in this
  // same program carrying `bindX`. A step is checked against what is bound
  // *before* it, so "draw X, then choose X cards" is refused and "choose any
  // number of cards, then draw X" is not.
  let bound = xBound;
  for (const raw of ops) {
    if (!raw || typeof raw !== "object") return false;
    const o = raw as Record<string, unknown>;
    const spec = typeof o.op === "string" ? OP_SCHEMA[o.op as Op["op"]] : undefined;
    if (!spec) return false;
    const ok = spec.fields.every((f) => {
      const v = o[f.name];
      if (v === undefined) return !f.required;
      if (v === null) return !!f.nullable;
      return fieldHolds(f.type, v, depth, bound);
    });
    if (!ok) return false;
    // 20-14-1: a tax is charged where the action is taken, and only the attack
    // charges one so far — a price on any other action would be a rule that
    // silently stopped forbidding anything.
    if (o.op === "forbid" && o.unlessPay !== undefined && (o.what !== "attack" || !(o.unlessPay as unknown[]).length || o.unless !== undefined)) return false;
    if (o.op === "choose" && o.bindX === true) bound = true;
  }
  return true;
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

function selectorHolds(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const special = (v as { special?: unknown }).special;
  return special === undefined || (SPECIAL_TARGETS as readonly string[]).includes(special as string);
}

/**
 * A condition's shape, from `COND_SCHEMA`. Until this existed the validator
 * asked only for a `kind`, so a condition missing the selector it counts was
 * stored happily and threw when a game read it.
 */
function condShapeHolds(v: unknown, depth: number, xBound: boolean): boolean {
  if (typeof v !== "object" || v === null || depth > 4) return false;
  const c = v as Record<string, unknown>;
  const spec = typeof c.kind === "string" ? COND_SCHEMA[c.kind as Cond["kind"]] : undefined;
  if (!spec) return false;
  return spec.fields.every((f) => {
    const x = c[f.name];
    if (x === undefined) return !f.required;
    if (x === null) return !!f.nullable;
    return fieldHolds(f.type, x, depth, xBound);
  });
}

function fieldHolds(type: FieldType, v: unknown, depth: number, xBound: boolean): boolean {
  if (typeof type === "object") {
    if ("enum" in type) return typeof v === "string" && type.enum.includes(v);
    return Array.isArray(v) && v.every((x) => (type.list === "string" ? typeof x === "string" : typeof x === "string" && type.list.enum.includes(x)));
  }
  switch (type) {
    case "amount":
      if (readsUnboundX(v, xBound)) return false;
      if (!perHolds(v)) return false;
      return typeof v === "number" || (typeof v === "object" && v !== null);
    // A ref is a bound name or a selector — a bare selector written where a
    // ref belongs ({"special":"self"} for {"sel":{"special":"self"}}) is the
    // mistake Claude makes most, and read as a ref it threw while being
    // described. Refused here, it comes back as "not a valid program".
    case "ref":
      return typeof v === "object" && v !== null && (typeof (v as { var?: unknown }).var === "string" || selectorHolds((v as { sel?: unknown }).sel));
    case "selector":
      return selectorHolds(v);
    case "cond":
      return condShapeHolds(v, depth, xBound);
    case "conds":
      return Array.isArray(v) && v.length > 0 && v.every((c) => condShapeHolds(c, depth + 1, xBound));
    case "filter":
      return typeof v === "object" && v !== null;
    case "keyword":
      return typeof v === "object" && v !== null && typeof (v as { name?: unknown }).name === "string";
    case "side":
      return typeof v === "string" && (SIDES as readonly string[]).includes(v);
    case "area":
      return typeof v === "string" && (AREAS as readonly string[]).includes(v);
    case "duration":
      return typeof v === "string" && (DURATIONS as readonly string[]).includes(v);
    case "ops":
      return validateProgram(v, depth + 1, xBound);
    case "modes":
      return Array.isArray(v) && v.length > 0 && v.every((m) => !!m && typeof m === "object" && validateProgram((m as { ops?: unknown }).ops, depth + 1, xBound));
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
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

export function describeFilter(f: CardFilter, noun?: FilterNoun): string {
  const bits: string[] = [];
  if (f.monoColor) bits.push("mono-colour");
  if (f.multiColor) bits.push("multicolour");
  bits.push(...f.colors.map((c) => c.toLowerCase()));
  // Every measure that *narrows by exclusion* was silent until 9 Sep 2026,
  // and a measure the reading drops always reads as the wider filter — the
  // one direction ground rule 5 forbids. "Non-black Battle Cards" printed as
  // "battle card" is the same sentence as no filter at all.
  bits.push(...f.notColors.map((c) => `non-${c.toLowerCase()}`));
  bits.push(...f.traits.map((x) => `≪${x}≫`));
  bits.push(...f.notTraits.map((x) => `non-≪${x}≫`));
  // "≪Brainwashed≫ or <Baby>" (BT29-114): the one word that makes it either,
  // and the word `parseFilter` reads the flag back from.
  if (f.characterOrTrait && f.traits.length && f.characters.length) bits.push("or");
  // "<Son Goku>-only" (BT29-108), on the last character named, as printed.
  bits.push(...f.characters.map((x, i) => `<${x}>${f.onlyCharacters && i === f.characters.length - 1 ? "-only" : ""}`));
  bits.push(...f.notCharacters.map((x) => `non-<${x}>`));
  bits.push(...f.names.map((x) => `{${x}}`));
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
  // The noun has to be settled before the trailing measures are hung off it,
  // and a name asked for **in part** is one of those — printed after the word
  // it qualifies, the way the card prints it.
  const partial = [
    ...f.charactersIncluding.map((x) => `with <${x}> in its character name`),
    ...f.namesIncluding.map((x) => `with {${x}} in its card name`),
    ...f.notCharactersIncluding.map((x) => `without <${x}> in its character name`),
    ...f.notNamesIncluding.map((x) => `without {${x}} in its card name`),
    // A name the target must *not* have. Written the way the cards write it,
    // which is also the only wording `parseFilter` reads it back from.
    ...f.notNames.map((x) => `other than {${x}}`),
    // "…with [Blocker]", "…with an [Evolve] skill", "…with [Counter] skills".
    // One "with" apiece rather than a list, so the phrase reads back as the
    // same set of keywords it printed.
    ...f.keywords.map((k) => `with [${k}]`),
    ...f.notKeywords.map((k) => `non-[${k}]`),
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
  if (f.powerRel) bits.push(`with power ${POWER_REL_WORDS[f.powerRel.cmp]} ${f.powerRel.of === "chosen" ? "the chosen card's" : "this card's"} power`);
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
  const owner = sel.side === "opponent" ? "your opponent's" : sel.side === "both" ? "each player's" : "your";
  const has = sel.side === "opponent" ? "your opponent has" : sel.side === "both" ? "either player has" : "you have";
  const zones = areas.filter((a) => a !== "play" && a !== "under" && a !== "removed").map((a) => ZONE_NOUNS[a as keyof typeof ZONE_NOUNS] ?? a);
  const parts: string[] = [];
  if (zones.length) parts.push(`in ${owner} ${zones.join(" or ")}`);
  if (areas.includes("play")) parts.push(`${has} in play`);
  if (areas.includes("under")) parts.push(`under ${owner} cards`);
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
        : sel.count === 99
          ? "all"
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
  return [count, words, where].filter(Boolean).join(" ") + mode + describeNotSelf(sel);
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
  (sel.printed ? " matching the description printed on this line" : "");

function describeRef(ref: Ref): string {
  return "var" in ref ? "the chosen cards" : describeSelector(ref.sel);
}

/**
 * A number in words. With a `noun` ("power") it is the signed change cards
 * print — "+5000 power", "+5000 power for each of your Battle Cards" — so the
 * noun sits next to the number rather than at the end of the sentence.
 */
/** The measures `attr` and `sumOf` read, as a person names them. */
const ATTR_NOUNS: Record<AmountAttr, string> = { power: "power", originalPower: "original power", comboPower: "combo power", energyCost: "energy cost", comboCost: "combo cost" };

function describeAmount(a: Amount, noun?: string): string {
  if (noun) {
    if (typeof a === "number") return `${a >= 0 ? "+" : ""}${a} ${noun}`;
    if ("plus" in a) return `${describeAmount(a.plus[0], noun)} and ${a.plus[1] < 0 ? `${-a.plus[1]} less` : `${a.plus[1]} more`}`;
    if ("count" in a) return `+${a.times ?? 1} ${noun} ${forEvery(a.per)} of ${describeEach(a.count)}`;
    if ("markers" in a) return `+${a.times ?? 1} ${noun} ${forEvery(a.per, "marker")} on ${describeEach(a.markers)}`;
    if ("x" in a) return a.times === undefined ? `+X ${noun}` : `+${a.times} ${noun} for each X`;
    if ("life" in a) return `+${a.times ?? 1} ${noun} ${forEvery(a.per, "life", "life")} ${a.life === "opponent" ? "your opponent has" : a.life === "both" ? "either player has" : "you have"}`;
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
  const who = sel.side === "opponent" ? "their " : sel.side === "both" ? "" : "your ";
  // A Hidden Mode card has no card type (23-5-2), so it is not a "Battle
  // Card" or a "Unison Card" to count: "your Hidden Mode cards", and the area
  // only when the selector names one.
  if (sel.hidden === true && !sel.filter && !sel.mode) {
    const areas = sel.areas?.length ? sel.areas : [sel.area ?? "play"];
    const where = areas.length === 1 && areas[0] !== "play" ? ` in ${who}${ZONE_NOUNS[areas[0] as keyof typeof ZONE_NOUNS] ?? areas[0]}` : "";
    return `${who}Hidden Mode cards${where}${describeNotSelf(sel)}`;
  }
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
  game: " for the rest of the game",
  whileSourceInPlay: " while this card is in a Battle Area",
};
const forThe = (until: Duration | undefined, r: RenderOptions) => (r.permanent || !until ? "" : DURATION_IN_WORDS[until]);

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
 * The op's shape as the referee is shown it: `{"op":"draw","n":AMOUNT,"side"?:SIDE}`.
 * Optional fields carry a `?`; the placeholders are defined once under the list.
 */
export function opSignature(name: Op["op"]): string {
  const shape = (t: FieldType): string => {
    if (typeof t === "object") {
      if ("enum" in t) return t.enum.length > 6 ? `${t.enum.slice(0, 3).map((e) => `"${e}"`).join("|")}|…` : t.enum.map((e) => `"${e}"`).join("|");
      return t.list === "string" ? '["…"]' : `[${t.list.enum.map((e) => `"${e}"`).join("|")}]`;
    }
    return { amount: "AMOUNT", ref: "TARGET", selector: "SELECTOR", side: '"you"|"opponent"', area: "AREA", duration: "DURATION", cond: "COND", conds: "[COND]", ops: "[…]", string: '"…"', number: "N", boolean: "true|false", keyword: '{"name":"Blocker"}', filter: "FILTER", modes: '[{"label":"…","ops":[…]}]' }[t];
  };
  const fields = OP_SCHEMA[name].fields.filter((f) => !f.offCard).map((f) => `"${f.name}"${f.required ? "" : "?"}:${shape(f.type)}`);
  return `{"op":"${name}"${fields.length ? "," : ""}${fields.join(",")}}`;
}

/** The same, for a condition: `{"kind":"count","sel":SELECTOR,"atLeast"?:N}`. */
export function condSignature(kind: Cond["kind"]): string {
  const shape = (t: FieldType): string => {
    if (typeof t === "object") return "enum" in t ? (t.enum.length > 4 ? `${t.enum.slice(0, 3).map((e) => `"${e}"`).join("|")}|…` : t.enum.map((e) => `"${e}"`).join("|")) : "[…]";
    return { selector: "SELECTOR", side: '"you"|"opponent"', cond: "COND", conds: "[COND]", filter: "FILTER", string: '"…"', number: "N", boolean: "true|false", amount: "AMOUNT", ref: "TARGET", area: "AREA", duration: "DURATION", ops: "[…]", keyword: '{"name":"Blocker"}', modes: "[…]" }[t];
  };
  const fields = COND_SCHEMA[kind].fields.filter((f) => !f.offCard).map((f) => `"${f.name}"${f.required ? "" : "?"}:${shape(f.type)}`);
  return `{"kind":"${kind}"${fields.length ? "," : ""}${fields.join(",")}}`;
}
