import { compilePotaraMaterials } from "./potara-materials";
import { isAbsorbSkill, absorbPriceProblem, absorbEffectProblem } from "../vm/absorb-procedure";
import { compileEvolutionBase } from "./evolution-base";
import { compileFusionMaterials } from "./fusion-materials";
import { priceFromCostRecord, zeroCostRecord } from "../vm/skill-payment";
import { keywordOf, orbsIn } from "../text/cards";
import { bondDescriptorOnly } from "../text/bond";
import type { Color, Skill } from "../types";
import type { Cond, CostRecord, Op, Ref, Script, SkillPrice, XCost } from "../vm/script";
import { splitClauses, stripNotes } from "./clauses";
import { allConditions, foldBothQualifier } from "./conditions";
import { disjointMoveSpans } from "./disjoint-shape";
import { namedSetSpans } from "./named-set-shape";
import { compileClauseList } from "./effects";
import type { Ctx } from "./shared";
import { countWord } from "./shared";
import { EACH_COUNT, SUMMED_COUNT } from "./targets";
import { compileSkill } from "./index";

/**
 * "…by **choosing** 1 card and **placing** it in your Drop" → "choose … place
 * …". A price that hangs off "by" is written as a gerund, and every action
 * pattern in the compiler is written in the imperative.
 */
const GERUNDS: Record<string, string> = {
  choosing: "choose",
  placing: "place",
  putting: "put",
  discarding: "discard",
  returning: "return",
  switching: "switch",
  adding: "add",
  sending: "send",
  removing: "remove",
  playing: "play",
  paying: "pay",
  drawing: "draw",
  revealing: "reveal",
};

function imperative(clause: string): string {
  return clause.replace(/^\s*([a-z]+ing)\b/i, (whole, word: string) => GERUNDS[word.toLowerCase()] ?? whole);
}

/**
 * "You can activate this card's [Counter] skill from your hand …" (5-3): the
 * card's own offer of another way to pay for it.
 *
 * The two halves are printed in either order — "…**without paying its energy
 * cost** by discarding 1 blue card" and "…by adding a card from your life to
 * your hand **instead of paying its energy cost**" say the same thing — and the
 * waiver is not the price. Anything the card asks for beyond the two fixed
 * kinds is an *action* price (4-3-3) in the same vocabulary as a printed one,
 * so the same reader compiles it; most of them ask the player to pick a card,
 * which is why the engine charges that one through the flow rather than inline.
 */
/** One entry per orb — `{r: 2}` becomes `["Red", "Red"]` — the shape `altCost`'s `orbs` field takes (5-3). */
export function orbsToList(orbs: Partial<Record<Color, number>> & { any?: number }): (Color | "any")[] {
  const out: (Color | "any")[] = [];
  for (const [k, n] of Object.entries(orbs)) for (let i = 0; i < (n ?? 0); i++) out.push(k as Color | "any");
  return out;
}

/**
 * The "…" half of "you can activate […] from your hand …" (5-3): what the
 * card asks for instead of the energy cost. Shared by the self-only reading
 * (`counterAltCost`, below) and the one that grants the same offer to *other*
 * cards for a span (BT11-033) — the price is worded identically either way,
 * only who it is about differs.
 */
