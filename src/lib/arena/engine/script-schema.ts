import type { CardFilter } from "./filters";
// `AmountAttr` and `CardAttr` are deliberately two lists, not one: `CardAttr`
// is what `modifyAttr` may *write* (colours, characters, traits and names among
// them, which are lists), `AmountAttr` what an amount may *read as a number*.
// Collapsing them would let `attr($t, colors)` stand where a number belongs.
import type { Amount, AmountAttr, CardAttr, Cond, Duration, Op, Ref, ReplaceEvent, ScriptArea, Selector, Side, SpecialTarget } from "./script";
import type { Area, CardDef, Color, DelayScope, DelayTiming, ForbiddenAction, KeywordSkill, Phase, Prompt, SkillKindPrefix } from "./types";

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
 */
const COLORS = ["Red", "Blue", "Green", "Yellow", "Black", "White", "Colorless"] as const satisfies readonly Color[];
export const SIDES = ["you", "opponent", "both"] as const satisfies readonly Side[];
export const SPECIAL_TARGETS = ["self", "attacker", "guard", "subject", "leader", "opponentLeader", "resolving", "onTop"] as const satisfies readonly SpecialTarget[];
export const REPLACE_EVENTS = ["leave", "ko", "play"] as const satisfies readonly ReplaceEvent[];
export const AREAS = ["hand", "deck", "drop", "life", "battle", "combo", "energy", "unison", "leader", "warp", "zDeck", "zEnergy", "under", "play", "removed"] as const satisfies readonly ScriptArea[];
export const CARD_ATTRS = ["power", "comboPower", "colors", "characters", "traits", "names"] as const satisfies readonly CardAttr[];
export const DURATIONS = ["battle", "turn", "opponentTurn", "nextTurn", "afterNextCharge", "game"] as const satisfies readonly Duration[];
const DELAY_TIMINGS = ["turnStart", "mainStart", "turnEnd", "turnCleanup", "battleEnd"] as const satisfies readonly DelayTiming[];
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
export const AREA_NAMES = ["hand", "deck", "drop", "life", "battle", "combo", "energy", "unison", "leader", "warp", "zDeck", "zEnergy", "removed"] as const satisfies readonly Area[];
type MissingArea = Exclude<Area, (typeof AREA_NAMES)[number]>;
const _everyAreaListed: MissingArea extends never ? true : never = true;
void _everyAreaListed;

export const PHASES = ["setup", "charge", "main", "mainEnd", "end", "over"] as const satisfies readonly Phase[];
type MissingPhase = Exclude<Phase, (typeof PHASES)[number]>;
const _everyPhaseListed: MissingPhase extends never ? true : never = true;
void _everyPhaseListed;

/**
 * Every `Prompt["kind"]` (`engine/types.ts`), so `scripts/verify/rulesets.ts`
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
/** `costReduction`'s fields, named so its `sentence` function (below) can hand them to `renderTemplate` for the non-"specified" branch without reaching into `OP_SCHEMA` mid-construction. */
const COST_REDUCTION_FIELDS: OpField[] = [
  TARGET,
  { name: "amount", type: "amount", required: true },
  { name: "what", type: { enum: ["energy", "skill", "evolve", "combo", "zEnergy", "specified"] }, default: "energy" },
  { name: "skillKind", type: { enum: SKILL_KIND_PREFIXES } },
  { name: "colors", type: { list: { enum: ["any", ...COLORS] } } },
  { name: "until", type: "duration" },
];
/** `modifyAttr`'s fields, named for the same reason `costReduction`'s are: its `sentence` hands them to `renderTemplate` for the two numeric attributes. */
const MODIFY_ATTR_FIELDS: OpField[] = [
  { name: "target", type: "ref", default: { sel: { special: "self" } } },
  { name: "attr", type: { enum: CARD_ATTRS }, required: true },
  { name: "amount", type: "amount", default: 0 },
  { name: "values", type: { list: "string" } },
  { name: "until", type: "duration" },
];
const SELF: OpField = { name: "target", type: "ref", default: { sel: { special: "self" } } };
const UNTIL: OpField = { name: "until", type: "duration", required: true };
const MODE = { enum: ["active", "rest"] } as const;
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

