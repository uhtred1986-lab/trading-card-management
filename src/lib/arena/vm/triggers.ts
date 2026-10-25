import { recordedSkillIdentity } from "./skill-identity";
import { noSparking, withValidity, sparkingIsValid, validityProblem } from "./validity";
import { unlimitedUsage, withUsage, requireUsage } from "./usage";
import { needsPaymentRecord } from "./skill-payment";
/**
 * `pendTriggers` as data: which cards answer to a moment, and with which skills.
 *
 * The legacy engine asks the question as TypeScript. A moment is one of 53
 * names in a union, the names are fired from forty hand-placed calls
 * (`pendTriggers(ctx, s, "played", card)`), and *who* hears each one is written
 * beside the call — `for (const id of cardsInPlay(s, other(p)))` for the
 * opponent's watchers, a bare card for the card's own. It is correct, and it is
 * forty separate places where it could stop being correct, none of which can be
 * read against the manual.
 *
 * Here the same question is one function over the `DEFINE TRIGGER` declarations
 * (`rulesets/dbs/triggers.rules`, #134). The engine fires a **moment**
 * (`./events.ts`) — the happening, in the definition's own words — and every
 * declaration whose `ON` pattern matches names a trigger, says who is asked
 * (`watcher:`), narrows it (`WHERE`), and says what the moment's card is called
 * (`BIND`). The name that comes out is the name a record's WHEN says, which is
 * why the record means the same thing on both engines.
 *
 * **Three rules of 9-6, and where each comes from.**
 *
 *   *Who is asked* is the declaration's `watcher:`, and nothing here. With one,
 *   the side's cards in play answer and the moment's card is their `subject`;
 *   without one, only the card the moment happened to answers, about itself. A
 *   moment with no card at all (a phase beginning) is the board's, so every card
 *   in play answers and `WHERE` is what makes "your Charge Phase" one side's.
 *
 *   *9-1-3-1 — a card's skills are valid in its own area* is the in-play zones,
 *   which `inPlayZones` derives from `inPlay:`. The exception is derived too,
 *   and this is the one piece of reasoning worth reading twice: the legacy
 *   engine carries a hand-written list of eleven triggers that fire while the
 *   card is somewhere else (`elsewhere` in `engine/triggers.ts`). Every one of
 *   them is a declaration whose pattern **names a zone** — `moved(from: combo)`,
 *   `moved(to: zEnergy)`, `faceUpTurned(in: life)` — because a moment that says
 *   where the card is or was is a moment that has already accounted for where
 *   its skills are valid. So the list is not copied: a self-moment whose pattern
 *   names a place asks the card wherever it is, and one that names none asks it
 *   only in play.
 *
 *   *9-6-6 — the turn player's pending skills resolve first* is enforced at
 *   the checkpoint; a side with several may choose their order (#549), while
 *   `nextPending` remains the singleton fallback.
 *
 * **What answers is an [Auto] — or a keyword that says so.** A keyword
 * skill's own moments (§22) are not read off the record on either engine —
 * the legacy engine has them as a `switch` in `keywordTriggers`, and here they
 * arrive from the `DEFINE KEYWORD` itself: a `HOOK` body (Stage 7, #153), or a
 * `DO` whose `at:` names the declared moments its line answers to ([Offering]
 * at `played`, `docs/arena-ruleset-spec.md` §4.4), which this file pends
 * exactly as it pends an [Auto] whose record names them. Copying the
 * `keywordTriggers` switch in here instead would be the wrong answer twice:
 * the wrong place for it, and a second copy of a list that is about to stop
 * being a list.
 *
 * Pure and client-safe: no database, no network, no `fs`.
 */
import { autoTriggerMatches, triggeredPermanent, whiteCellPlayedSubjectFilter } from "../text/triggers";
import { comboQualificationProblem, comboScriptProblem } from "./combo-qualification";
import { parseSkills } from "../text/cards";
import { copiedSkillIndex, programsOf } from "./common";
import { NO_RULES, type CardScripts, type Cond, type Op } from "./script";
import type { CardFilter } from "../text/filters";
import { PLAYERS, other, type PlayerId, type Skill, type Trigger } from "../types";
import type { EngineContext } from "../types";
import type { PatternValue } from "../lang";
import { ZONE_ARGS, type GameDefinition, type TriggerDef } from "../rulesets";
import { TRIGGERS } from "../gaps";
import { RulesetBroken } from "./errors";
import { NotYet } from "./errors";
import type { Moment } from "./events";
import type { ComboOrigin, VmState } from "./state";
import { bondIsValid } from "./bond";
import { findCard, inPlayZones } from "./zones";
import { skillNegated, skillsNegated } from "./effects";
import { usableFrom } from "./activate";
import { keywordMomentOf } from "./keyword-do";
import { attrsNow } from "./program";
import type { Attrs } from "./cards";
import { predicateOf } from "./filters";

/**
 * One [Auto] waiting to resolve (9-6-2).
 *
 * The field names are the legacy `PendingAuto`'s, deliberately: the two engines
 * queue the same thing, `subject` means the same card in both, and a stage that
 * spelt it differently would make the two lists uncomparable for no gain. The
 * one difference is `trigger`, a declared name rather than a union member —
 * which is the whole point, since a second game declares its own.
 */
