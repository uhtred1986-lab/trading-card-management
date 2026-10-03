import { keywordOf, skillsOf, trailingTrigger, withoutTrailingTrigger } from "../text/cards";
import type { CardScripts, Cond, Op, Script, SkillPrice } from "../vm/script";
import type { CardDef, KeywordSkill, Skill } from "../types";
import { splitClauses, stripNotes } from "./clauses";
import { allConditions, parseConditionClause } from "./conditions";
import { compileClauseList, holdForGame, splitModal, taxWordings } from "./effects";
import { compileCostProgram, costText, counterAltCost, priceCondition, priceX } from "./prices";
import type { Ctx } from "./shared";
import { SWITCHED_BY_THIS_SKILL, countWord } from "./shared";
import { filterFor, parseTarget, subjectFilterOf } from "./targets";

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
const IF_DROPPED_FROM_HAND = /^if this card is placed in (?:a|your|its owner'?s) drop area from (?:your|its owner'?s|the) hand by (?:a|any) skill\b/i;

const KEYWORD_HANDLES_THE_LINE =new Set<KeywordSkill["name"]>(["Evolve", "Union", "Over Realm", "Swap", "Overlord", "Z-Awaken", "Z-Stack", "Field", "Attack", "Revenge", "Offering"]);


export function compileSkill(skill: Skill): Script {
  const sc = narrowHiddenChoices(compileSkillText(skill));
  // A [Permanent] never resolves, so "for the turn" — the duration every
  // clause gets when it names none — was a lie on every op it emitted. The
  // static layer ignores `until`, so nothing played wrongly; but the stored
  // program, the inspector and the referee's worked examples all said it.
  // The skill holds while its card is where it is valid (9-5-1), and `game`
  // is the nearest thing the language has to that.
  return skill.kind === "permanent" ? { ...sc, ops: holdForGame(sc.ops) } : sc;
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

function compileSkillText(skill: Skill): Script {
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
  // A trigger printed at the end of the sentence rather than at its head
  // (BT3-103) has already happened by the time the effect resolves, exactly
  // like the leading form the clause loop drops below. Left in the text it
  // compiles to a delay instead, and the skill then waits for the *next* end
  // of a battle — one battle too late, every time.
  const trailing = trailingTrigger(skill);
  const text = stripNotes(trailing ? withoutTrailingTrigger(skill.effect, trailing) : skill.effect);
  if (!text) return { ops: [], unsupported: [] };
  const unsupported: string[] = [];
  const c: Ctx = {
    permanent: skill.kind === "permanent",
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
    xBound: priceX(skill) !== null,
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
  for (const o of priceOps) {
    if (o.op !== "choose") continue;
    c.last = o.as;
    c.lastTarget = { var: o.as };
    c.priceChoice = o.as;
  }
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
  const clauses = splitClauses(modal ? modal.head : spoken);
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
  // "If this card is placed in your Drop Area from your hand by a skill"
  // (SD13-05, behind a condition before the colon) is the trigger said with
  // "if" — `droppedFromHand`, the same moment as "when" — and not a condition.
  if (skill.kind === "auto" && (clauses.length > 1 || modal) && (/^(?:when|at the (?:end|beginning|start))\b/i.test(clauses[0] ?? "") || IF_DROPPED_FROM_HAND.test(clauses[0] ?? ""))) {
    const trigger = clauses.shift()!;
    // The dropped trigger is still what the sentence is about: "When this card
    // is sent to the Warp …, add **it** to your hand" means this card. Without
    // this, the first "it" of an [Auto] has nothing to point at and the whole
    // skill goes to the referee.
    // "When this card is placed under a <Vegito> card with a [Union] skill"
    // (BT29-140, 23-2): the host is the card on top of this one, and what the
    // trigger says about it is a condition on that card.
    const under = /^when this card is placed under (?:an? |your )?(.+?)[,.]?$/i.exec(trigger.trim());
    if (under) {
      const host = filterFor(under[1], null);
      if (host === null) return { ops: [], unsupported: [trigger, ...clauses] };
      if (host) triggerCond = { kind: "count", sel: { special: "onTop", filter: host }, atLeast: 1 };
    }
    // "When this card attacks during the turn you played it with [Over Realm]"
    // (P-048, 22-15): the moment is the attack, and the rest of the sentence is
    // a condition on it — the card's memory of how it was played this turn.
    // Dropped with the trigger, it fired on every attack of every turn.
    if (/\bduring the turn (?:you played (?:it|this card)|(?:it|this card) was played) (?:with|using) \[(?:dark )?over realm[^\]]*\]/i.test(trigger)) {
      triggerCond = { kind: "playedUsing", sel: { special: "self" }, what: "Over Realm" };
    }
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
    if (/\bthis card\b/i.test(trigger)) c.lastTarget = { sel: { special: "self" } };
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
    else if (/\byour\b|\byour opponent'?s\b/i.test(trigger) || /^when you (?:activate|play|combo with) (?:an?|1|up to \d+|\d+) /i.test(trigger.trim())) {
      if (/\byour\b/i.test(trigger)) c.lastTarget = { sel: { special: "subject" } };
      // The dropped clause also said *which* card, and dropping it dropped
      // that: "when your opponent plays a **Battle Card**" fired when they
      // played an Extra, and "when your **≪Saiyan≫** card attacks" fired for
      // anything of theirs that attacked. The engine binds the card as the
      // trigger's subject, so what the clause said about it becomes a
      // condition on that subject and the skill stays where it was printed.
      const subject = subjectFilterOf(trigger);
      if (subject) triggerCond = { kind: "count", sel: { special: "subject", filter: subject }, atLeast: 1 };
    }
    // "When this card attacks and KOs an opponent's Battle Card", "when this
    // card is revealed from the top of your deck and placed in your Drop Area"
    // — the trigger splits on its "and", and the second half is still the
    // trigger rather than the first thing the skill does.
    while (clauses.length > 1 && /^(?:kos?|ko's|is ko'?d|deals damage|(?:is )?placed in|(?:is )?revealed|(?:is )?sent to|(?:is )?returned to|(?:is )?switched to)\b/i.test(clauses[0].trim()))
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
        triggerCond = riding.cond;
        clauses.shift();
      }
    }
  }

  const unsupportedBeforeHead = unsupported.length;
  let ops = compileClauseList(clauses, c, unsupported);
  // Whether the head itself read clean, before the modal's own options add
  // any refusals of their own — an option's unread clause must not stop the
  // head's condition from being restored below.
  const headReadClean = unsupported.length === unsupportedBeforeHead;
  if (modal) {
    // Each option is compiled on its own, carrying what the head established
    // ("If your Leader is a <Baby> card, it gets +10000 power, then choose
    // one— ・…" — "it" still means the leader inside the options).
    const modes = modal.options.map((option) => ({ label: option, ops: compileClauseList(splitClauses(option), { ...c }, unsupported) }));
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
    if (modes.some((mode) => mode.ops.length)) ops.push({ op: "chooseMode", modes });
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
  const priced = costText(skill.cost);
  const priceCond = ops.length && !engineChecks ? priceCondition(skill) : null;
  // The trigger's own condition goes inside it. "If your Leader is red: When
  // your **blue <Son Goku> card** is played, …" is both, and returning the
  // price's condition alone dropped what the trigger said about its subject —
  // so the skill fired for any card that was played, KO'd or activated
  // (BT29-029's blue Extra, and some forty skills before it). The same holds
  // for a condition riding on the trigger and for the host of "placed under".
  if (priceCond) return { ops: [{ op: "if", cond: priceCond.cond, then: triggerCond ? [{ op: "if", cond: triggerCond, then: ops }] : ops }], unsupported };
  // A condition the compiler cannot read fails the skill. An *action* price is
  // not this: the engine charges that separately, so it leaves the program be.
  if (ops.length && !engineChecks && /^(?:if|when|while|during)\b/i.test(priced)) {
    return { ops: [], unsupported: [skill.cost, ...unsupported] };
  }
  if (ops.length && triggerCond) return { ops: [{ op: "if", cond: triggerCond, then: ops }], unsupported };
  return { ops, unsupported };
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
  for (const sk of skillsOf(card, side)) {
    const script = compileSkill(sk);
    // The price rides with the program. This is the only place it is read for
    // a context built from card text — `rulesFor` reads the row instead — and
    // it is what keeps `npm test` and the probe playing prices at all now that
    // the engine no longer compiles one mid-game.
    bySkill[sk.index] = { ...script, price: priceFromText(sk) };
    unsupported.push(...script.unsupported);
  }
  return { bySkill, complete: unsupported.length === 0, unsupported };
}

/**
 * The two halves of a price, read together (4-3-3). Module-local on purpose:
 * outside the compiler a price comes off the record, never off the text.
 */
function priceFromText(skill: Skill): SkillPrice {
  const x = priceX(skill);
  return { condition: priceCondition(skill)?.cond ?? null, ops: compileCostProgram(skill)?.ops ?? null, ...(x ? { x } : {}) };
}
