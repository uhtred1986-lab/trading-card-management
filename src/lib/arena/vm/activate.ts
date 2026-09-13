/**
 * A skill being used, and the refusal one line is owed (§9-1-2, §4-3).
 *
 * Every other move is about a card. An activation is about **a line of one**:
 * a card prints up to nine skills, each with its own price, its own condition
 * and its own once-per-turn ceiling, and one of them being on the menu says
 * nothing whatever about the other eight. That is §3.2's single exception —
 * one rejection per card per action type, *except an activation, which is one
 * per skill line* (`docs/arena-workflow-spec.md`, amended 8 Sep 2026) — and it
 * is the reason this module exists beside `vm/actions.ts` rather than inside
 * it: the candidate an `ACTION activate` enumerates is a pair, and everything
 * that decides its legality is read off the pair.
 *
 * **The record is the rule, and it is read exactly as the legacy engine reads
 * it.** The price before the colon comes off `card_rules.cost` (`Script.price`,
 * the precedent of 8 Sep 2026), the hoisted condition off the same row, the
 * program off `Script.ops` — so a rule a person corrected on the workbench
 * plays the same on both engines. A skill with **no record** has an *unknown*
 * price and is refused, never played free; a skill whose price is more than
 * this engine can charge is refused as `unread`, which is the same answer the
 * legacy engine gives for a cost its compiler could not read.
 *
 * **The order of the refusals is the legacy `whyNotActivate`'s**, gate for gate,
 * because the first one is what a player is shown. `whyNotActivate` collects
 * every reason and this returns the first, so the promise the two engines are
 * held to is *the same first requirement on the same board* — which is what
 * `scripts/verify/vm.ts` §19 asserts, line by line. The price sits between
 * `before` and `after` for that reason and no other: it is gate 12 of 15, and a
 * card short of energy *and* in the wrong area says the wrong-area reason on
 * neither engine.
 *
 * **What this paragraph is not about, and who owns it.**
 *
 *   *A keyword's own activation* — [Awaken], [Evolve], [Union], [Over Realm],
 *   [Swap], [Arrival], [Successor], [Aegis], [Rejuvenate], [Overlord], [Field],
 *   [Z-Awaken] — is a body the `DEFINE KEYWORD` hooks carry, which is Stage 7's
 *   (#153–#157). Such a line is still a candidate and is refused `unread`,
 *   because a player reaching for it is owed an answer; it is simply not an
 *   answer this engine can give yet.
 *
 *   *A [Counter] window* is Stage 6's (#150). No phase of `game.rules` asks a
 *   counter question, so no declaration offers those kinds and nothing here
 *   knows the word.
 *
 *   *An X price* (20-5) and *an action price* (4-3-3, "switch this card to Rest
 *   Mode:") are the two halves of a skill's cost this stage did not reach. The
 *   first is a value 1-2-2-2 makes an answer to a question and a candidate is a
 *   card and a number and nothing else; the second needs the payability of a
 *   whole program, which is `canPayCostProgram` in the legacy engine and has no
 *   reading over declared prices. Both are refused as the printed price rather
 *   than charged as nothing (#149).
 *
 *   *[Burst X]* (22-27) and *[Spirit Boost X]* (22-43) are prices paid in cards
 *   off the deck and markers off a Unison, each with moments of its own to fire;
 *   they are refused by name for the same reason (#149).
 *
 * **One reading that is deliberately not the legacy engine's**, recorded rather
 * than copied. An Extra Card used from the hand pays its own energy cost as well
 * as the skill's orbs (4-2, 12-2-2); the legacy `activatable` adds the two
 * *totals* and then plans against the play cost's colours alone
 * (`planPayment(c.total + orbTotal, c.specified)`), so on a board short of the
 * skill's own colour it offers a skill whose orbs it could not pay. Here the two
 * halves are one price, colours included, which is 1-2-3 read straight. The
 * divergence is asserted in `scripts/verify/vm.ts` §19 so it is a decision and
 * not a drift, and the legacy engine is bug fixes only.
 *
 * Pure and client-safe, like the rest of `vm/`: no database, no network.
 */