export function altCostHow(rawHow: string, c: Ctx): Op[] | null {
  // "Their energy costs" (plural) is how the same waiver reads when it is
  // granted to more than one card at once (BT11-033) rather than printed on
  // the one card paying it — "its"/"the" everywhere else.
  const how = rawHow.replace(/^without paying (?:its|the|their) energy costs?,? /, "").replace(/,? instead of (?:paying )?(?:its|the|their) energy costs?$/, "");
  if (/^without paying (?:its|the|their) energy costs?$/.test(how)) return [{ op: "altCost", pay: "none" }];
  let m: RegExpExecArray | null;
  if ((m = /^by adding (a|an|\d+) cards? from your life to your hand$/.exec(how))) {
    return [{ op: "altCost", pay: "life", n: countWord(m[1]) }];
  }
  // "By paying {1}" (BT18-088): a reduced but still-energy price, not a free
  // one — `program` has no op that rests energy as a cost, and reading this
  // as one would have offered the [Counter] for a choice that costs nothing.
  if ((m = /^by paying ((?:\{[a-z0-9]+\})+)$/i.exec(how))) {
    const orbs = orbsToList(orbsIn(m[1]));
    if (orbs.length) return [{ op: "altCost", pay: "energy", orbs }];
  }
  if ((m = /^by (.+)$/.exec(how))) {
    const unread: string[] = [];
    // A fresh variable counter well clear of the effect's own, because the
    // price is a program of its own that runs before the skill.
    const price = compileClauseList(splitClauses(m[1]).map(imperative), { ...c, n: c.n + 50, last: null, lastTarget: null, stale: null, twoNamedCardsRefused: false }, unread);
    if (price.length && !unread.length) return [{ op: "altCost", pay: "program", ops: price }];
  }
  return null;
}

export function counterAltCost(sentence: string, c: Ctx): Op[] | null {
  const said = /^activate this card's \[counter[^\]]*\](?: skill)? from your hand (.+?)\.?$/.exec(sentence);
  if (!said) return battleAltCost(sentence, c);
  return altCostHow(said[1], c);
}

/**
 * #742: "[Permanent] (If …,) you can activate this card's [Activate: Battle]
 * skill from your hand without paying its energy cost" — eleven Extra Cards
 * (BT9-017/036/051/067/086, BT13-120, BT13-151, BT14-059, BT15-057, BT16-019,
 * EX13-28). It is the [Counter] offer above for the card's [Activate: Battle]
 * line instead: a standing permission that the energy cost an Extra pays when
 * its skill is activated from the hand (12-2-2-2, 5-3) is waived for that one
 * line. Nothing is played — an Extra is never played (12-1-1) — and the line's
 * own price (orbs, [Spirit Boost]'s marker, [Limit X]) is still paid
 * (12-2-2-3), which `for: "activate:battle"` leaves to the activation itself.
 *
 * Read by the "activate … play" rule in `compile/effects.ts` until this
 * existed: "choose this card, play the chosen cards", a [Permanent] that
 * instructs and is therefore never run, so the player paid after all.
 *
 * Only a price the engines can charge at the combo prompt is read: the waiver,
 * life, or a reduced energy price. An action price (`program`) is refused —
 * `altCostFor` never offers one for anything but a [Counter] — and no card
 * prints one for this line.
 */
function battleAltCost(sentence: string, c: Ctx): Op[] | null {
  const said = /^activate this card's \[activate: ?battle\](?: skill)? from your hand (.+?)\.?$/.exec(sentence);
  if (!said) return null;
  const alt = altCostHow(said[1], c);
  if (!alt || alt.some((o) => o.op !== "altCost" || o.pay === "program")) return null;
  return alt.map((o) => (o.op === "altCost" ? { ...o, for: "activate:battle" as const } : o));
}

/**
 * Conditions a skill puts in front of its effect ("If your Leader is red, …").
 * Everything after the condition becomes conditional on it (9-1-3).
 */
/**
 * What a skill prints before its colon, with the orbs and any explanatory note
 * taken off — "{r}{r}, if your Leader is a green <Broly> card and you have 2
 * or more energy" leaves the condition alone.
 *
 * `activatable` in `engine.ts` and `compileSkill` both have to read this the
 * same way. They did not: both tested the *raw* cost for a leading "if", which
 * a card that also costs orbs never has, so the condition was neither checked
 * before offering the skill nor applied to the program.
 */
export function costText(cost: string): string {
  // #926: the slash of "{b}/{w}, if you have 3 or more energy …" (BT29-141)
  // is orb notation too (5-8-2-1), as `costIsOnlyOrbs` reads it — left on,
  // "/{w}, if …" was no price at all and the line was refused as unread.
  // #907: BT26-020 prints "{r}. if your Leader's back side is …" — a full stop
  // where its siblings (BT25-131 …) print the comma. LABELLED BEST GUESS (a
  // misprint; no FAQ entry): read as the comma, so the condition is the price's.
  return stripNotes(cost)
    .replace(/^((?:\{[^}]*\}|\s|,|\/)+)\.(?=\s*if\b)/i, "$1")
    .replace(/^(?:\{[^}]*\}|\s|,|\/)+/, "")
    .trim();
}