export interface VmPending {
  /** Older serialized Auto entries omit the kind field. */
  kind?: "auto";
  /** The card whose skill answers. */
  card: string;
  /** Which of that face's skills, by its printed index. */
  skillIndex: number;
  /** Whose skill it is. 9-6-6 gives this side priority at the checkpoint. */
  master: PlayerId;
  /** The declared moment it answers to — what `card_rules.trigger` says. */
  trigger: string;
  /** The card the moment happened to, when that is another card (`BIND "subject"`). */
  subject?: string;
  /** §9-6-9-1 information: original Battle Area, or a pre-announced new area. */
  subjectInfo?: Attrs;
  /** Internal identity of the 8-5-6 subject occurrence, across pause/reload. */
  cleanupOccurrence?: string;
  /**
   * #930 (owner's ruling of 25 Oct 2026): the answering card's [Union] entry
   * memory (`VmCard.enteredUsing`) as the skill was triggered — BT6-036's "if
   * this card was played using [union]" is about how it was played, so a copy
   * that leaves play before its [Auto] resolves keeps the answer. Taken when
   * pended, or by `resolvePlay` for the Autos its own successful [Union] play
   * pended; never copied onto a later play's Autos. Older entries carry none.
   */
  selfEnteredUsing?: string;
  /**
   * #930: the same memory of the moment's `subject` — "when your <X> card is
   * played by a [Union] skill" (BT22-033, BT25-036 back) asks how that card
   * was played, and it still counts when it leaves play before the [Auto]
   * resolves. Stamped by `resolvePlay` on the Autos its successful [Union]
   * entry pended about it; older entries carry none.
   */
  subjectEnteredUsing?: string;
}

/** A captured declarative effect hook awaiting the same 9-6-6 checkpoint as an [Auto]. */
export interface VmPendingHook {
  kind: "hook";
  card: string;
  skillIndex: number | undefined;
  master: PlayerId;
  trigger: "afterSkill";
  subject?: string;
  /** Compiled operations and event bindings are captured when the event happens; never re-read card text. */
  frame: import("./script").ScriptFrame;
}

export type VmPendingRecord = VmPending | VmPendingHook;

/** The self-moments of a card leaving a Battle Area by a skill (3-1-5), which 9-6-9-2 holds to the negation it had there. */
const LEFT_BATTLE_BY_SKILL = new Set(["removedFromBattle", "removedByOpponent", "droppedFromBattle", "droppedByOpponent", "leftBattleToDrop"]);

/** A card asked whether it answers to a moment, and the name it would answer to. */
export interface TriggerMatch {
  trigger: string;
  card: string;
  subject?: string;
  /**
   * 23-5-2-4: the declaration asks for a card *in* Hidden Mode (`hidden:
   * true`) — "when this card … is switched to Hidden Mode" — so the card's
   * front side answers although it is face down.
   */
  front?: true;
  /** Asked only because it sits in a hand: the caller keeps it if its skill plays this card from there. */
  handWatcher?: true;
}

// ── matching a moment against the declarations ──────────────────────────────

/**
 * Every (card, moment-name) pair this happening puts a question to.
 *
 * A declaration matches when its event word is the moment's and **every**
 * argument it names is carried by the moment with that value; a list in the
 * pattern is any-of (`to: [battle, unison]`). An argument the moment does not
 * carry never matches, which is what keeps `moved(asPlay: true)` off a card
 * that was merely placed — so a moment states the fields the patterns ask
 * about rather than leaving them out to be read as either.
 */
export function matchTriggers(game: GameDefinition, state: VmState, moment: Moment, alsoHand = false): TriggerMatch[] {
  const out: TriggerMatch[] = [];
  for (const trigger of Object.values(game.triggers)) {
    if (trigger.on.event !== moment.event) continue;
    if (!fieldsMatch(trigger.on.args, moment.args)) continue;
    const asksHidden = trigger.on.args.hidden === true;
    const fromHand = new Set<string>();
    for (const card of asked(game, state, trigger, moment, alsoHand ? fromHand : undefined)) {
      // 9-6-9-3: a card that moved (or was KO'd) face down does not answer to
      // its own area-movement [Auto]s, "unless specified otherwise" — and the
      // declaration that names `hidden: true` is what specifies it.
      if (card === moment.card && moment.args.hidden === true && !asksHidden) continue;
      if (!holdsFor(game, state, trigger, card)) continue;
      // #1163: `byWatcher: true` — only the card whose own skill made the move
      // is asked ("…is played by this card's skill", BT29-083). The moment
      // names that card as `byCard`; a move no card's skill made names none.
      // #1166: a skill granted in quotation marks names the granting card as
      // "this card" of "this card's skill", so its holder is asked as well.
      if (trigger.on.args.byWatcher === true && moment.args.byCard !== card && !quotedGrantFrom(state, card, moment.args.byCard)) continue;
      // A self-moment a skill caused hands that skill's card on as the subject (#907).
      const subject = trigger.bind === "subject" && moment.card !== undefined ? { subject: moment.card }
        : trigger.bind === "self" && moment.source !== undefined ? { subject: moment.source } : {};
      out.push({ trigger: trigger.name, card, ...subject, ...(asksHidden && card === moment.card ? { front: true as const } : {}), ...(fromHand.has(card) ? { handWatcher: true as const } : {}) });
    }
  }
  return out;
}