import type { EngineContext, GameEvent } from "../engine";
import type { Area, Color, PlayerId, Requirement, Skill } from "../engine/types";
import type { Script } from "../engine/script";
import { costIsOnlyOrbs } from "../engine/compile";
import type { ActionDef, GameDefinition } from "../rulesets";
import { attrsOf } from "./cards";
import { cardPrice, type BoundAmounts } from "./costs";
import { skillNegated, skillsNegated } from "./effects";
import { RulesetBroken } from "./errors";
import { log } from "./events";
import { moved } from "./flow";
import { forbiddenBy } from "./program";
import { vmHost } from "./host";
import type { VmState } from "./state";
import { skillsShowing } from "./triggers";
import { findCard } from "./zones";

/**
 * One candidate of an activation: the copy on the table, the printed line, and
 * the record that says what the line does.
 *
 * `script` is `undefined` for a line nobody drafted, which is a *different*
 * thing from a line with an empty program: the first has an unknown price and
 * is refused, the second is a rule that says nothing happens.
 */
export interface ActivationLine {
  card: string;
  skillIndex: number;
  skill: Skill;
  script: Script | undefined;
}

/**
 * The four pieces of the DBS definition an activation still names, and what
 * each is for.
 *
 * Checked against the declarations when a game is made (`createGame`), the way
 * `SETUP_ZONES`, `STEP_WORK` and `PLAY_ZONES` are: a renamed zone fails loudly
 * rather than reading a keyword's price off nothing. What would replace them is
 * `DEFINE KEYWORD` bodies naming their own pools, which is Stage 7's (#153).
 */
export const ACTIVATION_ZONES = { bond: "battle", sparking: "drop", marker: "unison", hand: "hand", drop: "drop" } as const;

/** Every zone this module names, for the check `createGame` makes against the declarations. */
export const ACTIVATION_ZONE_NAMES = [...new Set(Object.values(ACTIVATION_ZONES))];

// ── which lines are candidates ──────────────────────────────────────────────

/** The half of a skill kind before the colon — the family a `skills:` list belongs to (`activate`, `counter`, `auto`). */
const familyOf = (kind: string): string => kind.split(":")[0];

/** The windows a skill kind may be used in: `activate:main/battle` is both, `auto` is none. */
const windowsOf = (kind: string): string[] => {
  const rest = kind.slice(familyOf(kind).length + 1);
  return rest ? rest.split("/") : [];
};

/**
 * The one window this action offers, read off the kinds it declares.
 *
 * The intersection rather than the union: `skills: [activate:main,
 * activate:main/battle]` offers the Main Phase and nothing else, and it is the
 * *shared* half of those two kinds that says so. An action whose kinds share no
 * window, or share more than one, is a declaration no refusal could name a
 * window for, so it is refused when the game is made rather than the first time
 * a card asks.
 */
export function windowOf(game: GameDefinition, def: ActionDef): string {
  const kinds = def.skills ?? [];
  if (!kinds.length) throw new RulesetBroken(game.id, `DEFINE ACTION ${JSON.stringify(def.name)} is about skill lines and names no kind of one`);
  let shared: string[] | null = null;
  for (const kind of kinds) {
    const windows = windowsOf(kind);
    shared = shared === null ? windows : shared.filter((w) => windows.includes(w));
  }
  if (!shared || shared.length !== 1) {
    throw new RulesetBroken(game.id, `DEFINE ACTION ${JSON.stringify(def.name)} names skill kinds that share ${shared?.length ?? 0} windows, and a move is offered at one`);
  }
  return shared[0];
}

/**
 * Every line of this card the action is a move about.
 *
 * A line is a candidate when its kind is of the **family** the declaration
 * names — every `activate:…` line for an action declaring activations — and it
 * is *offered* only when its kind is one of the declared ones. That is what
 * lets one paragraph both offer the Main Phase's skills and answer the player
 * reaching for a Battle one with the window it belongs to, instead of leaving
 * that line out of both lists.
 *
 * 1-10-2: a card in Hidden Mode is no information at all, its own skills
 * included, so it offers none and is asked about none — the same reading
 * `pendAutos` makes of the same rule.
 */
export function activationsOf(ctx: EngineContext, state: VmState, def: ActionDef, card: string): ActivationLine[] {
  const families = new Set((def.skills ?? []).map(familyOf));
  const inst = state.cards[card];
  if (!inst || inst.hidden) return [];
  const showing = skillsShowing(ctx, state, card);
  const out: ActivationLine[] = [];
  for (const skill of showing.skills) {
    if (!families.has(familyOf(skill.kind))) continue;
    out.push({ card, skillIndex: skill.index, skill, script: showing.scripts.bySkill[skill.index] });
  }
  return out;
}

