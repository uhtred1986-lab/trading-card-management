import { compileCounterArrival } from "./counter-arrival";
import { counterUnderPermit } from "../vm/counter-under-contract";
import { counterEnergyPermit } from "../vm/counter-energy-contract";
import { counterDropPermit, COUNTER_DROP_COLORS } from "../vm/counter-drop-contract";
import { compilePotaraMaterials } from "./potara-materials";
import { isPotaraSkill, POTARA_REBUILD } from "../vm/potara-materials";
import { isAbsorbSkill, ABSORB_REBUILD } from "../vm/absorb-procedure";
import { compileEvolutionBase } from "./evolution-base";
import { needsEvolutionContract, EVOLUTION_REBUILD } from "../vm/evolution-base";
import { compileValidity, validityProblem } from "../vm/validity";
import { compileUsage, usageProblem } from "../vm/usage";
import { readsMomentsOneByOne, triggersOf, unreadMoments } from "../gaps";
import { effectHead, keywordOf, maskNames, parseSkills, skillsOf, trailingTrigger, withoutTrailingTrigger } from "../text/cards";
import { autoTriggerMatches, YOUR_OTHER_BATTLE_DARK_PLAYED, compileComboQualification, BY_THIS_CARDS_SKILL, RETURNED_FROM_YOUR_BATTLE, discardedBySkillCause, restedCauseOf, playedOrUnplacedAlternative, playedOrActiveDuringYourTurn, playedOrComboBattleEnd, TURN_END_AFTER_PLACED, comboBattleEndOpponentTurn, comboBattleEndYourTurn, comboEntryQualifier, whiteCellPlayedSubjectFilter, triggeredPermanent, spiritBoostPayerOf, yourCardPlayedByUnion, yourCardPlayedUsingArrival, watchedMomentOf, momentsBatch1, momentCauseOf, momentPartSkills, battleEndPart, battleAttackerSaid, TURN_END_WHERE_PLAYED, type MomentCause } from "../text/triggers";
import type { CardScripts, Cond, Op, Script, Selector } from "../vm/script";
import type { CardDef, Color, KeywordSkill, Skill } from "../types";
import type { CardFilter } from "../text/filters";
import { emptyFilter } from "../text/filters";
import { unreadFilterWords } from "../lang/filter-words";
import { splitClausesJoined, stripNotes } from "./clauses";
import { allConditions, parseConditionClause, playedHowGate } from "./conditions";
import { bindBlindLifeHandChoice, bindCompletedChoice, compileClauseList, holdForGame, isComboDropReplacement, oneAreaOfTwo, splitModal, taxWordings } from "./effects";
import { bondDescriptorOnly } from "../text/bond";
import { readsAsNothingSilently } from "./silent";
import { compileSkillPrice, IF_YOU_ACTION_PRICE, aegisPriceLine, compileCostProgram, costText, counterAltCost, declaredNumber, priceCondition, priceIsUnread, priceX } from "./prices";
import type { Ctx } from "./shared";
import { PLACED_IN_ENERGY, PLACED_UNDER_PLACEHOLDER, SAME_CHARACTER_AS_PLACED, SAME_NAME_AS_CHOSEN_PLACEHOLDER, SWITCHED_BY_THIS_SKILL, countWord } from "./shared";
import { filterFor, parseTarget, subjectFilterOf } from "./targets";
import { compileFusionMaterials } from "./fusion-materials";
import { isFusionSkill } from "../vm/fusion-materials";
import { deckBuildingOfSkill } from "./silent";

// ── skills and cards ───────────────────────────────────────────────────────

/**
 * Compile one skill's effect. Keyword skills are rules rather than text, so
 * they compile to an empty program and the engine applies them directly.
 */
/**
 * Keyword skills whose text after the colon is a *condition* the engine reads
 * for itself, not an effect to compile — "[Evolve] {2}: <Nail>" names the card
 * you evolve from, and `engine.ts` already handles the whole line. Compiling
 * it would report a card as unreadable that the engine plays perfectly well.
 *
 * [Awaken] and [Wish] are deliberately absent: their text after the colon is a
 * real effect, and the engine does need it compiled.
 */
/** SD13-05's trigger, printed with "if" (`droppedFromHand` in `text/triggers.ts`). */
const IF_DROPPED_FROM_HAND = /^if this card is placed in (?:a|your|its owner'?s) drop area from (?:your|its owner'?s|the) hand by (?:a|any) skill\b|^if this card is removed from (?:a|the|your) battle area by (?:an? |one of )?(?:your )?opponent'?s? skills?$/i;

/** #930: "when this card is played using [Union]" / "when you play this card with [union]" / "…by a [union] skill", and a named variant ("using [Union-Potara]", captured). The whole trigger clause, nothing coordinated after it. */
const UNION_PLAY_TRIGGER = /^when (?:you play this card|this card is played) (?:using|with|by) (?:an? |the )?\[union(?:[- ](fusion|potara|absorb))?\](?: skill)?[,.]?$/i;
const UNION_VARIANT = { fusion: "Union-Fusion", potara: "Union-Potara", absorb: "Union-Absorb" } as const;
const KEYWORD_HANDLES_THE_LINE =new Set<KeywordSkill["name"]>(["Evolve", "Union", "Over Realm", "Swap", "Overlord", "Z-Awaken", "Z-Stack", "Field", "Attack", "Revenge", "Offering"]);


export function compileSkill(skill: Skill): Script {
  // #1166: a line printed in quotation marks that another line grants is
  // compiled as the skill it quotes; its record is the grant's program (which
  // says for itself when the granted [Auto]'s moment is not read).
  if (skill.granted) return compileQuotedSkill(skill.granted.skill);
  const script = momentChoicesAreChoices(skill, opponentHandUnseen(attackerChoicesAreChoices(leaderNeverPlayed(momentIsRead(skill, compileSkillUnguarded(skill))))));
  // Audit effects 2: a line that reads as nothing and says nothing about it (`readsAsNothingSilently`, the
  // `KNOWN_SILENT` list) is unread — an honest gap — never a blank the engine plays as done: BT14-074's +5000 combo
  // power, BT18-003's battle ban, BT20-017/BT20-019's +5000 to the card above, BT25-133's combo cost, BT4-003's
  // [Counter] ban, BT13-084's copies-of-[Field] ban.
  return readsAsNothingSilently(skill, script) ? { ...script, unsupported: [skill.effect.replace(/\s+/g, " ").trim()] } : script;
}

/**
 * R-204's second half (owner, 3 Nov 2026): a printed "choose" of the card a moment names — "choose that card and it gets
 * -10000 power" (EX13-02), "choose it and switch it to Rest Mode" (BT16-081), "choose that card and return it to its
 * owner's hand" (DB2-059), "When the Battle Card is played, choose up to 1 of those Battle Cards" (DB1-020) — is a
 * choice, so [Barrier] (22-16-2) and every "can't be chosen" (20-4) apply unless the text says "ignoring [Barrier]".
 * The `subject` and `resolving` specials name the card without choosing it; the `choice` flag on the selector says the
 * text chose it. Only as many of the program's choices of those cards as the text prints "choose" for them, first
 * first: the compiler also writes a choice for wordings that print none ("play it in Rest Mode", BT23-118; "play it in
 * your Battle Area instead", BT20-136), and those are no choice.
 */
const PRINTED_MOMENT_CHOICE = /\bchoose (?:up to \d+ of )?(?:that (?:battle |unison )?card|it|them|those (?:battle |unison )?cards?|the (?:battle |unison )?cards? being played|the played (?:battle )?card)\b/g;
function momentChoicesAreChoices(skill: Skill, script: Script): Script {
  let printed = (maskNames(stripNotes(skill.effect)).text.toLowerCase().match(PRINTED_MOMENT_CHOICE) ?? []).length;
  if (!printed) return script;
  let changed = false;
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (!x || typeof x !== "object") return x;
    const o = x as Record<string, unknown>;
    const sel = o.sel as Selector | undefined;
    const mark = o.op === "choose" && (sel?.special === "subject" || sel?.special === "resolving") && !sel.ignoreBarrier && printed > 0;
    if (mark) printed--;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = walk(v);
    if (mark) {
      out.sel = { ...sel, choice: true };
      changed = true;
    }
    return out;
  };
  const ops = walk(script.ops) as Op[];
  return changed ? { ...script, ops } : script;
}

/**
 * Audit selectors 2 (round-1 doubt): "choose up to 1 card **in your opponent's hand** or up to 1 of their Battle Cards"
 * (BT13-146, BT15-063, TB1-052, BT17-065, BT3-063…): a hand is a secret area (3-1-3), and nothing in these skills
 * looks at it, so the cards are picked unseen — offered by position (`blind`), as the opponent's face-down Life is
 * (#916). Without it the prompt laid the opponent's hand open to the chooser. A choice the opponent makes of their own
 * hand, a choice out of a look ("look at your opponent's hand, choose 1 card in it", `fromVar`), one after the program
 * looked at or revealed that hand, and one that asks something of the card (a filter only a seen card can be measured
 * by) are left as they are.
 */
function opponentHandUnseen(script: Script): Script {
  if (script.unsupported.length) return script;
  let seen = false;
  let changed = false;
  const handOf = (sel: Selector | undefined) => !!sel && sel.side === "opponent" && (sel.area === "hand" || !!sel.areas?.includes("hand"));
  // A card type is no measure of a hidden card's face ("1 of their Battle Cards" names an area); anything else is.
  const blank = emptyFilter() as unknown as Record<string, unknown>;
  const plain = (sel: Selector) => !sel.filter || Object.entries(sel.filter).every(([k, v]) => k === "type" || v === undefined || JSON.stringify(v) === JSON.stringify(blank[k]));
  const walk = (ops: readonly Op[]): Op[] =>
    ops.map((o): Op => {
      if ((o.op === "look" && o.side === "opponent" && o.area === "hand") || (o.op === "reveal" && handOf(o.sel))) seen = true;
      // (A choice of all of them — "the rest of their hand" — and one at random pick no card by sight.)
      if (o.op === "choose" && !seen && !o.blind && !o.chooser && !o.sel.fromVar && !o.sel.special && !o.sel.atRandom && (o.sel.count ?? 1) < 99) {
        const parts = [o.sel, ...(o.sel.alsoFrom ?? [])];
        const hand = parts.filter((p) => handOf({ ...p, side: p.side ?? o.sel.side }));
        if (hand.length && hand.every(plain)) {
          changed = true;
          return { ...o, blind: true };
        }
      }
      if (o.op === "if") return { ...o, then: walk(o.then), ...(o.else ? { else: walk(o.else) } : {}) };
      if (o.op === "may" || o.op === "delay") return { ...o, ops: walk(o.ops) };
      if (o.op === "chooseMode") return { ...o, modes: o.modes.map((m) => ({ ...m, ops: walk(m.ops) })) };
      return o;
    });
  const ops = walk(script.ops);
  return changed ? { ...script, ops } : script;
}

/**
 * R-204 (owner, 3 Nov 2026): "**Choose** the attacking Battle Card, KO it" (P-203), "choose up to 1 of the attacking
 * Battle Cards" (P-409), "choose the attacking card, ignoring [Barrier]" (BT10-123, BT13-030) choose — so [Barrier]
 * (22-16-2) and every other "can't be chosen" (20-4) are asked unless the text says "ignoring [Barrier]". The
 * `attacker` special names the card without choosing it (`resolveSelector` asks neither), which is right for "the
 * attacking card gets -5000" and wrong inside a `choose`. There it becomes the battle-role choice audit-conditions-1
 * reads "choose up to 1 attacking Battle Card or Leader Card" as (BT10-030): the attack card, either player's unless an
 * owner is printed, in the area its noun names. Only `attacker`: the compiler also writes `choose` for wordings that
 * print no "choose" ("KO that card after the battle", BT1-015's guard), and those are no choice.
 */
function attackerChoicesAreChoices(script: Script): Script {
  let changed = false;
  const asChoice = (sel: Selector): Selector => {
    const { side, count, upTo, filter, ...rest } = sel;
    delete rest.special;
    const area = filter?.type === "BATTLE" ? "battle" : filter?.type === "LEADER" ? "leader" : "play";
    changed = true;
    return { ...rest, side: side ?? "both", area, ...(filter ? { filter } : {}), count: count ?? 1, upTo: !!upTo, battleRole: "attacker" };
  };
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (!x || typeof x !== "object") return x;
    const o = x as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = walk(v);
    if (o.op === "choose" && (o.sel as Selector | undefined)?.special === "attacker") out.sel = asChoice(o.sel as Selector);
    return out;
  };
  const ops = walk(script.ops) as Op[];
  return changed ? { ...script, ops } : script;
}

/**
 * Audit-selectors-1 review: a program that plays the Leader is a misread, whatever led to it — a Leader stays in the
 * Leader Area (3-1-2) and no card plays one. EX15-01's "Choose up to 1 mono-red <Gogeta: Br> card … from your deck or
 * hand, play it on top of this card" lost its choice to the condition in front of it and played "your leader"; read
 * whole, it played the wrong card. Left unread, the row is open and says why (moments batch 1 refused the same on a
 * moment it reads, BT5-071).
 */
function leaderNeverPlayed(script: Script): Script {
  if (script.unsupported.length) return script;
  if (playsTheLeader(script.ops)) return { ...script, unsupported: ["this effect would play the Leader, which no card does (3-1-2): the card it plays is not read"] };
  if (playsACardInPlay(script.ops)) return { ...script, unsupported: ["this effect would play a card that is already in play: where the card it plays comes from is not read"] };
  return script;
}

/**
 * Integration 2 (with R-205): a card is played from outside play (a hand, the deck, a Drop, the Warp, energy, life, a
 * pile) onto the table; one already in a Battle, Leader or Unison Area is never played. "Play up to 1 <Frieza> card and
 * up to 1 <Cooler> card ―both …― from your hand" (EX23-01) lost "from your hand" on its first card, and the choice
 * fell to 20-1-6's "a card on the table" — a program that played a card already in play, read as if understood (14 rows
 * of the catalog of 2 Nov 2026, the "play A and B from X" family). Left unread, the row is open and says why.
 */
function playsACardInPlay(ops: readonly Op[]): boolean {
  // In program order: a choice binds its name (a later choice of the same name — another option of a "choose one" —
  // binds it afresh), and a move out of play ("send it to your Warp, … play that card from your Warp", BT4-044) frees it.
  const IN_PLAY = new Set(["battle", "leader", "unison", "play"]);
  const onTable = new Map<string, boolean>();
  let found = false;
  const walk = (v: unknown): void => {
    if (found) return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const varOf = (t: unknown) => (t && typeof t === "object" && "var" in t ? String((t as { var: unknown }).var) : null);
    if (o.op === "choose" && typeof o.as === "string") {
      const sel = o.sel as Selector | undefined;
      const areas = sel?.areas ?? (sel?.area ? [sel.area] : []);
      onTable.set(o.as, !!sel && !sel.special && !sel.fromVar && areas.length > 0 && areas.every((x) => IN_PLAY.has(x)));
    }
    if (o.op === "moveTo" && typeof o.to === "string" && !IN_PLAY.has(o.to)) { const v = varOf(o.target); if (v) onTable.set(v, false); }
    if (o.op === "play") { const v = varOf(o.target); if (v && onTable.get(v)) { found = true; return; } }
    for (const k of Object.keys(o)) if (k !== "sel" && k !== "target") walk(o[k]);
  };
  walk(ops);
  return found;
}

/**
 * Moments batch 1: an [Auto] answers only to the moments its record names (9-6-2), so one whose moment no
 * reader places never fires — and before this nothing said so. The production audit of 2 Nov 2026 found 443
 * [Auto] skills stored read whole with an empty trigger list. A line like that now keeps its program and records
 * its moment clause, as printed, as unread: the row is open, and the referee and the worklist see why.
 *
 * Not refused: a keyword hook (the keyword's own line answers its own moments, `keywordTriggers`), and the one
 * [Auto] that is moment-less by design — a replacement of its card's own departure from a Combo Area ("When this
 * card would be placed in its owner's Drop Area from a Combo Area, you may play it instead", BT12-071), which never
 * fires and stands in the Combo Area like a [Permanent] (`vm/effects.ts`'s `comboDepartures`). A line that prints
 * no moment at all (P-417 as the catalog prints it) says so.
 */