/**
 * #1166: does `card` hold a skill granted in quotation marks by `by`'s skill
 * ("…your Leader gains the following skill for the turn- "[auto] When your
 * ≪Ginyu Force≫ card is played by this card's skill, …"")? The card whose
 * skill granted the line is the one "this card's skill" names in it (BT29-083).
 */
function quotedGrantFrom(state: VmState, card: string, by: PatternValue | undefined): boolean {
  return typeof by === "string" && state.effects.some((e) => e.kind === "copiedSkills" && e.target === card && e.copied?.quoted && e.copied.from === by);
}

/** #1166: the card whose skill granted this copied skill in quotation marks, if it is one. */
function quotedGrantSource(state: VmState, card: string, index: number): string | undefined {
  for (const e of state.effects) {
    if (e.kind !== "copiedSkills" || e.target !== card || !e.copied?.quoted) continue;
    if (e.copied.skills.some((i) => copiedSkillIndex(e.id, i) === index)) return e.copied.from;
  }
  return undefined;
}

/** Every argument the pattern names, matched against what the moment carries. `watcher` is about who is asked rather than about the event, and is read by `asked`; `byWatcher` is about which of them, and is read by `matchTriggers`. */
function fieldsMatch(pattern: Record<string, PatternValue>, carried: Record<string, PatternValue>): boolean {
  for (const [name, want] of Object.entries(pattern)) {
    if (name === "watcher" || name === "byWatcher") continue;
    if (!valueMatches(want, carried[name])) return false;
  }
  return true;
}

function valueMatches(want: PatternValue, got: PatternValue | undefined): boolean {
  if (got === undefined) return false;
  if (Array.isArray(want)) return want.some((one) => valueMatches(one, got));
  return want === got;
}

/** The cards this declaration puts the question to, before `WHERE` narrows them. */
function asked(game: GameDefinition, state: VmState, trigger: TriggerDef, moment: Moment, handOut?: Set<string>): string[] {
  const watcher = trigger.on.args.watcher;
  if (watcher !== undefined) {
    const sides = watching(state, trigger, moment, watcher);
    const askedCards = inPlay(game, state, sides);
    // 9-1-3-2 / 9-6-3-1-1: a watcher whose own skill plays this card from the
    // hand is heard there too; `pendAutos` keeps only the skills that say so.
    if (handOut) for (const p of sides) for (const id of state.sides[p].zones.hand) { askedCards.push(id); handOut.add(id); }
    // 9-1-3-2 / 3-9-4 (#1098): "When your life moves to another area, you may
    // play this card from your Drop" works from the Drop, so the Drop copies
    // hear this moment too. They are only *asked* here; `pendAutos` keeps a
    // Drop card's skill when the compiled record declares the Drop as its
    // origin (`usableFrom`), so a Drop card with no such Auto never fires.
    if (handOut && trigger.name === "lifeLeft") {
      for (const p of sides) for (const id of state.sides[p].zones.drop) { askedCards.push(id); handOut.add(id); }
    }
    // 3-9-2-1: the card turned face up is still in its Life Area, and its own
    // Auto can answer as well as the controller's in-play watchers. The
    // declaration's watcher chooses the audience; this event subject is the
    // one card that answers from outside that audience's in-play zones.
    if (trigger.name === "flippedFaceUp" && moment.event === "faceUpTurned" && moment.args.in === "life" && moment.card) {
      const at = findCard(state, moment.card);
      if (at?.zone === "life" && sides.includes(masterOf(game, state, moment.card))) askedCards.push(moment.card);
    }
    return askedCards;
  }
  // A moment with no card is about the board rather than about a card (a phase
  // beginning), so everything in play hears it; `WHERE` is what makes it one
  // side's, which is 7-1's own framing of "your Charge Phase".
  if (moment.card === undefined) return inPlay(game, state, [...PLAYERS]);
  // Its own moment. 9-1-3-1, and the exception derived from the declaration:
  // a pattern that names a place has already said where the card is.
  const at = findCard(state, moment.card);
  const valid = at !== null && game.zones[at.zone]?.inPlay === true;
  return valid || namesAPlace(trigger) ? [moment.card] : [];
}

/** `watcher: controller | opponent | both`, as sides of the table. `controller` is the side the moment is about. */
function watching(state: VmState, trigger: TriggerDef, moment: Moment, watcher: PatternValue): PlayerId[] {
  if (watcher === "both") return [...PLAYERS];
  if (watcher === "fromHolder") {
    const holder = moment.args.fromHolder;
    if (holder !== "p1" && holder !== "p2") throw new RulesetBroken(state.game, `the ${moment.event} moment has no original area holder for ${trigger.name}`);
    return [holder];
  }
  if (watcher !== "controller" && watcher !== "opponent") {
    throw new RulesetBroken(state.game, `trigger ${JSON.stringify(trigger.name)} watches ${JSON.stringify(watcher)}, and a watcher is controller, opponent, both or fromHolder`);
  }
  // A moment fired without saying whose it is cannot answer "the side the event
  // is about", and a silent empty list here would be a skill that never fires
  // with nothing to say why.
  if (!moment.controller) {
    throw new RulesetBroken(state.game, `the ${moment.event} moment says whose it is nowhere, and trigger ${JSON.stringify(trigger.name)} asks the ${watcher}`);
  }
  return [watcher === "controller" ? moment.controller : other(moment.controller)];
}