// ── what a line costs ───────────────────────────────────────────────────────

/**
 * The amounts this line binds to the prices the action names (#147).
 *
 * The orbs are printed in front of the line and the marker cost with them
 * (13-4); everything else is the record's. `unreadable` is the answer to "can
 * this engine charge the price at all": `null` when the printed cost is orbs,
 * or orbs and a condition 9-1-3 hoisted out of it, and the printed words
 * otherwise — which `planCost` turns into the `unread` requirement the legacy
 * engine gives for the same cost.
 *
 * 12-2-2: an Extra Card used from the hand pays its **energy cost as well**,
 * because using one is how an Extra is played (4-2). The two halves are added
 * here rather than charged separately, since a player pays once.
 */
export function boundFor(ctx: EngineContext, game: GameDefinition, state: VmState, line: ActivationLine): BoundAmounts {
  const sk = line.skill;
  const orbs: Partial<Record<Color, number>> = {};
  let total = 0;
  for (const [key, n] of Object.entries(sk.energyCost)) {
    if (!n) continue;
    total += n;
    // "{1}" is an orb of no colour (1-2-3): part of the total, asking for no
    // colour, which is what `any` means and what the planner counts by total.
    if (key !== "any") orbs[key as Color] = (orbs[key as Color] ?? 0) + n;
  }
  // 22-13: "{r}/{u}" is one orb payable with either, and it is one energy of
  // the total like any other orb.
  total += sk.energyEither.length;
  if (inHand(state, line.card) && isExtra(ctx, game, state, line.card)) {
    const play = cardPrice(ctx, game, state, line.card);
    total += play.total;
    for (const [colour, n] of Object.entries(play.orbs)) orbs[colour as Color] = (orbs[colour as Color] ?? 0) + (n ?? 0);
  }
  return {
    energy: { total, orbs, either: sk.energyEither.map((one) => [...one]) },
    markers: sk.markerCost ?? 0,
    unreadable: chargeablePrice(line) ? null : sk.cost,
  };
}

/**
 * Can this engine charge the whole of the line's printed price?
 *
 * Orbs, yes — they are a number and a colour. Orbs plus a condition 9-1-3
 * hoisted out of the price, yes: the condition is asked and the orbs are paid,
 * which is what the legacy engine does with "[Activate: Main] If your Leader
 * Card is red: Draw 1 card". Everything else, no: an action price (4-3-3) needs
 * the payability of a program, an X price (20-5) a value nobody has named, a
 * 20-19 payer an effect in force to read, and a skill with **no record at all**
 * has no price to read in the first place (the 8 Sep 2026 precedent).
 */
function chargeablePrice(line: ActivationLine): boolean {
  if (costIsOnlyOrbs(line.skill.cost)) return true;
  const price = line.script?.price;
  if (!price) return false;
  if (price.ops?.length || price.x || price.payWith?.length) return false;
  return price.condition !== null;
}

// ── why a line is not offered ───────────────────────────────────────────────

/**
 * The gates of `whyNotActivate`, in its order, with the price's place kept.
 *
 * `before` is everything the legacy twin asks before it counts the energy and
 * `after` everything it asks afterwards; `vm/actions.ts` reads the price
 * between them and takes the first requirement of the three lists together. A
 * list rather than a single value because the caller decides how many to show,
 * and the answer a client draws is the first.
 */
