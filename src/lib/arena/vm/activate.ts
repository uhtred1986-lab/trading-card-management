import { sparkingIsValid } from "./validity";
import { requireSkillPayment } from "./skill-payment";
import { fusionIdentityProblem } from "./skill-identity";
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
 *   *A [Counter]* is a skill activation handled outside this declaration: its windows (an attack's,
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
 *   refused as the printed price rather than charged as nothing — except
 *   [Aegis] (#595) and [Swap] (#729), whose stored continuations pay theirs on
 *   the strict action-price host (`vm/aegis-costs.ts`, `vm/swap-costs.ts`).
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
import { counterKindOf, type Area, type Color, type PlayerId, type Requirement, type Skill } from "../types";
import { disjointGroups, disjointPayable } from "./disjoint";
import { HIDEABLE, selectedCount, type Cond, type Op, type Script, type ScriptFrame, type Selector } from "./script";
import type { ActionDef, GameDefinition, KeywordDef } from "../rulesets";
import { attrsOf } from "./cards";
import { activeEnergy, altCostFor, comboPriceOf, cardColors, cardPrice, restingFor, skillOrbs, spendPriceUses, spendSkillCostUses, type BoundAmounts } from "./costs";
import { activationPriceProblem, isFixedUnderHost, taxPowerOnSelf } from "./activation-price-support";
import { skillNegated, skillsNegated, type VmAltCost } from "./effects";
import { RulesetBroken } from "./errors";
import { log } from "./events";
import { moved } from "./flow";
import { attrsNow, forbiddenBy, grantedLines, hasKeyword, keywordPlayForbiddenBy, keywordPlayTaxes, namedCandidates, permissions, resolveRef, resolveSelector, staticsNow, taxesOn, type TaxInForce } from "./program";
import { describeScript, taxHandNeed } from "./script-schema";
import { predicateOf } from "./filters";
import type { PayerGrant } from "./effects";
import { vmHost } from "./host";
import type { VmState } from "./state";
import { keywordAfterProgram, keywordMomentNames, keywordMoveOf, keywordProgram } from "./keyword-do";
import { masterOf, skillsShowing } from "./triggers";
import { replacementChoices } from "./replace";
import { canCombo, coversColors } from "../text/cards";
import { findCard, moveCard } from "./zones";
import { lifeToHandForbidden } from "./life-movement";
import { spendUse, usesLeft } from "./limits";
import type { KeywordCost } from "./keyword-costs";

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
export const ACTIVATION_ZONES = { bond: "battle", sparking: "drop", marker: "unison", hand: "hand", drop: "drop", burst: "deck", spiritBoost: "unison", zDeck: "zDeck", zEnergy: "zEnergy", overRealmWarp: "warp", combo: "combo", energy: "energy" } as const;

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
  for (const shown of showing.skills) {
    const script = showing.scripts.bySkill[shown.index];
    // Blocked records have no native keyword hooks. A valid stored Fusion
    // identity still names a rejected activation, even when its price is
    // unreadable. Restore that identity only for this candidate; the original
    // unsupported script remains attached and canResolve must refuse it.
    const skill: Skill = script?.unsupported.length && script.price?.fusion !== undefined && !fusionIdentityProblem(script, true)
      ? { ...shown, keyword: { name: "Union", variant: "Fusion" } }
      : shown;
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
    // #920 / 9-1-3-2: the Drop is a candidate area only when this
    // non-keyword line's persisted program explicitly takes this card from
    // there. Unrelated lines and keyword moves gain no Drop permission.
    if (findCard(state, card)?.zone === ACTIVATION_ZONES.drop &&
      (keyword || !usableFrom(showing.scripts.bySkill[skill.index]).includes("drop"))) continue;
    // 22-15 widened: the Warp is where nothing is used from, except an [Over
    // Realm] line whose own card's [Permanent] says it "can be activated from
    // its owner's Warp under the same conditions as if it were in your hand"
    // (BT31-150) — a `permit` of `overRealmFromWarp`, read while the card is
    // in the Warp (`vm/effects.ts`). Every other gate is the keyword's own.
    // #1118 / 9-1-3-2: and a non-keyword line whose persisted program takes
    // this card out of the Warp ("place this card from your Warp…", "play this
    // card from your Warp") is used from there — read off the record
    // (`usableFrom`), as the Drop is above, never off the name or the id.
    if (findCard(state, card)?.zone === ACTIVATION_ZONES.overRealmWarp &&
      !(game && keyword?.name === "Over Realm" && overRealmFromWarp(ctx, game, state, card)) &&
      (keyword || !usableFrom(showing.scripts.bySkill[skill.index]).includes("warp"))) continue;
    // BT19-077/078/081/082: a Z-Energy card's own [Evolve] line, when its [Permanent] says it "can also be
    // activated from your Z-Energy". Phrasing batch 2: and a printed line the card's own text ties to the
    // Z-Energy (`usedHere`, BT19-048, BT24-018). Everything else printed there stays inert.
    const zone = findCard(state, card)?.zone;
    if (zone === ACTIVATION_ZONES.zEnergy) {
      const evolveLine = !showing.scripts.bySkill[skill.index]?.price?.evolution && !!game && keyword?.name === "Evolve" && evolveFromZEnergy(ctx, game, state, card);
      if (!evolveLine && (keyword || !usedHere(showing.scripts.bySkill[skill.index], "zEnergy"))) continue;
    }
    // Phrasing batch 2 (9-1-3-1 "unless otherwise specified", 9-1-3-2): the Combo Area and the Energy Area are
    // where a printed line is used from only when the card's own text says the card there uses it (`usedHere`):
    // "…if … this card is in a Combo Area: …" (BT23-016, P-710), "Place this card in its owner's Drop Area from
    // your Combo Area: …" (EX19-12), "You may place this card in its owner's Drop Area from your energy" (EX17-05).
    // A Combo Area holds cards only during a battle (21-4-2), so its lines come at the combo prompt.
    if ((zone === ACTIVATION_ZONES.combo || zone === ACTIVATION_ZONES.energy) && (keyword || !usedHere(showing.scripts.bySkill[skill.index], zone))) continue;
    out.push({ card, skillIndex: skill.index, skill, script: showing.scripts.bySkill[skill.index], kind, ...(keyword ? { keyword } : {}) });
  }
  // #930, P-360: a line this card in hand has been granted ("Red <Gogeta: Br>
  // cards in your hand gain the following skill: [Union-Fusion]…") is a move of
  // the keyword like a printed one. It has no record of its own — the keyword's
  // `DO` is all its effect — and its energy is the orbs it prints.
  if (game) {
    for (const skill of grantedLines(ctx, game, state, card)) {
      const keyword = keywordMoveOf(game, skill);
      if (!keyword || !families.has(familyOf(keyword.offer as string))) continue;
      out.push({ card, skillIndex: skill.index, skill, script: { kind: skill.kind, ops: [], unsupported: [], price: skill.price, usage: skill.usage as import("./usage").UsageRecord, validity: skill.validity as import("./validity").ValidityRecord }, kind: keyword.offer as string, keyword });
    }
  }
  return out;
}

/** 22-5-2 widened (BT19-077/078/081/082): does a `permit` of `evolveFromZEnergy` stand for this card, which is in its master's Z-Energy? */
function evolveFromZEnergy(ctx: EngineContext, game: GameDefinition, state: VmState, card: string): boolean {
  return permissions(ctx, game, state, "evolveFromZEnergy").some((p) => p.target === card);
}

/** 22-15 widened (BT31-150): does a `permit` of `overRealmFromWarp` stand for this card, which is in the Warp? The legacy `overRealmFromWarp`'s twin. */
function overRealmFromWarp(ctx: EngineContext, game: GameDefinition, state: VmState, card: string): boolean {
  return permissions(ctx, game, state, "overRealmFromWarp").some((p) => p.target === card);
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
  const payment = requireSkillPayment(line.script?.price);
  const own = skillOrbs(ctx, game, state, line.card, sk, onto, payment);
  const orbs: Partial<Record<Color, number>> = { ...own.orbs };
  let total = own.total;
  if (withCardPrice && inHand(state, line.card) && isExtra(ctx, game, state, line.card)) {
    const play = cardPrice(ctx, game, state, line.card);
    total += play.total;
    for (const [colour, n] of Object.entries(play.orbs)) orbs[colour as Color] = (orbs[colour as Color] ?? 0) + (n ?? 0);
  }
  return {
    energy: { total, orbs, either: own.either },
    markers: payment.marker ?? 0,
    // 22-27-2: [Burst X]'s cards, by the pool the declared price takes them out
    // of. Bound to 0 on a line with no tag, so the price asks nothing of it.
    // 22-46-3: a line used from the Z-Deck pays its card's Z-Energy cost, read
    // off the card as a Z-card played from there pays it (16-2) — [Z-Awaken]
    // (#155); bound to 0 everywhere else, so no line in play pays it again.
    pooled: { [ACTIVATION_ZONES.burst]: payment.burst ?? 0, ...(findCard(state, line.card)?.zone === ACTIVATION_ZONES.zDeck ? {} : { [ACTIVATION_ZONES.zEnergy]: 0 }) },
    // 22-43: [Spirit Boost X]'s markers come off the Unison Card, the place
    // `DEFINE COST spiritBoost` names; bound to 0 on a line with no tag.
    markersFrom: { [ACTIVATION_ZONES.spiritBoost]: { n: -(payment.spiritBoost ?? 0), by: "Spirit Boost" } },
    payers: payWithPayers(ctx, game, state, player, line),
    unreadable: chargeablePrice(line) ? null : "the stored skill payment is unreadable",
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
  const frame: ScriptFrame = { ops: [], ip: 0, vars: {}, card: line.card, master: player, skillIndex: line.skillIndex, usage: line.skill.usage as import("./usage").UsageRecord, validity: line.skill.validity as import("./validity").ValidityRecord };
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
  // #742: "you can activate this card's [Activate: Battle] skill from your
  // hand without paying its energy cost" waives the energy cost for that line
  // alone (12-2-2-2) — `for: "activate:battle"`, asked only of such a line,
  // so the card's [Activate: Main] keeps its full price.
  const alt = altCostFor(ctx, game, state, line.card, player, def.alt) ?? (line.skill.kind === "activate:battle" ? altCostFor(ctx, game, state, line.card, player, "activate:battle") : null);
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
  const aegis = line.keyword?.name === "Aegis";
  // 22-30-2 (#595): an [Aegis] line prints nothing after its tag but its skill
  // cost, and its effect is the keyword's own (22-30-5). A record that holds a
  // program of its own drafted that cost as an effect, to run after activation
  // and free when it cannot; it is refused as unread until it is rebuilt.
  if (aegis && line.script?.ops.length) return false;
  const payment = requireSkillPayment(line.script?.price);
  if (!payment.readable) return false;
  const price = line.script!.price!;
  // 4-3-3: an action price is charged by `resolveActivation` (#458) — on a
  // printed line. A keyword's own move runs its `DO` in place of the record
  // and has nowhere to charge one, so it stays refused. [Aegis] is the
  // exception: its stored continuation pays the action after the colour
  // cards and native fee (22-30-3, `vm/aegis-costs.ts`). [Swap] is the other
  // (#729): its stored continuation pays the action after the energy and
  // before the swap (`vm/swap-costs.ts`), on the strict action-price host.
  // [Union-Fusion], [Union-Potara] and the [Evolve] family are the third
  // (#926): their `DO` pays it where it says `payActionPrice`
  // (`vm/keyword-costs.ts`), on the same strict host.
  if (price.ops?.length) return !line.keyword || aegis || !!swapActionPrice(line) || !!keywordActionPrice(line);
  return true;
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
  const payment = requireSkillPayment(line.script?.price);
  const inst = state.cards[card];
  const at = findCard(state, card)?.zone ?? null;
  if (line.script?.price?.potara && at !== line.script.price.potara.activation) before.push({ kind: "zone", card, area: "hand" });
  if (line.script?.price?.absorb && at !== line.script.price.absorb.area) before.push({ kind: "zone", card, area: "battle" });
  if (line.script?.price?.evolution && at !== line.script.price.evolution.activation) before.push({ kind: "zone", card, area: "hand" });

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
  // "You may not activate [EX-Evolve]" (BT4-003): a rule about one keyword skill asks the line's keyword.
  const banned = forbiddenBy(ctx, game, state, "activateSkill", { player, card, skillKind: line.kind, ...(sk.keyword ? { keyword: ("variant" in sk.keyword && typeof sk.keyword.variant === "string" ? sk.keyword.variant : sk.keyword.name) } : {}) });
  if (banned) before.push({ kind: "forbidden", ...banned });
  // #930: a keyword move that plays a card is not offered when 20-14 forbids
  // that play — "you can only play Battle Cards by using [Union-Fusion]"
  // (P-069, P-226) leaves the [Union-Fusion] offered and an [Evolve] or a
  // [Union-Potara] not (`keywordPlayForbiddenBy`).
  const playBanned = banned ? null : keywordPlayForbiddenBy(ctx, game, state, player, card, sk.keyword);
  if (playBanned) before.push({ kind: "forbidden", ...playBanned });
  // Owner ruling 26 Oct 2026 (A4 follow-up, 20-14-1): a keyword move that
  // plays its own card ([Evolve], [Union-Fusion/Potara], [Arrival],
  // [Successor], [Over Realm]) under a play tax nobody can pay on this board
  // — read after the move's printed energy is spent — is not offered, so its
  // own price is never paid for a play that cannot happen. A payable tax is
  // asked by the `play` op; declining it there is a failed play (22-5-7).
  const playTaxes = banned || playBanned ? [] : keywordPlayTaxes(ctx, game, state, player, card, sk.keyword);
  // Owner ruling 26 Oct 2026 (the batch 5 follow-up): on the board the move's
  // whole own price leaves — its energy and the cards it takes ([Union-Fusion]'s
  // materials, [Over Realm]'s Drop Area), `unpaidKeywordPlayTax`.
  const unpaidPlay = playTaxes.length ? unpaidKeywordPlayTax(ctx, game, state, player, card, sk, playTaxes, boundFor(ctx, game, state, player, line).energy?.total ?? 0) : null;
  if (unpaidPlay) before.push({ kind: "forbidden", by: unpaidPlay.by, until: unpaidPlay.until, unless: `you pay, each time: ${describeScript(unpaidPlay.ops).replace(/ other than this card\b/g, " other than the card being played")}` });
  // 20-14-1 (#677): a price on activating that cannot be paid is a ban, named
  // with the price — the legacy `whyNotActivate` asks it at the same place.
  const unpaid = banned ? null : unpaidActivationTaxAfter(ctx, game, state, player, card, activationTaxes(ctx, game, state, player, card, line.kind), boundFor(ctx, game, state, player, line).energy?.total ?? 0);
  if (unpaid) before.push({ kind: "forbidden", by: unpaid.by, until: unpaid.until, unless: `you pay, each time: ${describeScript(unpaid.ops)}` });
  const left = usesLeft(state, player, card, sk);
  if (left === 0) before.push({ kind: "oncePerTurn", what: "skill", ...(sk.limit != null && !sk.oncePerTurn ? { limit: sk.limit } : {}) });
  // 22-6 / 22-31: [Bond X] and [Sparking X] are conditions on using the skill,
  // counted over a pool the game declares.
  if (sk.bond != null && zone(state, player, ACTIVATION_ZONES.bond).length < sk.bond) {
    before.push({ kind: "condition", text: `[Bond ${sk.bond}]: ${sk.bond} or more Battle Cards in play` });
  }
  if (!sparkingIsValid(state, player, sk.validity)) {
    before.push({ kind: "condition", text: `[Sparking ${sk.sparking}]: ${sk.sparking} or more cards in your Drop Area` });
  }
  // 22-27-3: [Burst X] cannot be paid with fewer than X cards in the deck.
  // The price itself is charged by the planner (`DEFINE COST burst`); the
  // shortfall is asked *here*, among the gates, because this is where
  // `whyNotActivate` asks it — beside [Bond] and [Sparking], before the window
  // — and in its words, so the first requirement is the same one on both
  // engines. 22-43's [Spirit Boost], whose payment is a moment sixteen cards
  // answer, is still refused rather than charged (#149).
  if (payment.burst != null && zone(state, player, ACTIVATION_ZONES.burst).length < payment.burst) {
    before.push({ kind: "other", detail: `[Burst ${payment.burst}] needs that many cards in the deck` });
  }
  // 22-43-2: the same for [Spirit Boost X] — a Unison Card with X markers on it
  // — asked here for the same reason, in the legacy words (#157). The price is
  // `DEFINE COST spiritBoost`'s.
  if (payment.spiritBoost != null) {
    const unison = zone(state, player, ACTIVATION_ZONES.spiritBoost)[0];
    if (!unison || (state.cards[unison]?.markers ?? 0) < payment.spiritBoost) before.push({ kind: "other", detail: "[Spirit Boost] needs the markers" });
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
  if (line.keyword && canResolve(line)) before.push(...keywordRefusals());
  else if (sk.keyword) before.push({ kind: "unread", card });
  // 13-4: a marker skill is used in the Unison Area, once a turn, and never
  // below no markers. The last of the three is the price's own and `planCost`
  // words it; the two here are not about the price at all.
  if (payment.marker != null) {
    if (at !== ACTIVATION_ZONES.marker) before.push({ kind: "zone", card, area: ACTIVATION_ZONES.marker as Area });
    if (inst?.usedMarkerSkill) before.push({ kind: "oncePerTurn", what: "marker skill" });
  }
  // 9-4: the condition the record hoisted out of the price, asked where the
  // legacy engine asks it — before the energy is counted, so a skill whose
  // condition fails says so rather than "1 short".
  const printedCondition = line.script?.price?.condition ?? null;
  // Phrasing batch 6: "you can activate your Leader's [Awaken] even if your life is at 6 or less" (`awakenLife`) raises
  // the life ceiling of this Leader's [Awaken] condition while it lasts; the rest of the condition is asked as printed.
  const ceiling = printedCondition && line.keyword?.name === "Awaken" ? awakenCeiling(ctx, game, state, player, card) : null;
  const condition = printedCondition && ceiling !== null ? raiseLifeCeiling(printedCondition, ceiling) : printedCondition;
  if (condition && !vmHost(ctx, game, state, []).condHolds({ ops: [], ip: 0, vars: {}, card, master: player }, condition)) {
    before.push({ kind: "condition", text: sk.cost });
  }
  // 4-3-3: an action price that cannot be paid on this board, asked where the
  // legacy `whyNotActivate` asks it — after the condition, before the energy —
  // and in its words (#458).
  const priceOps = actionPriceOf(line);
  if (priceOps && !canPayPriceProgram(ctx, game, state, player, card, priceOps, payment.orbs)) before.push({ kind: "other", detail: `cannot pay: ${sk.cost}` });

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

/**
 * Phrasing batch 6: the highest life ceiling an `awakenLife` permission of this player's gives this Leader's [Awaken]
 * ("…even if your life is at 6 or less": 6; "…even if you have 5 or more life": 99, none), or null for none in force.
 */
function awakenCeiling(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string): number | null {
  const lifted = permissions(ctx, game, state, "awakenLife").filter((p) => p.master === player && p.target === card);
  return lifted.length ? Math.max(...lifted.map((p) => p.n ?? 99)) : null;
}

/** The condition with every ceiling on your own life raised to `n` (dropped at 99), and nothing else changed. */
function raiseLifeCeiling(c: Cond, n: number): Cond {
  if (c.kind === "all" || c.kind === "any") return { ...c, conds: c.conds.map((x) => raiseLifeCeiling(x, n)) };
  if (c.kind !== "life" || (c.side ?? "you") !== "you" || c.atMost === undefined) return c;
  if (n >= 99) {
    const { atMost: _atMost, ...rest } = c;
    void _atMost;
    return rest.atLeast === undefined ? { kind: "life", side: "you", atLeast: 0 } : rest;
  }
  return { ...c, atMost: Math.max(c.atMost, n) };
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

/**
 * Phrasing batch 2: is this line used by its card while the card is in `area`
 * — an area 9-1-3-1 gives no skills to (the Combo Area, the Energy Area, the
 * Z-Energy) — because the card's own text says so? Either the line's price or
 * effect takes this card out of that area (`usableFrom`, 9-1-3-2), or the
 * condition its price states asks that this card be there ("…and this card is
 * in a Combo Area", "…this card is in your Z-Energy", 9-1-3-1's "unless
 * otherwise specified"). Read off the record, never the text.
 */
export function usedHere(script: Script | undefined, area: Area): boolean {
  if (!script) return false;
  if (usableFrom(script).includes(area)) return true;
  const asksSelfHere = (cond: Cond | null | undefined): boolean =>
    !!cond && (cond.kind === "all" ? cond.conds.some(asksSelfHere) : cond.kind === "count" && "special" in cond.sel && cond.sel.special === "self" && cond.sel.area === area && (cond.atLeast ?? 0) >= 1 && cond.atMost === undefined);
  return asksSelfHere(script.price?.condition);
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
const canResolve = (line: ActivationLine): boolean => !!line.script && line.script.unsupported.length === 0;

/**
 * 22-3-3 (#907, BT10-052): "activate {Tragedy Overground}" said by another card's
 * skill is the activation of that Extra's [Field] skill — not a play of the
 * card. The line it activates, or `null` when this card has none that can be
 * activated now.
 *
 * Wherever the card lies (the text names the places: "from your hand, Drop
 * Area, deck, or Energy Area"): the selector that found it is the caller's,
 * and `activationsOf` is not asked, since it leaves a keyword's move in the
 * Drop out of the menu — a menu is about what a player may *offer*, this is a
 * card's skill naming one. The printed price is waived (12-2-4), as for
 * `invokedMainLines`; the gates that are not a price are not: negated skills,
 * a prohibition on activating (20-14), a tax that cannot be paid.
 *
 * `null` is a card with no [Field] skill at all (the caller plays it, as the
 * text always read); `"blocked"` is one that has the skill and may not
 * activate it now, which must not fall back to a play.
 */
export function fieldLineOf(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string): ActivationLine | "blocked" | null {
  const inst = state.cards[card];
  if (!inst || inst.owner !== player || inst.hidden || !isExtra(ctx, game, state, card)) return null;
  const showing = skillsShowing(ctx, state, card);
  for (const skill of showing.skills) {
    const keyword = keywordMoveOf(game, skill);
    if (keyword?.name !== "Field") continue;
    if (skillsNegated(state, card) || skillNegated(state, card, skill.index, skill.kind) || forbiddenBy(ctx, game, state, "activateSkill", { player, card, skillKind: skill.kind })) return "blocked";
    const line: ActivationLine = { card, skillIndex: skill.index, skill, script: showing.scripts.bySkill[skill.index], kind: keyword.offer as string, keyword };
    if (unpaidActivationTax(ctx, game, state, player, card, activationTaxes(ctx, game, state, player, card, line.kind))) return "blocked";
    if (usesLeft(state, player, card, skill) === 0 || !sparkingIsValid(state, player, skill.validity)) return "blocked";
    return line;
  }
  return null;
}

/** SD7-01: choose an Extra's real Main line, retaining every non-price activation gate. */
export function invokedMainLines(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string, op: Extract<Op, { op: "invokeSkill" }>): ActivationLine[] {
  if (op.from !== "hand" || findCard(state, card)?.zone !== "hand" || state.cards[card]?.owner !== player || !isExtra(ctx, game, state, card)) return [];
  if ("sel" in op) {
    const frame: ScriptFrame = { ops: [], ip: 0, vars: {}, card, master: player };
    if (!resolveSelector(ctx, game, state, frame, op.sel).includes(card)) return [];
  } else {
    if (op.maxCost !== "currentEnergy") return [];
    const attrs = attrsNow(ctx, game, state, card);
    const traits = attrs.traits;
    const energyCost = attrs.costOf;
    if (!Array.isArray(traits) || !traits.some((trait) => String(trait).toLowerCase() === op.trait.toLowerCase()) || typeof attrs.energyCost !== "number" || typeof energyCost !== "number" || energyCost > zone(state, player, "energy").length) return [];
  }
  const def = game.actions.activate;
  if (!def) return [];
  return activationsOf(ctx, state, def, card, game).filter((line) => {
    const sk = line.skill;
    if (line.kind !== op.skillKind || line.keyword || sk.keyword || !line.script || line.script.unsupported.length || line.script.price?.x || !canResolve(line)) return false;
    if (!requireSkillPayment(line.script.price).readable) return false;
    if (skillsNegated(state, card) || skillNegated(state, card, sk.index, sk.kind) || forbiddenBy(ctx, game, state, "activateSkill", { player, card, skillKind: sk.kind })) return false;
    // #677: the printed price is waived (12-2-4); an external 20-14 tax is
    // not, so an Extra whose tax cannot be paid is not eligible at all.
    if (unpaidActivationTax(ctx, game, state, player, card, activationTaxes(ctx, game, state, player, card, line.kind))) return false;
    if (usesLeft(state, player, card, sk) === 0) return false;
    if (sk.bond != null && zone(state, player, ACTIVATION_ZONES.bond).length < sk.bond) return false;
    if (!sparkingIsValid(state, player, sk.validity)) return false;
    const condition = line.script.price?.condition;
    return !condition || vmHost(ctx, game, state, []).condHolds({ ops: [], ip: 0, vars: {}, card, master: player }, condition);
  });
}

/**
 * #677, 20-14-1: "your opponent can't activate skills unless they …" — every
 * price in force on this player activating this line of this card, in the
 * order the rules are read: the `activateSkill` rules, then (for a [Counter])
 * the `activateCounter` ones, each matched against the line's kind
 * (`skillKind`) and the area the card was used from (`from`, once an Extra
 * has gone on to the Drop). `counted` reads the rules whose free uses are not
 * spent yet instead, which an activation's gate records as owing nothing.
 */
export function activationTaxes(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string, skillKind?: string, from?: string, counted = false): TaxInForce[] {
  const opts = { player, card, ...(skillKind === undefined ? {} : { skillKind }), ...(from === undefined ? {} : { from }), counted };
  const out = taxesOn(ctx, game, state, "activateSkill", opts);
  if (skillKind !== undefined && counterKindOf(skillKind)) out.push(...taxesOn(ctx, game, state, "activateCounter", opts));
  return out;
}

/**
 * The first of these taxes the player cannot pay, or null when the set can be
 * paid whole: each on its own (`canPayPriceProgram`), and the hand cards they
 * take between them (`taxHandNeed`) out of a hand the activating card is not
 * counted in. A null answer is what lets the activation be offered at all.
 */
export function unpaidActivationTax(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string, taxes: TaxInForce[]): TaxInForce | null {
  const single = taxes.find((t) => !canPayPriceProgram(ctx, game, state, player, card, t.ops));
  if (single) return single;
  if (taxes.length > 1) {
    const hand = zone(state, player, ACTIVATION_ZONES.hand).filter((id) => id !== card).length;
    if (taxHandNeed(taxes.map((t) => t.ops)) > hand) return taxes[taxes.length - 1];
  }
  return null;
}

/**
 * #677: the same question on the board the activation's printed energy will
 * leave — `energy` of the player's Active Mode energy rested first, on a copy
 * — since the prices are charged after it. "Unless they switch 1 of their
 * energy to Rest Mode" (BT10-097) on an Extra that takes the last Active
 * energy is a price that cannot be paid, so the Extra is not offered rather
 * than failing once its energy is spent.
 */
export function unpaidActivationTaxAfter(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string, taxes: TaxInForce[], energy: number): TaxInForce | null {
  if (!taxes.length) return null;
  if (energy <= 0) return unpaidActivationTax(ctx, game, state, player, card, taxes);
  const copy = structuredClone(state);
  for (const id of activeEnergy(game, copy, player).slice(0, energy)) copy.cards[id].mode = "rest";
  return unpaidActivationTax(ctx, game, copy, player, card, taxes);
}

/** Enough of the keyword's own payments to look through — a hand rarely holds more than a dozen cards, so this is never reached in play. */
const KEYWORD_OUTLAYS_MAX = 128;

/**
 * Owner ruling of 26 Oct 2026, the batch 5 follow-up (20-14-1, 22-5-7): a
 * keyword that plays its own card under a play tax is judged on the board its
 * **whole** own price leaves — the energy (`energy`, rested first as in
 * `unpaidActivationTaxAfter`), and the cards the keyword itself takes
 * (`keywordOutlays`): [Revive]'s colour cards and [Union-Fusion]'s two
 * materials out of the hand, [Over Realm]'s Drop Area into the Warp. A tax
 * one of those payments still leaves payable is payable — the player picks
 * the payment — and only when every way of paying the keyword leaves it
 * unpayable is the keyword refused, naming that tax. A keyword with nothing
 * of its own to pay but energy is `unpaidActivationTaxAfter`.
 */
export function unpaidKeywordPlayTax(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string, skill: Skill, taxes: TaxInForce[], energy: number): TaxInForce | null {
  if (!taxes.length) return null;
  const board = structuredClone(state);
  for (const id of activeEnergy(game, board, player).slice(0, energy)) board.cards[id].mode = "rest";
  const outlays = keywordOutlays(ctx, game, board, player, card, skill);
  if (!outlays?.length) return unpaidActivationTax(ctx, game, board, player, card, taxes);
  let first: TaxInForce | null = null;
  for (const outlay of outlays.slice(0, KEYWORD_OUTLAYS_MAX)) {
    const after = structuredClone(board);
    for (const { id, to } of outlay) moveCard(after, game, id, to, { owner: after.cards[id].owner });
    const unpaid = unpaidActivationTax(ctx, game, after, player, card, taxes);
    if (!unpaid) return null;
    first ??= unpaid;
  }
  return first;
}

/**
 * The ways a keyword that plays its own card can pay what it takes besides
 * energy, each as the moves it makes (`unpaidKeywordPlayTax`). `null` is a
 * keyword that takes nothing else ([Evolve], [Arrival], [Union-Potara]: its
 * materials stay in play, under the card), or a payment this reading does not
 * model — [Successor]'s Battle Cards, a [Union-Fusion] widened to other areas
 * by a [Permanent] — which is then judged on the energy alone, as before.
 * An empty list is a keyword that cannot be paid at all; its own `REFUSE`
 * says so.
 */
function keywordOutlays(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string, skill: Skill): { id: string; to: string }[][] | null {
  const kw = skill.keyword as { name?: string; variant?: string; colors?: Color[] } | undefined;
  if (!kw?.name) return null;
  const hand = zone(state, player, ACTIVATION_ZONES.hand).filter((id) => id !== card);
  const toDrop = (ids: string[]) => ids.map((id) => ({ id, to: ACTIVATION_ZONES.drop as string }));
  // 22-34-3: [Revive] drops up to two hand cards whose original colours cover both it names.
  if (kw.name === "Revive") {
    const colors = kw.colors ?? [];
    if (!colors.length) return null;
    const original = (id: string): string[] => { const v = attrsNow(ctx, game, state, id).originalColors; return Array.isArray(v) ? v.map(String) : []; };
    const useful = hand.filter((id) => original(id).some((c) => (colors as string[]).includes(c)));
    const out: string[][] = [];
    for (const [i, a] of useful.entries()) {
      if (coversColors([original(a)], colors)) out.push([a]);
      for (const b of useful.slice(i + 1)) if (coversColors([original(a), original(b)], colors)) out.push([a, b]);
    }
    return out.map(toDrop);
  }
  // 22-15: [Over Realm] sends the whole Drop Area to the Warp as its cost.
  if (kw.name === "Over Realm") return [zone(state, player, ACTIVATION_ZONES.drop).map((id) => ({ id, to: ACTIVATION_ZONES.overRealmWarp as string }))];
  // 22-13-4-2: [Union-Fusion] drops one hand card per named character, of one printed power.
  if (kw.name === "Union" && kw.variant === "Fusion") {
    const frame: ScriptFrame = { ops: [], ip: 0, vars: {}, card, master: player, skillIndex: skill.index };
    const host = vmHost(ctx, game, state, []);
    if ((["unionFusionAreas", "unionFusionWarp", "unionFusionDropBottom"] as const).some((what) => host.condHolds(frame, { kind: "permits", what }))) return null;
    const sel: Selector = { side: "you", area: "hand", notSelf: "card" };
    const out: string[][] = [];
    for (const a of namedCandidates(ctx, game, state, frame, sel, [])) {
      for (const b of namedCandidates(ctx, game, state, frame, sel, [a])) if (b !== a && !out.some((p) => p.includes(a) && p.includes(b))) out.push([a, b]);
    }
    return out.map(toDrop);
  }
  return null;
}

/**
 * #677: where an activation's 20-14 prices are charged — a frame with no
 * program of its own, put in front of what it guards (the activation's own
 * price and effect, an [Auto]'s or a [Counter]'s activation), stored with the
 * game so a reload resumes it.
 *
 * Each time it reaches the front it reads the prices **live** (`activationTaxes`
 * on the board as it now is): the first one not yet charged (`paid`, by the
 * rule's stable key) is put in front of it, in the payer's frame, and the gate
 * waits behind it to look again. So a rule whose source leaves before its
 * price is reached is not charged, one newly in force is, and none is charged
 * twice. A price already being paid when its rule ends is finished — it was
 * owed when it began. `free` holds the rules whose counted free use this
 * activation spent (20-14's "one more"), which owe nothing for it.
 *
 * Nothing left to charge: the gate is spent and what it guards runs. Prices
 * left that can no longer be paid whole: 20-14-1 ("if action B is not taken
 * … action A can't be … taken") with 5-8-4 — the activation fails, the
 * `guards` frames behind the gate are dropped, what was paid stays paid, and a
 * [Counter] still in the hand goes to the Drop (22-10-7-1).
 */
export interface TaxGate {
  player: PlayerId;
  card: string;
  skillKind: string;
  /** The area the card was used from, read at the declaration. */
  from?: string;
  paid: string[];
  free: string[];
  /** How many frames behind the gate are the activation it guards. */
  guards: number;
  /** A [Counter]: failing sends the card from the hand to the Drop. */
  counter?: true;
}

/**
 * The gate for an activation being declared, read before anything is paid or
 * moved and before a counted use is spent — or null when no price is in force
 * on it. The caller has already refused an activation whose prices cannot be
 * paid whole (`unpaidActivationTax`).
 */
export function activationTaxGate(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string, skillKind: string): Omit<TaxGate, "guards"> | null {
  const from = findCard(state, card)?.zone;
  if (!activationTaxes(ctx, game, state, player, card, skillKind, from).length) return null;
  const free = activationTaxes(ctx, game, state, player, card, skillKind, from, true).map((t) => t.key);
  return { player, card, skillKind, ...(from === undefined ? {} : { from }), paid: [], free };
}

/** Put the gate in front of the `guards` frames the activation has just queued. */
export function queueTaxGate(state: VmState, gate: Omit<TaxGate, "guards">, guards: number, counter = false): void {
  state.programs.unshift({ ops: [], ip: 0, vars: {}, card: gate.card, master: gate.player, taxGate: { ...gate, guards, ...(counter ? { counter: true as const } : {}) } });
}

/** One look of the gate at the front of the queue (`vm/flow.ts`'s runner); the frame is already off the queue. */
export function stepTaxGate(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame): "done" {
  const gate = frame.taxGate!;
  const owed = activationTaxes(ctx, game, state, gate.player, gate.card, gate.skillKind, gate.from).filter((t) => !gate.paid.includes(t.key) && !gate.free.includes(t.key));
  if (!owed.length) return "done";
  if (unpaidActivationTax(ctx, game, state, gate.player, gate.card, owed)) {
    state.programs.splice(0, gate.guards);
    if (gate.counter && state.sides[gate.player].zones[ACTIVATION_ZONES.hand]?.includes(gate.card)) moved(ctx, game, state, ev, gate.card, ACTIVATION_ZONES.drop, { owner: gate.player, reveal: true });
    log(ev, { type: "note", text: "The skill's activation failed: a price a rule puts on it (20-14-1) can no longer be paid" });
    return "done";
  }
  gate.paid.push(owed[0].key);
  state.programs.unshift({ ops: owed[0].ops, ip: 0, vars: {}, card: gate.card, master: gate.player }, frame);
  return "done";
}

// ── taking one ──────────────────────────────────────────────────────────────

/**
 * Use the line: mark it used, send an Extra on its way, announce it and put the
 * record's program on the queue.
 *
 * The price is **already charged** when this is reached — `applyDeclared` takes
 * it before anything here runs, which is the order #148 settled and the order a
 * replay depends on. What is left is the part that is not a price:
 *
 *   *22-11-2 / 22-44-3* the use itself — on the copy for a [Once per turn]
 *   line, on its master across every copy for a [Limit X] line
 *   (`vm/limits.ts`, #741) — and 13-4's lock on a second marker skill.
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
export function resolveActivation(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], player: PlayerId, line: ActivationLine, x?: number, onto?: string, resolved?: Pick<ScriptFrame, "ops" | "vars">, waived = false): void {
  const { card, skill: sk } = line;
  const payment = requireSkillPayment(line.script?.price);
  const inst = state.cards[card];
  if (!inst) throw new RulesetBroken(state.game, `there is no card ${card} to use a skill of`);
  // Capture the rule's trigger at the successful activation boundary, before
  // an Extra leaves the hand or its effect can alter keywords in force.
  const afterSkillKeywords: ("Heroic" | "Villainous")[] = isExtra(ctx, game, state, card)
    ? (["Heroic", "Villainous"] as const).filter((name) => hasKeyword(ctx, game, state, card, name))
    : [];
  const deferredFusion = !waived && isFusionPayment(line);
  if (!deferredFusion) spendUse(state, player, card, sk);
  if (!deferredFusion && (payment.marker != null || (line.keyword && isMarkerSkill(line.keyword)))) inst.usedMarkerSkill = true;
  // The price is charged (`vm/actions.ts`, before this): a one-use change to
  // the line's own orbs ("the next time you activate …", BT31-096) is spent.
  if (!waived && !deferredFusion) {
    spendSkillCostUses(ctx, game, state, ev, card, sk);
    // An Extra used from the hand pays its energy cost with the line (12-2-2):
    // "the next time you activate it, reduce the energy cost by {g}" is spent here.
    if (!line.keyword && findCard(state, card)?.zone === ACTIVATION_ZONES.hand && isExtra(ctx, game, state, card)) spendPriceUses(state, ev, card);
  }
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
  const priceOps = waived ? null : actionPriceOf(line);
  // #926: a [Union]/[Evolve] move with an action price is announced, and its
  // moments fired, once its `DO` has paid it (`vm/keyword-costs.ts`) — read
  // now, while "from: hand" is still true.
  const keywordPrice: KeywordCost | null = !waived && (keywordActionPrice(line) || deferredFusion)
    ? { ...(deferredFusion ? { fusion: { stage: "resources" as const } } : {}), key: `${card}:${sk.index}`, line, moments: [activationMoment(ctx, game, state, player, line), ...keywordActivationMoments(state, player, line)] }
    : null;
  if (!announcesBeforePrice(line) && !priceOps && !keywordPrice) announce(state, ev, player, line);
  // A keyword's own move runs the keyword's `DO` — the keyword's rules are the
  // effect (22-1), and the record of a line like "[Overlord]" says nothing —
  // and then whatever effect the line prints beyond the keyword, which is
  // [Union-Absorb]'s whole effect ("its text says which card is played onto
  // this one", 22-13-6) and nothing at all on a bare [Evolve] or [Overlord].
  // `AFTER` (#155) is the keyword's last word, after that printed effect:
  // [Wish]'s flip of the Leader (22-25-4).
  const program = resolved?.ops ?? (line.keyword ? [...keywordProgram(game, line.keyword, sk), ...(line.script?.ops ?? []), ...keywordAfterProgram(game, line.keyword, sk)] : (line.script?.ops ?? []));
  // 20-5: the X the price was paid at is what the effect reads as `X`.
  // EX03-16: an [Evolve]'s base named with the activation is the keyword's
  // `base` already chosen — `keywords.rules`' Evolve asks only when it is not.
  if (keywordPrice && !saysWhereItPays(program)) throw new RulesetBroken(state.game, `DEFINE KEYWORD ${line.keyword?.name} has an action price to pay and no payActionPrice to pay it at`);
  const effect: ScriptFrame = { ...(line.script?.price?.potara ? { potaraIdentity: { kind: line.script.kind, price: structuredClone(line.script.price) }, potaraSourceEpoch: state.cards[card].zoneEpoch ?? 0 } : {}), ...(line.script?.price?.absorb ? { absorbIdentity: { kind: line.script.kind, price: structuredClone(line.script.price), ops: structuredClone(line.script.ops) }, absorbSourceEpoch: state.cards[card].zoneEpoch ?? 0 } : {}), ...(line.script?.price?.evolution ? { evolutionIdentity: { kind: line.script.kind, price: structuredClone(line.script.price) }, evolutionSourceEpoch: state.cards[card].zoneEpoch ?? 0 } : {}), ...(line.script?.price?.fusion ? { fusionIdentity: { kind: line.script.kind, price: structuredClone(line.script.price) }, fusionSourceEpoch: state.cards[card].zoneEpoch ?? 0 } : {}), ops: program, ip: 0, vars: { ...resolved?.vars, ...(onto === undefined ? {} : { base: [onto] }) }, card, master: player, ...(line.keyword ? { viaKeyword: line.keyword.name } : {}), ...(inst.enteredUsing ? { selfEnteredUsing: inst.enteredUsing } : {}), skillIndex: sk.index, usage: sk.usage as import("./usage").UsageRecord, validity: sk.validity as import("./validity").ValidityRecord, ...(afterSkillKeywords.length ? { afterSkillSource: card, afterSkillKeywords } : {}), ...(x === undefined ? {} : { x }), ...(keywordPrice ? { keywordPrice } : {}) };
  if (priceOps) {
    // 4-3-3: the action price is paid on activation, as a program of its own in
    // front of the effect — the legacy `activate`'s `saveVarsAs` frame — and
    // what it chose ("the chosen card") is handed on under one key. The effect
    // frame is queued even when it does nothing, because it is what is
    // announced when the price is paid.
    const key = costVarsKey(card, sk.index);
    state.programs.unshift({ ops: priceOps, ip: 0, vars: {}, card, master: player, skillIndex: sk.index, usage: sk.usage as import("./usage").UsageRecord, validity: sk.validity as import("./validity").ValidityRecord, saveVarsAs: key }, { ...effect, pricedBy: { key, text: sk.raw } });
    return;
  }
  if (program.length || afterSkillKeywords.length) state.programs.unshift(effect);
}

/**
 * Phrasing batch 3 (owner's ruling of 26 Oct 2026 on BT24-096): a price that rests Active Mode cards it chooses, the
 * energy among them — "{y}{y}, if you switch 5 yellow cards to Rest Mode" — competes with the printed cost, which is
 * paid first and rests energy of its own (4-3-3). A rested card pays neither twice (5-8-2-2), so the choice is
 * payable only if `n` candidates are left once the orbs are paid: each coloured orb is paid off energy the choice does
 * not want when there is such energy of its colour, and the generic ones off whatever such energy is left; the rest
 * come out of the candidates.
 */
function restedEnoughBesideOrbs(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, payable: string[], orbs: Record<string, number>, n: number): boolean {
  const energy = zone(state, player, ACTIVATION_ZONES.energy).filter((id) => state.cards[id]?.mode === "active");
  const wanted = new Set(payable);
  if (!energy.some((id) => wanted.has(id))) return true;
  const spare = energy.filter((id) => !wanted.has(id));
  let reserved = 0;
  for (const [colour, count] of Object.entries(orbs)) {
    if (colour === "any" || !count) continue;
    const ofColour = spare.filter((id) => ((attrsNow(ctx, game, state, id).colors ?? []) as string[]).includes(colour));
    const fromSpare = Math.min(count, ofColour.length);
    for (const id of ofColour.slice(0, fromSpare)) spare.splice(spare.indexOf(id), 1);
    reserved += count - fromSpare;
  }
  reserved += Math.max(0, (orbs.any ?? 0) - spare.length);
  const fromEnergy = payable.filter((id) => energy.includes(id)).length;
  return payable.length - fromEnergy + Math.max(0, fromEnergy - reserved) >= n;
}

/** Where a line's action price leaves what it chose for the effect — the legacy key, word for word. */
const costVarsKey = (card: string, skillIndex: number) => `costvars:${card}:${skillIndex}`;

/**
 * The action price (4-3-3) this line charges, or null: the record's price
 * program. Display wording never decides whether the recorded action is paid.
 * A keyword's own move pays its action at the point declared in its DO.
 */
function actionPriceOf(line: ActivationLine): Script["ops"] | null {
  if (line.keyword) return null;
  requireSkillPayment(line.script?.price);
  const ops = line.script?.price?.ops;
  return ops?.length ? ops : null;
}

/**
 * #729 (22-22-2, 4-3-3): the action a [Swap] line prints before its colon —
 * BT4-079's "{y}, choose 1 card from your hand and place it in your Drop
 * Area" — read off the record, or null for a [Swap] whose price is orbs and
 * conditions alone, and for every other line. It is not `actionPriceOf`'s:
 * a keyword's own move has no printed effect to charge it in front of, so it
 * is paid by its own stored continuation (`vm/swap-costs.ts`) on the strict
 * action-price host, after the energy and before the keyword's `DO`.
 */
export function swapActionPrice(line: Pick<ActivationLine, "keyword" | "script">): Op[] | null {
  if (line.keyword?.name !== "Swap") return null;
  const ops = line.script?.price?.ops;
  return ops?.length ? ops : null;
}

/**
 * #926 (22-13-4-4-1, 22-13-5-2, 22-5-3, 4-3-3): the action a [Union-Fusion],
 * [Union-Potara] or [Evolve]-family move prints before its colon — BT11-013's
 * "{r}{r}{r}, draw 2 cards", BT13-024's "{r}{r}{r}, draw 1 card" — read off
 * the record, or null for a move whose price is orbs and conditions alone, and
 * for every other line. Paid by the strict frame the keyword's `DO` puts in
 * front of itself where it says `payActionPrice` (`vm/keyword-costs.ts`).
 * #930: [Union-Absorb] is one too: its line is "cost : effect" (22-13-6-1) and
 * its `DO` pays the cost (BT3-070's "choose 1 each of <Android 14> and
 * <Android 15> from your Drop Area and place them under this card") first.
 */
export function keywordActionPrice(line: Pick<ActivationLine, "keyword" | "script" | "skill">): Op[] | null {
  const name = line.keyword?.name;
  const printed = line.skill.keyword;
  const variant = printed && printed.name === name && "variant" in printed ? printed.variant : undefined;
  if (name !== "Evolve" && !(name === "Union" && (variant === "Fusion" || variant === "Potara" || variant === "Absorb"))) return null;
  const ops = line.script?.price?.ops;
  return ops?.length ? ops : null;
}

/** Fusion determines every remaining resource cost only after its material payment. */
export function isFusionPayment(line: Pick<ActivationLine, "skill" | "keyword">): boolean {
  return line.keyword?.name === "Union" && line.skill.keyword?.name === "Union" && line.skill.keyword.variant === "Fusion";
}

/** Does this program say where an action price is paid? A keyword whose `DO` never says `payActionPrice` would play the line free. */
function saysWhereItPays(ops: Op[]): boolean {
  return ops.some((op) => op.op === "payActionPrice" || (op.op === "if" && (saysWhereItPays(op.then) || saysWhereItPays(op.else ?? []))));
}

/**
 * 20-14-1 (BT13-030, the rule manual's own example): can this **tax** be paid
 * right now? `canPayPriceProgram`, with one more step a tax may take that an
 * activation's price planner does not: lowering the acting card's own power
 * ("…unless they give the attacking card -5000 power for the turn each
 * time"). A tax is run as a frame of its own, where that step is an ordinary
 * `power` op, and it can always be taken while the card is in play.
 */
export function canPayTaxProgram(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string, ops: Script["ops"]): boolean {
  const rest = ops.filter((o) => !taxPowerOnSelf(o));
  return rest.length === ops.length ? canPayPriceProgram(ctx, game, state, player, card, ops) : !rest.length || canPayPriceProgram(ctx, game, state, player, card, rest);
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
export function canPayPriceProgram(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string, ops: Script["ops"], orbs?: Record<string, number>): boolean {
  if (activationPriceProblem(ops)) return false;
  const frame: ScriptFrame = { ops: [], ip: 0, vars: {}, card, master: player };
  const hand = zone(state, player, ACTIVATION_ZONES.hand);
  // The activating card leaves the hand as part of the activation (12-2-2),
  // so it is not also there to be discarded.
  const inHand = hand.includes(card) ? 1 : 0;
  // #970: choices that must pick different cards are paid or not as a set — a
  // matching over their candidates, never each slot against the whole pool.
  /**
   * #1117 (5-12-1, 5-8-2-2): a KO paid as a price must really happen, so only a
   * Battle Card that nothing forbids KO'ing and no compulsory replacement
   * takes elsewhere is on offer — the interpreter's `ko` would otherwise skip
   * the card and the price would go unpaid after it was taken.
   */
  const koable = (id: string): boolean => {
    const at = findCard(state, id);
    if (!at || at.zone !== "battle") return false;
    if (forbiddenBy(ctx, game, state, "beKOd", { card: id }) || forbiddenBy(ctx, game, state, "beKOdBySkill", { player, card: id, source: card })) return false;
    if (hasKeyword(ctx, game, state, id, "Indestructible") && masterOf(game, state, id) !== player) return false;
    return replacementChoices(ctx, game, state, id, "ko", { actor: player, requestedTo: "drop" }).every((c) => c.optional);
  };
  /** #1117 (5-7-2): a combo needs a battle with this player in it, a Battle Card with combo cost and power, and no ban. */
  const comboable = (id: string): boolean => {
    const b = state.battle;
    const inst = state.cards[id];
    const def = inst && ctx.defs[inst.cardId];
    return !!b && (masterOf(game, state, b.attacker) === player || masterOf(game, state, b.guard) === player) && !!def && !!findCard(state, id)
      && findCard(state, id)?.zone !== "combo" && canCombo(def, comboPriceOf(game) === null) && !forbiddenBy(ctx, game, state, "combo", { player, card: id });
  };
  /** 20-14, 0-2-5: "You can't send cards from Drop Areas to Warps" (BT6-028) — a price that needs that move can't be paid. */
  const dropToWarpForbidden = (id: string, to: string): boolean => to === "warp" && findCard(state, id)?.zone === "drop" && !!forbiddenBy(ctx, game, state, "dropToWarp", { player, card: id });
  const movementPayable = (id: string, variable: string): boolean => {
    const movement = ops.find((o) => o.op === "moveTo" && "var" in o.target && o.target.var === variable);
    if (ops.some((o) => o.op === "ko" && "var" in o.target && o.target.var === variable) && !koable(id)) return false;
    if (ops.some((o) => o.op === "comboFrom" && "var" in o.target && o.target.var === variable) && !comboable(id)) return false;
    return movement?.op !== "moveTo" || (!lifeToHandForbidden(ctx, game, state, findCard(state, id)?.owner ?? state.cards[id].owner, findCard(state, id)?.zone ?? null, movement.to, undefined, id) && !dropToWarpForbidden(id, movement.to));
  };
  // 23-2 (placeOnTop): once the price has put a card from this card's pile on top of it, this card is under that
  // card, so a later choice of the same price can no longer pick it.
  const toppedAt = ops.findIndex((o) => o.op === "placeOnTop");
  const stillThere = (id: string, variable: string): boolean => id !== card || toppedAt < 0 || ops.findIndex((o) => o.op === "choose" && o.as === variable) < toppedAt;
  if (!disjointPayable(ops, (slot) => resolveSelector(ctx, game, state, frame, slot.sel).filter(id => movementPayable(id, slot.as) && stillThere(id, slot.as)))) return false;
  const linked = new Set(disjointGroups(ops).flat());
  for (const [at, op] of ops.entries()) {
    switch (op.op) {
      case "choose": {
        if (linked.has(at)) break;
        // "Up to" can always be paid with nothing (5-2-4).
        if (op.sel.upTo) break;
        // 5-8-2-2: a chosen card the price then switches pays only if it is
        // not in that mode already — "by switching 1 Hidden Mode card in your
        // Battle Area to Rest Mode" (BT28-138) is not paid by a rested one.
        const then = ops.find((o) => (o.op === "switchMode" || o.op === "hidden") && "target" in o && o.target && "var" in o.target && o.target.var === op.as);
        const switches = (id: string) =>
          !then ? true : then.op === "switchMode" ? state.cards[id].mode !== then.mode : then.op === "hidden" ? state.cards[id].hidden !== then.hidden : true;
        const payable = resolveSelector(ctx, game, state, frame, op.sel).filter(switches).filter(id => movementPayable(id, op.as) && stillThere(id, op.as));
        if (selectedCount(op.sel, payable, (id) => String(attrsNow(ctx, game, state, id).name ?? id), undefined, (id) => { const c = attrsNow(ctx, game, state, id).characters; return Array.isArray(c) ? c.map(String) : []; }) < (op.sel.minCount ?? op.sel.count ?? 1)) return false;
        // Phrasing batch 4 (owner's approval of 26 Oct 2026): the same for every exact choice whose cards must be in
        // Active Mode when it is made — rested by the price ("switch … to Rest Mode", BT24-096) or chosen as Active
        // Mode cards ("choose 2 of your energy in Active Mode …") — since the orbs, paid first, rest energy of their own.
        const needsActive = (then?.op === "switchMode" && then.mode === "rest") || op.sel.mode === "active";
        if (orbs && needsActive && !restedEnoughBesideOrbs(ctx, game, state, player, payable, orbs, op.sel.minCount ?? op.sel.count ?? 1)) return false;
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
        // "Play" is not an area (3-1).
        if (op.to === "play") return false;
        // #1096 (23-2): "under" needs a host, and the price supplies one — the
        // card an earlier `choose` of the same price binds. It is payable when
        // that choice has a card that holds piles (23-2-1: the Leader, Battle,
        // Combo and Unison Areas) other than the card going under it, and a
        // card to go there: this card (never a Leader, 3-1-2) or one the price
        // chose. Nothing else is promised, so a move that cannot happen is
        // never counted as paid.
        if (op.to === "under") {
          const earlier = ops.slice(0, at);
          const chosen = (v: string) => earlier.find((o): o is Extract<typeof o, { op: "choose" }> => o.op === "choose" && o.as === v);
          // No `under`: the host is this card (`script.ts` moveTo), which must stand in an area that holds piles.
          // A fixed host (owner decision 25 Oct 2026: "under your Leader Card", EX20-04, EX25-28) is the one card it names.
          const hostChoice = op.under && "var" in op.under ? chosen(op.under.var) : undefined;
          const fixedHost = op.under && isFixedUnderHost(op.under) ? resolveRef(ctx, game, state, frame, op.under) : undefined;
          if (op.under && !hostChoice && !fixedHost) return false;
          const hosts = (hostChoice ? resolveSelector(ctx, game, state, frame, hostChoice.sel) : fixedHost ?? [card]).filter((id) => game.zones[findCard(state, id)?.zone ?? ""]?.host === true);
          const movedChoice = "var" in op.target ? chosen(op.target.var) : undefined;
          if (!("var" in op.target) ? op.target.sel.special !== "self" : !movedChoice) return false;
          const moving = movedChoice
            ? resolveSelector(ctx, game, state, frame, movedChoice.sel)
            : state.cards[card] && findCard(state, card) ? [card] : [];
          if (!moving.some((m) => findCard(state, m)?.zone !== "leader" && hosts.some((h) => h !== m))) return false;
          break;
        }
        if ("var" in op.target) break;
        if (!resolveRef(ctx, game, state, frame, op.target).length || resolveRef(ctx, game, state, frame, op.target).some(id => lifeToHandForbidden(ctx, game, state, findCard(state, id)?.owner ?? state.cards[id].owner, findCard(state, id)?.zone ?? null, op.to) || dropToWarpForbidden(id, op.to))) return false;
        break;
      // #1117 (owner ruling 20 Oct 2026): a KO or a combo of a card the price chose was narrowed by its own
      // choice above; one of this card needs this card to be fit for it.
      case "ko":
        if (!("var" in op.target) && !koable(card)) return false;
        break;
      case "comboFrom":
        if (!("var" in op.target) && !comboable(card)) return false;
        break;
      // 23-2, 21-5-2: "place a Z-Extra from under this card on top of this card". The pile card was counted by
      // its own choice above (this card's pile); this card must stand where a pile is kept, never a Leader Area.
      case "placeOnTop": {
        const where = findCard(state, card)?.zone;
        if (!where || where === "leader" || game.zones[where]?.host !== true) return false;
        break;
      }
      // The payer picks which matching card is shown; the cards stay where they are (20-11-2). An Extra used
      // from the hand is in the Drop by the time its price is paid, so it is not one of the cards it can show.
      case "reveal": {
        if (op.sel.upTo) break;
        // "Choose 1 card in your hand … and reveal it" (EX13-14, #930): a reveal of what an earlier choice of
        // this price bound (the static half checks it is one) was counted by that choice above.
        if (op.sel.fromVar) break;
        const shown = resolveSelector(ctx, game, state, frame, op.sel).filter((id) => id !== card || !inHand || !isExtra(ctx, game, state, card));
        if (selectedCount(op.sel, shown, (id) => String(attrsNow(ctx, game, state, id).name ?? id), undefined, (id) => { const c = attrsNow(ctx, game, state, id).characters; return Array.isArray(c) ? c.map(String) : []; }) < (op.sel.minCount ?? op.sel.count ?? 1)) return false;
        break;
      }
      // "Pay the rest of the price, then shuffle": a shuffle can always be done (the static half keeps it last).
      case "shuffle":
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
 * announced after the price. Aegis also announces after payment: 22-30-3
 * places its hand-color payment before determining the additional price. So
 * does a [Swap] with an action price (#729), which no legacy `case` charges:
 * like a printed line's action price (#458), a [Counter]'s (#716) and
 * [Aegis]'s, it is announced once the whole price is paid, so a price that
 * fails (5-8-4) leaves no skill announced.
 */
export function announcesBeforePrice(line: ActivationLine): boolean {
  return !isFusionPayment(line) && !!line.keyword && line.keyword.name !== "Field" && line.keyword.name !== "Aegis" && !line.script?.ops.length && !swapActionPrice(line) && !keywordActionPrice(line);
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
export function activationMoment(
  ctx: EngineContext,
  game: GameDefinition,
  state: VmState,
  player: PlayerId,
  line: ActivationLine,
): { event: string; card: string; controller: PlayerId; args: Record<string, string | boolean> } {
  return {
    event: "skillActivated",
    card: line.card,
    controller: player,
    // `extra` is 12-1-3's "activating an Extra Card" (`extraActivated`): the
    // card's type, read here for the same reason as `from` — once it is in
    // the Drop it is still an Extra, but nothing else about the moment is.
    args: { kind: familyOf(line.skill.kind), from: findCard(state, line.card)?.zone ?? "", paid: true, extra: isExtra(ctx, game, state, line.card) },
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