/** Does this declaration's pattern name a place (the loader's own five arguments)? The derived half of 9-1-3-1's exception. */
function namesAPlace(trigger: TriggerDef): boolean {
  for (const name of Object.keys(trigger.on.args)) if (ZONE_ARGS.has(name)) return true;
  return false;
}

/** Every card in the in-play zones of these sides (9-1-3-1), in zone declaration order. */
function inPlay(game: GameDefinition, state: VmState, sides: PlayerId[]): string[] {
  const zones = inPlayZones(game);
  const out: string[] = [];
  for (const p of sides) for (const zone of zones) out.push(...state.sides[p].zones[zone]);
  return out;
}

/**
 * `WHERE` — a condition on the answering **side**, not on the event.
 *
 * `isTurnPlayer(who: you)` is what "your Charge Phase" means on a card and
 * `who: opponent` the same sentence from the other chair (7-1). Read off the
 * card's master, exactly as the legacy engine reads it off a running script's
 * (`engine/state.ts`). Anything richer is refused rather than guessed at: a
 * condition read as `true` is a skill firing at the wrong moment, and read as
 * `false` a skill that never fires — both worse than being told.
 */
function holdsFor(game: GameDefinition, state: VmState, trigger: TriggerDef, card: string): boolean {
  const cond = trigger.where;
  if (!cond) return true;
  if (cond.kind !== "isTurnPlayer") {
    throw new RulesetBroken(state.game, `trigger ${JSON.stringify(trigger.name)} is narrowed by ${cond.kind}, and this interpreter reads only isTurnPlayer so far (#142)`);
  }
  const master = masterOf(game, state, card);
  return cond.who === "opponent" ? state.turnPlayer !== master : state.turnPlayer === master;
}

/** Whose card this is: the side whose in-play area holds it, else its owner (3-1-6). The legacy `masterOf`, over declared zones. */
export function masterOf(game: GameDefinition, state: VmState, id: string): PlayerId {
  const at = findCard(state, id);
  if (at && game.zones[at.zone]?.inPlay === true) return at.owner;
  return state.cards[id].owner;
}

/**
 * The trigger subject's filter in a program's leading chain of lone IFs (no
 * ELSE, one op inside each but the last): `if A: if <subject is …>: …`, as
 * the compiler writes a trigger condition inside a price's condition (#1168).
 * Undefined when the chain holds none.
 */
function leadingSubjectFilter(ops: Op[] | undefined): CardFilter | undefined {
  let at = ops;
  while (at?.length === 1 && at[0].op === "if" && !at[0].else) {
    const cond = at[0].cond;
    if (cond.kind === "count" && cond.sel.special === "subject" && cond.sel.filter && (cond.atLeast ?? 1) <= 1 && cond.atMost === undefined) return cond.sel.filter;
    at = at[0].then;
  }
  return undefined;
}

// ── pending what answers ────────────────────────────────────────────────────

/**
 * The filter a record puts on the moment's subject, when the whole program is
 * a chain of plain IFs (no ELSE, one op inside each) and one of them is "the
 * subject is <filter>" (#1169). Every IF of the chain has to hold for anything
 * to happen, so a subject the filter refuses means nothing happens; any other
 * shape says nothing (null).
 */
function subjectGate(ops: readonly Op[] | undefined): CardFilter | null {
  for (let at = ops; at?.length === 1 && at[0].op === "if" && !at[0].else; at = at[0].then) {
    const cond = at[0].cond;
    if (cond.kind === "count" && cond.sel.special === "subject" && cond.sel.filter && (cond.atLeast ?? 1) <= 1 && !cond.atMost) return cond.sel.filter;
  }
  return null;
}

/**
 * #930: the [Union] keyword an [Auto] on `played` asks its own play to have
 * been made by — "when this card is played using [Union]" (BT14-114), "…with
 * [union]" (BT5-039), "…by a [union] skill" (BT28-097), "…using
 * [Union-Potara]" — read off the record, never the text: a chain of plain IFs
 * (no ELSE, one op inside each, as a price's condition wraps the trigger's)
 * one of which is `playedUsing(sel: self, what: Union…)`. "Union" is any
 * [Union-(type)]; null for any other shape. A condition later in the program
 * (BT6-036's "…and if this card was played using [union], draw 1 more card")
 * is not a gate: the Auto answers every play and asks it as it resolves.
 */
export function unionPlayGate(ops: readonly Op[] | undefined): string | null {
  return unionPlayedGate(ops, "self")?.what ?? null;
}

/**
 * #930: the same gate, generalised to the card the moment is about. For
 * `"subject"` it is "when your <X> card is played by a [Union] skill"
 * (BT22-033, BT25-036 back, P-682) and "when you play a Battle Card using a
 * [Union-Fusion] skill" (BT12-122), an [Auto] on `youPlayed`: one of the chain
 * of plain IFs holds `playedUsing(sel: subject, what: Union…)`, alone or as a
 * part of an `all`, and the description of the played card, when one is
 * printed, is the `count(subject <filter>)` beside it (`filter`). Read off the
 * record, never the text; null for any other shape.
 */