export function activationRefusals(
  ctx: EngineContext,
  game: GameDefinition,
  state: VmState,
  def: ActionDef,
  player: PlayerId,
  line: ActivationLine,
): { before: Requirement[]; after: Requirement[] } {
  const before: Requirement[] = [];
  const after: Requirement[] = [];
  const { card, skill: sk } = line;
  const inst = state.cards[card];
  const at = findCard(state, card)?.zone ?? null;

  // 9-1-5 in both its shapes: one line switched off by index, and the whole
  // card at once. The one reading of that rule is `vm/effects.ts` and every
  // reader of it asks there, the twin included.
  if (skillsNegated(state, card) || skillNegated(state, card, sk.index, sk.kind)) before.push({ kind: "other", detail: "the skill is negated" });
  // 20-14: a prohibition in force on using this card's skills. It sits here
  // rather than in the declaration's own `REFUSE` list because the order is the
  // point — `whyNotActivate` asks it second, after the negation and before
  // everything else, and a declared `REFUSE` runs before all of these. The
  // gates of an activation are the legacy twin's in the legacy twin's order,
  // which is what makes the *first* requirement the same requirement.
  const banned = forbiddenBy(ctx, game, state, "activateSkill", { player, card });
  if (banned) before.push({ kind: "forbidden", ...banned });
  const left = usesLeft(sk, inst?.usedThisTurn ?? []);
  if (left === 0) before.push({ kind: "oncePerTurn", what: "skill", ...(sk.limit != null && !sk.oncePerTurn ? { limit: sk.limit } : {}) });
  // 22-6 / 22-31: [Bond X] and [Sparking X] are conditions on using the skill,
  // counted over a pool the game declares.
  if (sk.bond != null && zone(state, player, ACTIVATION_ZONES.bond).length < sk.bond) {
    before.push({ kind: "condition", text: `[Bond ${sk.bond}]: ${sk.bond} or more Battle Cards in play` });
  }
  if (sk.sparking != null && zone(state, player, ACTIVATION_ZONES.sparking).length < sk.sparking) {
    before.push({ kind: "condition", text: `[Sparking ${sk.sparking}]: ${sk.sparking} or more cards in your Drop Area` });
  }
  // 22-27 / 22-43: a price in cards off the deck and in markers off a Unison,
  // each with moments of its own to fire. Refused rather than charged (#149).
  if (sk.burst != null || sk.spiritBoost != null) before.push({ kind: "unread", card });
  // The window: a line of a kind this move does not offer is still a candidate,
  // and the answer it is owed names the window it belongs to (7-3-4 against
  // 8-6-2). Derived from the declaration, so a battle paragraph says "main" for
  // the same line without a second table.
  if (!(def.skills ?? []).includes(sk.kind)) {
    const ours = windowOf(game, def);
    const theirs = windowsOf(sk.kind).filter((w) => w !== ours);
    before.push({ kind: "timing", window: theirs.join("/") || sk.kind });
  }
  // 22-2 and the eleven keywords like it: a keyword's activation has a body,
  // and the bodies are the `DEFINE KEYWORD` hooks of Stage 7.
  if (sk.keyword) before.push({ kind: "unread", card });
  // 13-4: a marker skill is used in the Unison Area, once a turn, and never
  // below no markers. The last of the three is the price's own and `planCost`
  // words it; the two here are not about the price at all.
  if (sk.markerCost != null) {
    if (at !== ACTIVATION_ZONES.marker) before.push({ kind: "zone", card, area: ACTIVATION_ZONES.marker as Area });
    if (inst?.usedMarkerSkill) before.push({ kind: "oncePerTurn", what: "marker skill" });
  }
  // 9-4: the condition the record hoisted out of the price, asked where the
  // legacy engine asks it — before the energy is counted, so a skill whose
  // condition fails says so rather than "1 short".
  const condition = line.script?.price?.condition ?? null;
  if (condition && !vmHost(ctx, game, state, []).condHolds({ ops: [], ip: 0, vars: {}, card, master: player }, condition)) {
    before.push({ kind: "condition", text: sk.cost });
  }

  // …the price goes here, and `vm/actions.ts` puts it there.

  // 9-1-3: a skill whose effect this engine cannot resolve is not offered, so
  // nothing is ever paid for an effect that then does not happen.
  if (!canResolve(line)) after.push({ kind: "unread", card });
  // 9-1-3-1: a Battle Card's skills are valid in the Battle Area. An Extra
  // Card's are valid in the hand, because using one from there is how an Extra
  // is played at all (4-2), and its price above carries the energy cost to
  // match.
  if (at === ACTIVATION_ZONES.hand && !isExtra(ctx, game, state, card)) after.push({ kind: "zone", card, area: "battle" });
  return { before, after };
}

/** 22-44-3: how many more times this line may be used this turn, or null for a line with no ceiling. The legacy `usesLeft`. */
function usesLeft(sk: Skill, used: number[]): number | null {
  const cap = sk.oncePerTurn ? 1 : sk.limit;
  if (cap == null) return null;
  return Math.max(0, cap - used.filter((i) => i === sk.index).length);
}