function momentIsRead(skill: Skill, script: Script): Script {
  if (skill.kind !== "auto" || skill.keyword || script.unsupported.length) return script;
  // Audit triggers 1: a coordinated head with a moment no reader places, or with a condition one of its moments alone
  // would carry ("…KOs one of your opponent's Battle Cards with an original energy cost of 2 or more or is removed …",
  // BT13-017), is not half read: its moment clause is unread.
  if (unreadMoments(skill).length || (readsMomentsOneByOne(skill) && coordinatedSubject(skill) === null))
    return { ...script, unsupported: [momentClauseOf(skill) ?? skill.effect.trim()] };
  // Audit triggers 2: "…is KO'd by an opponent's skill **or leaves a Battle Area**" (BT6-114) names one moment inside the
  // other — a KO is a departure — and the engine would pend the skill twice for the one KO (9-6-2-1 counts the trigger
  // condition fulfilled once). Unread until the record can say "either, once".
  const departs = script.trigger ?? triggersOf(skill);
  if (departs.includes("yourCardLeftBattle") && departs.length > 1) return { ...script, unsupported: [momentClauseOf(skill) ?? skill.effect.trim()] };
  if ((script.trigger ?? triggersOf(skill)).length) {
    // A moment this batch reads is not made readable on an effect that plays the Leader (3-1-2: a Leader stays in the
    // Leader Area): "…if your Leader Card is green, you may play it by paying its energy cost" (BT5-071) points "it"
    // at the condition's Leader, which no card means.
    if (momentsBatch1(effectHead(maskNames(skill.effect).text)).length && playsTheLeader(script.ops)) return { ...script, unsupported: ["\"it\" in this effect names the Leader, which is never played (3-1-2)"] };
    // Audit triggers 3: the card a play moment hands on has just been played and stands in play (5-5), so an effect that
    // plays it again is a misread — "play up to 1 <Raditz>, <Vegeta>, or <Nappa> card―…a different character name than
    // the played card―from your hand" (BT23-042) was read as playing "that card".
    if ((script.trigger ?? triggersOf(skill)).some((t) => PLAY_MOMENTS.has(t)) && playsTheSubject(script.ops)) return { ...script, unsupported: ["this effect would play the card the moment played, which is already in play: the card it plays is not read"] };
    return script;
  }
  if (standsInTheComboArea(script.ops)) return script;
  const clause = momentClauseOf(skill);
  return { ...script, unsupported: [clause ?? `an [Auto] that names no moment never fires: ${skill.effect.trim()}`] };
}

/** The leading clause of an [Auto]'s effect that names its moment, as printed; null when the line names none. */
export function momentClauseOf(skill: Pick<Skill, "effect">): string | null {
  const masked = maskNames(stripNotes(skill.effect).trim());
  // A tag's colon ("the [Activate: Battle] skill", BT15-019) and a character name's ("<Broly: Br>") are no clause
  // boundary: they are held aside as card names are.
  const tags: string[] = [];
  const text = masked.text.replace(/\[[^[\]]*\]|<[^<>]*>/g, (m) => `[${tags.push(m) - 1}]`);
  const pieces = text.split(/[,.:]/).map((p) => p.trim()).filter(Boolean);
  const said = (p: string) => masked.unmask(p.replace(/\[(\d+)\]/g, (m, i: string) => tags[Number(i)] ?? m));
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    if (/^(?:when(?:ever)?|at the (?:start|end|beginning)|each time|activate this skill when|after)\b/i.test(piece)) return said(piece);
    // "During your turn, when …" and "If your Leader is red, when …" put a turn or a condition before the moment.
    if (/^(?:during (?:your|your opponent'?s|each|a) turn|if\b)/i.test(piece) && /^(?:when|whenever|at the)\b/i.test(pieces[i + 1] ?? "")) continue;
    // "If this card is removed from a Battle Area by a skill, …" (BT10-038): an older card's moment said with "if".
    if (i === 0 && /^if\b/i.test(piece)) return said(piece);
    return null;
  }
  return null;
}

/** Audit triggers 3: the moments whose subject is a card just played into a Battle or Unison Area (5-5). */
const PLAY_MOMENTS = new Set<string>(["yourOtherBattlePlayedUsingDarkOverRealm", "youPlayed", "eitherCardPlayed", "opponentPlayed", "opponentPlayedBySkill", "opponentCardPlayedBySkill", "yourCardPlayedFromHand",
  "yourCardPlayedFromDrop", "yourCardPlayedFromWarp", "yourCardPlayedFromEnergy", "yourCardPlayedFromLife", "youPlayedByThisCard"]);

/** Audit triggers 3: a `play` of the cards a choice of the moment's subject bound (`special: "subject"`). */
function playsTheSubject(ops: readonly Op[]): boolean {
  const subject = new Set<string>();
  let found = false;
  const walk = (v: unknown): void => {
    if (found) return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (o.op === "choose" && typeof o.as === "string" && (o.sel as { special?: string } | undefined)?.special === "subject") subject.add(o.as);
    if (o.op === "play" && o.target && typeof o.target === "object" && "var" in o.target && subject.has(String((o.target as { var: unknown }).var))) found = true;
    if (o.op === "play" && o.target && typeof o.target === "object" && "sel" in o.target && (o.target as { sel: { special?: string } }).sel.special === "subject") found = true;
    for (const k of Object.keys(o)) if (k !== "sel" && k !== "target") walk(o[k]);
  };
  walk(ops);
  return found;
}

/** A `play` of the cards a choice of the Leader bound. */
function playsTheLeader(ops: readonly Op[]): boolean {
  const leaders = new Set<string>();
  const plays: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (o.op === "choose" && typeof o.as === "string" && (o.sel as { special?: string } | undefined)?.special === "leader") leaders.add(o.as);
    if (o.op === "play" && o.target && typeof o.target === "object" && "var" in o.target) plays.push(String((o.target as { var: unknown }).var));
    for (const k of Object.keys(o)) if (k !== "sel" && k !== "target") walk(o[k]);
  };
  walk(ops);
  return plays.some((p) => leaders.has(p));
}

/** BT12-071's shape: every step a replacement of a departure from the Combo Area, under the conditions printed above it. */
function standsInTheComboArea(ops: readonly Op[]): boolean {
  let found = false;
  const walk = (list: readonly Op[]): boolean => list.every((op) => {
    if (op.op === "if") return walk(op.then) && walk(op.else ?? []);
    const combo = (op.op === "replaceLeave" || (op.op === "replace" && op.event === "leave")) && !!op.from?.includes("combo");
    found ||= combo;
    return combo;
  });
  return walk(ops) && found;
}

function compileSkillUnguarded(skill: Skill): Script {
  if (skill.grants) return compileGrantingLine(skill, skill.grants);
  // A deck-building clause is not a rule of play (6-1; #1146): take it out and compile what is left of the
  // line. A line that is nothing else reads as empty, on purpose, and says so by having nothing unread.
  const deck = deckBuildingOfSkill(skill);
  if (deck.rules.some((r) => r.kind !== "keyword")) {
    if (!deck.rest) return { kind: skill.kind, ops: [], usage: compileUsage(skill), validity: compileValidity(skill), unsupported: deck.unread };
    return compileSkillWithoutDeckBuilding({ ...skill, effect: `${deck.rest}.` });
  }
  return counterPlaysThisCard(skill, compileSkillWithoutDeckBuilding(skill));
}

/**
 * "[Counter: Attack] Play this card **from your hand**" (BT1-064 front 10, BT23-055, BT1-091; deck
 * flags 26 Oct 2026): a [Counter] is activated from the hand and its card is placed in the Drop as it
 * activates (22-10-7), so by the time the effect resolves "this card" is no longer in the hand. Kept
 * on the selector, the area found nothing, nothing was played and the card stayed in the Drop. The
 * hand is where the counter was used from, not where the effect finds the card: the play of this
 * card names no area, as "[Counter: Play] Play this card" always has.
 */
function counterPlaysThisCard(skill: Skill, script: Script): Script {
  if (!skill.kind.startsWith("counter")) return script;
  const played = new Set(script.ops.flatMap((op) => (op.op === "play" && "var" in op.target ? [op.target.var] : [])));
  let changed = false;
  const ops = script.ops.map((op) => {
    if (op.op !== "choose" || op.sel.special !== "self" || op.sel.area !== "hand" || op.sel.areas?.length || !played.has(op.as)) return op;
    changed = true;
    const { area: _hand, ...sel } = op.sel;
    void _hand;
    return { ...op, sel };
  });
  return changed ? { ...script, ops } : script;
}

/**
 * #1166: a line that grants the skill printed in quotation marks on the next
 * line — "Play up to 1 yellow ≪Ginyu Force≫ card … from your Drop, and your
 * ≪Ginyu Force≫ Leader gains the following skill for the turn-" (BT29-083#0).
 *
 * "X gains the following skill <duration>" says what every keyword grant
 * says, with the quoted line in place of the keyword; so it is read as one,
 * through the readers that already know who X is ("your Leader", "this
 * card", "it" after a choice) and how long: the clause is compiled with a
 * stand-in keyword the line does not print, and that `grant` is replaced by a
 * `copySkills` of this card's own quoted line (`quoted: true`, `skill`: its
 * index). The quoted line's program is its own record, compiled from its text
 * like every other line (`compileQuotedSkill`); nothing is read at game time.
 *
 * A grant on a card the effect has not chosen (the Leader) is made before the
 * rest of the effect: the quoted skill has to be in force for what the same
 * effect does, or "When your ≪Ginyu Force≫ card is played by this card's
 * skill" could never answer to the play printed beside it — the only play that
 * card's skill makes. A grant on a card the effect chooses follows the choice,
 * and one on this card stays where it is printed (it may be played by the same
 * effect, BT23-109). Refused, in the card's own words: a duration the line
 * prints that is not one of `GRANT_DURATIONS`; a grant the readers cannot
 * place (no `grant` comes out, or more than one); a [Permanent] that grants
 * (a standing grant has no typed contract); and a grant of a quoted skill that
 * is itself unread or that the engine cannot run as a copy.
 */
function compileGrantingLine(skill: Skill, grants: { index: number; skill: Skill }): Script {
  const plain: Skill = { ...skill, grants: undefined };
  const at = /\bthe following skill\b/i.exec(skill.effect);
  const stand = GRANT_STAND_INS.find((k) => !new RegExp(`\\[${k}\\]`, "i").test(`${skill.cost} ${skill.effect}`));
  if (!at || !stand) return compileSkillUnguarded(plain);
  const tail = skill.effect.slice(at.index + at[0].length).replace(/[\s\-—–―:,.]+$/, "").trim();
  const clause = skill.effect.slice(at.index).replace(/[\s\-—–―:,.]+$/, "");
  const compiled = compileSkillUnguarded({ ...plain, effect: `${skill.effect.slice(0, at.index)}[${stand}]${tail ? ` ${tail}` : ""}.` });
  const back = (s: string) => s.replace(new RegExp(`\\[${stand}\\]`, "gi"), "the following skill");
  const refuse = (why: string): Script => ({ ...compiled, ops: [], unsupported: [...compiled.unsupported.map(back).filter((u) => !/the following skill/i.test(u)), clause, why] });
  if (skill.kind === "permanent") return refuse("a [Permanent] granting a skill in quotation marks has no typed standing grant (#1166)");
  if (tail && !GRANT_DURATIONS.test(tail)) return refuse(`the grant's duration "${tail}" is not read (#1166)`);
  const quoted = compileQuotedSkill(grants.skill);
  if (quoted.unsupported.length) return refuse(`the granted skill (line ${Math.floor(grants.index / 10) + 1}) is not read (#1166)`);
  let found = 0;
  const swap = (ops: Op[]): Op[] => {
    let first: Op | null = null;
    const out = ops.map((op) => {
      if (op.op === "grant" && op.keyword.name === stand) {
        found++;
        const made = { op: "copySkills", target: op.target, from: { sel: { special: "self" } }, skill: grants.index, quoted: true, until: op.until } as Op;
        const target = JSON.stringify(op.target);
        if (!target.includes('"var"') && !target.includes('"self"')) first = made;
        return made;
      }
      const copy: Record<string, unknown> = { ...op };
      for (const [k, v] of Object.entries(op)) if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object" && typeof (x as { op?: unknown }).op === "string")) copy[k] = swap(v as Op[]);
      return copy as Op;
    });
    return first ? [first, ...out.filter((op) => op !== first)] : out;
  };
  const ops = swap(compiled.ops);
  const unsupported = compiled.unsupported.map(back);
  if (found === 0) return { ...compiled, unsupported: unsupported.some((u) => /the following skill/i.test(u)) ? unsupported : [...unsupported, clause] };
  if (found > 1) return refuse("one line granting the following skill more than once is not read (#1166)");
  return { ...compiled, ops, unsupported };
}

/** Keywords a granting line is compiled with in place of "the following skill" (`compileGrantingLine`): the first one the line does not print itself. */
const GRANT_STAND_INS = ["Barrier", "Blocker", "Critical", "Double Strike", "Triple Strike", "Dual Attack"] as const;
/** The durations a granting line may print after "the following skill" (`durationOf` reads them): "for the turn", "until the end of your opponent's (next) turn", "until the start of your next turn / Main Phase". Anything else (BT23-077's "until the start of your turn") is refused, not read as the turn. */
const GRANT_DURATIONS = /^(?:for the turn|until the end of your opponent's(?: next)? turn|until the (?:start|beginning) of your next (?:turn|main phase))$/i;

/**
 * #1166: the skill a line in quotation marks quotes, as the record of that
 * line. Its "this card" is whichever card holds it while the grant lasts.
 * A quoted [Union-Absorb] (#930, BT30-064) is read: its record carries the
 * typed grant contract a granted Union needs — `cost.absorb` v1 identity, the
 * typed price program and the effect program, as P-360's `permit(unionLine)`
 * carries its typed price — so the host offers it from the Battle Area as its
 * own keyword move while the grant lasts, and nothing is read off the text.
 * Refused: every other keyword line ([EX-Evolve], [Evolve] — a granted keyword
 * move needs a grant contract of its own), and an [Auto] whose moment is not read (it would never
 * answer, and the grant would look read). Also "at the end of a battle in
 * which this card attacked" (BT22-022): the `battleEnd` moment does not ask
 * which card attacked, so the skill would answer to every battle's end; a
 * granted line is not made readable on that misreading.
 */
function compileQuotedSkill(quoted: Skill): Script {
  if ((quoted.kind === "keyword" || quoted.keyword) && !isAbsorbSkill(quoted)) return { kind: quoted.kind, ops: [], usage: compileUsage(quoted), validity: compileValidity(quoted), unsupported: [quoted.raw, "a keyword skill granted in quotation marks is not supported (#1166)"] };
  if (/\bat the end of (?:a|the) battle in which this card attack/i.test(quoted.effect)) return { kind: quoted.kind, ops: [], usage: compileUsage(quoted), validity: compileValidity(quoted), unsupported: [quoted.raw, "\"a battle in which this card attacked\" is not a moment the engine asks (#1166)"] };
  const script = compileSkillUnguarded(quoted);
  if (quoted.kind === "auto" && !script.unsupported.length && !(script.trigger ?? triggersOf(quoted)).length) return { ...script, ops: [], unsupported: [quoted.raw, "the granted [Auto]'s moment is not read (#1166)"] };
  return script;
}

/**
 * Audit conditions 2 (3 Nov 2026): "[activate: main]{r}{r}{r}: **If your Leader Card is a red <Gogeta: Br> card and you
 * have 4 or more energy:** Choose up to 1 …" (EX15-01): after the price's own colon, a condition closed by a colon of its
 * own. R-230 (owner, 3 Nov 2026): it is the line's activation condition — the skill can't be activated unless it holds,
 * so the {r}{r}{r} is never paid for nothing — the same as "{u}, if your Leader is mono-blue …:" printed inside the price
 * (P-409). It joins the price ("{r}{r}{r}, if …"), where the price reader takes it as the record's condition. Read as
 * printed, the second colon left the condition's last half and the whole effect unread. Only an [Activate] or [Counter]
 * line whose effect opens on "If", and only a colon in the effect's first sentence outside any name.
 */
function effectConditionColon(skill: Skill): Skill {
  if (!skill.cost || !/^(?:activate|counter)/.test(skill.kind) || !/^if\b/i.test(skill.effect.trim())) return skill;
  const e = skill.effect.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  let depth = 0;
  for (let i = 0; i < e.length; i++) {
    const ch = e[i];
    if ("([{<≪".includes(ch)) depth++;
    else if (")]}>≫".includes(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === ".") return skill;
    else if (depth === 0 && ch === ":") return { ...skill, cost: `${skill.cost}, ${e.slice(0, i).trim().replace(/^If\b/, "if")}`, effect: e.slice(i + 1).trim() };
  }
  return skill;
}

function compileSkillWithoutDeckBuilding(given: Skill): Script {
  const skill = effectConditionColon(given);
  if (isPotaraSkill(skill) && !compilePotaraMaterials(skill)) return { kind: skill.kind, ops: [], usage: compileUsage(skill), validity: compileValidity(skill), unsupported: [POTARA_REBUILD] };
  if (needsEvolutionContract(skill) && !compileEvolutionBase(skill)) return { kind: skill.kind, ops: [], usage: compileUsage(skill), validity: compileValidity(skill), unsupported: [EVOLUTION_REBUILD] };
  if (isFusionSkill(skill) && !compileFusionMaterials(skill)) return { kind: skill.kind, ops: [], usage: compileUsage(skill), validity: compileValidity(skill), unsupported: ["unsupported Fusion material description; record both complete named material filters"] };
  const read0 = narrowHiddenChoices(compileSkillText(skill));
  // Audit effects 3 (R-340): "in your Drop Area or Warp" is one area, picked first (DB2-019's Q&A; "from …" pools, BT6-126's).
  const read = read0.unsupported.length ? read0 : { ...read0, ops: oneAreaOfTwo(skill.effect, read0.ops) };
  // "Declare 1 number: …" (prices.ts `declaredNumber`): the number is named
  // first, whichever way the rest of the effect reads.
  const declared = declaredNumber(skill);
  const sc = declared && read.ops.length ? { ...read, ops: [{ op: "declare", min: declared.min, max: declared.max } as Op, ...read.ops] } : read;
  // The printed effect after an [Awaken] or [Awaken: Surge] colon remains
  // part of that keyword skill. Preserve that cause on mode-switch events so
  // triggers requiring a non-[Awaken] skill cannot mistake it for an ordinary
  // effect (22-2, #571).
  const awakened = skill.keyword?.name === "Awaken" ? markSwitchesByAwaken(awakenDrawIsMandatory(sc)) : sc;
  // 22-13-6-3 (#929): a [Union-Absorb] line's "play … on top of this card" is
  // the keyword's own play — it opens the [Counter: Play] timings and obeys
  // the failed-entry rule, which a plain `play … onto` does not.
  const caused = [skill.keyword, ...skill.tags.map(keywordOf)].some((k) => k?.name === "Union" && k.variant === "Absorb") ? markAbsorbPlays(awakened) : awakened;
  // A [Permanent] never resolves, so "for the turn" — the duration every
  // clause gets when it names none — was a lie on every op it emitted. The
  // static layer ignores `until`, so nothing played wrongly; but the stored
  // program, the inspector and the referee's worked examples all said it.
  // The skill holds while its card is where it is valid (9-5-1), and `game`
  // is the nearest thing the language has to that.
  const held = skill.kind === "permanent" && !triggeredPermanent(skill) ? { ...caused, ops: holdForGame(caused.ops) } : caused;
  const usage = compileUsage(skill);
  const validity = compileValidity(skill);
  const gap = usageProblem(usage) ?? validityProblem(validity);
  const result = { ...refuseUnmatchedComboEntry(skill, held), kind: skill.kind, usage, validity, ...(gap ? { unsupported: [...held.unsupported, gap] } : {}) };
  const combo = compileComboQualification(skill);
  return combo ? { ...result, combo, trigger: triggersOf(skill).filter((t) => combo.timing !== "entry" || t !== "comboed") } : result;
}

/**
 * #1042: a combo-entry Auto whose delayed half is "at the end of the battle"
 * (BT7-030, BT8-030, BT22-052, BT24-116, BT24-120, P-578) is refused when its
 * printed moment says more than the trigger can ask. The trigger (`comboUsed`)
 * is "this card entered a Combo Area", and only the hand was a captured origin
 * (`comboEntryFromHand`, which reads "when this card **in your hand** is used in
 * a combo" and "when you combo with this card from your hand", nothing wider).
 * "…used in a combo **from your hand**", "…from an Energy Area using {X}'s
 * skill" and "…from your hand **with an <Android 18> card in battle**" would
 * answer to every combo, and before the engine ran `battleEnd` delays that cost
 * nothing, because the delayed half never ran. Now it would play the card (or
 * send it to the Z-Energy) after battles it does not belong to, so the skill
 * was unread until the trigger could ask the origin and the company.
 *
 * #907 follow-up: it can. `comboEntryQualifier` (`text/triggers.ts`) reads those
 * moments and `pendAutos` asks the origin and the skill's card at the entry itself;
 * the company ("an <Android 18> card in battle") is a question about the board, so
 * it is a condition on the program. A wording the qualifier does not read whole is
 * still refused.
 */
const UNMATCHED_COMBO_ENTRY = /when this card is used in a combo from your hand|when you combo with this card from (?:your hand with|an? [a-z-]+ area)/i;

function refuseUnmatchedComboEntry(skill: Skill, script: Script): Script {
  if (skill.kind !== "auto" || script.unsupported.length) return script;
  const text = (skill.cost + " " + skill.effect).replace(/\s+/g, " ");
  const said = UNMATCHED_COMBO_ENTRY.exec(text);
  const qualifier = comboEntryQualifier(skill);
  // "with an <Android 18> card in battle" (BT8-030): one of your cards of that description is in the battle.
  // LABELLED BEST GUESS - the card text does not say whose side; the companion of a combo you make is on yours.
  if (qualifier?.company) {
    const got = parseConditionClause(`your ${qualifier.company} is in a battle`, true);
    if (!got) return { ...script, ops: [], unsupported: [said?.[0] ?? qualifier.company] };
    return { ...script, ops: [{ op: "if", cond: got.cond, then: script.ops }] };
  }
  if (!said || !hasBattleEndDelay(script.ops)) return script;
  if (!qualifier) return { ...script, ops: [], unsupported: [said[0]] };
  return script;
}

function hasBattleEndDelay(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasBattleEndDelay);
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  if (o.op === "delay" && o.at === "battleEnd") return true;
  return Object.values(o).some(hasBattleEndDelay);
}

/** R-388: Absorb plays its specified arrival on the activating card (22-13-6-3).
 * Future delayed/granted skills are separate execution trees, never Absorb arrivals. */
function markAbsorbPlays(script: Script): Script {
  const count = (ops: Op[]): number => ops.reduce((n, op) => n + (op.op === "play" ? 1
    : op.op === "if" ? count(op.then) + count(op.else ?? [])
    : op.op === "may" ? count(op.ops)
    : op.op === "chooseMode" ? op.modes.reduce((sum, mode) => sum + count(mode.ops), 0) : 0), 0);
  const soleArrival = count(script.ops) === 1;
  const mark = (ops: Op[]): Op[] => ops.map((op): Op => {
    if (op.op === "play" && !op.using && (op.onto || soleArrival)) {
      return { ...op, onto: op.onto ?? { sel: { special: "self" } }, using: "Union-Absorb", counterWindow: true };
    }
    if (op.op === "if") return { ...op, then: mark(op.then), ...(op.else ? { else: mark(op.else) } : {}) };
    if (op.op === "may") return { ...op, ops: mark(op.ops) };
    if (op.op === "chooseMode") return { ...op, modes: op.modes.map(mode => ({ ...mode, ops: mark(mode.ops) })) };
    return op;
  });
  return { ...script, ops: mark(script.ops) };
}

/**
 * [Awaken] "You may draw N cards and flip this card over" (BT2-001 .. -003,
 * about 181 rows, #1135): the draw is a mandatory part of the [Awaken]; "you
 * may" is the choice to awaken, which the engine already offers. Official Q&A
 * on BT2-001/-002/-003/-034/-035/-036/-068/-069/-070/-100/-102: "Can you choose
 * not to draw cards with [Awaken]? No, you cannot. You must draw 2 cards."
 *
 * Only the draw that opens the effect is unwrapped. Anything else the "may"
 * held ("You may draw 1 card and switch up to 1 of your energy…") stays in
 * its `may`, as it was read before; so do the other optional clauses of an
 * [Awaken] ("If you have a blue energy, you may switch…").
 */
function awakenDrawIsMandatory(script: Script): Script {
  const [first, ...rest] = script.ops;
  if (first?.op !== "may" || first.ops[0]?.op !== "draw") return script;
  const draws: Op[] = [];
  let i = 0;
  while (first.ops[i]?.op === "draw") draws.push(first.ops[i++]);
  // Audit selectors 3 (R-320): "You may draw 2 cards, **and add cards from your life to your hand until you have 6 life
  // left**" (P-434) — the life step said in the same offer is the [Awaken]'s too, as the draw is: the "you may" is the
  // choice to awaken. Kept in the offer, a player could awaken, draw, and keep the life the card takes.
  while (first.ops[i]?.op === "lifeDownTo") draws.push(first.ops[i++]);
  const kept = first.ops.slice(i);
  return { ...script, ops: [...draws, ...(kept.length ? [{ ...first, ops: kept } as Op] : []), ...rest] };
}

/** Apply a keyword cause through nested conditionals/choices, retaining any more specific cause already read on a switch. */
function markSwitchesByAwaken(script: Script): Script {
  const mark = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(mark);
    if (!value || typeof value !== "object") return value;
    const object = value as Record<string, unknown>;
    if (object.op === "switchMode" && !object.by) return { ...object, by: "Awaken" };
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, part] of Object.entries(object)) {
      const mapped = mark(part);
      next[key] = mapped;
      changed ||= mapped !== part;
    }
    return changed ? next : value;
  };
  return { ...script, ops: mark(script.ops) as Op[] };
}