export function unionPlayedGate(ops: readonly Op[] | undefined, who: "self" | "subject"): { what: string; filter?: CardFilter } | null {
  let what: string | null = null;
  let filter: CardFilter | undefined;
  const visit = (cond: Cond): void => {
    if (cond.kind === "all") { for (const c of cond.conds) visit(c); return; }
    if (cond.kind === "playedUsing" && cond.sel.special === who && !cond.sel.filter && (cond.what === "Union" || cond.what.startsWith("Union-"))) what ??= cond.what;
    if (who === "subject" && cond.kind === "count" && cond.sel.special === "subject" && cond.sel.filter && (cond.atLeast ?? 1) <= 1 && !cond.atMost) filter ??= cond.sel.filter;
  };
  for (let at = ops; at?.length === 1 && at[0].op === "if" && !at[0].else; at = at[0].then) visit(at[0].cond);
  return what === null ? null : { what, ...(filter ? { filter } : {}) };
}

/**
 * Queue every [Auto] that answers to this moment (9-6-2), and say which.
 *
 * Appends to `state.pending` in the order the declarations were read; the
 * *resolution* priority follows 9-6-6; #549 lets the priority side choose
 * among its pending skills when several answer at once.
 *
 * `only` narrows the matches to the ones a caller names — `vm/host.ts`'s
 * `pendByName`, where a program says "this card, this trigger" and nothing
 * else on the board is being asked.
 */