/**
 * The *action* a price charges: "switch this card to Rest Mode", "choose 1
 * card in your hand and place it in your Drop Area" (4-3-3). It is the same
 * vocabulary as an effect, so it is compiled by the same code — what makes it
 * a cost is only where it is printed. A price that states a condition first
 * has been cut in two by `splitPrice`, and this is the second half; the first
 * is `priceCondition`, and the two are read together, never as alternatives.
 *
 * Whether the engine may actually charge it is a separate question, answered
 * by `canPayCostProgram` in `engine.ts`; a program this returns is not yet a
 * price the player can pay.
 */
export function compileCostProgram(skill: Skill): Script | null {
  return splitPrice(skill).program;
}

const costPrograms = new Map<string, Script | null>();

/** The keyword moves whose printed action price (before the colon) is compiled as a price program: [Swap] (#729), [Union] (Fusion, Potara) and the [Evolve] family (#926). */
const PRICED_KEYWORD_MOVES = new Set<string>(["Swap", "Union", "Evolve"]);

/**
 * Compile one piece of price text as a program. Memoised on the text and the
 * line's tags, which decide whether a keyword owns the line rather than the
 * compiler.
 */
export function compileAction(said: string, skill: Skill): Script | null {
  const key = `${skill.tags.join("|")} ${said}`;
  const hit = costPrograms.get(key);
  if (hit !== undefined) return hit;
  // Compiled as an [Activate] so that a leading "when" is not mistaken for a
  // trigger, and with no cost of its own so nothing wraps it in a condition.
  // #729: a [Swap] tag owns its line's *description* (`KEYWORD_HANDLES_THE_LINE`),
  // never the price printed before the colon — "[Swap 2] {y}, choose 1 card
  // from your hand and place it in your Drop Area: ≪Goku's Lineage≫ …"
  // (BT4-079). Left on the line, the tag made every [Swap] action price read
  // as nothing, and the line was refused as unread. #926: the same holds for
  // [Union-Fusion], [Union-Potara] and the [Evolve] family, whose moves pay
  // their printed action price on the strict host (`vm/keyword-costs.ts`) —
  // "[Union-Fusion]{r}{r}{r}, draw 2 cards: Red <Son Goku: Br> and …"
  // (BT11-013), "[EX-Evolve]{r}{r}{r}, draw 1 card: Red <Broly: Br> …"
  // (BT13-024). Only those tags come off: the other keywords that own their
  // line keep their prices unread until their own moves can charge one.
  const owner = skill.keyword && PRICED_KEYWORD_MOVES.has(skill.keyword.name) && !(skill.keyword.name === "Union" && skill.keyword.variant === "Absorb") ? skill.keyword.name : null;
  const tags = owner ? skill.tags.filter((t) => keywordOf(t)?.name !== owner) : skill.tags;
  const read = (text: string) => compileSkill({ ...skill, kind: "activate:main", keyword: null, tags, cost: "", effect: text });
  let sc = read(said);
  // A printed price is written in the second person and every action pattern
  // in the compiler is written in the imperative, so one the compiler cannot
  // read is offered again with its subject taken off. Second and not first,
  // because a handful of prices do say "you" to the compiler — "you can't play
  // copies of this card for the turn" — and those are read as they stand.
  const bare = dropTheSubject(said);
  if ((sc.unsupported.length || !sc.ops.length) && bare !== said) sc = read(bare);
  // #970: disjoint choices are charged on an [Activate] line's own price only —
  // an [Auto], a [Counter] and a keyword's move have their own payment
  // planners, and none of them matches cards across slots.
  const disjoint = sc.ops.some((op) => op.op === "choose" && op.sel.notIn);
  const out = sc.unsupported.length || !sc.ops.length || (disjoint && (!skill.kind.startsWith("activate") || skill.keyword)) ? null : sc;
  costPrograms.set(key, out);
  return out;
}

