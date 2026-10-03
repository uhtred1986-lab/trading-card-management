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
 *   [Z-Awaken] — is its `DEFINE KEYWORD`'s `DO`, Stage 7's to write one keyword
 *   at a time (`docs/arena-ruleset-spec.md` §4.4). A keyword whose declaration
 *   says `offer:` makes its bare line a candidate here, as a line of the kind
 *   it names (`ActivationLine.kind`), gated by the keyword's own `REFUSE`s
 *   beside the window and running its `DO` in place of the record ([Overlord]
 *   is the first). A printed [Activate] line carrying a keyword with no `DO`
 *   is still a candidate and is refused `unread`, because a player reaching
 *   for it is owed an answer; it is simply not one this engine can give yet.
 *
 *   *A [Counter]* is not an activation at all: its windows (an attack's,
 *   a play's) are `vm/battle.ts`'s native `counter` move (#150), and no
 *   declaration offers those kinds. *An [Activate: Battle]* is this paragraph
 *   read against the combo prompt — `vm/battle.ts` hands `activate` the
 *   battle's kinds and the gates below are the same gates.
 *
 *   *An action price* (4-3-3, "choose 1 card in your hand and place it in the
 *   Drop Area:") is charged as the legacy engine charges it (#458): offered only
 *   when `canPayPriceProgram` — the legacy `canPayCostProgram`, op for op — says
 *   the program can be paid, run as its own frame in front of the effect, and
 *   the effect announced and started from what it chose once it is paid
 *   (`resolveActivation`). *An X price* (20-5) is one candidate per value
 *   (`vm/actions.ts`, #439). A keyword's own move with an action price is still
 *   refused as the printed price rather than charged as nothing.
 *
 *   *[Spirit Boost X]* (22-43) is a price in markers off a Unison with moments
 *   of its own to fire (sixteen cards watch the payment itself); it is refused
 *   by name for the same reason (#149). *[Burst X]* (22-27) is not: it is a
 *   `DEFINE COST burst` in `costs.rules`, X cards off the top of the deck,
 *   bound here from the line's own tag and charged by the planner between the
 *   marker and the orbs, which is where the legacy `activate` pays it (#148).
 *
 * **One reading that was once not the legacy engine's, and is now.** An Extra
 * Card used from the hand pays its own energy cost as well as the skill's orbs
 * (4-2, 12-2-2), and here the two halves have always been one price, colours
 * included, which is 1-2-3 read straight. The legacy `activatable` used to add
 * the two *totals* and then plan against the play cost's colours alone, so on
 * a board short of the skill's own colour it offered a skill whose orbs it
 * could not pay — BT17-080's {g}{y}{2} to an all-green board. The owner ruled
 * this engine right (13 Sep 2026: a card that cannot pay an energy colour
 * cannot be played), and the legacy engine was fixed as the bug it was (#271):
 * `scripts/verify/vm.ts` §19 now asserts the *agreement* — the same first
 * `Requirement` on a board with the total but not the colour, and the same
 * offer when the colour is there — where it used to record the divergence.
 *
 * Pure and client-safe, like the rest of `vm/`: no database, no network.
 */
import type { EngineContext, GameEvent, Payer } from "../types";
import type { Area, Color, PlayerId, Requirement, Skill } from "../types";
import { HIDEABLE, selectedCount, type Cond, type Op, type Script, type ScriptFrame, type Selector } from "./script";
import { costIsOnlyOrbs } from "../compile";
import type { ActionDef, GameDefinition, KeywordDef } from "../rulesets";
import { attrsOf } from "./cards";
import { altCostFor, cardColors, cardPrice, restingFor, skillOrbs, spendSkillCostUses, type BoundAmounts } from "./costs";
import { skillNegated, skillsNegated, type VmAltCost } from "./effects";
import { RulesetBroken } from "./errors";
import { log } from "./events";
import { moved } from "./flow";
import { attrsNow, forbiddenBy, permissions, resolveRef, resolveSelector, staticsNow } from "./program";
import { predicateOf } from "./filters";
import type { PayerGrant } from "./effects";
import { vmHost } from "./host";
import type { VmState } from "./state";
import { keywordAfterProgram, keywordMomentNames, keywordMoveOf, keywordProgram } from "./keyword-do";
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
  /**
   * The kind the line is offered as: its printed kind, or — for a line that is
   * nothing but a keyword whose `DEFINE KEYWORD` says `offer:` — the kind the
   * declaration names. Every window and family test reads this rather than
   * `skill.kind`, so [Overlord] is an `activate:main` line in every sense the
   * gates care about.
   */
  kind: string;
  /** The keyword's declaration, when the line is that keyword's own move: its `REFUSE`s are gates, its `label:` the menu's words and its `DO` the program. */
  keyword?: KeywordDef;
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
export const ACTIVATION_ZONES = { bond: "battle", sparking: "drop", marker: "unison", hand: "hand", drop: "drop", burst: "deck", spiritBoost: "unison", zDeck: "zDeck", zEnergy: "zEnergy" } as const;

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
export function activationsOf(ctx: EngineContext, state: VmState, def: ActionDef, card: string, game?: GameDefinition): ActivationLine[] {
  const families = new Set((def.skills ?? []).map(familyOf));
  const inst = state.cards[card];
  if (!inst || inst.hidden) return [];
  const showing = skillsShowing(ctx, state, card);
  const out: ActivationLine[] = [];
  for (const skill of showing.skills) {
    // Stage 7: a line that is nothing but a keyword is a move when the
    // keyword's declaration says so (`offer:`), and is then a candidate of the
    // family of the kind it is offered as. Without a `game` there is no
    // declaration to read, and such a line is what it has always been: none.
    const keyword = game ? keywordMoveOf(game, skill) : undefined;
    const kind = keyword && game ? widenedOffer(ctx, game, state, card, keyword) : skill.kind;
    if (!families.has(familyOf(kind))) continue;
    // 22-46-5: the Z-Deck is where a keyword's own move may be used from
    // ([Z-Awaken], #155), and nothing else is: a Z-card's printed lines are
    // valid once it is in play, so a line there that is no keyword's move is
    // no candidate at all — the legacy menu never asks about one.
    if (!keyword && findCard(state, card)?.zone === ACTIVATION_ZONES.zDeck) continue;
    out.push({ card, skillIndex: skill.index, skill, script: showing.scripts.bySkill[skill.index], kind, ...(keyword ? { keyword } : {}) });
  }
  return out;
}

/**
 * The kind a keyword's own move is offered as: its declaration's `offer:`,
 * widened to the battle's timings too when a [Permanent] says so for this card.
 * "The [Field] skill on this card in your hand can also be activated at
 * [Activate: Battle] timings" (BT29-041, BT29-042) is a `permit` of
 * `fieldBattle`, read from the hand (`vm/effects.ts`), and it makes the [Field]
 * line an `activate:main/battle` line — offered at the combo prompt as well
 * (`vm/battle.ts`'s `BATTLE_SKILL_KINDS`), with every other gate unchanged.
 */
function widenedOffer(ctx: EngineContext, game: GameDefinition, state: VmState, card: string, keyword: KeywordDef): string {
  const offer = keyword.offer as string;
  if (keyword.name !== "Field" || offer !== "activate:main") return offer;
  return permissions(ctx, game, state, "fieldBattle").some((p) => p.target === card) ? "activate:main/battle" : offer;
}

// ── what a line costs ───────────────────────────────────────────────────────

/**
 * The amounts this line binds to the prices the action names (#147).
 *
 * The orbs are printed in front of the line and the marker cost with them
 * (13-4), read through the one reduction layer a line's price has
 * (`skillOrbs`: every skill-cost change in force on this card for this kind
 * of line, 4-3-3); a [Burst X] tag binds X cards out of the pool `costs.rules`
 * says it is paid from (22-27); everything else is the record's. `unreadable` is the answer to "can
 * this engine charge the price at all": `null` when the printed cost is orbs,
 * or orbs and a condition 9-1-3 hoisted out of it, and the printed words
 * otherwise — which `planCost` turns into the `unread` requirement the legacy
 * engine gives for the same cost.
 *
 * 12-2-2: an Extra Card used from the hand pays its **energy cost as well**,
 * because using one is how an Extra is played (4-2). The two halves are added
 * here rather than charged separately, since a player pays once — unless
 * `withCardPrice` is false, for the line bought at its alternative price
 * (`activationAlt`), which stands in for the energy cost and leaves the
 * skill's own orbs to pay.
 */
export function boundFor(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, withCardPrice = true, onto?: string): BoundAmounts {
  const sk = line.skill;
  const own = skillOrbs(ctx, game, state, line.card, sk, onto);
  const orbs: Partial<Record<Color, number>> = { ...own.orbs };
  let total = own.total;
  if (withCardPrice && inHand(state, line.card) && isExtra(ctx, game, state, line.card)) {
    const play = cardPrice(ctx, game, state, line.card);
    total += play.total;
    for (const [colour, n] of Object.entries(play.orbs)) orbs[colour as Color] = (orbs[colour as Color] ?? 0) + (n ?? 0);
  }
  return {
    energy: { total, orbs, either: own.either },
    markers: sk.markerCost ?? 0,
    // 22-27-2: [Burst X]'s cards, by the pool the declared price takes them out
    // of. Bound to 0 on a line with no tag, so the price asks nothing of it.
    // 22-46-3: a line used from the Z-Deck pays its card's Z-Energy cost, read
    // off the card as a Z-card played from there pays it (16-2) — [Z-Awaken]
    // (#155); bound to 0 everywhere else, so no line in play pays it again.
    pooled: { [ACTIVATION_ZONES.burst]: sk.burst ?? 0, ...(findCard(state, line.card)?.zone === ACTIVATION_ZONES.zDeck ? {} : { [ACTIVATION_ZONES.zEnergy]: 0 }) },
    // 22-43: [Spirit Boost X]'s markers come off the Unison Card, the place
    // `DEFINE COST spiritBoost` names; bound to 0 on a line with no tag.
    markersFrom: { [ACTIVATION_ZONES.spiritBoost]: { n: -(sk.spiritBoost ?? 0), by: "Spirit Boost" } },
    payers: payWithPayers(ctx, game, state, player, line),
    unreadable: chargeablePrice(line) ? null : sk.cost,
  };
}

/**
 * EX03-16: the Battle Cards an [Evolve] line has a price change scoped to
 * (`costReduction`'s `onto`) that it could evolve onto — each one a second
 * candidate of the line, naming its base, beside the ordinary one. The legacy
 * `evolveOntoBases`, in the same order: the Battle Area's own.
 */
export function evolveOntoBases(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine): string[] {
  if (line.skill.keyword?.name !== "Evolve") return [];
  const scoped = (e: { kind: string; target?: string; onto?: string[] }) => e.kind === "evolveCost" && e.target === line.card && !!e.onto?.length;
  const bases = new Set([...staticsNow(ctx, game, state).filter(scoped), ...state.effects.filter(scoped)].flatMap((e) => e.onto ?? []));
  if (!bases.size) return [];
  const frame: ScriptFrame = { ops: [], ip: 0, vars: {}, card: line.card, master: player, skillIndex: line.skillIndex };
  return resolveSelector(ctx, game, state, frame, { area: "battle", side: "you", printed: true }).filter((id) => bases.has(id));
}

/**
 * 5-3 / 22-37: the other price an Extra Card's line may be used at from the
 * hand — the card's alternative to its energy cost, read for a play (4-2:
 * using an Extra from the hand is how it is played), which is the action's
 * `alt:` word, as the legacy `activatable(…, alt)` reads `altCostFor(…,
 * "play")`. The line's own orbs are still paid: `bound` is the line's price
 * without the card's energy cost, and `resting` the cards the alternative
 * would rest, which that price may not be paid with (#155, [Invoker]).
 */
export function activationAlt(
  ctx: EngineContext,
  game: GameDefinition,
  state: VmState,
  def: ActionDef,
  player: PlayerId,
  line: ActivationLine,
): { alt: VmAltCost; bound: BoundAmounts; resting: string[] } | null {
  if (def.alt === undefined || !inHand(state, line.card) || !isExtra(ctx, game, state, line.card)) return null;
  const alt = altCostFor(ctx, game, state, line.card, player, def.alt);
  return alt ? { alt, bound: boundFor(ctx, game, state, player, line, false), resting: restingFor(alt) } : null;
}

/**
 * 20-19: the cards this line's own price names as payers, resolved against the
 * board — the legacy `pricePayers`'s reading, port for port, since the
 * record's `payWith` is the one `PayWith[]` shape both engines read off
 * `Script.price`. Empty for the ordinary line, which names none: `priceFor`
 * reads an empty array as "nothing to add" rather than "nothing bound", so a
 * line with no `payWith` costs `priceFor` nothing extra to carry.
 *
 * The frame is bare — no running program, no variables — because a price is
 * planned before the skill's own effect ever starts one; `pw.sel` is read
 * against the board and the card whose line this is, the same two things
 * every other reading in this module already has.
 */
function payWithPayers(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine): Payer[] {
  const payWith = line.script?.price?.payWith;
  const out: Payer[] = scopedPayers(ctx, game, state, player, line).map((s) => s.payer);
  if (!payWith?.length) return out;
  const frame: ScriptFrame = { ops: [], ip: 0, vars: {}, card: line.card, master: player };
  for (const pw of payWith) {
    for (const id of resolveSelector(ctx, game, state, frame, pw.sel)) out.push({ id, colors: pw.as === "energy" ? cardColors(ctx, game, state, id) : [pw.as] });
  }
  return out;
}

/**
 * 20-19, scoped (BT28-106): the cards a [Permanent] of this player's lets pay
 * the **skill cost** of this line — "when paying the skill cost of skills on
 * white ≪God≫ cards in any of your areas, once per turn you can use 1 [or 2]
 * Hidden Mode card[s] in your Battle Area as energy". Only for a line on a
 * card the grant describes, wherever that card is; at most `max` of the cards
 * (the first ones standing, Active, in the area); and not at all once a
 * once-per-turn grant has paid this turn (`spendScopedPayers`). Each payer
 * carries the grant it came from, for the spending.
 */
function scopedPayers(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine): { payer: Payer; source: string; skillIndex?: number; oncePerTurn?: true }[] {
  const out: { payer: Payer; source: string; skillIndex?: number; oncePerTurn?: true }[] = [];
  const counted = new Map<string, number>();
  let attrs: ReturnType<typeof attrsNow> | null = null;
  for (const e of staticsNow(ctx, game, state)) {
    if (e.kind !== "payer" || !e.target || e.master !== player) continue;
    const g = e.value as PayerGrant;
    if (!g.forSkillsOf) continue;
    if (g.oncePerTurn && g.skillIndex !== undefined && state.cards[e.source]?.usedThisTurn.includes(g.skillIndex)) continue;
    attrs ??= attrsNow(ctx, game, state, line.card);
    if (!predicateOf(g.forSkillsOf, game)(attrs)) continue;
    const inst = state.cards[e.target];
    if (!inst || inst.owner !== player || inst.mode !== "active" || out.some((o) => o.payer.id === e.target)) continue;
    const key = `${e.source}#${g.skillIndex ?? ""}`;
    const n = counted.get(key) ?? 0;
    if (g.max !== undefined && n >= g.max) continue;
    counted.set(key, n + 1);
    out.push({ payer: { id: e.target, colors: g.payAs === "energy" ? cardColors(ctx, game, state, e.target) : [g.payAs] }, source: e.source, ...(g.skillIndex !== undefined ? { skillIndex: g.skillIndex } : {}), ...(g.oncePerTurn ? { oncePerTurn: true as const } : {}) });
  }
  return out;
}

/**
 * The other half of a once-per-turn scoped grant (BT28-106): the line paid
 * with one of its cards, so the [Permanent] is spent for the turn — its index
 * on its card's `usedThisTurn`, which the turn's end clears (`vm/flow.ts`).
 * Read before the charge, while the payers are still Active.
 */
export function scopedPayersSpent(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine): (rested: string[]) => void {
  const scoped = scopedPayers(ctx, game, state, player, line);
  return (rested) => {
    for (const s of scoped) {
      if (!s.oncePerTurn || s.skillIndex === undefined || !rested.includes(s.payer.id)) continue;
      const used = state.cards[s.source]?.usedThisTurn;
      if (used && !used.includes(s.skillIndex)) used.push(s.skillIndex);
    }
  };
}

/**
 * Can this engine charge the whole of the line's printed price?
 *
 * Orbs, yes — they are a number and a colour. Orbs plus a condition 9-1-3
 * hoisted out of the price, yes: the condition is asked and the orbs are paid,
 * which is what the legacy engine does with "[Activate: Main] If your Leader
 * Card is red: Draw 1 card". 20-19's own `payWith` items, yes too (#149) —
 * `payWithPayers` above is what reads them, and a line naming one is no more
 * unread than a line naming orbs. Everything else, no: an action price
 * (4-3-3) is charged since #458, on a printed line only, and a skill with **no
 * record at all** has no price to read in the first place (the 8 Sep 2026
 * precedent).
 */
function chargeablePrice(line: ActivationLine): boolean {
  if (costIsOnlyOrbs(line.skill.cost)) return true;
  const price = line.script?.price;
  if (!price) return false;
  // 4-3-3: an action price is charged by `resolveActivation` (#458) — on a
  // printed line. A keyword's own move runs its `DO` in place of the record
  // and has nowhere to charge one, so it stays refused.
  if (price.ops?.length) return !line.keyword;
  // 20-5: an X price is chargeable once X is named, which the menu does —
  // one candidate per payable value (`vm/actions.ts`'s `activation`, #439).
  if (price.x || price.payWith?.length) return true;
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
  keywordRefusals: () => Requirement[] = () => [],
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
  // 22-27-3: [Burst X] cannot be paid with fewer than X cards in the deck.
  // The price itself is charged by the planner (`DEFINE COST burst`); the
  // shortfall is asked *here*, among the gates, because this is where
  // `whyNotActivate` asks it — beside [Bond] and [Sparking], before the window
  // — and in its words, so the first requirement is the same one on both
  // engines. 22-43's [Spirit Boost], whose payment is a moment sixteen cards
  // answer, is still refused rather than charged (#149).
  if (sk.burst != null && zone(state, player, ACTIVATION_ZONES.burst).length < sk.burst) {
    before.push({ kind: "other", detail: `[Burst ${sk.burst}] needs that many cards in the deck` });
  }
  // 22-43-2: the same for [Spirit Boost X] — a Unison Card with X markers on it
  // — asked here for the same reason, in the legacy words (#157). The price is
  // `DEFINE COST spiritBoost`'s.
  if (sk.spiritBoost != null) {
    const unison = zone(state, player, ACTIVATION_ZONES.spiritBoost)[0];
    if (!unison || (state.cards[unison]?.markers ?? 0) < sk.spiritBoost) before.push({ kind: "other", detail: "[Spirit Boost] needs the markers" });
  }
  // The window: a line of a kind this move does not offer is still a candidate,
  // and the answer it is owed names the window it belongs to (7-3-4 against
  // 8-6-2). Derived from the declaration, so a battle paragraph says "main" for
  // the same line without a second table.
  if (!(def.skills ?? []).some((k) => k === line.kind)) {
    const ours = windowOf(game, def);
    const theirs = windowsOf(line.kind).filter((w) => w !== ours);
    before.push({ kind: "timing", window: theirs.join("/") || line.kind });
  }
  // 22-2 and the keywords like it: a keyword's own activation is the keyword's
  // `DO`, which Stage 7 writes one keyword at a time. One whose declaration
  // offers it is gated by its own `REFUSE` lines here — where the legacy
  // `whyNotActivate` asks its keyword's `case`, after the window — and every
  // other is still the answer it was: a line this engine cannot read yet.
  if (line.keyword) before.push(...keywordRefusals());
  else if (sk.keyword) before.push({ kind: "unread", card });
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
  // 4-3-3: an action price that cannot be paid on this board, asked where the
  // legacy `whyNotActivate` asks it — after the condition, before the energy —
  // and in its words (#458).
  const priceOps = actionPriceOf(line);
  if (priceOps && !canPayPriceProgram(ctx, game, state, player, card, priceOps)) before.push({ kind: "other", detail: `cannot pay: ${sk.cost}` });

  // …the price goes here, and `vm/actions.ts` puts it there.

  // 9-1-3: a skill whose effect this engine cannot resolve is not offered, so
  // nothing is ever paid for an effect that then does not happen.
  if (!canResolve(line)) after.push({ kind: "unread", card });
  // 9-1-3-1: a Battle Card's skills are valid in the Battle Area. An Extra
  // Card's are valid in the hand, because using one from there is how an Extra
  // is played at all (4-2), and its price above carries the energy cost to
  // match.
  // A keyword's own move says where it is used from in its own `REFUSE` lines
  // instead — [Evolve] from the hand (22-5-2), [Overlord] from the Battle Area.
  // 9-1-3-2: a line whose own price or effect takes *this card* out of an area
  // — "Draw 1 card and play this card from your hand" — is used from that
  // area and nowhere else, read off the record (`usableFrom`), never the text.
  // An Extra is used from the hand whatever its effect then does with it (4-2,
  // 12-2-2), so it is not asked.
  const from = line.keyword || isExtra(ctx, game, state, card) ? [] : usableFrom(line.script);
  if (from.length) {
    if (!from.includes(at as Area)) after.push({ kind: "zone", card, area: from[0] });
  } else if (at === ACTIVATION_ZONES.hand && !isExtra(ctx, game, state, card) && !line.keyword) after.push({ kind: "zone", card, area: "battle" });
  return { before, after };
}

/** The ops that take a card out of the area it is in: a move, a play, a combo use, a KO (9-1-3-2's "play this card from your hand", "send this card from your Drop to your Warp"). */
const MOVES_A_CARD = new Set<Op["op"]>(["moveTo", "play", "comboFrom", "ko"]);

/**
 * 9-1-3-2: the areas a line of this record is used from, when its own price
 * or effect names one — empty for every other line, which 9-1-3-1 answers.
 *
 * Read off the record and nothing else: the **first** op of the line — its
 * price first, then its effect — that moves *this card*, directly as its
 * target or through the variable a `choose` of it binds. When that op's
 * `self` selector names an area (`{ special: "self", area: "hand" }`, which
 * the compiler writes for "this card from your hand", `compile/targets.ts`'s
 * `selfFrom`), the line takes the card out of that area as it is used, and
 * that is where it is used from ("from your hand or Warp" names two, either
 * will do). Only the first, because a later move of the
 * same card starts wherever the first one left it — "KO this card, then add
 * this card from your Drop to your hand" is still used from the Battle Area.
 * A selector that only *asks* where the card is ("if this card is in your
 * hand") is a condition, not 9-1-3-2's area; a delayed program moves the card
 * later, from wherever it then is. Neither is read.
 */
export function usableFrom(script: Script | undefined): Area[] {
  if (!script) return [];
  const out = new Set<Area>();
  const bound = new Map<string, Area[]>();
  /** The areas outside play a `self` selector names — empty for one naming none; `undefined` for a selector that is not this card. */
  const selfArea = (sel: Selector | undefined): Area[] | undefined =>
    sel?.special !== "self" ? undefined : ((sel.areas ?? (sel.area ? [sel.area] : [])).filter((a) => a !== "play" && a !== "under") as Area[]);
  /** Walks one run of ops; true once this card has been moved in it. Branches are alternatives, each read up to its own first move. */
  const walk = (ops: Op[]): boolean => {
    for (const op of ops) {
      if (op.op === "choose") {
        const a = selfArea(op.sel);
        if (a !== undefined) bound.set(op.as, a);
      }
      if (MOVES_A_CARD.has(op.op) && "target" in op && op.target) {
        const a = "sel" in op.target ? selfArea(op.target.sel) : bound.get(op.target.var);
        if (a !== undefined) {
          for (const area of a) out.add(area);
          return true;
        }
      }
      let moved = false;
      if (op.op === "if") moved = [walk(op.then), walk(op.else ?? [])].some(Boolean);
      else if (op.op === "may") moved = walk(op.ops);
      else if (op.op === "chooseMode") moved = op.modes.map((m) => walk(m.ops)).some(Boolean);
      if (moved) return true;
    }
    return false;
  };
  if (!walk(script.price?.ops ?? [])) walk(script.ops);
  return [...out];
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
// A keyword's own move runs its `DO` and then the line's record, so the record
// is asked like any other — [Union-Absorb]'s printed effect has to read — and a
// line the record does not cover at all ([Overlord], a card no compile saw) is
// the keyword's `DO` alone.
const canResolve = (line: ActivationLine): boolean => (!line.skill.effect.trim() || (line.keyword && !line.script) ? true : !!line.script && line.script.unsupported.length === 0);

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
 * mid-decision, and the frame is the whole of its continuation. 9-7's `skill`
 * counter window around it is not opened: the legacy engine opens it with no
 * candidates at all, so there is nothing to answer it with.
 */
export function resolveActivation(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], player: PlayerId, line: ActivationLine, x?: number, onto?: string): void {
  const { card, skill: sk } = line;
  const inst = state.cards[card];
  if (!inst) throw new RulesetBroken(state.game, `there is no card ${card} to use a skill of`);
  if (sk.oncePerTurn || sk.limit != null) inst.usedThisTurn.push(sk.index);
  if (sk.markerCost != null || (line.keyword && isMarkerSkill(line.keyword))) inst.usedMarkerSkill = true;
  // The price is charged (`vm/actions.ts`, before this): a one-use change to
  // the line's own orbs ("the next time you activate …", BT31-096) is spent.
  spendSkillCostUses(state, ev, card, sk);
  // 12-2-2: the Extra is placed in the Drop Area as part of using it, before
  // its own effect resolves — so a skill that counts the Drop counts it.
  // Not for a keyword's own move: its `DO` says where the card goes, and
  // [Field]'s puts it in the Battle Area instead (22-3-2), as the legacy
  // engine's `Field` case moves it straight there.
  if (!line.keyword && findCard(state, card)?.zone === ACTIVATION_ZONES.hand && isExtra(ctx, game, state, card)) {
    moved(ctx, game, state, ev, card, ACTIVATION_ZONES.drop, { owner: player, reveal: true });
  }
  // `inBattle` is the legacy `!!s.battle`: an [Activate: Battle] taken at the
  // combo prompt (`vm/battle.ts`, #150) is a skill used in a battle.
  // 4-3-3: a line with an action price is announced once the price is paid —
  // the legacy `skill.resolve`, which runs after the price — so it is the
  // price's frame finishing that announces it (`vm/host.ts`'s `saveVars`).
  const priceOps = actionPriceOf(line);
  if (!announcesBeforePrice(line) && !priceOps) announce(state, ev, player, line);
  // A keyword's own move runs the keyword's `DO` — the keyword's rules are the
  // effect (22-1), and the record of a line like "[Overlord]" says nothing —
  // and then whatever effect the line prints beyond the keyword, which is
  // [Union-Absorb]'s whole effect ("its text says which card is played onto
  // this one", 22-13-6) and nothing at all on a bare [Evolve] or [Overlord].
  // `AFTER` (#155) is the keyword's last word, after that printed effect:
  // [Wish]'s flip of the Leader (22-25-4).
  const program = line.keyword ? [...keywordProgram(game, line.keyword, sk), ...(line.script?.ops ?? []), ...keywordAfterProgram(game, line.keyword, sk)] : (line.script?.ops ?? []);
  // 20-5: the X the price was paid at is what the effect reads as `X`.
  // EX03-16: an [Evolve]'s base named with the activation is the keyword's
  // `base` already chosen — `keywords.rules`' Evolve asks only when it is not.
  const effect: ScriptFrame = { ops: program, ip: 0, vars: onto === undefined ? {} : { base: [onto] }, card, master: player, skillIndex: sk.index, ...(x === undefined ? {} : { x }) };
  if (priceOps) {
    // 4-3-3: the action price is paid on activation, as a program of its own in
    // front of the effect — the legacy `activate`'s `saveVarsAs` frame — and
    // what it chose ("the chosen card") is handed on under one key. The effect
    // frame is queued even when it does nothing, because it is what is
    // announced when the price is paid.
    const key = costVarsKey(card, sk.index);
    state.programs.unshift({ ops: priceOps, ip: 0, vars: {}, card, master: player, skillIndex: sk.index, saveVarsAs: key }, { ...effect, pricedBy: { key, text: sk.raw } });
    return;
  }
  if (program.length) state.programs.unshift(effect);
}

/** Where a line's action price leaves what it chose for the effect — the legacy key, word for word. */
const costVarsKey = (card: string, skillIndex: number) => `costvars:${card}:${skillIndex}`;

/**
 * The action price (4-3-3) this line charges, or null: the record's price
 * program, read only when the printed cost is more than orbs — the legacy
 * `priceFor(…).ops` behind its `!costIsOrbsOnly` — and never for a keyword's
 * own move, which has no place to charge one.
 */
function actionPriceOf(line: ActivationLine): Script["ops"] | null {
  if (line.keyword || costIsOnlyOrbs(line.skill.cost)) return null;
  const ops = line.script?.price?.ops;
  return ops?.length ? ops : null;
}

/**
 * Can this action price be paid right now? The legacy `canPayCostProgram`
 * (`engine/state.ts`), op for op, over the declared zones.
 *
 * Deliberately a whitelist: an op that is not on it means "no", so the line
 * stays unoffered rather than offered with a price that then half-runs. A
 * target named by a variable is whatever the `choose` in front of it binds,
 * and that choice has already been checked.
 */
export function canPayPriceProgram(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string, ops: Script["ops"]): boolean {
  const frame: ScriptFrame = { ops: [], ip: 0, vars: {}, card, master: player };
  const hand = zone(state, player, ACTIVATION_ZONES.hand);
  // The activating card leaves the hand as part of the activation (12-2-2),
  // so it is not also there to be discarded.
  const inHand = hand.includes(card) ? 1 : 0;
  for (const op of ops) {
    switch (op.op) {
      case "choose": {
        // "Up to" can always be paid with nothing (5-2-4).
        if (op.sel.upTo) break;
        // 5-8-2-2: a chosen card the price then switches pays only if it is
        // not in that mode already — "by switching 1 Hidden Mode card in your
        // Battle Area to Rest Mode" (BT28-138) is not paid by a rested one.
        const then = ops.find((o) => (o.op === "switchMode" || o.op === "hidden") && "target" in o && o.target && "var" in o.target && o.target.var === op.as);
        const switches = (id: string) =>
          !then ? true : then.op === "switchMode" ? state.cards[id].mode !== then.mode : then.op === "hidden" ? state.cards[id].hidden !== then.hidden : true;
        const payable = resolveSelector(ctx, game, state, frame, op.sel).filter(switches);
        if (selectedCount(op.sel, payable, (id) => String(attrsNow(ctx, game, state, id).name ?? id)) < (op.sel.count ?? 1)) return false;
        break;
      }
      case "discard":
        if (typeof op.n !== "number" || hand.length - inHand < op.n) return false;
        break;
      case "mill":
        if (typeof op.n !== "number" || zone(state, player, ACTIVATION_ZONES.burst).length < op.n) return false;
        break;
      case "switchMode": {
        if ("var" in op.target) break;
        const cards = resolveRef(ctx, game, state, frame, op.target);
        if (!cards.length || cards.some((id) => state.cards[id].mode === op.mode)) return false;
        break;
      }
      case "hidden": {
        // 23-5 with 5-8-2-2: a switch is paid only by a card it can switch —
        // in an area with that position (1-10-2) and not already in it. A
        // chosen card has been narrowed to those by its own choice.
        if ("var" in op.target) break;
        const cards = resolveRef(ctx, game, state, frame, op.target);
        if (!cards.length || cards.some((id) => state.cards[id].hidden === op.hidden || !HIDEABLE.has(findCard(state, id)?.zone ?? ""))) return false;
        break;
      }
      case "moveTo":
        // "Under" needs a host and "play" is not an area (3-1).
        if (op.to === "under" || op.to === "play") return false;
        if ("var" in op.target) break;
        if (!resolveRef(ctx, game, state, frame, op.target).length) return false;
        break;
      case "removeMarker": {
        if (typeof op.n !== "number") return false;
        if ("var" in op.target) break;
        const cards = resolveRef(ctx, game, state, frame, op.target);
        if (!cards.length || cards.some((id) => state.cards[id].markers < (op.n as number))) return false;
        break;
      }
      default:
        return false;
    }
  }
  return true;
}

/**
 * 13-4-2: is a keyword's own move a marker skill — one whose use spends its
 * card's one marker skill of the turn? It is when the move is refused once that
 * card has used one, `REFUSE … UNLESS NOT markerSkillUsed(sel: [self])`: a
 * price printed as the line's text ([Rejuvenate]'s "Remove 2 markers from this
 * card", 22-42-2) is no `[-2]` tag `markerCost` reads, so the declaration's own
 * gate is what says the move is one (#155).
 */
function isMarkerSkill(def: KeywordDef): boolean {
  const onSelf = (c: Cond): boolean =>
    c.kind === "markerSkillUsed" ? c.sel.special === "self" : c.kind === "not" ? onSelf(c.cond) : c.kind === "all" || c.kind === "any" ? c.conds.some(onSelf) : false;
  return (def.refusals ?? []).some((r) => onSelf(r.unless));
}

/**
 * Is this line announced as it is declared — before its price is charged —
 * rather than as it is used? A keyword's own move whose effect is the
 * keyword's alone ([Evolve], [Union-Fusion], [Overlord]: the line's record has
 * nothing to run) is, because that is the legacy engine's order: its keyword
 * `case`s announce the skill and then pay. A line with an effect of its own
 * ([Union-Absorb], every printed [Activate]) is announced as that effect
 * resolves, after the price, the legacy `skill.resolve` step. The log is what
 * a replay compares, so the order is the oracle's. [Field] is the exception
 * the legacy engine makes too: its `Field` case pays the Extra's energy cost
 * first and announces the skill as it resolves (`resolvesLater`), so it is
 * announced after the price.
 */
export function announcesBeforePrice(line: ActivationLine): boolean {
  return !!line.keyword && line.keyword.name !== "Field" && !line.script?.ops.length;
}

/** The `skill` event for a line being used (9-6). */
export function announce(state: VmState, ev: GameEvent[], player: PlayerId, line: ActivationLine): void {
  log(ev, { type: "skill", card: line.card, skill: line.skill.index, master: player, text: line.skill.raw, inBattle: !!state.battle });
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

/**
 * The second moment a keyword's own move is: "when you activate an
 * [Overlord] skill", "when you use this card's [Evolve] from your hand"
 * (22-5, 22-13, 22-41) — `keywordActivated` in `triggers.rules`' words, the
 * event `vm/battle.ts` already fires for [Blocker]. Null for a line that is no
 * keyword's move. Read before the line is used, like the activation's own
 * moment, because "from: hand" is about where it was used from.
 */
export function keywordActivationMoments(state: VmState, player: PlayerId, line: ActivationLine): { event: string; card: string; controller: PlayerId; args: Record<string, string> }[] {
  const kw = line.keyword;
  if (!kw) return [];
  const from = findCard(state, line.card)?.zone ?? "";
  // One per name the move is announced under: [Union], and [Union-Absorb] for
  // an Absorb (22-13-5) — `keywordMomentNames`.
  return keywordMomentNames(kw, line.skill).map((keyword) => ({ event: "keywordActivated", card: line.card, controller: player, args: { keyword, from } }));
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