export function pendAutos(ctx: EngineContext, game: GameDefinition, state: VmState, moment: Moment, only?: (match: TriggerMatch) => boolean, subjectInfo?: Attrs, cleanupOccurrence?: string, comboOrigin?: ComboOrigin): VmPending[] {
  const pended: VmPending[] = [];
  // The entry moment carries the actual source area. Save it on the battle,
  // since several actions and even a JSON reload may separate entry from
  // 8-5's cleanup departure. A later entry of this same copy replaces it.
  if (state.battle && moment.event === "moved" && moment.card && moment.args.to === "combo" && moment.args.from !== "combo") {
    (state.battle.comboOrigins ??= {})[moment.card] = typeof moment.args.from === "string" ? moment.args.from : "other";
    // The card whose skill did it, when one did (#907): a later entry of this copy replaces it, a declared combo clears it.
    if (typeof moment.args.viaCard === "string") (state.battle.comboVia ??= {})[moment.card] = moment.args.viaCard;
    else if (state.battle.comboVia) delete state.battle.comboVia[moment.card];
  }
  for (const match of matchTriggers(game, state, moment, true)) {
    if (only && !only(match)) continue;
    if (match.trigger === "comboToDrop" && moment.args.cleanupDeparture === true) continue;
    if (match.trigger === "comboToDrop" && moment.args.fromHolder !== moment.controller) continue;
    // 5-7: a declared combo is not the entry moment if a replacement or a
    // failed move left the card outside the Combo Area.
    if (match.trigger === "comboUsed" && findCard(state, match.card)?.zone !== "combo") continue;
    const inst = state.cards[match.card];
    // 1-10-2 / 23-5: a card in Hidden Mode is no information at all, its own
    // skills included — and 9-1-5, a card whose skills are negated has none to
    // answer with. The second half is #142's: it is an effect in force, read
    // where every other reader of that rule reads it.
    // `front` is 23-5-2-4's exception: a moment that is about the card
    // switching to Hidden Mode is answered by its front side.
    if (!inst || (inst.hidden && !match.front) || skillsNegated(state, match.card)) continue;
    const master = masterOf(game, state, match.card);
    // Read once per card: a text box is parsed by a regex, and a moment that
    // every card in play hears would otherwise parse each of them twice.
    const showing = skillsShowing(ctx, state, match.card);
    for (const sk of showing.skills) {
      // An [Auto] answers through its record; a keyword's own line answers
      // through its declaration's `at:` (Stage 7 — [Offering] at `played`),
      // which is the one place a keyword's moment is written down.
      const keyword = sk.kind === "keyword" ? keywordMomentOf(game, sk, match.trigger) : undefined;
      if (sk.kind !== "auto" && !keyword && !triggeredPermanent(sk)) continue;
      // 22-21: a pending Auto is only created while its Bond condition is
      // valid. Unknown named selectors are left for the normal unread-rule
      // boundary; they must never be treated as an unrestricted count here.
      if (sk.kind === "auto" && bondIsValid(ctx, game, state, master, sk) === false) continue;
      // 9-1-5: one skill of a card switched off — by index, or a whole kind at
      // once — is off for the moment it would have answered to as well.
      if (skillNegated(state, match.card, sk.index, sk.kind)) continue;
      if (match.trigger === "battleOrDeckToWarp" && moment.sourceNegated?.includes(sk.index)) continue;
      // 9-6-9-2: an area-movement [Auto] negated in its original Battle Area
      // does not trigger although the card has moved on (and the move ended
      // the negation).
      if (LEFT_BATTLE_BY_SKILL.has(match.trigger) && moment.sourceNegated?.includes(sk.index)) continue;
      const script = showing.scripts.bySkill[sk.index];
      const combo = script?.combo;
      if (sk.kind === "auto" && (combo !== undefined || script?.trigger?.some((t) => t === "comboUsed" || t === "comboed"))) {
        const gap = comboScriptProblem(script);
        if (gap) throw new NotYet(gap, "#907");
      }
      if (!keyword && !answersTo(showing.scripts, sk, match.trigger)) continue;
      // #1163, #1166: "…played by this card's skill" — "this card" is the one
      // with the skill, or, for a skill granted in quotation marks, the card
      // whose skill granted it.
      if (game.triggers[match.trigger]?.on.args.byWatcher === true && moment.args.byCard !== (quotedGrantSource(state, match.card, sk.index) ?? match.card)) continue;
      requireUsage(sk.usage);
      if (!sparkingIsValid(state, master, sk.validity)) continue;
      if (sk.kind === "auto" && ["comboUsed", "comboed"].includes(match.trigger) && !combo)
        throw new NotYet(comboQualificationProblem(combo)!, "#907");
      // A qualified hand-return must become pending at the movement, not
      // first discover whether it qualified when another Auto has resolved.
      if (match.trigger === "yourCardReturnedToHand" || match.trigger === "yourUnisonLeft") {
        const first = showing.scripts.bySkill[sk.index]?.ops[0];
        if (first?.op === "if" && first.cond.kind === "count" && first.cond.sel.special === "subject" && first.cond.sel.filter) {
          if (!subjectInfo) throw new NotYet(match.trigger === "yourUnisonLeft" ? "recover original Unison Area information for a leave-Unison Auto" : "recover original Battle Area information for a hand-return Auto", "#825");
          if (!predicateOf(first.cond.sel.filter, game)(subjectInfo)) continue;
        }
      }
      // "When your <filter> is KO'd" (#1120): a KO that does not meet the
      // trigger condition is not a trigger (9-6), so it must not become pending
      // and use up [Once per turn]. The compiled record is a lone IF on the
      // KO'd card's filter (`special: "subject"`), read here, never from names.
      // The filter is read from the KO'd card as it stands, as the IF would.
      if (sk.kind === "auto" && (match.trigger === "yourCardKoed" || match.trigger === "opponentCardKoed") && match.subject && state.cards[match.subject]) {
        const ops = showing.scripts.bySkill[sk.index]?.ops;
        const first = ops?.[0];
        if (ops?.length === 1 && first?.op === "if" && !first.else && first.cond.kind === "count" && first.cond.sel.special === "subject" && first.cond.sel.filter
          && (first.cond.atLeast ?? 1) <= 1 && !first.cond.atMost) {
          if (!predicateOf(first.cond.sel.filter, game)(subjectInfo ?? attrsNow(ctx, game, state, match.subject))) continue;
        }
      }
      // "When you remove a marker from one of your **red** Unison Cards using a
      // [Spirit Boost] skill" (SD15-05, #1169, 22-43-3): a payment from a
      // Unison the description refuses is no trigger (9-6-2), so it is not
      // pended — not even for a hand copy to decline. The compiled record is
      // an IF on the payer (`special: "subject"`), behind the IF of any
      // condition before the colon; it is read off the Unison the markers
      // came off as it stands, as the IF would read it at resolution.
      if (sk.kind === "auto" && match.trigger === "spiritBoostPaid" && match.subject && state.cards[match.subject]) {
        const payer = subjectGate(showing.scripts.bySkill[sk.index]?.ops);
        if (payer && !predicateOf(payer, game)(subjectInfo ?? attrsNow(ctx, game, state, match.subject))) continue;
      }
      // "When your mono-red ≪Saiyan≫ Leader Card is attacked" (#1168, 8-1-3,
      // 9-6): an attack on a Leader the description does not meet is no
      // trigger, so the Auto is not pended and its price is never asked. The
      // record keeps the description as an IF on the attacked Leader
      // (`special: "subject"`), inside any condition its price states
      // ("If your opponent's life is at 3 or more:"), which the price asks
      // for itself; that chain of lone IFs is read here, never the text.
      if (sk.kind === "auto" && match.trigger === "yourLeaderAttacked" && match.subject && state.cards[match.subject]) {
        const filter = leadingSubjectFilter(showing.scripts.bySkill[sk.index]?.ops);
        if (filter && !predicateOf(filter, game)(subjectInfo ?? attrsNow(ctx, game, state, match.subject))) continue;
      }
      // 9-1-3-2: an [Auto] whose effect takes this card out of an area outside
      // play ("play this card from your hand") works from that area only
      // (9-6-3-1-1 lets its master leave it undeclared there). A hand copy is
      // asked for these skills alone; an in-play copy has nothing to take out.
      const outside = sk.kind === "auto" ? usableFrom(showing.scripts.bySkill[sk.index]) : [];
      const at = findCard(state, match.card)?.zone;
      if (match.handWatcher) {
        if (!at || !outside.includes(at as never)) continue;
      } else if (at && game.zones[at]?.inPlay === true && outside.length > 0 && outside.every((a) => game.zones[a]?.inPlay !== true)) continue;
      if (match.trigger === "comboed" && moment.args.cleanupDeparture === true && combo?.timing === "battleEnd") continue;
      // 8-5-10-1 names the actual 8-5-8 cleanup departure, not an
      // arbitrary mid-battle exit. This also covers no-hand-source wordings.
      if (match.trigger === "comboed" && combo?.timing === "battleEnd" && game.triggers.comboToDrop && moment.args.cleanupSpecial !== true) continue;
      if (moment.args.cleanupSpecial === true && combo?.timing !== "battleEnd") continue;
      // The named Cell/CELL Jr. is qualified at the *play* moment, before an
      // Auto price or another pending Auto can alter it. A current cost read
      // here is the event-time cost; it is never guessed from a later frame.
      const whiteCell = match.trigger === "youPlayed" ? whiteCellPlayedSubjectFilter(sk) : null;
      if (whiteCell) {
        if (!match.subject || !state.cards[match.subject]) continue;
        const attrs = attrsNow(ctx, game, state, match.subject);
        // A cost filter reads the printed energyCost (owner ruling, #1097):
        // 20-21 adjustments and [Permanent] increases change what is paid, not this.
        if (!predicateOf(whiteCell, game)(attrs)) continue;
      }
      // Qualification is captured before pending is created. It travels in the
      // executable context through reload/replay, never through display wording.
      if (combo && moment.card !== match.card) continue;
      if (combo?.turn === "controller" && state.turnPlayer !== master) continue;
      if (combo?.turn === "opponent" && state.turnPlayer === master) continue;
      if (combo && (combo.timing === "battleEnd" || match.trigger === "comboUsed" || match.trigger === "comboed")) {
        if (combo.timing === "entry" && match.trigger !== "comboUsed") continue;
        if (combo.timing === "battleEnd") {
          if (match.trigger !== "comboed" || state.battle?.step !== "battleEnd"
            || !["cleanup", "departures", "battleEndCheckpoint"].includes(state.battle.endCombo?.stage ?? "")) continue;
        }
        if (combo.origins) {
          const origin = comboOrigin ?? state.battle?.comboOrigins?.[match.card];
          if (origin === undefined) throw new NotYet(combo.timing === "entry" ? "infer the source of a hand-qualified combo entry" : "infer the origin of a combo card in an older saved battle", combo.timing === "entry" ? "#672" : "#572");
          if (!combo.origins.includes(origin)) continue;
        }
        if (combo.viaSkillOf !== undefined) {
          const by = state.battle?.comboVia?.[match.card];
          if (!by || ctx.defs[state.cards[by]?.cardId ?? ""]?.name?.toLowerCase() !== combo.viaSkillOf.toLowerCase()) continue;
        }
      }
      // 5-5-1: a play into the Battle Area is also a placing (owner's ruling,
      // 2 Oct 2026), so one arrival matches `played` and `placed` both. A
      // skill whose record says both answers that arrival once, as `played`.
      if (match.trigger === "placed" && pended.some((p) => p.card === match.card && p.skillIndex === sk.index && (p.trigger === "played" || p.trigger === "playedFromHand"))) continue;
      // 22-11: a free [Once per turn] [Auto] that is already waiting for this
      // very moment cannot be activated a second time (#916: several energy
      // readied at once). The copy is not asked to order itself against its
      // own duplicate, and no note reports a use it never had.
      if (sk.kind === "auto" && sk.oncePerTurn && !sk.cost.trim()
        && state.pending.some((p) => p.card === match.card && p.skillIndex === sk.index && p.trigger === match.trigger && p.master === master)) continue;
      const subject = match.subject !== undefined ? { subject: match.subject } : {};
      // Ordinary movement emits after the real move; the cleanup's 8-5-6
      // notice passes its projected new-area information explicitly. Either
      // way the subject's event information is frozen before another Auto can
      // move it again at the checkpoint.
      const movementInfo = subjectInfo ?? (match.trigger === "comboToDrop" && match.subject ? attrsNow(ctx, game, state, match.subject) : undefined);
      const pending: VmPending = { card: match.card, skillIndex: sk.index, master, trigger: match.trigger, ...subject,
        ...(movementInfo && match.subject ? { subjectInfo: movementInfo } : {}),
        ...(cleanupOccurrence && match.trigger === "comboToDrop" ? { cleanupOccurrence } : {}),
        ...(state.cards[match.card]?.enteredUsing ? { selfEnteredUsing: state.cards[match.card].enteredUsing } : {}) };
      state.pending.push(pending);
      pended.push(pending);
    }
  }
  // Keep provenance through matching the cleanup move to Drop, then forget
  // it. A card that left and reentered from elsewhere must not inherit hand.
  if (state.battle && moment.event === "moved" && moment.card && moment.args.from === "combo" && moment.args.to !== "combo"
      && !cleanupOccurrence && moment.args.cleanupSpecial !== true) {
    delete state.battle.comboOrigins?.[moment.card];
    delete state.battle.comboVia?.[moment.card];
  }
  return pended;
}