export const OP_SCHEMA: Record<Op["op"], OpSpec> = {
  draw: { fields: [n(), SIDE], sentence: "{side:opponent draws|draw} {n}" },
  discard: { fields: [n(), SIDE, { name: "to", type: { enum: ["warp"] } }], sentence: "{side:opponent discards|discard} {n}{to? to the Warp}", doc: 'cards leave a hand for the Drop (20-7); "to":"warp" for the Warp' },
  damage: { fields: [n(), SIDE], sentence: "deal {n} damage", doc: "life to hand" },
  mill: { fields: [n(), SIDE, { name: "as", type: "string" }], sentence: "{n} from the top of the deck to the Drop", doc: 'deck to Drop; "as" names the cards for a later clause ("if that card is red")' },
  addLife: { fields: [n(), SIDE], sentence: "add {n} to life" },
  lifeDownTo: { fields: [{ name: "n", type: "number", required: true }, SIDE], sentence: "life down to {n}, the cards going to hand", doc: "add cards from life to hand until that many life remain (21-3-2)" },
  shuffle: { fields: [SIDE], sentence: "shuffle" },
  energyMarker: { fields: [n(), SIDE], sentence: "{n} energy marker" },
  choose: {
    fields: [
      { name: "sel", type: "selector", required: true },
      { name: "as", type: "string", required: true },
      { name: "reason", type: "string" },
      { name: "chooser", type: "side" },
      { name: "bindX", type: "boolean" },
    ],
    sentence: "choose {sel}",
    doc: 'binds the chosen cards to the name in "as"; "chooser":"opponent" when the card says *they* choose ("your opponent sends 1 Battle Card…"); "bindX":true also binds X to how many were chosen (20-5)',
  },
  look: {
    fields: [n(), { name: "as", type: "string", required: true }, SIDE, { name: "from", type: POSITION, default: "top" }, { name: "area", type: "area", default: "deck" }],
    sentence: "look at the top {n}",
    doc: "top of your deck, seen only by you; the cards are bound to the name in \"as\" (20-11)",
  },
  reveal: { fields: [{ name: "sel", type: "selector", required: true }, { name: "as", type: "string", required: true }], sentence: "reveal {sel}", doc: "shown to both players; the cards stay where they are (20-11-2)" },
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
    ],
    sentence: "move {target} to {to}{faceUp? face up}",
    doc: '"to":"under" puts the card under "under" (or under this card, 23-2); "owner":"opponent" for "place it in your opponent\'s energy" — the area is theirs, not the card owner\'s (3-8)',
  },
  play: {
    fields: [TARGET, { name: "mode", type: MODE }, { name: "onto", type: "ref" }, { name: "negated", type: { enum: ["turn", "game"] } }],
    sentence: "play {target}{mode? in {mode} mode}",
    doc: '"onto" plays it on top of another card ([Union-Absorb], 22-13-6-3); "negated" is "played with its skills negated" (9-1-5)',
  },
  switchMode: { fields: [TARGET, { name: "mode", type: MODE, required: true }], sentence: "switch {target} to {mode} mode" },
  modifyAttr: {
    fields: MODIFY_ATTR_FIELDS,
    // Two sentences, because the two numbers and the four lists are different
    // sentences in English: "+5000 power for the turn" against "also counts
    // as ≪Saiyan≫". They are the same mechanism, which is the point of the
    // row, but a reading that said "power: +≪Saiyan≫" would be worse than no
    // row at all.
    sentence: (raw, r) => {
      const op = raw as OpOf<"modifyAttr">;
      if (op.attr === "power" || op.attr === "comboPower")
        return renderTemplate(`{target} {amount:${op.attr === "power" ? "power" : "combo power"}}{until}`, raw as unknown as Record<string, unknown>, MODIFY_ATTR_FIELDS, r);
      const words = (op.values ?? []).join(", ");
      const said = op.attr === "traits" ? `\u226a${words}\u226b` : op.attr === "characters" ? `<${words}>` : op.attr === "names" ? `the card named ${words}` : words;
      return `${describeRef(op.target ?? { sel: { special: "self" } })} also counts as ${said}${forThe(op.until, r)}`;
    },
    doc: 'the primitive under "power", "comboPower" and "gains" (docs/arena-ruleset-spec.md §2.3): one attribute of one card, "amount" for the two numbers and "values" for the lists it also counts as. Those three spellings are still what the compiler writes and what a stored rule holds — prefer them; this row is what they mean',
  },
  power: {
    fields: [TARGET, { name: "amount", type: "amount", required: true }, UNTIL],
    sentence: "{target} {amount:power}{until}",
    doc: 'an amount may also be {"count":SELECTOR,"times":5000} (so much for each card), {"sumPower":{"var":"rested"}} (the total power of named cards) or {"sumOf":SELECTOR,"attr":"comboPower"} (any measure of them, added up)',
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
  negateSkills: { fields: [TARGET, UNTIL], sentence: "negate the skills of {target}{until}" },
  negateSkillsOfKind: {
    fields: [TARGET, { name: "kind", type: { enum: SKILL_KIND_PREFIXES }, required: true }, UNTIL],
    sentence: "negate the [{kind:auto=Auto|activate=Activate|counter=Counter|permanent=Permanent}] skills of {target}{until}",
    doc: '"negate that card\'s [Auto] skill for the turn" — one kind, not the whole card (9-1-5)',
  },
  hidden: { fields: [TARGET, { name: "hidden", type: "boolean", required: true }], sentence: "switch {target} to {hidden:Hidden|Revealed} Mode", doc: "Hidden Mode / Revealed Mode (23-5)" },
  redirectAttack: { fields: [TARGET], sentence: "switch the target of the attack to {target}", doc: '"switch the target of the attack to it" (22-4-2)' },
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
          return renderTemplate("{target} costs {amount:less|more}", raw as unknown as Record<string, unknown>, COST_REDUCTION_FIELDS, r);
        }
        const noun = op.what === "combo" ? "combo cost" : op.what === "zEnergy" ? "Z-Energy cost" : op.what === "skill" ? "skill cost" : op.what === "evolve" ? "[Evolve] cost" : "cost";
        const scoped = op.skillKind ? ` for [${op.skillKind === "activate" ? "Activate" : op.skillKind === "counter" ? "Counter" : op.skillKind === "auto" ? "Auto" : "Permanent"}] skills` : "";
        return `${describeRef(op.target)}'s ${noun}${scoped} is ${describeCostChange(op.amount)}`;
      }
      const counts = new Map<string, number>();
      for (const c of op.colors ?? []) counts.set(c, (counts.get(c) ?? 0) + 1);
      const orbs = [...counts.entries()].map(([c, n]) => `${n} ${c === "any" ? "energy" : c.toLowerCase()}`).join(", ");
      const amt = typeof op.amount === "number" ? op.amount : 0;
      return `${describeRef(op.target)}'s specified cost is ${amt < 0 ? `${-amt} more` : `${amt} less`}${orbs ? ` (${orbs})` : ""}`;
    },
    doc: '[Permanent] only unless a duration is given (20-21): "reduce the energy cost of your <Son Goku> cards in your hand by 1" — the selector names the area the text names, usually the hand; "skill"/"evolve" are orb costs read by `orbTotals` for one skill on one card; "zEnergy" is the Z-Energy cost a Z-Card pays from the Z-Energy Area (5-4), read by `zEnergyCostOf`, never `d.zEnergyCost` raw. "specified" is the coloured part of an X-cost card\'s price (owner\'s ruling on BT19-039, 9 Sep 2026): it never touches the total, only which colours `playCost` demands, and `colors` carries the orbs it relaxes — always printed as `{u}`/`{y}{y}`/…, never a bare count.',
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
    fields: [{ name: "to", type: "area", required: true }, { name: "by", type: { enum: ["skill", "ko", "skillOrKo"] } }, { name: "mode", type: MODE }, { name: "optional", type: "boolean" }, SELF],
    sentence: (raw) => {
      const op = raw as OpOf<"replaceLeave">;
      const cause = op.by === "ko" ? "be KO'd" : op.by === "skill" ? "be removed from the Battle Area by a skill" : op.by === "skillOrKo" ? "be removed from the Battle Area by a skill or KO'd" : "leave the Battle Area";
      return `if ${describeRef(op.target ?? { sel: { special: "self" } })} would ${cause}, it ${op.optional ? "may go" : "goes"} to the ${op.to}${op.mode === "rest" ? " in Rest Mode" : ""} instead`;
    },
    doc: '[Permanent] only (9-10): "if this card would be KO\'d, send it to the Warp instead". "by" is which departure it replaces: omitted = any, "skill" = removed by an effect, "ko" = the KO, "skillOrKo" = either. "optional" is 9-10-3\'s "you may". Omit "target" for this card',
  },
  replace: {
    fields: [
      { name: "event", type: { enum: REPLACE_EVENTS }, required: true },
      { name: "with", type: "ops", required: true },
      { name: "by", type: { enum: ["skill", "skillOrKo"] } },
      { name: "optional", type: "boolean" },
      SELF,
    ],
    sentence: (raw, r) => {
      const op = raw as OpOf<"replace">;
      const who = describeRef(op.target ?? { sel: { special: "self" } });
      const moment =
        op.event === "play"
          ? "the card being played would be played"
          : op.event === "ko"
            ? `${who} would be KO'd`
            : op.by === "skill"
              ? `${who} would be removed from the Battle Area by a skill`
              : op.by === "skillOrKo"
                ? `${who} would be removed from the Battle Area by a skill or KO'd`
                : `${who} would leave the Battle Area`;
      return `if ${moment}, ${op.optional ? "you may have this happen" : "this happens"} instead: ${describeScript(op.with, r)}`;
    },
    doc: 'an event happens differently, or not at all (9-10) — the primitive "replaceLeave" and the "instead" half of "resolvingPlay" are macros over. "event" is the moment: "leave" (the card would leave the Battle Area, narrowed by "by"), "ko" (it would be KO\'d), "play" (the play being resolved, 9-6, [Counter: Play] only). "with" is what happens in its place: one move of the card itself is a redirect, anything else is a substitute — the departure does not happen at all, the card stays, and the program runs with it bound as "subject". It may not ask a question (see #107), and a "leave"/"ko" replacement is [Permanent] only',
  },
  altCost: {
    fields: [
      { name: "pay", type: { enum: ["none", "life", "program", "energy"] }, required: true },
      { name: "n", type: "number" },
      { name: "for", type: { enum: ["counter", "play"] }, default: "counter" },
      { name: "ops", type: "ops" },
      { name: "orbs", type: { list: { enum: ["any", ...COLORS] } } },
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
            : op.pay === "energy"
              ? `for ${(op.orbs ?? []).map((o) => (o === "any" ? "{any}" : `{${o}}`)).join("")}`
              : `by adding ${op.n ?? 1} from your life to your hand`;
      const who = op.target ? describeRef(op.target) : "this card";
      const until = op.until ? ` until ${op.until === "game" ? "the game ends" : op.until}` : "";
      return `${op.for === "play" ? `${who} may be played` : `${who}'s [Counter] may be activated`} ${price}${until}`;
    },
    doc: 'another way to pay for a [Counter] (or a play, "for":"play") (5-3) — "none", "life" (n cards), a reduced "energy" price ("orbs"), or a "program" the card asks for instead. Printed on the card itself this is [Permanent]-only and omits "target"/"until"; a card that grants it to *other* cards for a span carries both — "Until the start of your next turn, you can activate mono-blue cards with [Counter] skills from your hand by …" (BT11-033)',
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
  negateOwnSkill: { fields: [{ name: "until", type: { enum: ["turn", "battle"] } }], sentence: "this skill does not happen again", doc: '"negate this skill for the game / turn / battle" (9-1-5)' },
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
      const escape = op.unless ? ` unless ${describeCond(op.unless)}` : "";
      return `${who} can't ${verb}${which ? ` ${which}` : ""}${budget}${escape}${forThe(op.until, r)}`;
    },
    doc: `forbid an action (20-14): a "target" for a rule about particular cards, or a "side" for one about a player, narrowed by a "filter"; "sameNameAsSelf":true narrows a play rule to copies of this card; "uses" is how many times that action may still happen before the prohibition starts applying, and "unless" is the escape condition. "what" is one of ${FORBIDDEN_ACTIONS.map((w) => `"${w}"`).join(" | ")}`,
  },
  immune: {
    fields: [UNTIL, SELF, { name: "from", type: "side" }, { name: "fromFilter", type: "filter" }],
    sentence: (raw, r) => {
      const op = raw as OpOf<"immune">;
      const who = op.from === "opponent" ? "your opponent's" : op.from === "you" ? "your" : "";
      const whose = [who, op.fromFilter ? describeFilter(op.fromFilter) : ""].filter(Boolean).join(" ");
      return `${describeRef(op.target ?? { sel: { special: "self" } })} isn't affected by ${whose ? `${whose} ` : ""}skills${forThe(op.until, r)}`;
    },
    doc: '9-1-4: a card no skill may touch (stronger than "forbid":"beChosen", which only stops a skill choosing it); "from" and "fromFilter" narrow whose skills, and both absent means every skill',
  },
  permit: {
    fields: [{ name: "what", type: { enum: ["attackActive"] }, required: true }, UNTIL, TARGET, { name: "filter", type: "filter" }],
    sentence: "{target} can attack {filter:cards} in Active Mode{until}",
    doc: 'the one rule of the game a card may lift: "this card can attack Battle Cards in Active Mode" (8-1-1). The filter says *which* active cards — leave it out only when the card does',
  },
  if: { fields: [{ name: "cond", type: "cond", required: true }, { name: "then", type: "ops", required: true }, { name: "else", type: "ops" }], sentence: "if {cond}: {then:nothing}{else?, otherwise {else}}" },
  chooseMode: { fields: [{ name: "modes", type: "modes", required: true }, { name: "reason", type: "string" }], sentence: "choose one — {modes}", doc: '"Choose one— ・A ・B" (20-2): the master picks one printed option' },
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
  negateSkills:       "macro over `negate`",
  negateSkillsOfKind: "macro over `negate`",
  hidden:             "macro over `modifyAttr`",
  redirectAttack:     "macro over `modifyAttr`",
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
  replaceLeave:       "macro over `replace`",
  altCost:            "macro over `costModifier`",
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
};

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
      // "all" is the count this borrows to name the cards; what is left says
      // which and where. With no filter it starts at the area — "there is 2 or
      // more in your drop" — so the noun the selector had nothing to say about
      // is put back.
      const what = describeSelector({ ...c.sel, count: 99 }).replace(/^all /, "");
      return `there are ${bound(c)} ${what.startsWith("in ") ? `cards ${what}` : what}`;
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
      const bits = [...f.colors, ...f.characters.map((x) => `<${x}>`), ...f.traits.map((x) => `\u226a${x}\u226b`)];
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
      return `${describeSelector(c.sel, "any of")} is ${c.not ? "not " : ""}${c.role === "guard" ? "being attacked" : c.role === "attacker" ? "attacking" : "in a battle"}`;
    },
  },
  battled: { fields: [SEL], sentence: (raw) => `${describeSelector((raw as CondOf<"battled">).sel, "any of")} has been in a battle this turn` },
  every: {
    fields: [SEL, { name: "matching", type: "selector", required: true }],
    sentence: (raw) => {
      const c = raw as CondOf<"every">;
      // Both selectors are built by `parseTarget` with the count deleted (see
      // `compile.ts`), so the quantifier is the sentence's own word: "all of
      // all in your energy is all mono-colour blue in your energy" was the
      // stutter that came of letting each of them claim one.
      return `every card ${describeSelector(c.sel, "")} is also ${describeSelector(c.matching, "")}`;
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
};

// ── validation, for programs that did not come from the compiler ───────────

/**
 * Structural check for a program supplied by the referee, the workbench or a
 * stored row: every op is in the schema, every required field is there and
 * every enumerated field holds one of its values. It only proves the shape is
 * executable — the engine still enforces every rule while running it, so a
 * bad ruling can be wrong but never illegal. Nested programs are checked to
 * the depth a real card ever needs.
 */
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
    // #107: `move()` is synchronous with no suspension path at 46 of its 48
    // call sites, so a question asked inside a replacement is silently lost —
    // the program is refused rather than stored and half-played. The message
    // a person sees is `validateRule`'s, which names the issue.
    if (o.op === "replace" && asksAQuestion(o.with)) return false;
    if (o.op === "choose" && o.bindX === true) bound = true;
  }
  return true;
}