/**
 * "**You** remove this card in your Drop from the game and discard 1 card from
 * your hand" → "remove this card …" (BT31-132): the subject of a printed
 * price, at the front and after each "and"/"then"/"or". Until it came off, no
 * "you place …", "you discard …" or "you choose …" price was readable at all.
 *
 * "You may" stays: that is `may` (20-16), an op of its own, and what follows it
 * is what is optional rather than what is done.
 */
function dropTheSubject(said: string): string {
  return said.replace(/(^|,\s*|\band\s+|\bthen\s+|\bor\s+)you\s+(?!may\b)/gi, "$1");
}

/**
 * "{X}" — the price is X energy, chosen when the skill is activated, and the
 * effect may then say `X` (20-5). "Pay X energy" is the same price written
 * out, which is how a rule typed by hand and the harness's own card say it.
 *
 * No bounds are read: no printed card states one, and inventing a ceiling
 * would refuse a payment the rules allow. The engine offers every value the
 * energy can settle.
 */
export function priceX(skill: Skill): XCost | null {
  const cost = stripNotes(skill.cost);
  return /\{x\}/i.test(cost) || /\bpay x energy\b/i.test(cost) ? {} : null;
}

/**
 * "[Auto] **Declare 1 number**: When this card attacks, reveal the top card of
 * your opponent's deck …" (BT22-090, BT22-101 and the Fortuneteller Baba cards),
 * "{y}, declare 1 number: …", "Declare 1 number that's 3 or less: …": the
 * printed price is naming a number, which the effect then reads back ("the
 * declared number"). Best guess (no ruling prints it; the manual has no
 * declaration step): naming a number costs nothing, so it is the first thing the
 * effect does, once the skill resolves, and the only thing lost against a real
 * price is the option of declining the whole skill. An unconstrained number
 * offers 0 to 10 (the highest energy cost the revealed card could have is
 * well inside it).
 */