/**
 * 23-5 with 5-8-2-2: "choose 1 card in your Battle Area **and switch it to
 * Revealed Mode**" can only be performed on a card that is in Hidden Mode,
 * and the other way round. As a price that is the whole of it — a price is
 * paid only if its action is performed completely, so picking a card already
 * face up would buy the line for nothing — and as an effect it is the only
 * pick that does anything. The choice is narrowed to the cards the switch can
 * act on, read off the first switch the chosen cards meet: BT28-113 hides a
 * card and reveals it again at the end of the turn, and it is the hiding that
 * is chosen for. A choice that already describes its cards (a colour, a
 * trait, "Battle Cards") is left alone: a Hidden Mode card has none of that
 * information (23-5-2), so the description has already ruled them out.
 */
function narrowHiddenChoices(sc: Script): Script {
  const chooses = new Map<string, Extract<Op, { op: "choose" }>>();
  const first = new Map<string, boolean>();
  const firstMode = new Map<string, "active" | "rest">();
  const toggled = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (o.op === "choose" && typeof o.as === "string") chooses.set(o.as, o as Extract<Op, { op: "choose" }>);
    // "Switch it to Revealed Mode or Hidden Mode" (BT28-150) asks which mode
    // the chosen card is in and switches it to the other: either will do.
    const asked = o.op === "if" ? (o.cond as { sel?: { fromVar?: string } } | undefined)?.sel?.fromVar : undefined;
    if (asked) toggled.add(asked);
    if (o.op === "hidden" && o.target && typeof o.target === "object" && "var" in o.target) {
      const name = (o.target as { var: string }).var;
      if (!first.has(name)) first.set(name, o.hidden as boolean);
    }
    if (o.op === "switchMode" && o.target && typeof o.target === "object" && "var" in o.target) {
      const name = (o.target as { var: string }).var;
      if (!firstMode.has(name)) firstMode.set(name, o.mode as "active" | "rest");
    }
    for (const k of Object.keys(o)) if (k !== "sel" && k !== "target") walk(o[k]);
  };
  walk(sc.ops);
  if (!first.size && !firstMode.size) return sc;
  const narrowed = new Map<string, Extract<Op, { op: "choose" }>>();
  // The same for a Hidden Mode card switched to Rest or Active Mode — "by
  // switching 1 Hidden Mode card in your Battle Area to Rest Mode" (BT28-138)
  // — where the choice already says Hidden Mode and nothing of its mode.
  for (const [name, mode] of firstMode) {
    const ch = chooses.get(name);
    if (!ch || ch.sel.hidden !== true || ch.sel.mode || first.has(name)) continue;
    narrowed.set(name, { ...ch, sel: { ...ch.sel, mode: mode === "rest" ? "active" : "rest" } });
  }
  for (const [name, hidden] of first) {
    if (toggled.has(name)) continue;
    const ch = chooses.get(name);
    if (!ch || ch.sel.filter || ch.sel.hidden !== undefined || ch.sel.special || ch.sel.fromVar || ch.sel.take != null) continue;
    // Only where a card has the position at all (1-10-2): a card chosen out of
    // a hand and then put into play face down is not chosen for its mode.
    const areas = ch.sel.areas?.length ? ch.sel.areas : [ch.sel.area ?? "battle"];
    if (!areas.every((a) => a === "battle" || a === "energy" || a === "unison" || a === "play")) continue;
    narrowed.set(name, { ...ch, sel: { ...ch.sel, hidden: !hidden } });
  }
  if (!narrowed.size) return sc;
  const rebuild = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(rebuild);
    if (!v || typeof v !== "object") return v;
    const o = v as Record<string, unknown>;
    if (o.op === "choose" && typeof o.as === "string" && narrowed.get(o.as) && chooses.get(o.as) === o) return narrowed.get(o.as);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) out[k] = k === "sel" || k === "target" ? o[k] : rebuild(o[k]);
    return out;
  };
  return { ...sc, ops: rebuild(sc.ops) as Op[] };
}

/**
 * "When paying the skill cost of skills on <description> cards in any of your
 * areas, [once per turn] you can use <N [or M]> <cards> as energy" — the
 * scoped `payWith` (20-19, BT28-106). Null for any other sentence, and for
 * one whose description or cards the target grammar cannot read: a
 * permission read wider than it is printed is the one wrong answer.
 */
function scopedPayWith(text: string): Op | null {
  const m = /^when paying the skill costs? of skills on (.+?) cards? in (?:any of )?your areas?,\s*(once per turn,? )?you (?:can|may) use (\d+)(?: or (\d+))? (.+?) as energy\.?$/i.exec(text.trim());
  if (!m) return null;
  const forSkillsOf = filterFor(m[1], null);
  if (!forSkillsOf) return null;
  const sel = parseTarget(`${m[3]} ${m[5]}`);
  if (!sel || sel.special || sel.fromVar) return null;
  const { count: _count, upTo: _upTo, ...where } = sel;
  void _count;
  void _upTo;
  const max = Number(m[4] ?? m[3]);
  return { op: "payWith", target: { sel: where }, forSkillsOf, max, ...(m[2] ? { oncePerTurn: true as const } : {}) };
}

/**
 * 22-13-4-2-1, BT31-001: "You can choose the specified Battle Cards in your
 * Battle Area or your Drop when choosing cards to use with the [Union] skill
 * of a red <Veku> or <Gogeta> card from your hand. If you do, send the chosen
 * cards to their owner's Warp." Two sentences that are one standing
 * permission, so the clause list (which reads a choice, then a move to the
 * Warp) never sees them. Fusion only (the owner's ruling of 13 Oct 2026): the
 * card text says [Union], but [Union-Potara] is placed on top and
 * [Union-Absorb] is not activated from the hand. The engine's [Union] keyword
 * reads the permit and sends those cards to the Warp itself. Null for any
 * other sentence, and for a description the filter grammar cannot read.
 */
function unionFusionAreasPermit(text: string): Op | null {
  // 22-13-4-2-1: this card's own Fusion may pay its named materials
  // from Warp as well as hand. Both sentences are one standing permission.
  // #930: the printed spellings are BT12-136 / BT12-137 / P-286 ("place the
  // chosen cards in your Drop Area from your Warp"), P-308 ("…from your Warp in
  // your Drop Area"), EX25-32 ("…from your Warp into their owner's Drop") and
  // the one-sentence form of the [Union-Potara] cards BT10-132 / P-230, which
  // names no destination (the Potara moves the chosen card to the Battle Area,
  // 22-13-5-2-1-1; a Fusion's go to the Drop as its cost, 22-13-4-4).
  const warp = "you (?:can|may) choose battle cards in your warp when choosing cards to use with this card's \\[union\\] skill from your hand\\.?";
  if (new RegExp(`^${warp}(?:\\s*if you do,? place the chosen cards (?:in your drop area from your warp|from your warp (?:in your drop area|into their owner'?s drop(?: area)?))\\.?)?$`, "i").test(text.trim())) {
    return { op: "permit", what: "unionFusionWarp", target: { sel: { special: "self" } }, until: "game" };
  }
  const m = /^you (?:can|may) choose the specified battle cards in your battle area or your drop when choosing cards to use with the \[union\] skill of an? (.+?) cards? from your hand\.?\s*if you do,? send the chosen cards to their owner'?s warp\.?$/i.exec(text.trim());
  if (!m) return null;
  // "red <Veku> or <Gogeta>" keeps its "or": names side by side are all of them (#907 round 5).
  const filter = filterFor(m[1], null);
  if (!filter) return null;
  return { op: "permit", what: "unionFusionAreas", target: { sel: { special: "self" } }, until: "game", filter };
}

/**
 * 22-13-5-2-1 (#927): the two standing permissions that widen where a
 * [Union-Potara]'s materials may be chosen from.
 *  - BT24-112 (back): "You can choose Battle Cards from under your black
 *    Z-Unison when choosing cards to use with a black card's [Union-Potara]
 *    skill from your hand." -> `unionSourceUnder`, `filter` the card using the
 *    skill (black), `source` the Unison whose pile is searched.
 *  - BT20-125: "This card is played from your hand in your opponent's Battle
 *    Area, and when choosing cards to use with this card's [Union] skill from
 *    your hand, you can choose Battle Cards you own in your opponent's Battle
 *    Area." -> `playInOpponentBattle` and `unionSourceOpponentBattle`, both
 *    this card's own, read from the hand.
 * Null for any other sentence, and for a description the filter grammar cannot read.
 */