/**
 * The steps that stop and ask somebody something. `discard` is one of them: it
 * is rewritten by `stepScript` into a `choose` the owner answers and a move.
 */
const PROMPTING_OPS = new Set<Op["op"]>(["choose", "chooseMode", "may", "look", "discard"]);

/**
 * Does this program stop to ask a question, anywhere inside it? Read by
 * `validateProgram` for a replacement's `with` block (#107) and by the
 * compiler, which refuses to write one rather than emitting a rule the
 * validator would then refuse.
 */
export function asksAQuestion(ops: unknown): boolean {
  if (!Array.isArray(ops)) return false;
  return ops.some((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const o = raw as Record<string, unknown>;
    if (typeof o.op === "string" && PROMPTING_OPS.has(o.op as Op["op"])) return true;
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

export function describeFilter(f: CardFilter): string {
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
  bits.push(...f.characters.map((x) => `<${x}>`));
  bits.push(...f.notCharacters.map((x) => `non-<${x}>`));
  bits.push(...f.names.map((x) => `{${x}}`));
  if (f.token) bits.push("token");
  else if (f.notToken) bits.push("non-token");
  if (f.z) bits.push("Z-card");
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
  if (f.type) bits.push(`${f.type.toLowerCase()} card`);
  else if (f.notType) bits.push(`non-${f.notType.toLowerCase()} card`);
  else if (!bits.length) bits.push("card");
  // Printed nowhere until 9 Sep 2026, which is what let "choose up to 1 of
  // your Battle Cards **with <Son Gohan> in its character name**" (BT19-130)
  // read as "choose up to 1 in your battle" — a filter the compiler had,
  // printed as though it had none. The reading is the only check on a filter
  // that narrows wrongly, so a measure it cannot print is a measure nobody can
  // sign off.
  bits.push(...partial);
  if (f.faceUp) bits.push("that is face up");
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
  const areas = (sel.areas?.length ? sel.areas : [sel.area]).filter(Boolean).map((a) => `${String(a).toLowerCase()} card`);
  return words === "card" || areas.includes(words) ? "" : words;
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
function describeSelector(sel: Selector, all = "all"): string {
  // The one special a filter can narrow and the reading has to keep: "the
  // <Majin Buu> on top of this card" and "the Leader on top of this card" are
  // different cards, and dropping the words would print them the same.
  if (sel.special === "onTop") {
    const words = selectorWords(sel);
    return `the ${words ? `${words} ` : "card "}on top of this card`;
  }
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
  const who = sel.side === "opponent" ? "opponent's " : sel.side === "both" ? "each player's " : "your ";
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
  const words = selectorWords(sel);
  const host = sel.underHost ? describeUnderHost(sel.underHost) : null;
  const where = sel.fromVar
    ? "of the cards looked at"
    : host
      ? `under ${host}`
      : `in ${who}${sel.areas?.length ? sel.areas.join(" or ") : sel.area}`;
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
  return `${who}${words ? `${words} ` : ""}${kind}`;
}

/**
 * "In Rest Mode" / "In Hidden Mode" — the two axes a card instance carries
 * (§23-5's Hidden/Revealed is orthogonal to §1-10's Active/Rest, and the
 * compiler never sets both on one selector, so there is no case where they
 * would need to be said together).
 */
const describeMode = (sel: Selector): string =>
  sel.mode ? ` in ${sel.mode} mode` : sel.hidden === true ? " in Hidden Mode" : sel.hidden === false ? " in Revealed Mode" : "";

/**
 * "…other than this card". Left out of the reading until 9 Sep 2026, when
 * reading "all other Battle Cards" as `notSelf` made it the difference between
 * a board wipe and a board wipe that also takes the card casting it — which
 * the sentence "all in each player's battle" said nothing about either way.
 */
const describeNotSelf = (sel: Selector): string =>
  sel.notSelf === "card" ? " other than this card" : sel.notSelf === "copies" ? " other than copies of this card" : "";

function describeRef(ref: Ref): string {
  return "var" in ref ? "the chosen cards" : describeSelector(ref.sel);
}

/**
 * A number in words. With a `noun` ("power") it is the signed change cards
 * print — "+5000 power", "+5000 power for each of your Battle Cards" — so the
 * noun sits next to the number rather than at the end of the sentence.
 */
/** The measures `attr` and `sumOf` read, as a person names them. */
const ATTR_NOUNS: Record<AmountAttr, string> = { power: "power", comboPower: "combo power", energyCost: "energy cost", comboCost: "combo cost" };

function describeAmount(a: Amount, noun?: string): string {
  if (noun) {
    if (typeof a === "number") return `${a >= 0 ? "+" : ""}${a} ${noun}`;
    if ("plus" in a) return `${describeAmount(a.plus[0], noun)} and ${a.plus[1]} more`;
    if ("count" in a) return `+${a.times ?? 1} ${noun} for each of ${describeEach(a.count)}`;
    if ("markers" in a) return `+${a.times ?? 1} ${noun} for each marker on ${describeEach(a.markers)}`;
    if ("x" in a) return a.times === undefined ? `+X ${noun}` : `+${a.times} ${noun} for each X`;
    if ("life" in a) return `+${a.times ?? 1} ${noun} for each life ${a.life === "opponent" ? "your opponent has" : a.life === "both" ? "either player has" : "you have"}`;
    if ("sumOf" in a) return `${noun} equal to the total ${ATTR_NOUNS[a.attr]} of ${describeEach(a.sumOf)}${a.times === undefined ? "" : ` × ${a.times}`}`;
    if ("attr" in a) return `${noun} equal to ${describeRef(a.attr)}'s ${ATTR_NOUNS[a.name]}${a.times === undefined ? "" : ` × ${a.times}`}`;
    return `+that many ${noun}`;
  }
  if (typeof a === "number") return `${a}`;
  if ("plus" in a) return `${describeAmount(a.plus[0])} and ${a.plus[1]} more`;
  if ("var" in a) return "that many";
  if ("sumPower" in a) return "the total power of the cards rested";
  if ("handUpTo" in a) return `up to ${a.handUpTo} in hand`;
  if ("x" in a) return a.times === undefined ? "X" : `${a.times} for each X`;
  if ("life" in a) return `${a.times ?? 1} for each life ${a.life === "opponent" ? "your opponent has" : a.life === "both" ? "either player has" : "you have"}`;
  if ("sumOf" in a) return `the total ${ATTR_NOUNS[a.attr]} of ${describeEach(a.sumOf)}${a.times === undefined ? "" : ` × ${a.times}`}`;
  if ("attr" in a) return `${describeRef(a.attr)}'s ${ATTR_NOUNS[a.name]}${a.times === undefined ? "" : ` × ${a.times}`}`;
  if ("markers" in a) return `${a.times ?? 1} for each marker on ${describeEach(a.markers)}`;
  return `${a.times ?? 1} for each of ${describeEach(a.count)}`;
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
      return (v as KeywordSkill).name;
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
  const fields = OP_SCHEMA[name].fields.map((f) => `"${f.name}"${f.required ? "" : "?"}:${shape(f.type)}`);
  return `{"op":"${name}"${fields.length ? "," : ""}${fields.join(",")}}`;
}

/** The same, for a condition: `{"kind":"count","sel":SELECTOR,"atLeast"?:N}`. */
export function condSignature(kind: Cond["kind"]): string {
  const shape = (t: FieldType): string => {
    if (typeof t === "object") return "enum" in t ? (t.enum.length > 4 ? `${t.enum.slice(0, 3).map((e) => `"${e}"`).join("|")}|…` : t.enum.map((e) => `"${e}"`).join("|")) : "[…]";
    return { selector: "SELECTOR", side: '"you"|"opponent"', cond: "COND", conds: "[COND]", filter: "FILTER", string: '"…"', number: "N", boolean: "true|false", amount: "AMOUNT", ref: "TARGET", area: "AREA", duration: "DURATION", ops: "[…]", keyword: '{"name":"Blocker"}', modes: "[…]" }[t];
  };
  const fields = COND_SCHEMA[kind].fields.map((f) => `"${f.name}"${f.required ? "" : "?"}:${shape(f.type)}`);
  return `{"kind":"${kind}"${fields.length ? "," : ""}${fields.join(",")}}`;
}