/**
 * Can the effect after the colon be resolved at all? The legacy `canResolve`,
 * with no referee: a line with no effect resolves to nothing, and a line with
 * one needs a record whose every clause the compiler read.
 */
const canResolve = (line: ActivationLine): boolean => (!line.skill.effect.trim() ? true : !!line.script && line.script.unsupported.length === 0);

// ── taking one ──────────────────────────────────────────────────────────────

/**
 * Use the line: mark it used, send an Extra on its way, announce it and put the
 * record's program on the queue.
 *
 * The price is **already charged** when this is reached — `applyDeclared` takes
 * it before anything here runs, which is the order #148 settled and the order a
 * replay depends on. What is left is the part that is not a price:
 *
 *   *22-44-3* the use itself, counted on the copy so a [Once per turn] line is
 *   refused for the rest of the turn, and 13-4's lock on a second marker skill.
 *   *12-2-2* an Extra used from the hand goes to the Drop Area as it resolves.
 *   *9-6-2* the `skill` beat — the line **as printed**, tag and all, which is
 *   what the legacy engine logs (`sk.raw`) and therefore what the two logs are
 *   compared on.
 *
 * The program goes on the queue rather than running here, exactly as a pended
 * [Auto]'s does (`flow.ts`'s checkpoint): a skill that stops to ask is storable
 * mid-decision, and the frame is the whole of its continuation. 9-7's counter
 * window around it is Stage 6's (#150) and is not opened.
 */
export function resolveActivation(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], player: PlayerId, line: ActivationLine): void {
  const { card, skill: sk } = line;
  const inst = state.cards[card];
  if (!inst) throw new RulesetBroken(state.game, `there is no card ${card} to use a skill of`);
  if (sk.oncePerTurn || sk.limit != null) inst.usedThisTurn.push(sk.index);
  if (sk.markerCost != null) inst.usedMarkerSkill = true;
  // 12-2-2: the Extra is placed in the Drop Area as part of using it, before
  // its own effect resolves — so a skill that counts the Drop counts it.
  if (findCard(state, card)?.zone === ACTIVATION_ZONES.hand && isExtra(ctx, game, state, card)) {
    moved(ctx, game, state, ev, card, ACTIVATION_ZONES.drop, { owner: player, reveal: true });
  }
  log(ev, { type: "skill", card, skill: sk.index, master: player, text: sk.raw, inBattle: false });
  const program = line.script?.ops ?? [];
  if (program.length) state.programs.unshift({ ops: program, ip: 0, vars: {}, card, master: player, skillIndex: sk.index });
}

/**
 * The moment a skill being used **is** (9-6), in the words `triggers.rules` is
 * written in.
 *
 * Fired by `vm/actions.ts` once the line has been paid for and announced, and
 * named nowhere here: what answers to it is the declarations' business, which
 * is the whole difference from the forty hand-placed `pendTriggers` calls in
 * the engine this one is replacing.
 */
export function activationMoment(state: VmState, player: PlayerId, line: ActivationLine): { event: string; card: string; controller: PlayerId; args: Record<string, string | boolean> } {
  return {
    event: "skillActivated",
    card: line.card,
    controller: player,
    args: { kind: familyOf(line.skill.kind), from: findCard(state, line.card)?.zone ?? "", paid: true },
  };
}

// ── reading the board ───────────────────────────────────────────────────────

const zone = (state: VmState, player: PlayerId, name: string): string[] => state.sides[player].zones[name] ?? [];

const inHand = (state: VmState, card: string): boolean => findCard(state, card)?.zone === ACTIVATION_ZONES.hand;

/**
 * 4-2: an Extra Card is activated rather than played, which is what makes the
 * hand one of the areas its skills are valid in.
 *
 * Read off the declared `type` attribute and its base (14-1), which is the same
 * reading `vm/play.ts` and `vm/filters.ts` make of it.
 */
function isExtra(ctx: EngineContext, game: GameDefinition, state: VmState, card: string): boolean {
  const inst = state.cards[card];
  const def = inst && ctx.defs[inst.cardId];
  if (!def) return false;
  return String(attrsOf(def, game).attrs.type ?? "").replace(/^Z-/, "") === "EXTRA";
}