function unionPotaraSourcePermit(text: string): Op[] | null {
  const t = text.trim();
  const own = /^this card is played from your hand in your opponent'?s battle area,? and when choosing cards to use with this card'?s \[union(?:-potara)?\] skill from your hand,? you (?:can|may) choose battle cards you own in your opponent'?s battle area\.?$/i;
  if (own.test(t)) {
    const self = { sel: { special: "self" as const } };
    return [
      { op: "permit", what: "playInOpponentBattle", target: self, until: "game" },
      { op: "permit", what: "unionSourceOpponentBattle", target: self, until: "game" },
    ];
  }
  const m = /^you (?:can|may) choose battle cards from under your (.+?) when choosing cards to use with an? (.+?) card'?s \[union-potara\] skill from your hand\.?$/i.exec(t);
  if (!m) return null;
  const source = filterFor(m[1], null);
  const filter = filterFor(`${m[2]} card`, null);
  if (!source || !filter) return null;
  return [{ op: "permit", what: "unionSourceUnder", target: { sel: { special: "self" } }, until: "game", filter, source }];
}

/**
 * #930, BT17-082 (back): "When placing Battle Cards under other cards to pay
 * skill costs for your ≪Namekian≫ [Union Absorb] skills, you can use cards
 * from under this card instead." One standing permission: `filter` is the
 * card whose [Union-Absorb] it widens, and the pile is the granting card's own
 * (owner-accepted default of 25 Oct 2026: a substitute for the place-under
 * material only, one for one, never for energy). Null for any other sentence.
 */
function absorbMaterialUnderPermit(text: string): Op | null {
  const m = /^when placing battle cards under other cards to pay skill costs for your (.+?) \[union[- ]absorb\] skills,? you (?:can|may) use cards from under this card instead\.?$/i.exec(text.trim());
  if (!m) return null;
  const filter = filterFor(`${m[1]} card`, null);
  if (!filter || filter.unreadable) return null;
  return { op: "permit", what: "absorbMaterialUnder", target: { sel: { special: "self" } }, until: "game", filter };
}

/**
 * 22-5-2 widened (BT19-077/078/081/082): "This card's [EX-Evolve] can also be
 * activated from your Z-Energy." One standing permission about the card's own
 * Evolve line's source area. The official card Q&A (BT19-077 Q1) reads it as
 * "activate [EX-Evolve] while it is in your Z-Energy, then play it on top of the
 * target card in the Battle Area", so the base area is untouched.
 */
