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
 *   *9-6-6 — the turn player's pending skills resolve first* is `nextPending`,
 *   copied from the legacy `checkpoint` rather than re-derived.
 *
 * **What answers is an [Auto], and only an [Auto].** A keyword skill's own
 * moments (§22) are not read off the record on either engine — the legacy
 * engine has them as a `switch` in `keywordTriggers`, and here they arrive as
 * the `DEFINE KEYWORD` hook bodies of Stage 7 (#153). Pending them off a
 * `keywordTriggers` call copied into this file would be the wrong answer twice:
 * the wrong place for it, and a second copy of a list that is about to stop
 * being a list. `docs/arena-ruleset-spec.md` §4 says so.
 *
 * Pure and client-safe: no database, no network, no `fs`.
 */
import { autoTriggerMatches } from "../engine/triggers";
import { parseSkills } from "../engine/cards";
import { programsOf } from "../engine/state";
import { NO_RULES, type CardScripts } from "../engine/script";
import { PLAYERS, other, type PlayerId, type Skill, type Trigger } from "../engine/types";
import type { EngineContext } from "../engine";
import type { PatternValue } from "../lang";
import { ZONE_ARGS, type GameDefinition, type TriggerDef } from "../rulesets";
import { TRIGGERS } from "../gaps";
import { RulesetBroken } from "./errors";
import type { Moment } from "./events";
import type { VmState } from "./state";
import { findCard, inPlayZones } from "./zones";
import { skillNegated, skillsNegated } from "./effects";

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
  /** The card whose skill answers. */
  card: string;
  /** Which of that face's skills, by its printed index. */
  skillIndex: number;
  /** Whose skill it is. 9-6-6 orders the queue by this and nothing else. */
  master: PlayerId;
  /** The declared moment it answers to — what `card_rules.trigger` says. */
  trigger: string;
  /** The card the moment happened to, when that is another card (`BIND "subject"`). */
  subject?: string;
}

/** A card asked whether it answers to a moment, and the name it would answer to. */
export interface TriggerMatch {
  trigger: string;
  card: string;
  subject?: string;
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
export function matchTriggers(game: GameDefinition, state: VmState, moment: Moment): TriggerMatch[] {
  const out: TriggerMatch[] = [];
  for (const trigger of Object.values(game.triggers)) {
    if (trigger.on.event !== moment.event) continue;
    if (!fieldsMatch(trigger.on.args, moment.args)) continue;
    for (const card of asked(game, state, trigger, moment)) {
      if (!holdsFor(game, state, trigger, card)) continue;
      const subject = trigger.bind === "subject" && moment.card !== undefined ? { subject: moment.card } : {};
      out.push({ trigger: trigger.name, card, ...subject });
    }
  }
  return out;
}

/** Every argument the pattern names, matched against what the moment carries. `watcher` is about who is asked rather than about the event, and is read by `asked`. */
function fieldsMatch(pattern: Record<string, PatternValue>, carried: Record<string, PatternValue>): boolean {
  for (const [name, want] of Object.entries(pattern)) {
    if (name === "watcher") continue;
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
function asked(game: GameDefinition, state: VmState, trigger: TriggerDef, moment: Moment): string[] {
  const watcher = trigger.on.args.watcher;
  if (watcher !== undefined) return inPlay(game, state, watching(state, trigger, moment, watcher));
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
  if (watcher !== "controller" && watcher !== "opponent") {
    throw new RulesetBroken(state.game, `trigger ${JSON.stringify(trigger.name)} watches ${JSON.stringify(watcher)}, and a watcher is controller, opponent or both`);
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

// ── pending what answers ────────────────────────────────────────────────────

/**
 * Queue every [Auto] that answers to this moment (9-6-2), and say which.
 *
 * Appends to `state.pending` in the order the declarations were read; the
 * *resolution* order is 9-6-6's and is `nextPending`'s, which is what makes the
 * queue a set rather than a sequence at this end.
 */
export function pendAutos(ctx: EngineContext, game: GameDefinition, state: VmState, moment: Moment): VmPending[] {
  const pended: VmPending[] = [];
  for (const match of matchTriggers(game, state, moment)) {
    const inst = state.cards[match.card];
    // 1-10-2 / 23-5: a card in Hidden Mode is no information at all, its own
    // skills included — and 9-1-5, a card whose skills are negated has none to
    // answer with. The second half is #142's: it is an effect in force, read
    // where every other reader of that rule reads it.
    if (!inst || inst.hidden || skillsNegated(state, match.card)) continue;
    const master = masterOf(game, state, match.card);
    // Read once per card: a text box is parsed by a regex, and a moment that
    // every card in play hears would otherwise parse each of them twice.
    const showing = skillsShowing(ctx, state, match.card);
    for (const sk of showing.skills) {
      if (sk.kind !== "auto") continue;
      // 9-1-5: one skill of a card switched off — by index, or a whole kind at
      // once — is off for the moment it would have answered to as well.
      if (skillNegated(state, match.card, sk.index, sk.kind)) continue;
      if (!answersTo(showing.scripts, sk, match.trigger)) continue;
      const subject = match.subject !== undefined ? { subject: match.subject } : {};
      const pending: VmPending = { card: match.card, skillIndex: sk.index, master, trigger: match.trigger, ...subject };
      state.pending.push(pending);
      pended.push(pending);
    }
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
  return { skills: parseSkills((back ? def.back?.skill : def.skill) ?? null), scripts: programsOf(ctx, def, back ? "back" : "front") };
}

// ── the checkpoint's queue (4-2-2, 9-6-6) ───────────────────────────────────

/**
 * The next [Auto] to resolve: the turn player's first, then the other player's
 * (9-6-6), taken off the queue.
 *
 * Copied from the legacy `checkpoint` (`engine/engine.ts`) rather than
 * re-derived, because the ordering is the one thing two engines playing the
 * same game may not disagree about — a skill resolving a step later is a
 * different board.
 */
export function nextPending(state: VmState): VmPending | null {
  const pick = (p: PlayerId): VmPending | null => {
    const i = state.pending.findIndex((x) => x.master === p);
    return i >= 0 ? state.pending.splice(i, 1)[0] : null;
  };
  return pick(state.turnPlayer) ?? pick(other(state.turnPlayer));
}