const DECLARE_TAIL = /(?:^|[,\s])(?:you )?declare (?:1|a|one) numbers?(?: (?:that'?s (\d+) or (?:less|fewer)|from (\d+) to (\d+)))?$/i;

export function declaredNumber(skill: Pick<Skill, "cost">): { min: number; max: number } | null {
  const m = DECLARE_TAIL.exec(costText(skill.cost));
  if (!m) return null;
  if (m[3]) return { min: Number(m[2]), max: Number(m[3]) };
  return { min: 0, max: m[1] ? Number(m[1]) : 10 };
}

/**
 * True when the price is nothing but orbs (and the reminder text beside them).
 * The slash of "{r}/{u}" is part of the orb notation, not leftover text.
 */
export function costIsOnlyOrbs(cost: string): boolean {
  return (
    stripNotes(cost)
      .replace(/\{[^}]*\}/g, "")
      // "Declare 1 number" is read as the effect's first step (`declaredNumber`):
      // it leaves nothing to pay, so a price that is only orbs and a declaration is orbs.
      .replace(/(?:^|[,\s])declare (?:1|a|one) numbers?(?: (?:that'?s \d+ or (?:less|fewer)|from \d+ to \d+))?\s*$/i, "")
      .replace(/[\s,:/]/g, "").length === 0
  );
}

/**
 * 22-30-2: "[Aegis XY]" or "[Aegis XY] skill cost". What an [Aegis] line
 * prints after its tag is its skill cost, never an effect: the keyword's own
 * effect is 22-30-5. `splitCost` (text/cards.ts) can only hand a colon-less
 * keyword line's orbs to `cost`, so an action written there ("[Aegis
 * Red/Blue] Switch this card to Rest Mode") arrives as `effect` and was
 * compiled as an effect run *after* activation — free if it could not be done.
 * This is the line read as printed, for the compiler, the drafter and the
 * engine's chargeability check alike (#595). Orbs mixed with an action stay as
 * they are: the parse never put those orbs in `energyCost`, so reading the
 * action alone would drop them, and the effect reader keeps the line unread.
 */
export function aegisPriceLine<T extends Pick<Skill, "keyword" | "cost" | "effect">>(skill: T): T {
  if (skill.keyword?.name !== "Aegis" || skill.cost.trim() || !skill.effect.trim() || /\{[^}]*\}/.test(stripNotes(skill.effect))) return skill;
  return { ...skill, cost: skill.effect, effect: "" };
}

/**
 * The condition or conditions a price states (9-1-3) — whether or not it also
 * charges an action, which is `compileCostProgram`.
 *
 * Most cards write "If your Leader Card is red"; a dozen print the same claim
 * bare — "Your Leader Card is a green ≪Android≫ card" — with no condition word
 * in front of it. A bare one is only read once the price has failed to be an
 * *action*, because the action is the stronger reading: charging it changes the
 * game, and a condition that merely holds costs nothing, so guessing wrong in
 * that direction would hand the player a free skill.
 */
export function priceCondition(skill: Skill): { cond: Cond; subject?: Ref } | null {
  const conds = splitPrice(skill).conds;
  if (!conds.length) return null;
  if (conds.length === 1) return conds[0];
  // Several conditions in one price all have to hold (9-1-3). None of them is
  // then *the* subject an effect's "it" points back at, so none is offered.
  return { cond: { kind: "all", conds: conds.map((x) => x.cond) } };
}

/**
 * The price a skill prints, with the descriptor of its [Bond] or [Spirit Boost]
 * marker taken off: "[Bond 2] ≪Alien≫ (This skill takes effect when you have 2
 * or more …):" and "[Spirit Boost 1] Blue Unison Card with a specified cost of
 * 2 or more, you have 3 or more energy:" name the Unison the markers come from
 * or the Battle Cards the Bond counts, which the keyword's own move reads. What
 * follows the descriptor's comma is the price proper (#961).
 */
function priceText(skill: Skill): string {
  const said = costText(skill.cost);
  // "Declare 1 number" costs nothing to pay: it is read as the first step of
  // the effect (`declaredNumber`), so the price has nothing else to say.
  const declared = DECLARE_TAIL.exec(said);
  if (declared && declaredNumber(skill)) return said.slice(0, declared.index).replace(/[\s,]*(?:and)?[\s,]*$/i, "");
  // A [Bond] line that opens with a condition word prints no descriptor:
  // "[Bond 2] If your Leader Card is a ≪Slug's Army≫ card:" (BT12-060) is the
  // price's condition whole, and cutting it as a descriptor lost it.
  if (skill.bond != null && !/^(?:if|when|while|during)\b/i.test(said)) return said.replace(/^[^,(]*(?:\([^)]*\))?\.?\s*,?\s*/, "");
  if (skill.spiritBoost != null) return said.replace(/^(?:[a-z-]+ )?(?:z-)?unison cards?\b[^,]*(?:,\s*|$)/i, "");
  return said;
}

/**
 * #961: a price the compiler read none of. An [Activate], [Auto] or [Counter]
 * line prints what it costs before the colon; text there that is neither orbs,
 * nor a condition, nor an action the compiler can charge was dropped without a
 * word, and the skill was offered for the orbs alone ("send 1 blue card with
 * <Son Goten> … and 1 blue card with <Trunks> … to your Warp", P-441). Such a
 * line is unread, whole. Lines a keyword owns (their price is read by the
 * keyword's own move) and [Permanent]s (no price) are not asked.
 */
/**
 * The one "If you …:" price read as the action it names: a discard from the
 * hand. Narrow on purpose: other "If you place/add/switch …:" prices would
 * expose effect readings nobody has signed off (BT21-103's "play this card
 * under a yellow <Whis> Z-Battle Card" reads as a plain play), and each is its
 * own wording to check.
 */
export const IF_YOU_DISCARD_PRICE = /^if you discard (?:\d+|an?|up to \d+) cards? from your hand$/i;

export function priceIsUnread(skill: Skill): boolean {
  if (skill.keyword || !/^(?:activate|auto|counter)/.test(skill.kind)) return false;
  const said = priceText(skill);
  if (!said || costIsOnlyOrbs(skill.cost) || priceX(skill)) return false;
  const split = splitPrice(skill);
  return !split.conds.length && !split.program;
}

/**
 * A price says one of three things, and a few hundred cards say two of them at
 * once: "[Activate: Main] If your Leader is a white <Cell> card, and you
 * remove this card in your Drop from the game and discard 1 card from your
 * hand:" (BT31-132) both names a condition the skill needs (9-1-3) and charges
 * an action to use it (4-3-3).
 *
 * The two halves are separated here so the engine can check the one and charge
 * the other. A split is only taken when *both* halves are fully read — the
 * conditions all parse and the rest compiles to a program — because a price
 * read in half is worse than one not read at all: the skill would be offered
 * without its condition, or, far more likely, for free.
 */
interface PriceSplit {
  conds: { cond: Cond; subject?: Ref }[];
  /** The action half, compiled; null when the price only states conditions. */
  program: Script | null;
}

const priceSplits = new Map<string, PriceSplit>();
const NO_PRICE: PriceSplit = { conds: [], program: null };

function splitPrice(skill: Skill): PriceSplit {
  const said = priceText(skill);
  if (!said || costIsOnlyOrbs(skill.cost)) return NO_PRICE;
  const key = `${skill.tags.join("|")} ${said}`;
  const hit = priceSplits.get(key);
  if (hit) return hit;
  const out = readPrice(said, skill);
  priceSplits.set(key, out);
  return out;
}

function readPrice(printed: string, skill: Skill): PriceSplit {
  // #966: "…card—both yellow—and you send …" has no space before its "and", so
  // the colour is folded into the Leader's description before the price is cut
  // at its joints.
  const said = foldBothQualifier(printed);
  // BT15-022's "{r}{1}, if your opponent has 3 or more energy, there's a red
  // [Field] Extra Card with an energy cost of 2 in your Drop Area, and you
  // place this card in its owner's Drop Area" — two conditions and an action
  // ANDed together, the harder chain a prior audit reported as merging into
  // one wrong condition (the "3 or more" bound landing on the second
  // condition's filter, the side flipping to the opponent's, the price action
  // dropped outright). That does not reproduce here: the reversed-joints loop
  // below already tries the *last* joint first, so `allConditions` reads the
  // two leading conditions off the head correctly scoped ("in your Drop",
  // not "opponent's") and `compileAction` reads the trailing "you place this
  // card…" as the program in the same pass. Left as found — investigated for
  // Lane G, 9 Sep 2026 — because the failure the audit named is not here to
  // fix; whatever produced it either predates this loop's current shape or
  // was on a since-corrected catalog entry.
  //
  // A price with no condition word in front of it is charged, not merely
  // checked: the action is the stronger reading, because charging it changes
  // the game and a condition that holds costs nothing. A dozen cards do state
  // the condition bare, and they are read once that reading has failed.
  // A price that chooses cards by the sum of their costs or power ("you
  // choose any number of red ≪Demon Clan≫ cards … whose total power adds up
  // to 40000 or more", BT12-017) or one of each kind is a choice no selector
  // states (`parseTarget`). Refused whole: cut at its "and", the choice half
  // was read into the Leader condition before it.
  // #930: "choose 1 each of <A> and <B> from your Drop Area and place them
  // under this card" (BT3-070, BT3-020, BT3-022) is the one "each" the
  // compiler reads — a named list, one slot per name (`named-set.ts`) — so the
  // words of such a clause are not asked.
  const withoutNamedSets = namedSetSpans(said).reduceRight((rest, [from, to]) => rest.slice(0, from) + rest.slice(to), said);
  if (SUMMED_COUNT.test(said) || EACH_COUNT.test(withoutNamedSets)) return NO_PRICE;
  // #970: a multi-slot send/place beside an aside the readers above did not fold
  // ("a <Gogeta> or <Veku> card―both with the [aegis] skill―in play", BT22-033)
  // would keep the condition half-read: left unread whole.
  if (disjointMoveSpans(said).length && /[―—–]|--/.test(said)) return NO_PRICE;
  const cued = /^(?:if|when|while|during)\b/i.test(said);
  const whole = cued ? null : compileAction(said, skill);
  if (whole) return { conds: [], program: whole };
  // "If X, and you do Y": every place the sentence could be cut in two, the
  // longest condition half first, so a price stating two conditions and an
  // action keeps both of them.
  for (const at of joints(said).reverse()) {
    const head = said.slice(0, at.at).replace(/[\s,]+$/, "");
    const tail = said.slice(at.at + at.len).trim();
    if (!head || !tail) continue;
    const conds = allConditions(head);
    if (!conds) continue;
    const program = compileAction(tail, skill);
    if (program) return { conds, program };
  }
  const only = allConditions(said);
  if (only) return { conds: only, program: null };
  // "[Activate: Battle] **If you discard 1 card from your hand**: …"
  // (BT22-054b) states the whole price as an "if" and names no condition at
  // all — the action is the price, as in the unprefixed "Discard 1 card from
  // your hand:". Read last, once it has failed to be a condition, for the
  // reason given above: charging an action is the stronger reading.
  const bareAction = IF_YOU_DISCARD_PRICE.test(said) ?compileAction(said.replace(/^if\s+/i, ""), skill) : null;
  return bareAction ? { conds: [], program: bareAction } : NO_PRICE;
}

/** Every "and"/"," a price could be cut at, outside the bracketed card descriptions. */
export function joints(said: string): { at: number; len: number }[] {
  const out: { at: number; len: number }[] = [];
  const closers: Record<string, string> = { "<": ">", "≪": "≫", "{": "}", "(": ")", "[": "]" };
  let close = "";
  for (let i = 0; i < said.length; i++) {
    const ch = said[i];
    if (close) {
      if (ch === close) close = "";
      continue;
    }
    if (closers[ch]) {
      close = closers[ch];
      continue;
    }
    const rest = said.slice(i);
    const m = /^(,\s+and\s+|,\s+|\s+and\s+)/i.exec(rest);
    if (m) {
      out.push({ at: i, len: m[1].length });
      i += m[1].length - 1;
    }
  }
  return out;
}

/*
 * 22-21 (#544): "[Bond 2] ≪Universe 6≫:" names the Battle Cards the keyword
 * counts — a condition `bondIsValid` checks — and pays nothing. A price that is
 * only that descriptor (one bracketed selector or a compound of them, its
 * reminder note, orbs) is a readable payment of its orbs alone
 * (`bondDescriptorOnly`, text/bond.ts). Anything the selector reader cannot
 * prove ("≪Universe 6≫ draw 1 card") stays unreadable, never free.
 */

/** Compile the complete price once, including an explicit zero payment. */
export function compileCostRecord(skill: Skill): CostRecord {
  if (skill.kind === "permanent") return zeroCostRecord();
  const condition = priceCondition(skill)?.cond ?? null;
  const program = compileCostProgram(skill)?.ops ?? null;
  const x = priceX(skill);
  const fusion = compileFusionMaterials(skill);
  const potara = compilePotaraMaterials(skill);
  const evolution = compileEvolutionBase(skill);
  const absorbEffect = isAbsorbSkill(skill) ? compileSkill(skill) : null;
  const absorb = absorbEffect && !absorbEffect.unsupported.length && !absorbPriceProblem(program, condition) && !absorbEffectProblem(absorbEffect.ops) ? { version: 1 as const, variant: "Absorb" as const, area: "battle" as const } : undefined;
  return {
    version: 1,
    readable: costIsOnlyOrbs(skill.cost) || bondDescriptorOnly(skill) || condition !== null || !!program?.length || x !== null,
    text: costText(skill.cost), orbs: { ...skill.energyCost }, either: skill.energyEither.map((group) => [...group]),
    marker: skill.markerCost, burst: skill.burst, spiritBoost: skill.spiritBoost,
    condition, program, ...(fusion ? { fusion } : {}), ...(potara ? { potara } : {}), ...(evolution ? { evolution } : {}), ...(absorb ? { absorb } : {}), ...(x ? { x } : {}),
  };
}

export function compileSkillPrice(skill: Skill): SkillPrice {
  return priceFromCostRecord(compileCostRecord(skill));
}