/**
 * Does this skill answer to this moment? The record's WHEN if it has one, the
 * printed text if it has not (9-6-2).
 *
 * Word for word the legacy `skillAnswersTo`, and it has to be: a card with no
 * record is read by `autoTriggerMatches` — the compiler's own regexes, imported
 * rather than copied — so the two engines place an undrafted card at the same
 * moment. `undefined` is *no record*; an empty array is a record that says this
 * skill answers to nothing, and is honoured as that.
 */
function answersTo(scripts: CardScripts, sk: Skill, trigger: string): boolean {
  const recorded = scripts.bySkill[sk.index]?.trigger;
  if (recorded) return (recorded as readonly string[]).includes(trigger);
  // A counter window is a moment no record's WHEN ever says (`whenMoments`), so
  // there is no printed wording to fall back on either.
  return isMoment(trigger) && autoTriggerMatches(sk, trigger);
}

/** Is this declared name one of the moments a record's WHEN may say? The five counter windows are not (4-3, 9-7). */
const isMoment = (name: string): name is Trigger => (TRIGGERS as readonly string[]).includes(name);

/**
 * The skills of the face a card is showing, and the records that go with them.
 *
 * A flipped Leader answers with its awakened face (1-9), which is the side
 * `programsOf` keys as `<id>#back`. The text is read off the catalog row here
 * rather than through `vm/cards.ts` because a card's *back* is a face of its
 * own and the attribute adapter reads the front — noted in §3 of the ruleset
 * spec as one of the five things the grammar could not say.
 */