function evolveFromZEnergyPermit(text: string): Op | null {
  if (!/^this card['’]s \[(?:ex-)?evolve\] can also be activated from your z-energy\.?$/i.test(text.trim())) return null;
  return { op: "permit", what: "evolveFromZEnergy", target: { sel: { special: "self" } }, until: "game" };
}

/** 22-5-3-1: one standing permission, not a choice followed by a free play. */
function evolveEnergyBasesPermit(text: string): Op | null {
  if (!/^when using this card['’]s \[evolve\] skill from your hand,? you can choose battle cards from your energy and play this card in active mode\.?$/i.test(text.trim())) return null;
  return { op: "permit", what: "evolveEnergyBases", target: { sel: { special: "self" } }, until: "game" };
}

/**
 * 22-30-3 with a substitute payment (BT22-035, BT22-140): "[Permanent] If your
 * Leader is …, you can activate your [Aegis] skill by sending 1 yellow card and
 * 1 blue card from your Drop to your Warp instead of discarding a card from
 * your hand" and "…, and you can activate this card's [Aegis] skill by sending
 * 1 card from your opponent's hand to the bottom of their deck instead of
 * discarding a card from your hand". One standing permission each (20-1-11: a
 * voluntary "instead of" applies only if its substitute is fulfilled, which the
 * engine checks when the skill is offered). `head` is whatever the sentence
 * says before ", and you can" and `opener` the leading "if" clause; the engine
 * pays the substitute itself. Null for any other wording, including a scope
 * ("your" / "this card's") the payment does not go with.
 */
function aegisAltPermit(text: string): { head: string | null; opener: string | null; permit: Op } | null {
  const m = /^(?:(.+?),\s*and\s+)?(?:if (.+?),\s*)?you (?:can|may) activate (your|this card'?s) \[aegis(?: [^\]]*)?\](?: skill)? by sending (.+?) instead of discarding (?:a|1|one) cards? from your hand\.?$/i.exec(text.trim());
  if (!m) return null;
  const [, head, opener, scope, payment] = m;
  const target = { sel: { special: "self" as const } };
  const colors = /^1 (\w+) card and 1 (\w+) card from your drop(?: area)? to your warp(?: area)?$/i.exec(payment.trim());
  if (colors && /^your$/i.test(scope)) {
    const named = colors.slice(1, 3).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
    if (!named.every((w) => ["Red", "Blue", "Green", "Yellow", "Black", "White"].includes(w))) return null;
    return { head: head ?? null, opener: opener ?? null, permit: { op: "permit", what: "aegisAltDrop", target, until: "game", filter: { ...emptyFilter(), colors: named as Color[] } } };
  }
  if (/^1 card from your opponent'?s hand to the bottom of their deck$/i.test(payment.trim()) && /^this/i.test(scope)) {
    return { head: head ?? null, opener: opener ?? null, permit: { op: "permit", what: "aegisAltOpponentHand", target, until: "game" } };
  }
  return null;
}

function compileSkillText(skill: Skill): Script {
  const arrivalPolicy = compileCounterArrival(skill);
  if (arrivalPolicy) return arrivalPolicy;
  // [Union-Fusion] and [Union-Potara] print two character names where an
  // effect would go, and the engine reads those itself. [Union-Absorb] is
  // different (22-13-6-1): its line really is "cost : effect", and the effect
  // is what says which card is played onto this one.
  // A line may carry more than one tag — "[Blocker][Evolve]{r}{r}: <Pan>" —
  // and the one that owns the text is not always the one `parseSkills` picked
  // as *the* keyword. Reading the whole line's tags stops the Evolve's target
  // ("<Pan>.") being compiled as if it were an effect.
  const owners = [skill.keyword, ...skill.tags.map(keywordOf)].filter((k): k is KeywordSkill => !!k);
  const keywordOwnsIt = owners.some((k) => KEYWORD_HANDLES_THE_LINE.has(k.name) && !(k.name === "Union" && k.variant === "Absorb"));
  if (keywordOwnsIt) return { ops: [], unsupported: [] };
  // 22-21-2: a bare keyword line's [Bond X] descriptor — "[Blocker][Bond 3]
  // Red ≪Saiyan≫ cards and/or ≪Bardock's Crew≫ cards." (BT13-006) — names the
  // Battle Cards the keyword counts (`bondSelector`, checked in play by
  // `vm/bond.ts`); it is not an effect. Only a descriptor the selector reader
  // proves is taken off; anything else stays unread.
  if (skill.kind === "keyword" && skill.bond != null && !skill.cost.trim() && skill.effect.trim() && bondDescriptorOnly(skill)) return { ops: [], unsupported: [] };
  // A trigger printed at the end of the sentence rather than at its head
  // (BT3-103) has already happened by the time the effect resolves, exactly
  // like the leading form the clause loop drops below. Left in the text it
  // compiles to a delay instead, and the skill then waits for the *next* end
  // of a battle — one battle too late, every time.
  const trailing = trailingTrigger(skill);
  // Phrasing batch 6: "if all of your Battle Cards are red **and no other color**" (TB3-007, TB3-008, TB3-010) is "…are
  // mono-red" (2-6-4), said before the clauses are cut at its "and".
  const text = stripNotes(trailing ? withoutTrailingTrigger(skill.effect, trailing) : skill.effect).replace(/\b(all of your [^,.:;]+? (?:are|is)) (red|blue|green|yellow|black|white) and no other colou?rs?\b/gi, "$1 mono-$2")
    // Mechanism batch 2 (3-8): "**take the top 6 cards from your deck and add them to your energy**" (P-104) is the move
    // "add the top 6 cards of your deck to your energy" said in two verbs.
    .replace(/\btake the top (\d+) cards? from your deck and add (?:them|it) to your energy\b/gi, "add the top $1 cards of your deck to your energy")
    // Mechanism batch 2 (3-8): "choose **this card and 1 of your energy** and switch them to Active Mode" (TB2-058): both
    // are switched. Cut at its "and"s, "them" was only the energy and this card stayed in Rest Mode.
    .replace(/\bchoose this card and (\d+) of your energy and switch them to (active|rest) mode\b/gi, "switch this card to $2 Mode, then choose $1 of your energy and switch it to $2 Mode");
  if (!text) return { ops: [], unsupported: [] };
  // Mechanism batch 2: an [Auto] whose moment is "At the end of your next turn **after you place this card in your
  // energy with this skill**" (BT10-036, BT10-040) waits on an event another line of the card remembers; no moment
  // says it, and read without it the skill would never fire. Unread whole.
  if (skill.kind === "auto" && /^at the end of your next turn after\b/i.test(text.trim())) return { ops: [], unsupported: [text.trim().split(/,/)[0]] };
  // Mechanism batch 2: "When this card is played using a [successor] skill **that was activated by choosing 1 or more
  // each of <Android 17>, <Android 18>, and <Cell> for their skill costs**" (BT21-145): which cards paid the price is not
  // part of any moment the engine has; read without it the skill fired on every play.
  const paidWith = /\busing an? \[[^\]]+\] skill that was activated by choosing [^,]+/i.exec(skill.raw ?? skill.effect);
  if (skill.kind === "auto" && paidWith) return { ops: [], unsupported: [paidWith[0]] };
  const unsupported: string[] = [];
  const c: Ctx = {
    permanent: skill.kind === "permanent" && !triggeredPermanent(skill),
    last: null,
    choices: [],
    lastSeen: null,
    lastNamed: null,
    mills: 0,
    costs: 0,
    lastPlayed: null,
    lastTarget: null,
    stale: null,
    twoNamedCardsRefused: false,
    lastOp: null,
    replacing: null,
    n: 0,
    raw: skill.effect,
    ...(skill.tokenReminders ? { tokenReminders: skill.tokenReminders } : {}),
    skillKind: skill.kind,
    xBound: priceX(skill) !== null,
    ...(skill.spiritBoost ? { spiritBoost: skill.spiritBoost } : {}),
    ...(priceX(skill)?.spiritBoost ? { spiritBoostX: true } : {}),
  };
  // A standing permission is one sentence, not a list of actions: "you can
  // activate this card's [Counter] skill from your hand without paying its
  // energy cost **by choosing 1 other black card in your hand and placing it
  // in your Drop Area**". Splitting it first hands the price's second half to
  // the clause list as an orphan, so the whole sentence is read before that.
  //
  // Ten of the eleven cards that print such a price open with a condition of
  // their own — "**If all of your energy is mono-red,** you can activate this
  // card's [Counter] skill from your hand without paying its energy cost by
  // choosing 2 other cards in your hand **and discarding them**" — and this
  // read only stripped "you can". So it never fired for any of them, the
  // sentence went to the clause list after all, and the half of the price
  // after the "and" was orphaned exactly as the comment above says it must not
  // be: the [Counter] was offered for a choice that cost nothing. The
  // condition comes off first and goes back on around the permission, the way
  // the two-sentence form below already does it.
  const said = text.toLowerCase().trim();
  // 20-19, scoped (BT28-106): "When paying the skill cost of skills on white
  // ≪God≫ cards in any of your areas, once per turn you can use 1 [or 2]
  // Hidden Mode card[s] in your Battle Area as energy." One sentence, which
  // the clause list would cut at the comma and leave both halves unread.
  const scoped = c.permanent ? scopedPayWith(text) : null;
  if (scoped) return { ops: [scoped], unsupported: [] };
  // EX23-36 / P-519: source timing and replacement destination are one
  // standing permission, not an effect-time instruction to select materials.
  const dropBottom = c.permanent ? /^if (your leader(?: card)? is a yellow <gotenks: adolescence>(?: card)?)(?: and you are choosing cards to use with this card's \[union\] skill from your hand| and you choose cards to use with this card's \[union\] skill from a hand),? you may choose the specified battle cards? (?:from|in) your drop(?: area)?\.\s*if you do,? place the chosen cards at the bottom of your deck in any order\.?$/i.exec(text.trim()) : null;
  if (dropBottom) {
    const leader = parseConditionClause(`if ${dropBottom[1]}`, true);
    if (leader) return { ops: [{ op: "if", cond: leader.cond, then: [{ op: "permit", what: "unionFusionDropBottom", target: { sel: { special: "self" } }, until: "game" }] }], unsupported: [] };
  }
  // R469 / BT13-084: the whole permission has a narrower no-cleanup clause.
  // Its first "any number" sentence does not exempt original-cost-1 Fields.
  const fieldKeep = c.permanent ? /^if (your leader(?: card)? is a (?:red|blue|green|yellow|black|white) <[^>]+> card),? you can place any number of mono-(red|blue|green|yellow|black|white) extra cards with the \[field\] skill in your battle area,? and your mono-\2 extra cards with an original energy cost of ([1-9]\d*) and the \[field\] skill don't cause any of your other extra cards with the \[field\] skill to be placed in their owners' drop areas?\.?$/i.exec(text.trim()) : null;
  if (fieldKeep) {
    const leader = parseConditionClause(`if ${fieldKeep[1]}`, true);
    const filter = filterFor(`mono-${fieldKeep[2]} Extra Card with [Field]`, null);
    if (leader && filter) return { ops: [{ op: "if", cond: leader.cond, then: [{ op: "permit", what: "fieldKeepOthers", target: { sel: { special: "self" } }, until: "game", filter: { ...filter, originalCostMin: Number(fieldKeep[3]), originalCostMax: Number(fieldKeep[3]) } }] }], unsupported: [] };
  }
  if (c.permanent && /^you can't activate extra cards with the \[field\] skill that are copies of extra cards with the \[field\] skill in your battle area\.?$/i.test(text.trim())) {
    return { ops: [{ op: "forbid", what: "activateSkill", keywordSkill: "Field", side: "you", until: "game", copiesOf: { side: "you", area: "battle", filter: { ...emptyFilter(), type: "EXTRA", keywords: ["Field"] } } }], unsupported: [] };
  }
  const unionAreas = c.permanent ? unionFusionAreasPermit(text) : null;
  if (unionAreas) return { ops: [unionAreas], unsupported: [] };
  const potaraSources = c.permanent ? unionPotaraSourcePermit(text) : null;
  if (potaraSources) return { ops: potaraSources, unsupported: [] };
  const absorbUnder = c.permanent ? absorbMaterialUnderPermit(text) : null;
  if (absorbUnder) return { ops: [absorbUnder], unsupported: [] };
  // R438: this entire sentence grants permission plus a mandatory price;
  // splitting its conjunction would lose either the area or a removal.
  const counterDrop = c.permanent ? /^if this card is in your drop(?: area)?,? you can activate it by paying its energy cost and removing it and 1 (red|blue|green|yellow) card in your hand from the game\.?$/i.exec(text.trim()) : null;
  if (counterDrop) return { ops: [counterDropPermit(COUNTER_DROP_COLORS.find(color => color.toLowerCase() === counterDrop[1].toLowerCase())!)], unsupported: [] };
  const counterUnder = c.permanent && /^if this card is under a \{universal tuffleization plan\} in your battle area,? you can activate this card['’]s \[counter\] skill under the same conditions as if it were in your hand\.?$/i.test(text.trim());
  if (counterUnder) return { ops: [counterUnderPermit()], unsupported: [] };
  const counterEnergy = c.permanent ? /^(?:if your leader(?: card)? is a blue ≪red ribbon army≫ card,? )?you can activate this card['’]s \[counter\] skill from your energy by paying its energy cost(?: and (choosing 1 card in your hand and discarding it|discarding 1 card from your hand))?\.?$/i.exec(text.trim()) : null;
  if (counterEnergy) {
    const leader = /^if /i.test(text.trim()), discard = !!counterEnergy[1];
    if (leader || discard) return { ops: [counterEnergyPermit(leader, discard)], unsupported: [] };
  }
  const evolveZ = c.permanent ? evolveFromZEnergyPermit(text) : null;
  if (evolveZ) return { ops: [evolveZ], unsupported: [] };
  const evolveAreas = c.permanent ? evolveEnergyBasesPermit(text) : null;
  if (evolveAreas) return { ops: [evolveAreas], unsupported: [] };
  // #930, P-360: "[Permanent] Red <Gogeta: Br> cards in your hand gain the
  // following skill: ・[union-fusion]{r}{u}{2}: <Son Goku: Br> and <Vegeta: Br>."
  // A granted [Union-Fusion] / [Union-Potara] line is a move of the card in hand
  // and needs no program (the keyword's \`DO\` is its effect), so the standing
  // permission carries the printed line and \`activationsOf\` offers it. Any
  // other granted line stays unread.
  // The colon that ends "…the following skill:" is the one `splitCost` cuts the
  // line at, so the sentence arrives as a cost and an effect and is read whole.
  const grantedSentence = c.permanent && /\bfollowing skill\s*$/i.test(skill.cost.trim()) ? `${skill.cost.trim()}: ${text.trim()}` : text.trim();
  const granted = c.permanent ? /^(.+?) cards? in your hand gains? the following skill:\s*[・•·]?\s*(\[union[- ](?:fusion|potara)\][^\n]*?)\s*$/i.exec(grantedSentence) : null;
  if (granted) {
    const who = parseTarget(`${granted[1]} cards in your hand`);
    if (who && !who.special && !who.fromVar && !who.upTo && who.side === "you" && who.area === "hand" && !who.filter?.unreadable) {
      const lines = parseSkills(granted[2]);
      const line = lines[0];
      if (lines.length !== 1 || line.kind !== "keyword" || line.keyword?.name !== "Union"
        || (isFusionSkill(line) && (line.oncePerTurn || line.limit !== null || line.bond !== null || line.sparking !== null || line.tags.length !== 1))) {
        return { ops: [], unsupported: ["unsupported granted Union identity or use-limit metadata"] };
      }
      if (isAbsorbSkill(line)) return { ops: [], unsupported: ["granted typed Union-Absorb procedure is not supported (#907)"] };
      if (isFusionSkill(line) && !compileFusionMaterials(line)) return { ops: [], unsupported: ["unsupported granted Fusion material description"] };
      if (line.oncePerTurn || line.limit !== null || line.sparking !== null) return { ops: [], unsupported: ["granted Union use ceilings/Sparking require a typed grant contract; this grant is unsupported (#907)"] };
      return { ops: [{ op: "permit", what: "unionLine", target: { sel: who }, until: "game", line: granted[2], unionVariant: line.keyword?.name === "Union" && line.keyword.variant === "Potara" ? "Potara" : "Fusion", price: compileSkillPrice(line) }], unsupported: [] };
    }
  }
  // #930, 22-13-5-2-1: "[Permanent] If you have 4 or more energy, you can choose
  // Battle Cards in your energy when choosing cards to use with this card's
  // [Union] skill from your hand" (BT10-046; BT10-053 at 3, P-220 with none).
  const energyOpener = c.permanent ? /^(?:if (.+?),\s*)?you (?:can|may) choose battle cards in your energy when choosing cards to use with this card's \[union\] skill from your hand\.?$/i.exec(text.trim()) : null;
  if (energyOpener) {
    const conds = energyOpener[1] ? allConditions(energyOpener[1]) : [];
    // A condition that cannot be read refuses the permission (ground rule 5).
    if (!conds) return { ops: [], unsupported: [energyOpener[1]] };
    const permit: Op = { op: "permit", what: "unionEnergy", target: { sel: { special: "self" } }, until: "game" };
    return { ops: conds.reduceRight<Op[]>((then, { cond }) => [{ op: "if", cond, then }], [permit]), unsupported: [] };
  }
  const aegisAlt = c.permanent ? aegisAltPermit(text) : null;
  if (aegisAlt) {
    const rest = aegisAlt.head ? compileSkillText({ ...skill, effect: aegisAlt.head }) : { ops: [], unsupported: [] as string[] };
    if (rest.unsupported.length) return { ops: [], unsupported: rest.unsupported };
    // A condition that cannot be read refuses the permission (ground rule 5).
    // "a Leader with both <A> and <B>" (BT22-035) is read by the card filter
    // itself as all-of (`charactersAll`, #768).
    const conds = aegisAlt.opener ? allConditions(aegisAlt.opener) : [];
    if (!conds) return { ops: [], unsupported: [aegisAlt.opener!] };
    return { ops: [...rest.ops, ...conds.reduceRight<Op[]>((then, { cond }) => [{ op: "if", cond, then }], [aegisAlt.permit])], unsupported: [] };
  }
  const opener = /^if (.+?),\s*(?=you (?:can|may)\s)/.exec(said);
  const permission = counterAltCost(said.slice(opener?.[0].length ?? 0).replace(/^you (?:can|may)\s+/, ""), c);
  // Only a *program* price needs the opener taken off. A waiver and a price
    // out of your life are each said in one clause, so the clause list reads
    // them and their conditions exactly as it always did — and it reads some
    // of those conditions better than this does. BT19-092's "if your Leader is
    // a green <Gogeta: Br> card **and** at least 1 <Son Goku: Br> card and 1
    // <Vegeta: Br> card are in your Z-Energy" defeats `allConditions`, which
    // falls back to reading the whole as one condition and gets a Leader
    // answering to three names with nothing asked of the Z-Energy — wider than
    // the card, where the clause list was merely narrower.
  if (permission && (!opener || permission.some((o) => o.op === "altCost" && o.pay === "program"))) {
    if (!opener) return { ops: permission, unsupported: [] };
    // Read through `allConditions`, never `parseConditionClause`: these
    // openers state two and three requirements at once — "if your Leader is a
    // yellow <Son Gohan: Youth> card, your life is at 4 or less, **and** you
    // have a yellow ≪Great Ape≫ <Son Gohan: Youth> card in play" — and a
    // single-condition read keeps the first and the last and drops what is
    // between them. Each one is its own `if`, which is what the clause list
    // already made of these sentences before this read existed.
    //
    // A condition that cannot be read must refuse the permission rather than
    // come off in front of it: a price waived on fewer terms than the card
    // states is a wider offer than the card makes (ground rule 5).
    const conds = allConditions(opener[1]);
    if (!conds) return { ops: [], unsupported: [opener[1]] };
    return { ops: conds.reduceRight<Op[]>((then, { cond }) => [{ op: "if", cond, then }], permission), unsupported: [] };
  }
  // The same offer told over two sentences (BT4-070, BT4-097): the price
  // first, as something you may do at the moment the [Counter] is activated,
  // and the waiver second, hanging on "if you do so". Read clause by clause it
  // becomes a choice out of your life and then a *play* of this card, which is
  // not what any of it says — so the pair is matched whole, ahead of the split.
  const overTwo =
    /when you activate this card's \[counter[^\]]*\](?: skill)?,\s*you may (?:choose|add) (a|an|\d+) cards? (?:in|from) your life(?: and add (?:it|them) to your hand)?\.?\s*if you do(?: so)?,\s*you may activate this card's \[counter[^\]]*\](?: skill)? without paying (?:its|the) energy cost/i.exec(
      text,
    );
  if (overTwo) {
    const alt: Op[] = [{ op: "altCost", pay: "life", n: countWord(overTwo[1]) }];
    // "If your Leader Card is ≪Goku's Lineage≫, when you activate…": the
    // permission only stands while the condition does.
    const lead = /^if (.+?),\s*when you activate/i.exec(text);
    const cond = lead ? parseConditionClause(`if ${lead[1]}`, true) : null;
    if (lead && !cond) return { ops: [], unsupported: [lead[1]] };
    return { ops: cond ? [{ op: "if", cond: cond.cond, then: alt }] : alt, unsupported: [] };
  }
  // "Choose 1 {Tree of Might} … and place this card under the chosen card:
  // **Add a marker to the chosen card**" — the effect points back at what the
  // price chose. The price is its own program, and the engine hands its
  // variables on (4-3-3), so the compiler only has to know the name.
  const priceOps = compileCostProgram(skill)?.ops ?? [];
  if (skill.burst && !priceOps.length && (skill.kind === "auto" || skill.kind.startsWith("activate:"))) c.paidPile = { name: `paid_burst`, count: skill.burst };
  const millPrice = priceOps.length === 1 ? priceOps[0] : undefined;
  if (!skill.burst && millPrice?.op === "mill" && millPrice.as && typeof millPrice.n === "number" && millPrice.n > 0 && (!millPrice.side || millPrice.side === "you") && (skill.kind === "auto" || skill.kind.startsWith("activate:"))) c.paidPile = { name: `paid_mill_${millPrice.as}`, count: millPrice.n };
  for (const o of priceOps) {
    if (o.op !== "choose") continue;
    // Audit effects 2 review: a price's pick from the pile under its chosen card ("…and place 2 of the cards from under
    // that card into their owner's Drop", BT28-079's back) is not "the chosen card" of the effect (`Ctx.pilePick`).
    if (o.sel.underHost?.fromVar && o.sel.underHost.fromVar !== o.as) (c.pilePick ??= {})[o.as] = o.sel.underHost.fromVar;
    c.last = o.as;
    c.lastTarget = { var: o.as };
    c.priceChoice = o.as;
    c.priceDiscarded = priceOps.some((p) => p.op === "moveTo" && "var" in p.target && p.target.var === o.as && p.to === "drop");
  }
  // Audit selectors 3: where each of the price's choices was made, for "the chosen cards from your opponent's Drop Area".
  c.priceChoices = priceOps.filter((o): o is Extract<Op, { op: "choose" }> => o.op === "choose").map((o) => ({ var: o.as, sel: o.sel }));
  c.priceChosen = priceOps
    .filter((o): o is Extract<Op, { op: "choose" }> => o.op === "choose")
    .map((o) => o.as)
    .filter((v) => !priceOps.some((p) => p.op === "placeOnTop" && "var" in p.target && p.target.var === v));
  // "The card you placed under this card" (BT4-018, #930) is the price's choice
  // only when the price is exactly one choice of one card, placed under this
  // card; the effect's own names then start past it, so its search never
  // rebinds the name it is compared against.
  const priceChoices = priceOps.filter((o): o is Extract<Op, { op: "choose" }> => o.op === "choose");
  if (priceChoices.length === 1 && priceChoices[0].sel.count === 1 && !priceChoices[0].sel.upTo
    && priceOps.some((p) => p.op === "moveTo" && "var" in p.target && p.target.var === priceChoices[0].as && p.to === "under" && !p.under)) {
    c.pricePlacedUnder = true;
    if (SAME_CHARACTER_AS_PLACED.test(text)) {
      const at = /^c(\d+)$/.exec(priceChoices[0].as);
      if (at) c.n = Math.max(c.n, Number(at[1]) + 1);
    }
  }
  // Review of audit selectors 3: "…and **all of the chosen cards** will not switch to Active Mode" (BT21-118) names the
  // price's cards beside the effect's own choice, so the effect's names start past the price's — read with both called
  // "c0", the effect's choice rebound the name and the two energy were lost.
  if (c.priceChosen.length && /\ball (?:of )?the chosen cards\b/i.test(text)) {
    for (const v of c.priceChosen) {
      const at = /^c(\d+)$/.exec(v);
      if (at) c.n = Math.max(c.n, Number(at[1]) + 1);
    }
  }
  // Audit-selectors-1 review: "the card that was sent to the Warp by this skill" (BT7-080) after a price that sent this card there.
  if (priceOps.some((p) => p.op === "moveTo" && p.to === "warp" && "sel" in p.target && p.target.sel.special === "self")) c.priceSentSelfToWarp = true;
  // "The revealed card" (#930, EX13-14 / SD19-03) is what the price revealed.
  const priceReveal = priceOps.filter((o): o is Extract<Op, { op: "reveal" }> => o.op === "reveal");
  if (priceReveal.length === 1) c.priceRevealed = priceReveal[0].as;
  // "The card that was switched to Hidden Mode by this skill" names the
  // price's card, possibly well after the effect has made choices of its own
  // ("Play this card, then switch the card that was switched to Hidden Mode
  // by this skill to Revealed Mode at the end of the turn", BT28-121). The
  // effect's own names start past the price's then, so the price's card is
  // still under its name when the reference is read; anywhere else the shared
  // `c0` stays as it is (see `Ctx.mills`).
  if (c.priceChoice && SWITCHED_BY_THIS_SKILL.test(text)) {
    const at = /^c(\d+)$/.exec(c.priceChoice);
    if (at) c.n = Math.max(c.n, Number(at[1]) + 1);
  }
  // 20-14-1's prices said around the action they tax (BT31-093, BT8-051),
  // put back in the one shape `compileProhibition` reads before the sentence
  // is cut — cut first, the trigger-like half and the ban land in two clauses.
  const spoken = taxWordings(text);
  const modal = splitModal(spoken);
  const split = splitClausesJoined(modal ? modal.head : spoken);
  const clauses = [...split.clauses];
  // Audit lane C (2 Nov 2026): "you may choose 1 card from your hand and place it in your Drop Area. **If you do,
  // choose one—** ・…" (BT7-017, BT7-036, BT7-063, BT11-030): the menu hangs on the head's own decision (20-16). The
  // hinge is the head's last clause with nothing after it, which the clause list drops as an empty group, and the menu
  // was then offered whether or not the card was placed.
  const modalIfDone = !!modal && clauses.length > 1 && /^(?:then,? )?if (?:you do(?: so)?|so|you did)[,.]?$/i.test(clauses[clauses.length - 1].trim());
  if (modalIfDone) clauses.pop();
  // BT3-096/098: keep the own-turn condition, but consume this battle's
  // cleanup timing as the Auto trigger rather than schedule another delay.
  const ownComboEnd = skill.kind === "auto" && comboBattleEndYourTurn(skill);
  if (ownComboEnd && /^during your turn$/i.test(clauses[0] ?? "")) clauses.shift();
  // [Awaken] and [Wish] check their own condition in the engine before the
  // skill is offered (22-2, 22-20), and the engine flips the Leader after the
  // effects resolve (22-2-4), so "flip this card over" in their text is not an
  // effect. On any other skill it is (a Leader's [Auto] that awakens it).
  const engineChecks = skill.keyword?.name === "Awaken" || skill.keyword?.name === "Wish";
  if (engineChecks) for (let i = clauses.length - 1; i >= 0; i--) if (/^(?:then )?flip (?:this card|it) (?:over|onto its back|to its back(?: side)?)[.]?$/i.test(clauses[i].trim())) clauses.splice(i, 1);
  // An [Auto] skill restates its own trigger ("When this card attacks, draw 1
  // card"); by the time the effect resolves the trigger has already fired, so
  // that clause is dropped. A leading "if …" is a condition, not a trigger, and
  // stays — it must compile or the skill goes to the referee.
  let triggerCond: Cond | null = null;
  let returnedFromBattle = false;
  if (ownComboEnd && !compileComboQualification(skill)) triggerCond = { kind: "isTurnPlayer" };
  // "If this card is placed in your Drop Area from your hand by a skill"
  // (SD13-05, behind a condition before the colon) is the trigger said with
  // "if" — `droppedFromHand`, the same moment as "when" — and not a condition.
  // #907: "During your turn, when you Combo with this card, …" (BT1-063, BT1-101,
  // BT2-044, BT2-079, BT3-072, BT4-107) and "During your turn, when this card
  // attacks" put the turn before the moment. The turn is a condition on the
  // skill, not part of the trigger, so it is lifted off the front here and
  // folded back into the trigger's condition below; the moment is then the head.
  let turnCond: Cond | null = null;
  let leadCond: Cond | null = null;
  if (skill.kind === "auto" && clauses.length > 2 && /^when\b/i.test(clauses[1] ?? "")) {
    const turn = /^during (your|your opponent'?s) turn[,.]?$/i.exec(clauses[0].trim());
    if (turn) {
      turnCond = turn[1].toLowerCase() === "your" ? { kind: "isTurnPlayer" } : { kind: "isTurnPlayer", who: "opponent" };
      clauses.shift();
    } else if (/^if\b/i.test(clauses[0].trim())) {
      // Audit triggers 3: "If you have 6 or more red energy, **when you play this card**, look at …" (BT2-022): the older
      // cards' condition before the moment with a comma rather than a colon — a condition on the skill as "During your
      // turn," is, lifted off the front and folded back into the trigger's condition, so the moment is the head.
      const lead = parseConditionClause(clauses[0].trim().replace(/[,.]$/, ""));
      if (lead && !lead.subject) {
        leadCond = lead.cond;
        clauses.shift();
      }
    }
  }
  if ((skill.kind === "auto" || triggeredPermanent(skill)) && (clauses.length > 1 || modal) && (/^(?:when|at the (?:end|beginning|start))\b/i.test(clauses[0] ?? "") || IF_DROPPED_FROM_HAND.test(clauses[0] ?? "")) && !isComboDropReplacement(clauses[0] ?? "")) {
    const trigger = clauses.shift()!;
    // Phrasing batch 3: the second moment of a trigger said after a comma — "When this card attacks**, or activates
    // the [Blocker] skill**" (BT25-066, BT27-074), "At the end of your turn**, or when this card activates its
    // [blocker] skill**" (BT13-018), "…**, or when you activate this card's [Blocker] skill**" (BT15-143, BT25-116).
    // The trigger readers already answer to both moments (`blockerUsed` beside `attacks` or `turnEnd`); the comma
    // only left the second one behind as a clause of its own, which is the trigger again and nothing to do.
    if (clauses.length > 1 && /^or (?:when )?(?:this card activates (?:its |the )?|you activate this card['’]s |activates (?:its |the )?)\[blocker\](?: skill)?[.,]?$/i.test(clauses[0].trim()) && autoTriggerMatches(skill, "blockerUsed")) clauses.shift();
    // "When this card is played or removed from a Battle Area by a skill"
    // (BT31-015, #940): a coordinated alternative the trigger readers could
    // not place is left unread, not dropped silently with the clause.
    if (playedOrUnplacedAlternative(skill)) return { ops: [], unsupported: [trigger, ...clauses] };
    // The comma-separated alternative belongs to WHEN; its own typed moment carries the turn restriction.
    if (playedOrActiveDuringYourTurn(skill) && /^or when this card is switched to active mode by a skill during your turn[,.]?$/i.test(clauses[0]?.trim() ?? "")) clauses.shift();
    // R-485: Sawar separates the already represented Hand-combo alternative with a comma.
    if (playedOrComboBattleEnd(skill) && /^or at the end of a battle (?:in which|where) this card was used in a combo from your hand[,.]?$/i.test(clauses[0]?.trim() ?? "")) clauses.shift();
    // Audit triggers 1: a head that coordinates moments answers to each (`triggersOf`), and what it says about a card a
    // moment hands on is read off that moment. One that no reader places, or a condition one moment alone would carry,
    // leaves the moment clause unread (`momentIsRead`), the program kept as for any unread moment.
    const coordinated = readsMomentsOneByOne(skill) ? coordinatedSubject(skill) ?? { cond: null } : undefined;
    // Moments batch 1: what a moment says about the skill's card that caused it — "by your Leader's skill", "by a
    // <Dr. Hedo: SH> card skill", "by the skills of a ≪Prison Planet≫ card in any of your areas" — is a condition on
    // the subject the moment hands on (20-7-2, 20-7-3); so is the kind of card a watched power change is about. A
    // cause the target grammar cannot read whole refuses the skill: firing for any skill would be wider than the card.
    let momentRead = false;
    if (skill.kind === "auto") {
      const b1 = coordinated !== undefined ? undefined : batch1Condition(trigger);
      if (b1 === null) return { ops: [], unsupported: [trigger, ...clauses] };
      if (b1) {
        momentRead = true;
        if (b1.cond) triggerCond = b1.cond;
      }
    }
    const returned = RETURNED_FROM_YOUR_BATTLE.exec(trigger.trim());
    if (returned) {
      returnedFromBattle = true;
      const filter = filterFor(returned[1], null);
      if (filter === null) return { ops: [], unsupported: [trigger, ...clauses] };
      if (filter) triggerCond = { kind: "count", sel: { special: "subject", filter }, atLeast: 1 };
    }
    // The dropped trigger is still what the sentence is about: "When this card
    // is sent to the Warp …, add **it** to your hand" means this card. Without
    // this, the first "it" of an [Auto] has nothing to point at and the whole
    // skill goes to the referee.
    // "When this card is placed under a <Vegito> card with a [Union] skill"
    // (BT29-140, 23-2): the host is the card on top of this one, and what the
    // trigger says about it is a condition on that card.
    // Audit triggers 3: and where this card came from (`placedUnderFrom…`, a moment each) — "When this card **in your
    // hand** is placed under a {Destroyed West City} **in your Battle Area**" (BT23-025), "…placed **from your hand or
    // Drop** under an <Anilaza> or <Koichiarator> card―both red and in your Battle Area―" (BT20-014): the host's area is
    // a condition on it too.
    const under = /^when this card(?: in your [a-z -]+?| in a battle area)? is placed(?: from your [a-z -]+?)? under (?:an? |your |one of your )?(.+?)[,.]?$/i.exec(trigger.trim());
    if (under) {
      const shared = /[-—–―]\s*both (.+?) and in your battle area\s*[-—–―]?$/i.exec(under[1]);
      const inBattle = !!shared || / in your battle area$/i.test(under[1]);
      // "An <Anilaza> or <Koichiarator> card―both red―" is a red <Anilaza> or <Koichiarator> card: the shared words go in front.
      const said = shared ? `${shared[1]} ${under[1].slice(0, shared.index).trim()}` : under[1].replace(/ in your battle area$/i, "");
      const host = filterFor(said, null);
      if (host === null || (host && unreadFilterWords(said, host).length)) return { ops: [], unsupported: [trigger, ...clauses] };
      if (host || inBattle) triggerCond = { kind: "count", sel: { special: "onTop", ...(inBattle ? { area: "battle" as const } : {}), ...(host ? { filter: host } : {}) }, atLeast: 1 };
      // Review of audit selectors 3: "…placed under one of your Z-Battle Cards, **the Z-Battle Card** gets +5000 power
      // and the following skill" (BT18-008) — the definite description is that host (`refFor`, `Ctx.hostAbove`).
      if (host) c.hostAbove = host;
    }
    // "When this card attacks during the turn you played it with [Over Realm]"
    // (P-048, 22-15): the moment is the attack, and the rest of the sentence is
    // a condition on it — the card's memory of how it was played this turn.
    // Dropped with the trigger, it fired on every attack of every turn.
    if (/\bduring the turn (?:you played (?:it|this card)|(?:it|this card) was played) (?:with|using) \[(?:dark )?over realm[^\]]*\]/i.test(trigger)) {
      triggerCond = { kind: "playedUsing", sel: { special: "self" }, what: "Over Realm" };
    }
    // Audit triggers 3: "At the end of a turn where this card was played" (BT16-142): the turn's end, either player's, and
    // the card's memory of being played this turn (5-5, `VmCard.playedThisTurn`) the condition on it.
    if (TURN_END_WHERE_PLAYED.test(maskNames(trigger.trim()).text.toLowerCase().replace(/[,.]$/, ""))) triggerCond = { kind: "placedThisTurn", sel: { special: "self" }, played: true, ...(/ from your hand[,.]?$/i.test(trigger.trim()) ? { from: ["hand" as const] } : {}) };
    // #930: "When this card is played using [Union]" (BT14-114), "when you play
    // this card with [union]" (BT5-039, BT2-085 …), "when this card is played
    // by a [union] skill" (BT28-097, BT28-099): the moment is `played`, and
    // how it was played is a gate on it — a successful entry by a [Union-(type)]
    // skill's own play (owner's ruling, 25 Oct 2026), bare [Union] any of them,
    // a named variant ("using [Union-Potara]") only that one. `resolvePlay`
    // withdraws the Auto from any other play (`vm/triggers.ts`
    // `unionPlayGate`). Only the whole moment: "…using [union-potara] or
    // attacks" (BT4-019) uses independent typed moments (R487), no shared gate.
    const unionPlay = UNION_PLAY_TRIGGER.exec(trigger.trim());
    if (unionPlay) triggerCond = { kind: "playedUsing", sel: { special: "self" }, what: unionPlay[1] ? UNION_VARIANT[unionPlay[1].toLowerCase() as keyof typeof UNION_VARIANT] : "Union" };
    // Audit conditions 2: how else the play had to be made — "with [Swap]", "using [Arrival]", "with the skill of
    // {Majin Buu's Sealed Ball}", "without using skills", "during your opponent's turn" (`playedHowGate`). Words it
    // cannot read whole refuse the skill: answering every play is wider than the card.
    const how = skill.kind === "auto" && !unionPlay ? playedHowGate(trigger) : undefined;
    if (how === null) return { ops: [], unsupported: [trigger, ...clauses] };
    if (how) triggerCond = triggerCond ? { kind: "all", conds: [triggerCond, how] } : how;
    // Audit conditions 2: "When this card **attacks twice in the same turn**" (EX01-04): the moment is the attack, and it
    // has to be this card's second this turn (`attacked`, the count [Dual Attack] keeps). Dropped, the first attack
    // already gave [Double Strike].
    if (skill.kind === "auto" && /^when this card attacks twice in (?:the same|a single|one) turn[.,]?$/i.test(trigger.trim())) triggerCond = { kind: "attacked", sel: { special: "self" }, atLeast: 2 };
    // "At the end of a turn in which this card was placed in a Battle Area"
    // (BT15-118, 5-5-4): the moment is every turn's end (`turnEnd` and
    // `opponentTurnEnd`), and the rest of the sentence is a condition on it —
    // the card's memory of arriving this turn, played or placed (5-5-1).
    if (TURN_END_AFTER_PLACED.test(trigger.trim().toLowerCase())) triggerCond = { kind: "placedThisTurn", sel: { special: "self" } };
    // "At the end of a battle in which you combo with this card from your hand
    // **during your opponent's turn**" (BT6-010, #539): the moment is
    // `comboed`; whose turn it is, a condition on it. The two trigger
    // interpreters now bind "from your hand" to this battle's combo-entry
    // source before queueing the Auto, rather than widening this condition.
    if (comboBattleEndOpponentTurn(skill) && !compileComboQualification(skill))
      triggerCond = { kind: "not", cond: { kind: "isTurnPlayer" } };
    // "When this card is sent from your deck to your Warp by your <Heles>
    // card's skill" (BT30-106, 3-10): the moment is any skill of yours
    // (`deckToWarpBySkill`), and the skill's card is the subject — so which
    // card's skill it was is a condition on the subject. A description that
    // cannot be read refuses the skill: firing for every skill of yours would
    // be wider than the card.
    const warped = /^when this card (?:in your deck is sent (?:from your deck )?|is sent from your deck )to (?:your|its owner'?s) warp by (?:one of )?your (.+?)[,.]?$/i.exec(trigger.trim());
    if (warped) {
      const said = warped[1].trim();
      if (!/^skills?$/i.test(said)) {
        const by = /^(.+?)(?: card)?'s? skills?$/i.exec(said);
        const cause = by ? filterFor(by[1], null) : null;
        if (!cause) return { ops: [], unsupported: [trigger, ...clauses] };
        triggerCond = { kind: "count", sel: { special: "subject", filter: cause }, atLeast: 1 };
      }
    }
    // "When you remove a marker from one of your **red** Unison Cards using a
    // [Spirit Boost] skill" (SD15-05, 22-43-3, #1169): the moment is any
    // [Spirit Boost] payment of yours (`spiritBoostPaid`), which hands the
    // Unison the markers came off on as the subject, so what the card says
    // about it — a colour, mono-colour, a <name>, a ≪trait≫, a {card name} —
    // is a condition on that subject. A description the filter cannot read
    // whole leaves the skill unread: firing for any Unison would be wider
    // than the card.
    const payer = skill.kind === "auto" ? spiritBoostPayerOf(trigger) : null;
    if (payer !== null && !/^unison cards?$/i.test(payer)) {
      const filter = filterFor(payer, null);
      if (!filter || unreadFilterWords(payer, filter).length) return { ops: [], unsupported: [trigger, ...clauses] };
      triggerCond = { kind: "count", sel: { special: "subject", filter }, atLeast: 1 };
    }
    // "When this card is played from your hand or discarded by a <Shadow Dragon>
    // card's skill" (BT14-131 …, #969): the discard half is `droppedFromHand`,
    // which hands the skill's card on as the subject, so which card's skill it
    // was is a condition on a subject — and only the discard half has one. The
    // play has none, which is what "no subject" says; a description that cannot
    // be read refuses the skill rather than widening the discard to any skill.
    const discardCause = skill.kind === "auto" && !momentRead ? discardedBySkillCause(trigger) : null;
    if (discardCause) {
      const cause = filterFor(discardCause, null);
      if (!cause) return { ops: [], unsupported: [trigger, ...clauses] };
      // Audit conditions 2: "…discarded by **your** Leader's skill" (P-491) is your own Leader's skill, not the
      // opponent's; and a moment that is the discard alone ("When this card is discarded by …") has no play half, so a
      // discard naming no card is not let through as one.
      const subject = { special: "subject", ...(/\bdiscarded by (?:your|one of your) /i.test(trigger) ? { side: "you" as const } : {}) } as const;
      const has: Cond = { kind: "count", sel: { ...subject, filter: cause }, atLeast: 1 };
      triggerCond = /^when this card is discarded by\b/i.test(trigger.trim()) ? has : { kind: "any", conds: [
        { kind: "not", cond: { kind: "count", sel: { special: "subject" }, atLeast: 1 } },
        has,
      ] };
    }
    // "When this card is [played or] switched to Rest Mode by one of your yellow
    // card skills" (BT13-112/113/116, EX19-18), "… by your yellow <Turles> card's
    // skill" (BT24-102), "… by your Leader's skill" (BT23-110, SD20-05),
    // "… with {Secret Treaty Hercule}'s skill" (TB2-009) (#907): the moment is the
    // switch by a skill (`restedBySkill`, `restedByAnySkill`,
    // `restedByOpponentSkill`), which hands the skill's card on as the subject, so
    // what the card says about the cause is a condition on that subject. In a
    // coordinated "played or switched" the play has no subject, and the condition
    // belongs to the Rest half alone. A description the filter cannot read refuses
    // the skill: firing for any skill would be wider than the card.
    const restCause = skill.kind === "auto" ? restedCauseOf(trigger) : null;
    if (restCause && restCause.side !== "alliance" && restCause.desc) {
      const cause = filterFor(restCause.desc, null);
      if (!cause) return { ops: [], unsupported: [trigger, ...clauses] };
      const subject = { special: "subject" } as const;
      const has: Cond = { kind: "count", sel: { ...subject, filter: cause }, atLeast: 1 };
      triggerCond = restCause.played
        ? { kind: "any", conds: [{ kind: "not", cond: { kind: "count", sel: subject, atLeast: 1 } }, has] }
        : has;
    }
    // "When this card attacks a Leader Card" / "… attacks a Battle Card"
    // (SD5-01, BT6-014, 8-1-3): the moment is the attack, and what it attacks
    // is a condition on the card being attacked. Dropped with the trigger, the
    // skill fired on every attack (owner's card review, 4 Oct 2026, #536).
    // Audit lane C review (2 Nov 2026): the Leader is also said without "Card" — "When this card attacks **your
    // opponent's Leader**" (P-027, front and back), "…attacks **a Leader**" (BT31-124): the same guard. Only the
    // bare noun at the end of the moment; "a Leader or Unison" (BT18-059) names a second guard and is not this.
    const attacking = /^when this card attacks (?:an? |1 of your opponent'?s |your opponent'?s |an opponent'?s )?(?:(leader|battle) card\b(.*)|(leader))$/i.exec(trigger.trim());
    if (attacking) {
      const kind = (attacking[1] ?? attacking[3]).toLowerCase();
      // "…a Battle Card **with an energy cost of 8 or more**" (BT19-035b,
      // #1005): the tail describes the card attacked. Dropped, the skill fired
      // on every attack at a Battle Card; a tail the filter cannot read refuses
      // the skill rather than widening it.
      const tail = (attacking[2] ?? "").trim().replace(/[.,]$/, "");
      const guardFilter = tail ? filterFor(`${kind} card ${tail}`, null) : undefined;
      if (tail && (!guardFilter || !/^with\b/i.test(tail) || unreadFilterWords(tail, guardFilter).length)) return { ops: [], unsupported: [trigger, ...clauses] };
      triggerCond = { kind: "inBattle", sel: { area: kind === "leader" ? "leader" : "battle", side: "opponent", ...(guardFilter ? { filter: guardFilter } : {}) }, role: "guard" };
      if (kind === "battle") c.attacksBattleCard = true;
    }
    // Audit conditions 2: "When this card attacks **a Leader or Unison**" (BT18-059): the guard is the opponent's Leader or
    // one of their Unisons — either; read with no guard at all the skill answered an attack on a Battle Card too.
    if (/^when this card attacks (?:an? |your opponent'?s )?leader(?: card)? or (?:an? )?unison(?: card)?[.,]?$/i.test(trigger.trim()))
      triggerCond = { kind: "any", conds: [{ kind: "inBattle", sel: { area: "leader", side: "opponent" }, role: "guard" }, { kind: "inBattle", sel: { area: "unison", side: "opponent" }, role: "guard" }] };
    // Audit triggers 1: "At the end of the battle **for this card**" (BT25-039's wording), "…a battle **in which this card
    // attacked**", "…**after this card attacks**", "…**in which this card was attacked**" (8-5): the moment is every
    // battle's end (`battleEnd`), and this card's part in the battle is a condition on it — dropped, the skill answered
    // the end of every battle on the board.
    const battlePart = skill.kind === "auto" ? battleEndPart(trigger.trim().toLowerCase()) : undefined;
    if (battlePart === "yourAttacker") {
      const said = battleAttackerSaid(trigger) ?? "";
      const attacker = filterFor(said, null);
      if (!attacker || unreadFilterWords(said, attacker).length) return { ops: [], unsupported: [trigger, ...clauses] };
      triggerCond = { kind: "inBattle", sel: { side: "you", ...(/\bbattle cards?$/i.test(said) ? { area: "battle" as const } : {}), filter: attacker }, role: "attacker" };
    } else if (battlePart && battlePart !== "any") triggerCond = { kind: "inBattle", sel: { special: "self" }, ...(battlePart === "self" ? {} : { role: battlePart }) };
    // Audit triggers 1: the card a `kos` moment KO'd is its subject, and what the words say about it is a condition on it.
    // The head is read whole: "attacks and KOs …" is cut at its "and" into clauses (below). A condition in front may end
    // in a comma, the sets' bar or (audit triggers 2) a colon left in the effect.
    const kosMasked = maskNames(skill.effect);
    const kosHead = /^(?:if (?:[^,|:<]|<[^<>]*>){0,90}[,|:]\s*)?(when this card (?:attacks and )?kos [^,:]*)/i.exec(kosMasked.text.trim())?.[1];
    const koedSaid = skill.kind === "auto" && coordinated === undefined && kosHead ? kosMasked.unmask(koedDescription(kosHead)) : "";
    if (koedSaid) {
      const koedFilter = filterFor(koedSaid, null);
      if (!koedFilter || unreadFilterWords(koedSaid, koedFilter).length) return { ops: [], unsupported: [trigger, ...clauses] };
      const has: Cond = { kind: "count", sel: { special: "subject", filter: koedFilter }, atLeast: 1 };
      triggerCond = triggerCond ? { kind: "all", conds: [triggerCond, has] } : has;
    }
    // "When your ≪Ginyu Force≫ card is played **by this card's skill**, it
    // gets +5000 power" (BT29-083, #1163): "this card's skill" is the means,
    // and the card the trigger is about is the one played — "it" is that
    // card, not this one. Only the means phrase is set aside; any other
    // "this card" in the trigger still makes it the antecedent.
    // Audit selectors 3: the card a combo card combos **with** — "When this card is used in a combo from your hand with a
    // ≪Heroine≫ card in your Leader Area or Battle Area, **that card** gets +5000 power and [double strike]" (EB1-45), "When
    // you combo this card with a skill-less Battle Card with 10000 power, you may choose **that card** and switch it to
    // Active Mode" (DB2-003), "…used in a combo with a red <Yamcha> card, **it** gets +5000 combo power" (BT10-017) — is
    // your card in the battle (5-7-1). What the words say of it is a condition, and "that card" names it ("it" stays this
    // card, the one the combo power is on). Dropped, the description fired for any battle and "that card" was this one.
    let partnerTarget: { sel: Selector } | null = null;
    const partnerSaid = skill.kind === "auto" ? /^when (?:this card is used in a combo|you use this card in a combo|you combo this card)(?: from your hand)? with (?:an?|1) (.+?)(?: in your (?:leader area or battle area|battle area or leader area|battle area|leader area))?[.,]?$/i.exec(trigger.trim()) : null;
    if (partnerSaid) {
      const partner = filterFor(partnerSaid[1], null);
      if (!partner || unreadFilterWords(partnerSaid[1], partner).length) return { ops: [], unsupported: [trigger, ...clauses] };
      const yours: Selector = { side: "you", area: "leader", areas: ["leader", "battle"], filter: partner, battleRole: "any" };
      const has: Cond = { kind: "inBattle", sel: { side: "you", filter: partner } };
      triggerCond = triggerCond ? { kind: "all", conds: [triggerCond, has] } : has;
      if (clauses.some((cl) => /\bthat card\b/i.test(cl))) partnerTarget = { sel: yours };
    }
    const arrivalPlay = yourCardPlayedUsingArrival(trigger);
    if (skill.kind === "auto" && triggersOf(skill).some((t) => t === "youPlayed" || t === "opponentPlayed")) c.playedSubject = true;
    if (/\bthis card\b/i.test(trigger.replace(BY_THIS_CARDS_SKILL, ""))) c.lastTarget = partnerTarget ?? { sel: { special: "self" } };
    // "When your green ≪Turtle School≫ card with an energy cost of 5 or less
    // attacks a Battle Card, **it** gets +10000 power for the turn" — a
    // trigger about some *other* card, which the engine already binds as the
    // trigger's subject. Without this, "it" had nothing to point at.
    //
    // "When you activate a Red/Blue multicolor Extra" (BT20-009) names no
    // "your" and is still about another card, the Extra (12-1-3,
    // `extraActivated`): its description is read as a condition below, but
    // "that card" is not pointed at it — BT31-086b's "activate the [Activate]
    // skill of that card from its owner's Drop" would read as a play.
    //
    // The same for "when you **play** a red ≪Android≫ card" (`youPlayed`) and
    // "when you **combo with** a skill-less card" (`youCombo`): the card
    // played or used is the subject and its description a condition on it,
    // which a trigger with no "your" in it never got — so those skills fired
    // for any card at all. "It" is still pointed at the subject only where
    // the trigger says "your", as before.
    // BT15-091: "when a player places a [Field] Extra Card in a Battle Area",
    // "when a player's [Field] Extra Card leaves a Battle Area" — either
    // player's card, its description the condition on it.
    else if (/\byour\b|\byour opponent'?s\b/i.test(trigger) || /^when you (?:activate|play|combo with|use) (?:an?|1|up to \d+|\d+) /i.test(trigger.trim()) || /^when a player(?:'?s)? /i.test(trigger.trim()) || !!watchedMomentOf(trigger) || !!arrivalPlay) {
      // "When you play a red ≪Alien≫, **it** gains +5000 power" (BT1-006, phrasing batch 1): the card played is the
      // one thing the sentence has named, so "it" is that card too.
      // "When you combo with a skill-less card, **that card** gets +5000 combo power" (BT6-105b, phrasing batch 2): the
      // card used in the combo, likewise.
      // "When you use a red skill-less Battle Card … in a combo, **it** gets +6000 combo power" (BT14-001b, phrasing batch 3).
      if (/\byour\b/i.test(trigger) || !!watchedMomentOf(trigger) || /^when you (?:play|combo with|use) (?:an?|1) /i.test(trigger.trim())) c.lastTarget = { sel: { special: "subject" } };
      // "When your **mono-red ≪Saiyan≫** Leader Card is attacked" (SD15-02,
      // #1168, 8-1-3): the moment is `yourLeaderAttacked`, whose subject is
      // the Leader attacked, and the description is a condition on that
      // Leader. Dropped, the skill fired for any Leader. A description that
      // cannot be read whole leaves the skill unread rather than firing for
      // every Leader (`subjectFilterOf`'s ground rule 6 is not this case).
      const leader = attackedLeaderDescription(trigger);
      if (leader === null) return { ops: [], unsupported: [trigger, ...clauses] };
      if (leader) {
        triggerCond = { kind: "count", sel: { special: "subject", filter: leader }, atLeast: 1 };
      } else {
        // The dropped clause also said *which* card, and dropping it dropped
        // that: "when your opponent plays a **Battle Card**" fired when they
        // played an Extra, and "when your **≪Saiyan≫** card attacks" fired for
        // anything of theirs that attacked. The engine binds the card as the
        // trigger's subject, so what the clause said about it becomes a
        // condition on that subject and the skill stays where it was printed.
        // Audit triggers 1: a coordinated head's description is read off its own moment (`coordinatedSubject`).
        const subject = momentRead || coordinated !== undefined ? undefined : subjectFilterOf(trigger);
        if (subject) triggerCond = { kind: "count", sel: { special: "subject", filter: subject }, atLeast: 1 };
      }
      // #930: "When your <X> card is played by a [Union] skill" (BT22-033,
      // BT25-036 back, P-682), "when you play a Battle Card using a
      // [Union-Fusion] skill" (BT12-122): the moment is `youPlayed`, the
      // description stays the condition on the played card, and how it was
      // played is a second one beside it — a successful entry by a
      // [Union-(type)] skill's own play (owner's ruling, 25 Oct 2026), bare
      // [Union] any of them, a named variant only that one. `resolvePlay`
      // withdraws the Auto from any other play, or a card the description
      // refuses (`vm/triggers.ts` `unionPlayedGate`).
      // "When you play a Battle Card **on your turn**" (BT13-026, phrasing batch 1): a card can be played on the
      // opponent's turn too (a [Counter: Play], a skill's play), and the words say this one only counts on yours.
      if (/^when you play [^,]+ on your turn$/i.test(trigger.trim())) triggerCond = triggerCond ? { kind: "all", conds: [triggerCond, { kind: "isTurnPlayer" }] } : { kind: "isTurnPlayer" };
      if (arrivalPlay) {
        const filter = filterFor(arrivalPlay, null);
        if (!filter || unreadFilterWords(arrivalPlay.replace(/\b(red|blue|green|yellow|black|white)\/(?=red|blue|green|yellow|black|white)/gi, "$1 "), filter).length) return { ops: [], unsupported: [trigger, ...clauses] };
        triggerCond = { kind: "all", conds: [{ kind: "count", sel: { special: "subject", filter }, atLeast: 1 }, { kind: "playedUsing", sel: { special: "subject" }, what: "Arrival" }] };
        c.lastTarget = { sel: { special: "subject" } };
      }
      const byUnion = yourCardPlayedByUnion(trigger);
      if (byUnion) {
        const how: Cond = { kind: "playedUsing", sel: { special: "subject" }, what: byUnion.what };
        triggerCond = triggerCond ? { kind: "all", conds: [triggerCond, how] } : how;
      }
    }
    // R472: "other than this card" qualifies the arrived subject, not the
    // watcher. The moved trigger supplies controller and exact Dark procedure.
    if (skill.kind === "auto" && YOUR_OTHER_BATTLE_DARK_PLAYED.test(trigger.trim())) {
      const otherBattle: Cond = { kind: "count", sel: { special: "subject", notSelf: "card", filter: { ...emptyFilter(), type: "BATTLE" } }, atLeast: 1 };
      triggerCond = triggerCond ? { kind: "all", conds: [triggerCond, otherBattle] } : otherBattle;
      c.lastTarget = { sel: { special: "subject" } };
    }
    // Audit conditions 3: "When you combo with 1 of your cards **during your turn**" (BT6-080 both sides): a watched combo
    // (`youCombo`) only on your own turn — a defender combos too. ("When you combo with this card during your turn" is the
    // combo record's own `turn`.)
    if (skill.kind === "auto" && /^when you combo with (?!this card\b)[^,]+ during your (opponent'?s )?turn$/i.test(trigger.trim())) {
      const turn: Cond = /opponent/i.test(trigger) ? { kind: "isTurnPlayer", who: "opponent" } : { kind: "isTurnPlayer" };
      triggerCond = triggerCond ? { kind: "all", conds: [triggerCond, turn] } : turn;
    }
    if (coordinated?.cond) triggerCond = triggerCond ? { kind: "all", conds: [triggerCond, coordinated.cond] } : coordinated.cond;
    // "When this card attacks and KOs an opponent's Battle Card", "when this
    // card is revealed from the top of your deck and placed in your Drop Area"
    // — the trigger splits on its "and", and the second half is still the
    // trigger rather than the first thing the skill does.
    while (clauses.length > 1 && /^(?:kos|ko's|is ko'?d|deals damage|(?:is )?placed in|(?:is )?revealed|(?:is )?sent to|(?:is )?returned to|(?:is )?switched to|or (?:when |if )you combo with this card)\b/i.test(clauses[0].trim()))
      clauses.shift();
    // "When you play this card and your Leader Card is a ≪Universe 6≫ card,
    // …" — a condition riding on the trigger, split off the same way (9-1-3).
    // A clause with its own "if" is a condition in the ordinary chain; only a
    // bare one rode in on the trigger.
    // An effect is never one: "When this card is used in a combo, **choose up
    // to 1 of your opponent's Battle Cards in Rest Mode that isn't attacking**
    // and KO it" (BT19-114) was read as a condition, and the KO fell on this card.
    if (clauses.length > 1 && !/^(?:if|when|while|during|choose|you may)\b/i.test(clauses[0].trim())) {
      const riding = parseConditionClause(clauses[0], true);
      if (riding) {
        triggerCond = triggerCond ? { kind: "all", conds: [triggerCond, riding.cond] } : riding.cond;
        clauses.shift();
      }
    }
  }

  if (turnCond && !compileComboQualification(skill)) triggerCond = triggerCond ? { kind: "all", conds: [turnCond, triggerCond] } : turnCond;
  if (leadCond) triggerCond = triggerCond ? { kind: "all", conds: [leadCond, triggerCond] } : leadCond;

  const unsupportedBeforeHead = unsupported.length;
  // The head's surgery above only ever removes clauses, so what is left is a
  // subsequence of what was cut; carry each survivor's "joined to the one
  // before it" along by walking the two in step.
  const joins: boolean[] = [];
  for (let k = 0, at = 0; k < clauses.length; k++) {
    while (at < split.clauses.length && split.clauses[at] !== clauses[k]) at++;
    joins.push(at < split.clauses.length ? split.joined[at++] : false);
  }
  let ops = compileClauseList(clauses, c, unsupported, joins);
  // R504: only the main unpriced Auto effect, never a price or recursive clause context.
  if (skill.kind === "auto" && !skill.cost.trim() && bindBlindLifeHandChoice(clauses, ops) === false) {
    unsupported.push(clauses.slice(0, 2).join(", "));
  }

  // BT29-029 / 20-16: "If you do" requires the optional play itself,
  // not merely accepting its offer when a prohibition/replacement stops it.
  if (returnedFromBattle && ops[0]?.op === "may" && ops[0].ops.some((op) => op.op === "play")) {
    ops = ops.map((op) => op.op === "if" && op.cond.kind === "did" && op.cond.what === "may"
      ? { ...op, cond: { kind: "did", what: "play" } } : op);
    const offer = ops[0];
    if (offer.op === "may") offer.ops = offer.ops.map((op) => op.op === "play" ? { ...op, counterWindow: true } : op);
  }
  // Whether the head itself read clean, before the modal's own options add
  // any refusals of their own — an option's unread clause must not stop the
  // head's condition from being restored below.
  const headReadClean = unsupported.length === unsupportedBeforeHead;
  if (modal) {
    // Each option is compiled on its own, carrying what the head established
    // ("If your Leader is a <Baby> card, it gets +10000 power, then choose
    // one— ・…" — "it" still means the leader inside the options).
    const modes = modal.options.map((option) => {
      const cut = splitClausesJoined(option);
      return { label: option, ops: compileClauseList(cut.clauses, { ...c }, unsupported, cut.joined) };
    });
    // An option the compiler could not read is an empty branch, and the menu
    // then offers a mode that silently does nothing — the player picks it and
    // the game moves on (P-396). A mode is only a choice if every option on
    // the menu is one, so a single empty branch fails the whole skill and the
    // referee is asked the question the card actually printed.
    if (modes.some((mode) => !mode.ops.length)) {
      // Its own clauses are already in `unsupported` — unless the option was
      // read away to nothing without refusing anything, and then the option
      // itself is what could not be said, or the skill would come back empty
      // and be counted as fully compiled.
      const silent = modal.options.filter((_, i) => !modes[i].ops.length);
      return { ops: [], unsupported: unsupported.length ? unsupported : silent };
    }
    if (modes.some((mode) => mode.ops.length)) {
      // What "if you do" reads (20-16): the offer taken, or the choice made, just before it.
      const gate: Cond | null = !modalIfDone ? null : c.lastOp === "may" ? { kind: "did", what: "may" } : c.last ? bindCompletedChoice(ops, c.last) ?? { kind: "chose", var: c.last } : null;
      if (modalIfDone && !gate) return { ops: [], unsupported: [...unsupported, "If you do"] };
      // Audit lane C: a head that ends on a condition hangs the menu on it — "…it gets +15000 power for the duration of
      // the battle, **and if it is your turn, also choose one—**" (EX06-21). Nested in a condition the head opened, the
      // condition is a branch still waiting for its effect (an `if` with nothing in it at the end of the head); on its
      // own, a group the clause list drops for being empty, and the head's last clause says it again.
      const dangling = (list: Op[]): Op[] | null => {
        const last = list[list.length - 1];
        if (last?.op !== "if" || last.else) return null;
        return last.then.length ? dangling(last.then) : last.then;
      };
      const lastClause = clauses[clauses.length - 1]?.trim() ?? "";
      const host = gate ? null : dangling(ops);
      const trailing = gate || host || !/^if\b/i.test(lastClause) ? null : parseConditionClause(lastClause, true);
      const menu: Op = { op: "chooseMode", modes };
      if (host) host.push(menu);
      else ops.push(gate ? { op: "if", cond: gate, then: [menu] } : trailing ? { op: "if", cond: trailing.cond, then: [menu] } : menu);
    }
    // "If your Leader Card is a green <Cheelai: Br> card or yellow <Broly:
    // Br> card, choose one— ・…" (EX19-13, TB3-066): the head is nothing but
    // the condition that gates the whole menu, with no effect of its own for
    // it to attach to before the bullets — and `compileClauseList`'s own
    // flush drops a condition group whose body came back empty
    // (`if (!g.ops.length) continue`), exactly the case a bare head leaves
    // behind. `parseConditionClause` already reads the head fine, which is
    // how it was ever split off as the modal's head at all; the read is
    // simply thrown away one step later. Read again here and used to wrap
    // the menu — but only when nothing in the head actually failed, so a
    // head that could not be read in full still refuses instead of
    // silently gaining a condition weaker than what it printed.
    if (ops.length && !ops.some((o) => o.op === "if") && clauses.length && headReadClean) {
      const read = allConditions(clauses.join(" and "));
      if (read) ops = [{ op: "if", cond: read.length > 1 ? { kind: "all", conds: read.map((r) => r.cond) } : read[0].cond, then: ops }];
    }
  }
  // "[Auto] If your Leader Card is red: When you play this card, draw 1 card"
  // — a condition written before the colon is part of the skill's validity
  // (9-1-3), and it lands in `cost`. It wraps the whole program; one the
  // compiler cannot read fails the skill rather than running it unconditionally.
  // A "same character name as the card you placed under this card" that no
  // choice clause bound to the price (#930) measures nothing: unread.
  if (JSON.stringify(ops).includes(`"sameCharacterAs":"${PLACED_UNDER_PLACEHOLDER}"`)) {
    return { ops: [], unsupported: [...unsupported, "with the same character name as the card you placed under this card"] };
  }
  if (JSON.stringify(ops).includes(`"sameNameAs":"${SAME_NAME_AS_CHOSEN_PLACEHOLDER}"`)) {
    return { ops: [], unsupported: [...unsupported, "with the same name as the chosen card"] };
  }
  // Mechanism batch 2 (BT10-054): "the card you placed in your energy with this skill" is what the skill's one move
  // to the Energy Area took, outside any delayed part. None, or more than one, and there is nothing to name: unread.
  if (JSON.stringify(ops).includes(`"fromVar":"${PLACED_IN_ENERGY}"`)) {
    const moves = ops.filter((o): o is Extract<Op, { op: "moveTo" }> => o.op === "moveTo" && o.to === "energy");
    if (moves.length !== 1) return { ops: [], unsupported: [...unsupported, "the card you placed in your energy with this skill"] };
    moves[0].as = PLACED_IN_ENERGY;
    // "If it is in your energy, … . If it isn't in your energy, …" at the same later moment is one question with two
    // answers, asked once: two delays would ask the second after the first had already moved the card.
    for (let k = 0; k + 1 < ops.length; k++) {
      const a = ops[k];
      const b = ops[k + 1];
      if (a.op !== "delay" || b.op !== "delay" || a.at !== b.at || a.scope !== b.scope || a.ops.length !== 1 || b.ops.length !== 1) continue;
      const ia = a.ops[0];
      const ib = b.ops[0];
      if (ia.op !== "if" || ib.op !== "if" || ia.else || ib.else || ia.cond.kind !== "count" || ib.cond.kind !== "count") continue;
      const same = JSON.stringify(ia.cond.sel) === JSON.stringify(ib.cond.sel) && JSON.stringify(ia.cond.sel).includes(PLACED_IN_ENERGY);
      if (!same || ia.cond.atLeast !== 1 || ib.cond.atMost !== 0) continue;
      ops.splice(k, 2, { ...a, ops: [{ ...ia, else: ib.then }] });
    }
  }
  const priced = costText(skill.cost);
  const priceCond = ops.length && !engineChecks ? priceCondition(skill) : null;
  // This one shared Cell/Jr. trigger is checked against the played card when
  // the moment is pended. Rechecking its cost here, after another Auto may
  // alter that card, would undo the captured trigger truth. Keep the price
  // condition and any conditional effect; remove only this trigger's wrapper.
  const capturedCellTrigger = whiteCellPlayedSubjectFilter(skill) && triggerCond?.kind === "count"
    && triggerCond.sel.special === "subject";
  const effectTriggerCond = capturedCellTrigger ? null : triggerCond;
  // The trigger's own condition goes inside it. "If your Leader is red: When
  // your **blue <Son Goku> card** is played, …" is both, and returning the
  // price's condition alone dropped what the trigger said about its subject —
  // so the skill fired for any card that was played, KO'd or activated
  // (BT29-029's blue Extra, and some forty skills before it). The same holds
  // for a condition riding on the trigger and for the host of "placed under".
  // #961: a printed price that read as neither a condition nor an action is
  // not free — the skill is unread, not offered for its orbs alone.
  if (ops.length && !engineChecks && priceIsUnread(skill)) return { ops: [], unsupported: [skill.cost, ...unsupported] };
  if (priceCond) return { ops: [{ op: "if", cond: priceCond.cond, then: effectTriggerCond ? [{ op: "if", cond: effectTriggerCond, then: ops }] : ops }], unsupported };
  // A condition the compiler cannot read fails the skill. An *action* price is
  // not this: the engine charges that separately, so it leaves the program be.
  // "If you discard 1 card from your hand:" (BT22-054b) is an action price
  // whose only condition word is the "if" (`readPrice`): it read as an action,
  // so there is no condition left unread.
  const ifThenAction = IF_YOU_ACTION_PRICE.test(priced) &&!priceCond && !!compileCostProgram(skill);
  if (ops.length && !engineChecks && !ifThenAction && /^(?:if|when|while|during)\b/i.test(priced)) {
    return { ops: [], unsupported: [skill.cost, ...unsupported] };
  }
  if (ops.length && effectTriggerCond) return { ops: [{ op: "if", cond: effectTriggerCond, then: ops }], unsupported };
  return { ops, unsupported, ...(ops.length === 1 && c.resolutionCondition === ops[0] ? { keepResolutionCondition: true as const } : {}) };
}

/**
 * What "when your <description> Leader Card is attacked" (`yourLeaderAttacked`,
 * 8-1-3; SD15-02, #1168) says about the Leader attacked: `undefined` when the
 * trigger is not that wording or describes nothing ("When your Leader Card is
 * attacked"), the filter when the description reads whole (colour, mono-colour,
 * ≪traits≫, <names>, {card names}), and `null` when it does not — the skill is
 * then left unread, never fired for any Leader.
 */
function attackedLeaderDescription(trigger: string): CardFilter | null | undefined {
  const m = /^when your (.*?)\s*leader(?: card)? is attacked\b/i.exec(trigger.trim());
  if (!m) return undefined;
  const said = m[1].trim();
  if (!said) return undefined;
  // "Your opponent's Leader" is the other side's attack, not this moment.
  if (/\bopponent/i.test(said)) return null;
  const filter = filterFor(`${said} leader card`, null);
  if (!filter || unreadFilterWords(said, filter).length) return null;
  return filter;
}

/**
 * Audit triggers 1: "When this card [attacks and] KOs an opponent's Battle Card **with an energy cost of 2 or more**"
 * (P-384, BT13-017): the KO'd card's description when it says more than "Battle Card" — a condition on the card the
 * `kos` moment hands on (`vm/battle.ts`'s `koCard`) — or "" for none ("…by attacking it" is how, not which).
 */
function koedDescription(trigger: string): string {
  const m = /^when this card (?:attacks and )?kos (?:an?|one of your opponent'?s|your opponent'?s|an opponent'?s) (battle cards?|cards?)( .+)?$/i.exec(trigger.trim().replace(/[,.]$/, "").replace(/ by attacking(?: it)?$/i, ""));
  return m?.[2] ? `${m[1]}${m[2]}` : "";
}

/** This card's own moments that hand on no other card (no `source` on the moment): a description beside them is asked only of a card one hands on. */
const SUBJECTLESS = new Set<string>(["attacks", "attacked", "played", "playedFromHand", "playedFromDrop", "comboUsed", "comboed", "blockerUsed", "turnEnd", "opponentTurnEnd", "battleEnd", "mainStart", "opponentMainStart"]);

/**
 * Audit triggers 1: what a coordinated head (`momentPartSkills`) says about the card a moment hands on, read off the
 * moment that says it. `undefined` for a head that names one moment; `null` for one the record cannot put on the
 * moment it belongs to (unread); otherwise the condition, or none.
 *
 *  - each moment about the same described card ("When your opponent's Battle Card is played or attacks", BT29-004;
 *    "When your red Z-Card is played or attacks", BT31-006): the description, asked of the card either hands on;
 *  - this card's moment beside another card's ("When this card attacks or your opponent plays a Battle Card", BT4-016):
 *    the description asked only when a card is handed on, which this card's own moments here never do;
 *  - a cause one moment of this card names ("…or placed in your Drop by a <Vegeta> card's skill") would be a condition
 *    on that moment alone, which a record cannot say: unread.
 */
function coordinatedSubject(skill: Skill): { cond: Cond | null } | null | undefined {
  const parts = momentPartSkills(skill);
  if (!parts) return undefined;
  const heads = parts.map((p) => p.effect.replace(/, \.$/, ""));
  const own = (h: string) => /^(?:when this card\b|at the )/i.test(h);
  for (const h of heads) {
    const b1 = batch1Condition(h);
    if (b1 === null || b1?.cond) return null;
    // A battle-end of this card's own battle, or a KO of a described card, is a condition on that moment alone.
    const battle = battleEndPart(h.toLowerCase());
    if (battle !== undefined && battle !== "any") return null;
    if (koedDescription(h)) return null;
    // Audit triggers 2: "…played or attacks **an opponent's Battle Card**" (BT26-100): what this card attacks is a
    // condition on the attack alone.
    if (/^when this card attacks\s+\S/i.test(h)) return null;
  }
  const watched = heads.filter((h) => !own(h));
  if (!watched.length) return { cond: null };
  const said = watched.map((h) => subjectFilterOf(h)).filter((f): f is CardFilter => !!f);
  if (!said.length) return { cond: null };
  if (said.length !== watched.length || new Set(said.map((f) => JSON.stringify(f))).size > 1) return null;
  const has: Cond = { kind: "count", sel: { special: "subject", filter: said[0] }, atLeast: 1 };
  if (watched.length === heads.length) return { cond: has };
  if (parts.some((p, i) => own(heads[i]) && triggersOf(p).some((t) => !SUBJECTLESS.has(t)))) return null;
  return { cond: { kind: "any", conds: [{ kind: "not", cond: { kind: "count", sel: { special: "subject" }, atLeast: 1 } }, has] } };
}

/**
 * Moments batch 1 (`momentsBatch1`, `text/triggers.ts`): the condition a moment's own words put on the card it hands
 * on — the skill's card for a self-moment ("…by your Leader's skill"), the card changed for a watched power change
 * ("…one of your opponent's **Battle Cards**") — and the turn ("…by a skill **during your turn**", EX06-01).
 * `undefined` for a trigger that is none of these moments; `null` when the cause or the card cannot be read whole.
 */
function batch1Condition(trigger: string): { cond: Cond | null } | null | undefined {
  const masked = maskNames(trigger.trim().replace(/[,.]$/, ""));
  const lower = masked.text.toLowerCase();
  const read = momentsBatch1(lower)[0];
  if (!read) return undefined;
  const conds: Cond[] = [];
  if (read.cause) {
    // The cause in its printed case, names put back: the target grammar reads it.
    const at = lower.lastIndexOf(read.cause);
    const said = at < 0 ? read.cause : masked.unmask(masked.text.slice(at, at + read.cause.length));
    const cause = momentCauseOf(said);
    if (!cause) return null;
    // A moment named for its side ("…by one of your skills" is `…ByYou`) asks nothing more of a cause that says no more.
    // "By your {Soul Punisher, the Cleansing Light} or a blue <Gogeta> card skill" (BT22-039): either card, each read
    // on its own — one filter would ask for a card that is both.
    const parts = !cause.desc ? [cause] : splitAlternatives(cause.desc).map((desc) => ({ ...cause, desc }));
    const sels = parts.map((part) => (read.sided && !part.desc ? undefined : causeSelector(part)));
    if (sels.some((sel) => sel === null)) return null;
    const asked = sels.filter((sel): sel is Selector => !!sel).map((sel): Cond => ({ kind: "count", sel, atLeast: 1 }));
    if (asked.length) conds.push(asked.length === 1 ? asked[0] : { kind: "any", conds: asked });
  }
  // 20-1-2: "Battle Cards" are cards in a Battle Area; a Leader is no Battle Card.
  const whose = read.trigger.startsWith("opponentCardPower") ? ({ side: "opponent" } as const) : read.trigger === "yourCardPowerLowered" ? ({ side: "you" } as const) : {};
  if (read.subject === "battle") conds.push({ kind: "count", sel: { special: "subject", ...whose, area: "battle" }, atLeast: 1 });
  if (read.subject === "leader") conds.push({ kind: "count", sel: { special: "subject", ...whose, area: "leader" }, atLeast: 1 });
  if (read.trigger !== "activeBySkillDuringYourTurn" && /\bduring your turn$/i.test(masked.text)) conds.push({ kind: "isTurnPlayer" });
  return { cond: conds.length === 0 ? null : conds.length === 1 ? conds[0] : { kind: "all", conds } };
}

/**
 * The skill's card a cause describes, as a selector of the moment's subject: whose it is ("your", "an opponent's",
 * "in any of your areas"), where it is ("in your Battle Area"; a Battle Card's skill with no area named is one in a
 * Battle Area, 20-1-2 and 20-7-2; a <Character> or ≪trait≫ card's anywhere, 20-7-3), and what it is. `undefined` when
 * the cause says nothing about the card; `null` when the description cannot be read whole.
 */
/**
 * The alternatives of a cause, at a top-level " or " between two descriptions of different kinds ("{Serpent Road}"
 * beside "a white ≪King Kai's Planet≫ card"): each alternative carries the area said at the end ("…in your Battle
 * Area") and ends in "card". Names side by side with one colour each ("yellow <Majin Buu> or yellow <Evil Wizard
 * Babidi> card") split the same way, which asks the same thing.
 */
function splitAlternatives(desc: string): string[] {
  const masked = maskNames(desc);
  if (!/ or /i.test(masked.text)) return [desc];
  const where = / in your battle area$/i.exec(masked.text)?.[0] ?? "";
  const body = where ? masked.text.slice(0, -where.length) : masked.text;
  return body.split(/ or /i).map((part) => {
    const one = part.trim().replace(/^(?:an?|your) /i, "");
    return masked.unmask(`${/\bcard$|\}$/i.test(one) ? one : `${one} card`}${where}`);
  });
}

function causeSelector(cause: MomentCause): Selector | null | undefined {
  const side = cause.side === "any" ? undefined : cause.side;
  if (!cause.desc) return side ? { special: "subject", side } : undefined;
  let desc = cause.desc.trim();
  let area: Selector["area"];
  if (/ in your battle area$/i.test(desc)) {
    area = "battle";
    desc = desc.replace(/ in your battle area$/i, "");
  }
  if (/^leader(?: card)?$/i.test(desc)) return { special: "subject", area: "leader", ...(side ? { side } : {}) };
  if (!area && /\bbattle card$/i.test(desc)) area = "battle";
  const filter = filterFor(/\bcard$|\}$/i.test(desc) ? desc : `${desc} card`, null);
  if (filter === null || (filter && unreadFilterWords(desc, filter).length)) return null;
  return { special: "subject", ...(side ? { side } : {}), ...(area ? { area } : {}), ...(filter ? { filter } : {}) };
}

const cardCache = new WeakMap<CardDef, { front: CardScripts; back: CardScripts }>();

/** `compileCard`, memoised per definition — the same card is compiled once. Off the game path: the engine reads `card_rules`; this serves the drafter, the coverage CLIs and the tests. */
export function compileCardCached(card: CardDef, side: "front" | "back" = "front"): CardScripts {
  let entry = cardCache.get(card);
  if (!entry) {
    entry = { front: compileCard(card, "front"), back: compileCard(card, "back") };
    cardCache.set(card, entry);
  }
  return side === "back" ? entry.back : entry.front;
}

export function compileCard(card: CardDef, side: "front" | "back" = "front"): CardScripts {
  const bySkill: Record<number, Script> = {};
  const unsupported: string[] = [];
  for (const printed of skillsOf(card, side)) {
    // 22-30-2: an [Aegis] line's text after its tag is its price (#595).
    // #1166: a granted line in quotation marks is compiled (and priced) as the skill it quotes.
    const sk = aegisPriceLine(printed.granted ? printed.granted.skill : printed);
    const script = compileSkill(printed.granted ? printed : sk);
    // The price rides with the program. This is the only place it is read for
    // a context built from card text — `rulesFor` reads the row instead — and
    // it is what keeps `npm test` and the probe playing prices at all now that
    // the engine no longer compiles one mid-game.
    const price = compileSkillPrice(sk);
    if (isAbsorbSkill(sk) && !price.absorb) script.unsupported.push(ABSORB_REBUILD);
    bySkill[sk.index] = { ...script, price };
    unsupported.push(...script.unsupported);
  }
  return { bySkill, complete: unsupported.length === 0, unsupported };
}