export function skillsShowing(ctx: EngineContext, state: VmState, id: string): { skills: Skill[]; scripts: CardScripts } {
  const inst = state.cards[id];
  const def = inst ? ctx.defs[inst.cardId] : undefined;
  if (!def) return { skills: [], scripts: NO_RULES };
  const back = inst.flipped && def.back != null;
  const own = { skills: parseSkills((back ? def.back?.skill : def.skill) ?? null), scripts: programsOf(ctx, def, back ? "back" : "front") };
  // 20-18: the skills this card has taken on from another, each under the
  // index the legacy `copiedSkillsOn` gives it and played from the *source's*
  // record — so a copied [Permanent] stands on the target, a copied [Auto]
  // answers to the target's moments and a copied line's keyword is in force
  // on it, every reader of this function at once (#439). A copied pure
  // keyword line is not here: it is granted as a `keyword` effect.
  const copies = state.effects.filter((e) => e.kind === "copiedSkills" && e.target === id && e.copied);
  const executable = (sk: Skill, scripts: CardScripts): Skill => {
    const script = scripts.bySkill[sk.index];
    sk = recordedSkillIdentity(sk, script);
    const native = sk.kind === "keyword" && !sk.effect.trim() && !sk.cost.trim() && !needsPaymentRecord(sk) && !sk.oncePerTurn && sk.limit === null;
    const bareKeyword = sk.kind === "keyword" && !sk.effect.trim() && !sk.cost.trim() && !needsPaymentRecord(sk);
    if (bareKeyword && script && validityProblem(script.validity)) throw new NotYet(validityProblem(script.validity)!, "#907");
    if (bareKeyword && (sk.sparking !== null || script?.validity?.sparking != null))
      throw new NotYet("apply Sparking to native keyword identity; this qualified keyword remains unsupported", "#907");
    return withValidity(withUsage(sk, script ? script.usage : (native ? unlimitedUsage() : undefined)),
      script ? script.validity : (native && sk.sparking === null ? noSparking() : undefined));
  };
  // #1166: a line printed in quotation marks is a skill this card grants
  // ("…your Leader gains the following skill for the turn- "[auto] …""),
  // never one it has — it runs only as the copy a quoted grant makes.
  const mine = own.skills.some((sk) => sk.granted) ? own.skills.filter((sk) => !sk.granted) : own.skills;
  if (!copies.length) return { ...own, skills: mine.map((sk) => executable(sk, own.scripts)) };
  const skills = mine.slice();
  const bySkill = { ...own.scripts.bySkill };
  for (const e of copies) {
    const c = e.copied!;
    const src = ctx.defs[c.cardId];
    if (!src) continue;
    const scripts = programsOf(ctx, src, c.side);
    for (const sk of parseSkills((c.side === "back" ? src.back?.skill : src.skill) ?? null)) {
      if (!c.skills.includes(sk.index)) continue;
      // #1166: a quoted grant runs the quoted skill; no other copy takes one.
      if (!sk.granted !== !c.quoted) continue;
      const index = copiedSkillIndex(e.id, sk.index);
      skills.push({ ...(sk.granted ? sk.granted.skill : sk), index });
      if (scripts.bySkill[sk.index]) {
        const script = scripts.bySkill[sk.index];
        bySkill[index] = script.usage?.limit != null ? { ...script, usage: undefined,
          unsupported: [...script.unsupported, "copied Limit ceilings require a canonical shared same-skill identity; unsupported (#907)"] } : script;
      }
    }
  }
  return { skills: skills.map((sk) => executable(sk, { ...own.scripts, bySkill })), scripts: { ...own.scripts, bySkill } };
}

// ── the checkpoint's queue (4-2-2, 9-6-6) ───────────────────────────────────

/**
 * The singleton fallback: the turn player's first, then the other player's
 * (9-6-6), taken off the queue. With several pending on one side, the
 * checkpoint asks that player to choose their order (#549).
 *
 * Copied from the legacy `checkpoint` (`engine/engine.ts`) rather than
 * re-derived, because the ordering is the one thing two engines playing the
 * same game may not disagree about — a skill resolving a step later is a
 * different board.
 */
export function nextPending(state: VmState): VmPendingRecord | null {
  const pick = (p: PlayerId): VmPendingRecord | null => {
    const i = state.pending.findIndex((x) => x.master === p);
    return i >= 0 ? state.pending.splice(i, 1)[0] : null;
  };
  return pick(state.turnPlayer) ?? pick(other(state.turnPlayer));
}
