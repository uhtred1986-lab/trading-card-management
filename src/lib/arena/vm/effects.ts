import { sparkingIsValid } from "./validity";
/**
 * What is in force, and for how long.
 *
 * Three kinds of thing outlive the step that made them, and the legacy engine
 * keeps all three on its `GameState`. They are here for the rules engine, in
 * the **same shapes** (`ContinuousEffect`, `DelayedEffect` from
 * `../types.ts`), because `src/lib/arena/effects.ts` is the one place a
 * rule in force becomes a label on the board and it may not learn a second
 * spelling — the `effect` and `effectEnded` events a client draws the surge and
 * the settle from are the same events on both engines, or the board is reading
 * the engine rather than the contract.
 *
 *   **A continuous effect** (9-1-4) is a change that holds for a duration:
 *   +5000 power until the end of the turn, a granted keyword, a negation. It is
 *   stored, expires at its `until`, and says so when it does.
 *
 *   **A delayed effect** (20-15) is a program written down now for a moment
 *   later: "at the end of the turn, KO this card". It waits on `at`, one of the
 *   five `DELAY_TIMINGS`, and on `scope`, which says *which* turn.
 *
 *   **A [Permanent]'s static** (9-5-1) is neither: it is never resolved and
 *   never stored, because it holds only while its card is where its skills are
 *   valid (9-1-3-1). It is *read* every time a value is asked for, which is
 *   what `permanents` does — and the moment the card leaves play the reading
 *   stops finding it, with no expiry to run.
 *
 * **The layers are the declaration's, not this file's.** `attributes.rules`
 * says `layers: [printed, rewrite, numeric]` on `power` and `comboPower`
 * (9-9-1) and `[printed, reduction]`/`[printed, reduction, specified]` on the
 * prices (20-21), and `valueOf` walks exactly that list: the printed face
 * first, then the layer each effect belongs to. A game that declared a fifth
 * layer would need a row in `LAYERS` and nothing else; a game that declared
 * none gets the printed value and nothing else, which is what `id` and `name`
 * want. A layer is a **function** rather than a list of numbers to add,
 * because 20-21-2's floor at zero does not commute with an addition and the
 * coloured half of a price is not a number at all.
 *
 * One approximation, written down because nothing would catch it later:
 * 9-9-1-2 and 9-9-1-3 divide continuous effects by whether they **rewrite a
 * number**, not by where they came from. Every power change this engine makes
 * is an addition, so the sum is the same whichever order the two layers are
 * applied in, and the division used here — a [Permanent]'s standing change in
 * `rewrite`, a resolved skill's timed change in `numeric` — is a reading that
 * happens to give the right answer for every card that exists today. The first
 * "this card's power becomes X" effect makes the order matter, and at that
 * point the layer belongs on the effect rather than on its origin.
 *
 * Pure and client-safe: no database, no network, no `fs`.
 */
import type { EngineContext, GameEvent } from "../types";
import { costModifierAs, modifyAttrAs, negateAs, replaceAs, type Amount, type Cond, type Op, type ScriptFrame } from "./script";
import { redirectOf } from "./common";
import { type AltCost, type Replacement } from "../types";
import type { CardIdentityGain, Color, ContinuousEffect, DelayedEffect, DelayTiming, Immunity, KeywordSkill, Permission, PlayerId, Prohibition, SkillKindPrefix, SkipWhat } from "../types";
import { other as otherPlayer } from "../types";
import type { GameDefinition } from "../rulesets";
import type { CardFilter } from "../text/filters";
import type { AttrValue, Attrs } from "./cards";
import { log } from "./events";
import { skillsShowing } from "./triggers";
import { inPlayZones } from "./zones";
import type { VmState } from "./state";

/** The name on the face a card is showing (1-9): a flipped Leader answers to its awakened name, which is what a "copies of this card" prohibition is matched on. */
function faceName(ctx: EngineContext, state: VmState, id: string): string | undefined {
  const inst = state.cards[id];
  const def = inst ? ctx.defs[inst.cardId] : undefined;
  if (!def) return undefined;
  return inst.flipped && def.back ? def.back.name : def.name;
}

/**
 * 9-1-3-3: the prohibitions a card states **about itself**, read wherever it
 * sits.
 *
 * "This card can't be played from any area except by skills" has to hold in the
 * Drop Area, where no [Permanent] of that card is otherwise valid (9-1-3-1), so
 * these are read apart from `permanents` and by exactly the legacy
 * `ownProhibitions`' three tests: the rule is about `self`, it holds for the
 * game rather than for a duration, and it says which side of "by skills" it is
 * on — the shape only a card's own such sentence has.
 */
export function ownProhibitions(ctx: EngineContext, state: VmState, id: string, measure: (frame: ScriptFrame, amount: Amount) => number, master: PlayerId): Prohibition[] {
  const inst = state.cards[id];
  if (!inst || inst.hidden || skillsNegated(state, id)) return [];
  const showing = skillsShowing(ctx, state, id);
  const out: Prohibition[] = [];
  for (const sk of showing.skills) {
    if (sk.kind !== "permanent" || skillNegated(state, id, sk.index, sk.kind)) continue;
    const program = showing.scripts.bySkill[sk.index];
    if (!program || program.unsupported.length || !sparkingIsValid(state, master, sk.validity)) continue;
    for (const op of program.ops) {
      if (op.op !== "forbid" || op.until !== "game" || (op.bySkill === undefined && op.what !== "play")) continue;
      if (!op.target || !("sel" in op.target) || op.target.sel.special !== "self") continue;
      const frame: ScriptFrame = { ops: [], ip: 0, vars: {}, card: id, master };
      out.push({
        what: op.what,
        ...(op.uses != null ? { uses: measure(frame, op.uses) } : {}),
        ...(op.unless ? { unless: op.unless, master } : {}),
        ...(op.bySkill !== undefined ? { bySkill: op.bySkill } : {}),
        ...(op.exceptEvolve ? { exceptEvolve: true } : {}),
        ...(op.exceptUnion?.length ? { exceptUnion: [...op.exceptUnion] } : {}),
      });
    }
  }
  return out;
}

/** A continuous effect as a program asks for one: the bookkeeping is this module's (9-1-4). */
export type EffectSpec = Omit<ContinuousEffect, "id" | "createdTurn" | "ownerTurn" | "master"> & { master?: PlayerId };

/** A delayed effect as a program asks for one (20-15). */
export type DelaySpec = Omit<DelayedEffect, "id" | "createdTurn">;

/**
 * The coloured half of a price, changed on its own (20-21-2, and the owner's
 * BT19-039 ruling of 9 Sep 2026): the orbs a `costReduction(what: "specified")`
 * relaxes (`sign: 1`) or demands (`sign: -1`). Carried as the printed orbs and
 * never as a bare count, because relaxing blue and relaxing yellow are
 * different changes — the legacy `StaticEffect`'s value shape, word for word,
 * because a continuous effect is one shape on both engines.
 */
export interface SpecifiedChange {
  colors: (Color | "any")[];
  sign: 1 | -1;
  /** No specified cost at all, after every other change ([Warrior of Universe 7], 22-19-2; `costReduction`'s `all`, #154). */
  all?: true;
}

/**
 * One [Permanent]'s standing change, read rather than stored (9-5-1).
 *
 * Still narrower than the legacy engine's `StaticEffect`, but no longer the
 * three kinds a *number* is read through: a price is read through its declared
 * layers like any other attribute, so a cost reduction is one of these too
 * (#148). `kind` is the **attribute or effect kind** the change belongs to and
 * `LAYER_KINDS` is what pairs the two where they differ — a reducer says
 * `cost` and the attribute it discounts is called `costOf`, and the names are
 * the legacy engine's on both sides of that pairing.
 *
 * Three more carry a *price* rather than a value (#148): 20-19's standing
 * payer ("you can use this card to pay energy costs even when it's in your
 * Battle Area", `kind: "payer"`), which `vm/costs.ts`' `payersFor` adds to the
 * pool of every energy price; 5-3's alternative price ("you can play this card
 * from your hand without paying its energy cost", `kind: "altCost"`), which
 * `altCostFor` offers as a second way to make the move; and a change to a
 * skill line's own orbs (`kind: "skillCost"`), which `skillOrbs` reads where
 * the line's price is bound.
 *
 * What a [Permanent] can still say and this cannot carry is a *legality*;
 * `DEFERRED_STATICS` names each with the issue that reads it, because a static
 * quietly collected into a list nothing reads is the dishonest version of a
 * gap.
 */
export interface VmStatic {
  /** The card whose [Permanent] says it. */
  source: string;
  /** Whose skill it is (9-1-2). */
  master: PlayerId;
  /** `replaceLeave` is 9-10's standing offer (`vm/replace.ts`), a [Permanent]'s only — no resolved skill puts one in force for a duration. */
  kind: ContinuousEffect["kind"] | "replaceLeave" | "skip";
  /** The card it is about. */
  target: string;
  value: number | KeywordSkill | KeywordSkill["name"] | CardIdentityGain | SpecifiedChange | Prohibition | PayerGrant | VmAltCost | Immunity | Replacement | StandingSkip | Permission;
  /** `skillCost`: the kind of skill line the change is about ("activate", "counter", …), or every line when absent — the legacy `StaticEffect`'s field. */
  skillKind?: SkillKindPrefix;
  /** `skillCost`: the keyword skill the change is about (`ContinuousEffect.tag`). */
  tag?: string;
  /** `skillCost`: the printed orbs the change takes off (or puts on), in order; `["any"]` for a colourless one. */
  colors?: (Color | "any")[];
  /** `evolveCost` only: the change holds only for an [Evolve] played onto one of these cards (`costReduction`'s `onto`, EX03-16). */
  onto?: string[];
  /** The printed line this static belongs to, used to distinguish simultaneous replacement sources. */
  skillIndex?: number;
  /** One standing keyword grant's stable source/skill/op/target identity. */
  standingGrantId?: string;
}

/**
 * 5-3: another price for a card, as this engine reads one — the shared
 * `AltCost`, and for a `pay: "energy"` price written with `altCost`'s `rest`
 * selector, the cards it found: the only ones that may pay it, rested where
 * they stand ([Invoker], 22-37, #155).
 */
export type VmAltCost = AltCost & { rest?: string[] };

/** 20-13: a step a [Permanent] skips while its condition holds, and whose step it is (`vm/skips.ts`'s `stepSkippedByPermanent`). */
export interface StandingSkip {
  what: SkipWhat;
  player: PlayerId;
}

/** 20-19: what a standing payer counts as while it pays — one energy of its own colours, or of the one colour named. The legacy `StaticEffect`'s value, word for word. */
export interface PayerGrant {
  payAs: "energy" | Color;
  /**
   * The scoped permission (BT28-106): only the skill costs of skills on cards
   * this describes — read by `vm/activate.ts`'s `payWithPayers` for one line,
   * never by `payersFor`'s every-price pool.
   */
  forSkillsOf?: CardFilter;
  /** At most this many of the granted cards on one payment. */
  max?: number;
  /** Spent for the turn when it pays: the [Permanent] line's index goes on its card's `usedThisTurn`. */
  oncePerTurn?: true;
  /** The [Permanent] line saying it, for `oncePerTurn`. */
  skillIndex?: number;
}

/** A negative power effect that actually participates in a 21-6 result. */
export interface PowerReductionSource {
  /** A card skill, when the effect has one. */
  source?: string;
  /** The master of the skill, or the player whose turn created the effect. */
  master: PlayerId;
  /** The signed power change; always negative. */
  value: number;
}

/**
 * The power reductions currently applied to one card. Power layers are
 * additive in the DBS ruleset, so a card at zero or below that returns above
 * zero when these reductions are removed was reduced there by an effect
 * (21-6-2-1). The caller uses the sources for the moved moment and 9-10's
 * actor; a zero printed power with no reduction remains a rule move.
 */
export function powerReductionSources(state: VmState, id: string, standing: VmStatic[]): PowerReductionSource[] {
  const timed = state.effects
    .filter((effect) => effect.kind === "power" && effect.target === id && typeof effect.value === "number" && effect.value < 0)
    .map((effect) => ({ source: effect.source, master: effect.master, value: effect.value as number }));
  const permanent = standing
    .filter((effect) => effect.kind === "power" && effect.target === id && typeof effect.value === "number" && effect.value < 0)
    .map((effect) => ({ source: effect.source, master: effect.master, value: effect.value as number }));
  return [...timed, ...permanent];
}

/** The ops `permanents` reads out of a [Permanent]'s program. */
export const STATIC_OPS = ["power", "comboPower", "modifyAttr", "grant", "gains", "negateKeyword", "costReduction", "forbid", "immune", "payWith", "altCost", "replaceLeave", "replace", "skip", "permit", "if"] as const;

/** Every other op a [Permanent] may carry, and the issue that reads it. A gap named is a gap that can be looked up. */
export const DEFERRED_STATICS: Record<string, string> = {};

/**
 * Which effect `kind` feeds which **layer** of which attribute (20-21).
 *
 * A layer reads the effects whose `kind` is the attribute's own name — which
 * is the whole of the rule for `power` and `comboPower`, and is why neither is
 * listed. A price is the exception, and it is an exception of *naming* rather
 * than of mechanism: the attribute a game declares is `costOf`, the effect a
 * skill puts in force says `cost`, and both names are the legacy engine's,
 * which is what lets one `card_rules` row mean one thing on both. This table is
 * that pairing and nothing else — no layer applies except the one the
 * declaration lists, and an attribute absent from here reads its own name.
 *
 * Checked against the definition at load (`assertCostLayers`), so a layer
 * renamed in `attributes.rules` fails a game rather than quietly reading
 * nothing.
 */
export const LAYER_KINDS: Record<string, Record<string, ContinuousEffect["kind"]>> = {
  costOf: { reduction: "cost" },
  comboCostOf: { reduction: "comboCost" },
  zEnergyCostOf: { reduction: "zEnergy" },
  // 20-21-2: a flat reduction lowers the coloured half as well as the total, so
  // the coloured attribute reads the *same* `cost` effects through its own
  // `reduction` layer; `specified` is the half that moves the colours alone.
  specifiedCost: { reduction: "cost", specified: "specifiedCost" },
  // `keywords` (plural, the names in force) reads `keyword` (singular, what
  // `grant` puts in force) through both layers 9-9-1 gives a non-numeric
  // change: a [Permanent]'s standing grant (rewrite) and a resolved skill's
  // own grant for a duration (numeric) — spec §2.5-1/§2.5-3, #275.
  keywords: { rewrite: "keyword", numeric: "keyword" },
};

/**
 * The attributes and layers `LAYER_KINDS` names, checked against the game that
 * is being loaded.
 *
 * `SETUP_ZONES`, `STEP_WORK` and `PLAY_ZONES` are the same discipline: a
 * constant in `vm/` that names a piece of the DBS definition says so out loud
 * and is held to it, rather than reading nothing on the day the declaration is
 * renamed.
 */
export function costLayerGaps(game: GameDefinition): string[] {
  const out: string[] = [];
  for (const [attr, layers] of Object.entries(LAYER_KINDS)) {
    const declared = game.attributes[attr];
    if (!declared) {
      out.push(`${attr} is an attribute nothing declares, and a price is read off one`);
      continue;
    }
    for (const layer of Object.keys(layers)) {
      if (!declared.layers?.includes(layer)) out.push(`${attr} does not declare the ${JSON.stringify(layer)} layer, so a cost change of that layer would be read by nothing`);
    }
  }
  return out;
}

// ── continuous effects (9-1-4) ──────────────────────────────────────────────

/** Put a continuous effect in force, and say so. The `effect` beat is what a client draws the surge from. */
export function addEffect(state: VmState, ev: GameEvent[], spec: EffectSpec): ContinuousEffect {
  const full: ContinuousEffect = { ...spec, master: spec.master ?? state.turnPlayer, id: state.nextEffect++, createdTurn: state.turn, ownerTurn: state.turnPlayer };
  state.effects.push(full);
  log(ev, { type: "effect", effect: full });
  return full;
}

/** Every effect in force on one card of one kind, in the order they were made (9-9-2). */
export function effectsOn(state: VmState, id: string, kind: ContinuousEffect["kind"]): ContinuousEffect[] {
  return state.effects.filter((e) => e.kind === kind && e.target === id);
}

/**
 * Take effects out of force, saying so.
 *
 * Every one that ends gets an `effectEnded` event — the other end of `effect`,
 * and the beat a board draws the number settling back on. `keep` says which
 * stay, exactly as the legacy `dropEffects` does.
 */
function dropEffects(state: VmState, ev: GameEvent[], keep: (e: ContinuousEffect) => boolean): ContinuousEffect[] {
  const kept: ContinuousEffect[] = [];
  const ended: ContinuousEffect[] = [];
  for (const e of state.effects) {
    if (keep(e)) kept.push(e);
    else {
      ended.push(e);
      log(ev, { type: "effectEnded", effect: e });
    }
  }
  state.effects = kept;
  return ended;
}

/** 7-4-5 / 7-3-5-1-3: every effect of this duration ends, for one player's or for both. */
export function endEffects(state: VmState, ev: GameEvent[], until: ContinuousEffect["until"], forPlayer?: PlayerId): ContinuousEffect[] {
  return dropEffects(state, ev, (e) => !(e.until === until && (forPlayer == null || e.ownerTurn === forPlayer)));
}

/**
 * 7-2-4: the two durations written from the controller's chair.
 *
 * "Until the end of your opponent's turn" and "until the start of your
 * opponent's next turn" are read against the effect's own `master`, never
 * against whose turn it happened to be made on — the legacy
 * `endTurnRelativeEffects`, word for word, because a duration that ended a turn
 * early on one engine and a turn late on the other is the kind of difference
 * `arena:diff` exists to refuse.
 */
export function endTurnRelativeEffects(state: VmState, ev: GameEvent[]): ContinuousEffect[] {
  return dropEffects(state, ev, (e) => {
    if (e.createdTurn >= state.turn) return true;
    if (e.until === "nextTurn") return state.turnPlayer !== e.master;
    if (e.until === "opponentTurn") return state.turnPlayer === e.master;
    return true;
  });
}

/** 3-1-4: a card that changed area is a new card, so nothing that was in force on it still is. */
/**
 * "…will not switch to Active Mode during your next Charge Phase": spent by
 * the Active Step it was written for (7-2-7), on the cards that step covered —
 * the legacy `endAfterChargeEffects`, which this engine had not carried over,
 * so the rule outlived its step (#459, `verify/readings.ts`'s LOCKER case).
 */
export function endAfterChargeEffects(state: VmState, ev: GameEvent[], cards: string[]): ContinuousEffect[] {
  return dropEffects(state, ev, (e) => !(e.until === "afterNextCharge" && cards.includes(e.target)));
}

/**
 * "…until the end of your turn" (`ownTurn`, BT31-043, #930): ends at 7-4-5
 * of a turn whose turn player is the effect's master — the same turn when it
 * was made on the master's own turn, or the master's next turn when it was made
 * on the opponent's. Called beside the "for the turn" expiry.
 */
export function endOwnTurnEffects(state: VmState, ev: GameEvent[]): ContinuousEffect[] {
  return dropEffects(state, ev, (e) => !(e.until === "ownTurn" && e.master === state.turnPlayer));
}

/**
 * "…until the start of your next Main Phase" (`nextMain`, BT13-012, #1163):
 * ends as its master's Main Phase begins on a later turn than the one it was
 * made on — so it holds through the opponent's whole turn and the master's
 * own Charge Phase. Called as a Main Phase begins (or is skipped, 20-13-5);
 * the turn player then is the one whose Main Phase it is.
 */
export function endNextMainEffects(state: VmState, ev: GameEvent[]): ContinuousEffect[] {
  return dropEffects(state, ev, (e) => !(e.until === "nextMain" && e.master === state.turnPlayer && e.createdTurn < state.turn));
}

/** End a source-controller's opponent-Charge restriction after that phase, even when its target changed control. */
export function endAfterOpponentChargeEffects(state: VmState, ev: GameEvent[]): ContinuousEffect[] {
  return dropEffects(state, ev, (e) => !(e.until === "afterOpponentCharge" && e.master !== state.turnPlayer && e.createdTurn < state.turn));
}

/**
 * "…while this card is in a Battle Area" (`whileSourceInPlay`): every effect
 * the card made with that duration ends as the card leaves the Battle Area —
 * the legacy `endSourceEffects`, word for word.
 */
export function endSourceEffects(state: VmState, ev: GameEvent[], source: string): ContinuousEffect[] {
  return dropEffects(state, ev, (e) => !(e.until === "whileSourceInPlay" && e.source === source));
}

export function dropEffectsOn(state: VmState, ev: GameEvent[], id: string): void {
  dropEffects(state, ev, (e) => e.target !== id);
}

// ── delayed effects (20-15) ─────────────────────────────────────────────────

/** Write a program down for a later moment. */
export function schedule(state: VmState, ev: GameEvent[], spec: DelaySpec): DelayedEffect {
  const full: DelayedEffect = { ...spec, id: state.nextEffect++, createdTurn: state.turn };
  state.delayed.push(full);
  log(ev, { type: "delayed", card: spec.card, label: spec.label });
  return full;
}

/** Whether the turn now under way is the one the effect was waiting for. The legacy `ripe`. */
function ripe(state: VmState, d: DelayedEffect): boolean {
  switch (d.scope) {
    case "thisTurn":
      return state.turn === d.createdTurn;
    case "nextTurn":
      return state.turn > d.createdTurn;
    case "yourNextTurn":
      return state.turn > d.createdTurn && state.turnPlayer === d.master;
    // No "later than the turn it was written on" here: an effect scheduled
    // during the opponent's turn — every [Counter] is — means the turn now
    // under way. The side test is the guard.
    case "opponentNextTurn":
      return state.turnPlayer !== d.master;
  }
}

/**
 * Take every effect waiting for this timing off the list, oldest first
 * (4-2-2-2), as the programs that carry them out.
 *
 * The frames come back rather than being run here, because running a program is
 * the runner's business and one of these can stop to ask a question.
 */
export function dueDelays(state: VmState, at: DelayTiming): ScriptFrame[] {
  const ready = state.delayed.filter((d) => d.at === at && ripe(state, d));
  if (!ready.length) return [];
  const ids = new Set(ready.map((d) => d.id));
  state.delayed = state.delayed.filter((d) => !ids.has(d.id));
  return ready.map((d) => ({ ops: d.ops, ip: 0, vars: d.vars, card: d.card, master: d.master, subject: d.subject }));
}

/** An effect scheduled for "this turn" whose moment has gone never happens. Keeps the list from growing over a long game. */
export function expireDelayed(state: VmState): void {
  // Called from `endTurn` (`vm/flow.ts`), *before* the turn number moves on —
  // the legacy engine's call sits after it, which is why its filter keeps the
  // effects made on the turn now starting. Here the turn ending is the one
  // every "this turn" effect was made on, so all of them have missed their
  // moment; keeping `createdTurn === state.turn` kept exactly the ones that
  // should go (#459, `verify/compiler.ts`'s DELAYKO case).
  state.delayed = state.delayed.filter((d) => d.scope !== "thisTurn" || d.createdTurn > state.turn);
}

// ── negation (9-1-5) ────────────────────────────────────────────────────────

/**
 * Are *all* of this card's skills switched off?
 *
 * The legacy engine keeps the for-the-game half as a mark on the instance and
 * the timed half as an effect; here both are effects, because a `VmCard` is the
 * copy on the table and nothing more. One function, and **every reader goes
 * through it** — the [Permanent] walk, the checkpoint, the moment that pends an
 * [Auto] and the host. The bug that made it one function was three readers and
 * two of them checking: a negated card's [Permanent] went on standing while its
 * [Auto]s correctly did not.
 */
export function skillsNegated(state: VmState, id: string): boolean {
  return state.effects.some((e) => e.kind === "negateSkills" && e.target === id);
}

/**
 * Is this one skill of this card switched off (9-1-5)?
 *
 * Three ways, the legacy `skillNegated`'s three: the whole card, this skill by
 * its printed index, and a whole *kind* at once — "negate that card's [Auto]
 * skill for the turn". A printed "[Counter]" covers every counter kind, so the
 * stored value is a prefix of the skill kind rather than the whole of it.
 */
export function skillNegated(state: VmState, id: string, index: number, kind?: string): boolean {
  if (skillsNegated(state, id)) return true;
  if (state.effects.some((e) => e.kind === "negateSkill" && e.target === id && e.value === index)) return true;
  return !!kind && state.effects.some((e) => e.kind === "negateSkillKind" && e.target === id && kind.startsWith(e.value as string));
}

/** Negation of one effect-granted keyword, keyed by its persisted effect ID. */
export function grantedSkillNegated(state: VmState, id: string, grantId: number | string): boolean {
  return skillsNegated(state, id) || state.effects.some((e) => e.kind === "negateGrantedSkill" && e.target === id && (typeof grantId === "number" ? e.value === grantId : typeof e.value === "object" && e.value !== null && "standingGrantId" in e.value && e.value.standingGrantId === grantId));
}

/** The skills of this card that are off, as `stepScript` reads them: `"all"`, or the indexes. */
export function negatedSkillsOf(state: VmState, id: string): "all" | number[] {
  if (skillsNegated(state, id)) return "all";
  return state.effects.filter((e) => e.kind === "negateSkill" && e.target === id).map((e) => e.value as number);
}

// ── [Permanent] statics (9-5, 9-9) ──────────────────────────────────────────

/** A change to a card's identity (traits, characters, colours, names) printed "in all areas" (TB1-095, #936). */
function identityInAllAreas(op: Op): boolean {
  if (op.op === "gains") return op.allAreas === true;
  return op.op === "modifyAttr" && op.allAreas === true && (op.attr === "traits" || op.attr === "characters" || op.attr === "colors" || op.attr === "alsoNames");
}

/**
 * What of a [Permanent] holds while its card lies face down in the Life Area:
 * a `life` replacement about the card itself (it names its `target`), however
 * deep under conditions ("during your opponent's turn, if all of your energy
 * is mono-blue …"), and an identity printed "in all areas". The conditions
 * are kept around it, so they are asked afresh on every reading (9-5-1-1).
 */
function lifeSelfOps(ops: Op[]): Op[] {
  return ops.flatMap((op): Op[] => {
    if (op.op === "replace") return op.event === "life" && op.target ? [op] : [];
    if (op.op === "if") {
      const then = lifeSelfOps(op.then);
      const other = op.else ? lifeSelfOps(op.else) : [];
      return then.length || other.length ? [{ ...op, then, ...(other.length ? { else: other } : {}) }] : [];
    }
    return identityInAllAreas(op) ? [op] : [];
  });
}

/**
 * What a card in a Combo Area can answer: its replacements of a departure from the Combo Area, kept
 * inside the conditions they are printed under ("If your Leader Card is …"), and nothing else of the program.
 */
function comboDepartures(ops: readonly Op[]): Op[] {
  const out: Op[] = [];
  for (const op of ops) {
    if (op.op === "if") {
      const then = comboDepartures(op.then);
      const other = op.else ? comboDepartures(op.else) : [];
      if (then.length || other.length) out.push({ ...op, then, ...(other.length ? { else: other } : {}) });
    } else if ((op.op === "replaceLeave" || (op.op === "replace" && op.event === "leave")) && op.from?.includes("combo")) out.push(op);
  }
  return out;
}

/** The zones `permanents` walks for a game, worked out once (#1009): they are the game definition's, not the board's. */
const zonePlans = new WeakMap<GameDefinition, { inPlay: Set<string>; zones: string[]; walked: string[] }>();
function zonePlan(game: GameDefinition) {
  let plan = zonePlans.get(game);
  if (!plan) {
    const inPlay = new Set(inPlayZones(game));
    const zones = [...inPlay, "hand", "zDeck", "warp", "combo", "life"].filter((zone) => game.zones[zone]?.place !== false);
    const everywhere = Object.keys(game.zones).filter((zone) => !zones.includes(zone) && game.zones[zone]?.place !== false);
    plan = { inPlay, zones, walked: everywhere.length ? [...zones, ...everywhere] : zones };
    zonePlans.set(game, plan);
  }
  return plan;
}

/**
 * Which printed texts can matter outside the zones a [Permanent] normally holds in, read once per
 * printed card (#1009). `permanents` runs on every value asked for, and testing the text of every
 * card of the deck, the Drop and the Life Area with a regex each time cost most of a move.
 */
const printedAreaFlags = new WeakMap<object, { allAreas: boolean; life: boolean; zEnergy: boolean }>();
const NO_AREA_FLAGS = { allAreas: false, life: false, zEnergy: false };
function areaFlags(printed: { skill?: string | null; back?: { skill?: string | null } | null } | undefined): { allAreas: boolean; life: boolean; zEnergy: boolean } {
  if (!printed) return NO_AREA_FLAGS;
  let flags = printedAreaFlags.get(printed);
  if (!flags) {
    const text = `${printed.skill ?? ""} ${printed.back?.skill ?? ""}`;
    const allAreas = /all areas/i.test(text);
    flags = { allAreas, life: allAreas || /this card from your life/i.test(text), zEnergy: /can also be activated from your z-energy/i.test(text) };
    printedAreaFlags.set(printed, flags);
  }
  return flags;
}

/**
 * Every standing change a [Permanent] makes right now.
 *
 * Read, never stored: a [Permanent] is never activated and never resolves
 * (9-5-1), so the only honest way to have one is to look for it whenever a
 * value is asked for. A card in Hidden Mode is no information at all and is
 * skipped (23-5); a card whose skills are negated says nothing (9-1-5).
 *
 * `targets` is the selector resolver, handed in rather than imported, because
 * a static's target is a selector and resolving one asks for a card's value —
 * which asks for the statics again. The caller owns that recursion guard
 * (`vm/program.ts`), the way `computingStatics` owns it on the legacy engine.
 */
export function permanents(
  ctx: EngineContext,
  game: GameDefinition,
  state: VmState,
  targets: (frame: ScriptFrame, op: Op) => string[],
  holds: (frame: ScriptFrame, op: Op) => boolean,
  measure: (frame: ScriptFrame, amount: Amount) => number,
  /** Walk only the programs this accepts — the immunity pass (`vm/program.ts`) skips every [Permanent] that grants none, on a path taken once per candidate of every selector. */
  only?: (ops: Op[]) => boolean,
): VmStatic[] {
  const out: VmStatic[] = [];
  const { inPlay, zones, walked } = zonePlan(game);
  // The Warp only for the one permission about the card's own line used from
  // there (`overRealmFromWarp`, BT31-150) — nothing else a [Permanent] says
  // holds from the Warp, the same as the legacy `staticEffects`; and, in the
  // Warp and everywhere else, the identity a card "gains ... in all areas".
  // The Life Area likewise, for the one [Permanent] a life card prints about
  // itself: "if you would reveal this card from your life to add it to your hand,
  // you may … instead" (BT10-036, BT10-047; 9-1-3-3 — the text names the area it
  // is valid in). Nothing else a life card says holds there.
  // "This card gains ≪Universe 7≫ in all areas" (TB1-095, #936) holds in
  // every area a card can be in, the Drop included — which is where "9 or more
  // ≪Universe 7≫ in your Drop Area" counts it. Looked for in these areas only
  // on a card whose printed text says "all areas", so the Drop's cards cost a
  // string test each.
  const firstExtra = zones.length;
  for (const p of Object.keys(state.sides) as PlayerId[]) {
    for (let zi = 0; zi < walked.length; zi++) {
      const zone = walked[zi];
      const extra = zi >= firstExtra;
      for (const src of state.sides[p].zones[zone] ?? []) {
        const card = state.cards[src];
        if (!card || card.hidden) continue;
        const printed = ctx.defs[card.cardId];
        // The text tests are cached per printed card (#1009), and asked before the negation scan below.
        // BT19-077/078/081/082: a Z-Energy card's one [Permanent], about its own [Evolve] line used from there.
        if (extra && !areaFlags(printed).allAreas && !(zone === "zEnergy" && areaFlags(printed).zEnergy)) continue;
        // A life card is looked at only when it prints a rule about itself in the Life Area (a life card is read on every statics pass).
        if (zone === "life" && !areaFlags(printed).life) continue;
        if (skillsNegated(state, src)) continue;
        const showing = skillsShowing(ctx, state, src);
        const overRealm = showing.skills.some((sk) => sk.keyword?.name === "Over Realm");
        if (zone === "warp" && !overRealm && !showing.skills.some((sk) => sk.kind === "permanent")) continue;
        for (const sk of showing.skills) {
          // An [Auto] that prints a replacement of its card's own departure from the Combo Area (BT12-071, "…: When this card would be placed in its owner's Drop Area from a Combo Area, you may play it instead") never fires, and stands in the Combo Area like a [Permanent]: only that replacement of it is read, below.
          if (sk.kind !== "permanent" && !(sk.kind === "auto" && zone === "combo")) continue;
          if (skillNegated(state, src, sk.index, sk.kind)) continue;
          // 22-26 / 22-21: a [Sparking X] or [Bond X] [Permanent] is valid only
          // while its master has the count — BT5-023's "[Permanent][Sparking 5]
          // …adding a card from your life to your hand instead of paying its
          // energy cost" offered nothing before #716 let its [Counter] be
          // offered at all. The same zones `vm/activate.ts` counts.
          const program = showing.scripts.bySkill[sk.index];
          if (!program || program.unsupported.length || (only && !only(program.ops))) continue;
          if (!sparkingIsValid(state, p, sk.validity)) continue;
          if (sk.bond != null && (state.sides[p].zones.battle ?? []).length < sk.bond) continue;
          const ops = extra ? program.ops.filter((op) => identityInAllAreas(op) || (zone === "zEnergy" && op.op === "permit" && op.what === "evolveFromZEnergy"))
            : zone === "life" ? lifeSelfOps(program.ops)
            : zone === "warp" ? program.ops.filter((op) => (overRealm && op.op === "permit" && op.what === "overRealmFromWarp") || identityInAllAreas(op))
            : zone === "combo" ? comboDepartures(program.ops) : program.ops;
          if (!ops.length) continue;
          collect(ctx, state, out, { ops: [], ip: 0, vars: {}, card: src, master: p, skillIndex: sk.index }, ops, inPlay.has(zone), targets, holds, measure);
        }
      }
    }
    // #1119: a card in a pile is in no zone (23-2), so the walk above never meets it. Its
    // [Permanent] counts only where its record asks for the card to be under another one, and only
    // while the card holding the pile stands in play and shows its face.
    for (const zone of inPlay) {
      for (const host of state.sides[p].zones[zone] ?? []) {
        const hostCard = state.cards[host];
        if (!hostCard?.under.length || hostCard.hidden) continue;
        for (const src of hostCard.under) {
          const card = state.cards[src];
          if (!card || card.hidden || skillsNegated(state, src)) continue;
          const showing = skillsShowing(ctx, state, src);
          for (const sk of showing.skills) {
            if (sk.kind !== "permanent" || skillNegated(state, src, sk.index, sk.kind)) continue;
            const program = showing.scripts.bySkill[sk.index];
            if (!program || program.unsupported.length || (only && !only(program.ops))) continue;
            if (!sparkingIsValid(state, p, sk.validity)) continue;
            if (sk.bond != null && (state.sides[p].zones.battle ?? []).length < sk.bond) continue;
            const ops = pileOps(program.ops);
            if (!ops.length) continue;
            collect(ctx, state, out, { ops: [], ip: 0, vars: {}, card: src, master: p, skillIndex: sk.index }, ops, true, targets, holds, measure);
          }
        }
      }
    }
  }
  return out;
}

/**
 * Does this condition hold only while the card carrying it is under another card? The compiler
 * reads "when this card is under a card" / "this card is under a white <Cell> card" as a count of
 * the `onTop` selector (the card whose pile holds this one, 23-2-2-2), so that is what is looked
 * for, in the record and never in a card's name. `all` needs one such part; `any` and `not` never
 * count, since either can hold with the card in no pile.
 */
function requiresPile(cond: Cond): boolean {
  if (cond.kind === "count") return cond.sel.special === "onTop" && (cond.atLeast ?? 1) >= 1;
  if (cond.kind === "all") return cond.conds.some(requiresPile);
  return false;
}

/** A standing grant, power change, attribute change or identity gain whose every target is selected by `special: "onTop"`. */
function reachesOnlyOnTop(op: Op): boolean {
  if (op.op !== "grant" && op.op !== "power" && op.op !== "modifyAttr" && op.op !== "gains") return false;
  const t = op.target;
  return !!t && "sel" in t && t.sel.special === "onTop";
}

const pileOpsCache =new WeakMap<Op[], Op[]>();
/**
 * What of a [Permanent]'s program works from the pile under a card (#1119): the branches reached
 * only through a condition that asks for the card to be under another (BT3-050 f20, BT31-130 f10),
 * kept inside every condition around them. A program with no such branch gives `[]`, so an
 * ordinary [Permanent] on a buried card never starts to apply (9-1-3-1: a skill is valid only in the
 * area its text names).
 */
function pileOps(ops: Op[]): Op[] {
  const cached = pileOpsCache.get(ops);
  if (cached) return cached;
  const out: Op[] = [];
  for (const op of ops) {
    // A stored row may carry the under-condition nowhere but in the target itself: a bare grant to
    // `onTop` (BT3-050 f20 as stored). `onTop` is the one card whose pile holds this one, so such an
    // op reaches nothing else and is safe to take from a pile.
    if (op.op !== "if") {
      if (reachesOnlyOnTop(op)) out.push(op);
      continue;
    }
    if (requiresPile(op.cond)) {
      // The `else` of a pile condition is where the card is *not* under one, so it is dropped.
      const { else: _dropped, ...rest } = op;
      void _dropped;
      out.push(rest);
    } else {
      const then = pileOps(op.then);
      const other = op.else ? pileOps(op.else) : [];
      if (then.length || other.length) out.push({ ...op, then, ...(other.length ? { else: other } : {}) });
    }
  }
  pileOpsCache.set(ops, out);
  return out;
}

/**
 * A keyword's `altPayment` bodies (#154), walked exactly as a [Permanent]'s
 * program is — the contract's "a query hook body is an always-on [Permanent]
 * its keyword grants for free" (`docs/arena-ruleset-spec.md` §4.1), for the
 * one hook whose answer is a change to *other* cards' prices rather than a
 * fact about its own card. Each body comes with the card in play that carries
 * the keyword; the caller (`vm/program.ts`'s `statics`) finds them, because
 * finding a keyword in force asks for the statics too.
 */
export function keywordStatics(
  ctx: EngineContext,
  state: VmState,
  bodies: { card: string; master: PlayerId; ops: Op[] }[],
  targets: (frame: ScriptFrame, op: Op) => string[],
  holds: (frame: ScriptFrame, op: Op) => boolean,
  measure: (frame: ScriptFrame, amount: Amount) => number,
): VmStatic[] {
  const out: VmStatic[] = [];
  for (const b of bodies) collect(ctx, state, out, { ops: [], ip: 0, vars: {}, card: b.card, master: b.master }, b.ops, true, targets, holds, measure);
  return out;
}

/** One [Permanent]'s program, walked for the standing changes a value is read through. */
function collect(
  ctx: EngineContext,
  state: VmState,
  out: VmStatic[],
  frame: ScriptFrame,
  ops: Op[],
  inPlayNow: boolean,
  targets: (frame: ScriptFrame, op: Op) => string[],
  holds: (frame: ScriptFrame, op: Op) => boolean,
  measure: (frame: ScriptFrame, amount: Amount) => number,
  path = "",
): void {
  // A `negate` (#276), a `costModifier` (#277) or a `modifyAttr` widening
  // (spec §2.5-1/§2.5-3, #275) is walked as the spelling it stands for, the
  // same as `collectStatics` on the legacy engine — so a `negateKeyword`
  // written as the primitive reaches the static negation layer below,
  // `modifyAttr(attr: keywords, …)` reads as the `grant` case below, and
  // list-attribute `modifyAttr` shares the `gains` layer.
  for (const [index, op] of ops.map((o) => replaceAs(costModifierAs(negateAs(modifyAttrAs(o))))).entries()) {
    if (op.op === "if") {
      // A [Permanent] under a condition holds only while the condition does
      // (9-5-1-1), so the branch is taken afresh on every reading.
      if (holds(frame, op)) collect(ctx, state, out, frame, op.then, inPlayNow, targets, holds, measure, `${path}${index}t/`);
      else if (op.else) collect(ctx, state, out, frame, op.else, inPlayNow, targets, holds, measure, `${path}${index}f/`);
      continue;
    }
    // 20-14: a prohibition printed as a [Permanent] holds for as long as the
    // card is where its skills are valid (9-1-3-1), which for this one is the
    // table — so it is read here and never stored, with no duration to expire.
    // A rule about *cards* carries its own target; one about a *player* carries
    // no target and the filter says which cards it is about.
    if (op.op === "forbid") {
      if (!inPlayNow) continue;
      const player = op.side && op.side !== "both" ? (op.side === "opponent" ? otherPlayer(frame.master) : frame.master) : undefined;
      const uses = op.uses != null ? measure(frame, op.uses) : undefined;
      // The escape clause is a sentence of *this* card, so it records whose
      // card it is: "you" and "your opponent" in it are read from that chair
      // and not from the chair of whoever is trying to act.
      // #1005: "…can only attack this card" — read as the cards it names, now.
      const attackOnly = op.attackOnly ? targets(frame, { ...op, target: op.attackOnly }) : undefined;
      const forbid: Prohibition = { what: op.what, ...(op.attackTarget ? { attackTarget: op.attackTarget } : {}), ...(attackOnly ? { attackOnly } : {}), ...(uses != null ? { uses } : {}), ...(op.unless ? { unless: op.unless, master: frame.master } : {}), ...(op.unlessPay?.length ? { pay: op.unlessPay } : {}), ...(op.byTypes?.length ? { byTypes: op.byTypes } : {}), ...(op.turnPlayer ? { turnPlayer: true } : {}), ...(op.counterKind ? { counterKind: op.counterKind } : {}), ...(op.otherCards ? { otherCards: true } : {}), ...(op.extraCardActivation ? { extraCardActivation: true } : {}), ...(op.exceptEvolve ? { exceptEvolve: true } : {}), ...(op.exceptUnion?.length ? { exceptUnion: [...op.exceptUnion] } : {}), player, bySkill: op.bySkill };
      if (op.target) {
        for (const id of targets(frame, op)) out.push({ source: frame.card, master: frame.master, kind: "forbid", target: id, value: forbid });
      } else {
        const name = op.sameNameAsSelf ? faceName(ctx, state, frame.card) : undefined;
        out.push({ source: frame.card, master: frame.master, kind: "forbid", target: "", value: { ...forbid, filter: op.filter, name } });
      }
      continue;
    }
    // 9-1-4: a card no skill may touch, printed as a [Permanent] on most of
    // the cards that have it — stored the way `forbid` is, in play only, with
    // `op.until` unused for the same reason. Whose skills it blocks is the
    // rule's own (`from`, a player; absent for "non-<Gogeta: GT> skills",
    // which names no side) and `immunityRefusing` (`vm/program.ts`) asks it
    // of every chooser — the legacy `collectStatics`' reading, word for word.
    if (op.op === "immune") {
      if (!inPlayNow) continue;
      const value: Immunity = {
        ...(op.from && op.from !== "both" ? { from: op.from === "opponent" ? otherPlayer(frame.master) : frame.master } : {}),
        ...(op.fromFilter ? { fromFilter: op.fromFilter } : {}),
      };
      for (const id of op.target ? targets(frame, op) : [frame.card]) out.push({ source: frame.card, master: frame.master, kind: "immune", target: id, value });
      continue;
    }
    // 9-1-3-1: a change to a card's power or keywords holds only while its
    // source is in play — "Your Battle Cards get +5000 power" does nothing
    // from the hand. The legacy `collectStatics`' `if (!inPlayNow) continue`
    // before these three, which this walk had not carried over: an aura in
    // hand raised every Battle Card (#459, `verify/compiler.ts`'s AURA case).
    if (
      !inPlayNow &&
      (op.op === "power" || op.op === "comboPower" || op.op === "grant" || op.op === "negateKeyword" ||
        (op.op === "modifyAttr" && (op.attr === "power" || op.attr === "comboPower" || op.attr === "keywords" || ((op.attr === "traits" || op.attr === "characters" || op.attr === "colors" || op.attr === "alsoNames") && !op.allAreas))) ||
        (op.op === "gains" && !op.allAreas))
    ) continue;
    if (op.op === "power" || op.op === "comboPower") {
      // "+3000 power for each marker on this card": the same two counted amounts
      // the cost reduction below takes — a [Permanent] binds no variable, so
      // only a count over the board can be read.
      const value = typeof op.amount === "number" ? op.amount : "count" in op.amount || "markers" in op.amount ? measure(frame, op.amount) : null;
      if (value == null) continue;
      for (const id of targets(frame, op)) out.push({ source: frame.card, master: frame.master, kind: op.op, target: id, value });
      continue;
    }
    if (op.op === "modifyAttr") {
      // §2.3 of the ruleset spec: the primitive `power`/`comboPower` are
      // spellings of, so it makes the same standing change.
      if (op.attr === "power" || op.attr === "comboPower") {
        if (typeof op.amount !== "number") continue;
        for (const id of targets(frame, op)) out.push({ source: frame.card, master: frame.master, kind: op.attr, target: id, value: op.amount });
        continue;
      }
      if (op.attr === "traits" || op.attr === "characters" || op.attr === "colors" || op.attr === "alsoNames") {
        const values = op.values ?? [];
        const value: CardIdentityGain = {
          traits: op.attr === "traits" ? values : [],
          characters: op.attr === "characters" ? values : [],
          colors: op.attr === "colors" ? values as Color[] : [],
          names: op.attr === "alsoNames" ? values : [],
        };
        for (const id of targets(frame, op)) out.push({ source: frame.card, master: frame.master, kind: "gains", target: id, value });
      }
      continue;
    }
    if (op.op === "grant") {
      for (const id of targets(frame, op)) out.push({ source: frame.card, master: frame.master, kind: "keyword", target: id, value: op.keyword, ...(frame.skillIndex === undefined ? {} : { standingGrantId: `${frame.card}:${state.cards[frame.card]?.zoneEpoch ?? 0}:${state.cards[frame.card]?.flipped ? "back" : "front"}:${frame.skillIndex}:${path}${index}:${id}:${state.cards[id]?.zoneEpoch ?? 0}` }) });
      continue;
    }
    if (op.op === "gains") {
      const value: CardIdentityGain = { traits: op.traits ?? [], characters: op.characters ?? [], colors: op.colors ?? [], names: op.names ?? [] };
      for (const id of op.target ? targets(frame, op) : [frame.card]) out.push({ source: frame.card, master: frame.master, kind: "gains", target: id, value });
      continue;
    }
    if (op.op === "negateKeyword") {
      for (const id of op.target ? targets(frame, op) : [frame.card]) out.push({ source: frame.card, master: frame.master, kind: "negateKeyword", target: id, value: op.keyword });
      continue;
    }
    // 20-21: the price a card is bought at, standing rather than resolved —
    // "reduce the energy cost of your <Son Goku> cards in your hand by 1". It
    // reaches the price through the attribute layers `LAYER_KINDS` pairs it
    // with, which is why nothing below names a cost field.
    if (op.op === "costReduction") {
      // The coloured half alone, kept as its own kind so the total cannot be
      // moved by it (the owner's BT19-039 ruling). Always a printed list of
      // orbs and never a "for each" count, so the sign is read off the number
      // rather than measured.
      if (op.what === "specified") {
        if (op.all) {
          for (const id of targets(frame, op)) out.push({ source: frame.card, master: frame.master, kind: "specifiedCost", target: id, value: { colors: [], sign: 1, all: true } });
          continue;
        }
        if (!op.colors?.length || typeof op.amount !== "number") continue;
        const sign: 1 | -1 = op.amount < 0 ? -1 : 1;
        for (const id of targets(frame, op)) out.push({ source: frame.card, master: frame.master, kind: "specifiedCost", target: id, value: { colors: op.colors, sign } });
        continue;
      }
      // 4-3-3: an orb price belongs to *one skill line* rather than to the
      // card, so a change to it is no layer of any card attribute — it is
      // collected under the legacy engine's own kind, with the line kind and
      // the orbs it names, and read where the line's price is bound
      // (`vm/costs.ts`' `skillOrbs`, #148). 22-5's [Evolve] price is the
      // same shape on its own channel, `evolveCost` (#157) — the legacy
      // `orbTotals(…, "evolve")` reads it instead of `skillCost` for an
      // [Evolve] line, and `skillOrbs` does the same.
      if (op.what === "skill" || op.what === "evolve") {
        const value = typeof op.amount === "number" ? op.amount : "count" in op.amount || "markers" in op.amount ? measure(frame, op.amount) : null;
        if (value == null) continue;
        const kind = op.what === "evolve" ? "evolveCost" : "skillCost";
        // EX03-16: an [Evolve] price changed only when it is played onto these.
        const onto = kind === "evolveCost" && op.onto ? { onto: targets(frame, { ...op, target: op.onto }) } : {};
        for (const id of targets(frame, op))
          out.push({ source: frame.card, master: frame.master, kind, target: id, value, ...(op.skillKind ? { skillKind: op.skillKind } : {}), ...(op.tag ? { tag: op.tag } : {}), ...(op.colors?.length ? { colors: op.colors } : {}), ...onto });
        continue;
      }
      const kind = op.what === "combo" ? "comboCost" : op.what === "zEnergy" ? "zEnergy" : "cost";
      // "…by 1 for each of your blue Battle Cards" — the same two amounts the
      // power statics take, and for the same reason: a [Permanent] has no frame
      // that ever bound a variable, so only a count over the board can be read.
      const value = typeof op.amount === "number" ? op.amount : "count" in op.amount || "markers" in op.amount ? measure(frame, op.amount) : null;
      if (value == null) continue;
      // 20-21-2: an energy cost reduced "by {r}" keeps the orbs it was said in.
      const named = kind === "cost" && op.colors?.length ? { colors: op.colors } : {};
      for (const id of targets(frame, op)) out.push({ source: frame.card, master: frame.master, kind, target: id, value, ...named });
      continue;
    }
    // 5-3: another price for the card itself — "you can play this card from
    // your hand without paying its energy cost". Read wherever the card is,
    // like a cost reducer, because the hand is where it applies; one granted
    // for a span (`until`) is a resolved skill's continuous effect and is read
    // off `state.effects` instead, since a [Permanent] never resolves and
    // nothing would expire it. The legacy `collectStatics`' reading, word for
    // word, and `altCostFor` is what offers it.
    if (op.op === "altCost") {
      if (op.until) continue;
      // #155: the only cards that may pay a `rest` price, found from the
      // body's own chair as it is read — [Invoker]'s Red/Blue energy.
      const rest = op.pay === "energy" && op.rest ? targets(frame, { ...op, target: { sel: op.rest } }) : null;
      const value: VmAltCost = { pay: op.pay, n: op.n ?? 1, for: op.for ?? "counter", ...(op.ops ? { ops: op.ops } : {}), ...(op.orbs ? { orbs: op.orbs } : {}), ...(rest ? { rest } : {}) };
      for (const id of op.target ? targets(frame, op) : [frame.card]) out.push({ source: frame.card, master: frame.master, kind: "altCost", target: id, value });
      continue;
    }
    // 9-10: a standing offer read when a departure comes (`vm/replace.ts`),
    // only while the card is where its skill is valid — a replacement on a
    // card in the hand has nothing to replace. `replaceLeave` is a redirect;
    // `replace` of a departure (`leave`, `ko`, `life`) is a redirect when its
    // `with` is one move of the card itself and a substitute otherwise, and
    // of the play is not standing at all (it resolves). The legacy
    // `collectStatics`' reading, word for word, under its one kind.
    if (op.op === "replaceLeave") {
      const explicitSource = op.from?.some((zone) => state.sides[frame.master].zones[zone]?.includes(frame.card));
      if (op.from ? !explicitSource : !inPlayNow) continue;
      const to = op.to === "play" ? "battle" : op.to === "under" ? "drop" : op.to;
      const value: Replacement = { to, from: op.from, by: op.by, bySide: op.bySide, mode: op.mode, position: op.position, requestedTo: op.requestedTo, optional: op.optional, ...(frame.skillIndex !== undefined ? { skillIndex: frame.skillIndex } : {}) };
      for (const id of op.target ? targets(frame, op) : [frame.card]) out.push({ source: frame.card, master: frame.master, kind: "replaceLeave", target: id, value: { ...value }, ...(frame.skillIndex !== undefined ? { skillIndex: frame.skillIndex } : {}) });
      continue;
    }
    if (op.op === "replace") {
      const explicitSource = op.from?.some((zone) => state.sides[frame.master].zones[zone]?.includes(frame.card));
      // A `life` replacement that names a `target` (the card itself) is about
      // the life card that prints it: "if you would reveal this card from your
      // life to add it to your hand…" (BT10-036, 9-1-3-3). It is valid while
      // that card lies in the Life Area, and only there.
      const lifeSelf = op.event === "life" && !!op.target;
      if (op.event === "play" || (lifeSelf ? !state.sides[frame.master].zones.life?.includes(frame.card) : op.from ? !explicitSource : !inPlayNow)) continue;
      const isLife = op.event === "life";
      // 13-5-2: a marker loss is never a redirect — the marker is not a card
      // that could go anywhere else — so its `with` is always the substitute.
      const isMarker = op.event === "marker";
      const redirect = isMarker ? null : redirectOf(op.with);
      const by = op.event === "ko" ? ("ko" as const) : isLife || isMarker || op.by === "attack" ? undefined : op.by;
      const lifeFields = isLife ? { kind: "life" as const, ...(op.to ? { lifeTo: op.to } : {}), ...(lifeSelf ? { lifeSelf: true as const } : {}) } : isMarker ? { kind: "marker" as const } : {};
      const value: Replacement = redirect
        ? { to: redirect.to, from: op.from, by, bySide: op.bySide, mode: redirect.mode, position: redirect.position, optional: op.optional, ...lifeFields }
        : { from: op.from, by, bySide: op.bySide, optional: op.optional, ops: op.with, source: frame.card, master: frame.master, ...lifeFields, ...(frame.skillIndex !== undefined ? { skillIndex: frame.skillIndex } : {}) };
      for (const id of op.target && !lifeSelf ? targets(frame, op) : [frame.card]) out.push({ source: frame.card, master: frame.master, kind: "replaceLeave", target: id, value: { ...value } });
      continue;
    }
    // 8-1-1 / 5-7 lifted as a standing rule: "this card can attack Battle
    // Cards in Active Mode", "you can use your mono-red Rest Mode ≪Saiyan≫
    // cards in combos" (BT18-001). In play only, like every [Permanent] —
    // except `fieldBattle` (BT29-041/-042), which is about the [Field] line
    // used from the hand (22-3) and so is read there, as `altCost` is, and
    // `overRealmFromWarp` (BT31-150), which is about the card's own
    // [Over Realm] line used from the Warp and so is read there.
    // `evolveEnergyBases` is this hand copy's own Evolve permission; the
    // `permits` condition additionally enforces that source and exact copy;
    // unionFusionWarp is scoped by condHolds to this card's Fusion from hand.
    if (op.op === "permit") {
      if (!inPlayNow && op.what !== "fieldBattle" && op.what !== "overRealmFromWarp" && op.what !== "evolveEnergyBases" && op.what !== "evolveFromZEnergy" && op.what !== "unionFusionWarp" && op.what !== "unionFusionDropBottom" && op.what !== "unionEnergy" && op.what !== "unionSourceOpponentBattle" && op.what !== "playInOpponentBattle") continue;
      const value: Permission = { what: op.what, ...(op.filter ? { filter: op.filter } : {}), ...(op.line ? { line: op.line } : {}), ...(op.unionVariant ? { unionVariant: op.unionVariant } : {}), ...(op.price ? { price: op.price } : {}), ...(op.source ? { source: op.source } : {}), ...(op.n !== undefined ? { n: op.n } : {}) };
      for (const id of targets(frame, op)) out.push({ source: frame.card, master: frame.master, kind: "permit", target: id, value });
      continue;
    }
    // 20-19: a card that may be rested in the Energy Area's place, for every
    // energy price rather than for one (BT3-039). 9-1-3-1 separates it from
    // `altCost` above: a card can only be *rested* to pay where it stands on
    // the table, so it is read in play only. `payersFor` is what adds it.
    if (op.op === "payWith") {
      if (op.until || !inPlayNow) continue;
      const scope: Partial<PayerGrant> = op.forSkillsOf
        ? { forSkillsOf: op.forSkillsOf, ...(op.max ? { max: op.max } : {}), ...(op.oncePerTurn ? { oncePerTurn: true as const } : {}), ...(frame.skillIndex !== undefined ? { skillIndex: frame.skillIndex } : {}) }
        : {};
      const value: PayerGrant = { payAs: op.as ?? "energy", ...scope };
      for (const id of op.target ? targets(frame, op) : [frame.card]) out.push({ source: frame.card, master: frame.master, kind: "payer", target: id, value });
      continue;
    }
    // 20-13 printed as a [Permanent] (#278): "when this card is in a battle,
    // you skip your Offense Step" — a standing rule the step itself asks
    // (`vm/skips.ts`), in play only, never spent. The legacy
    // `collectStatics`' reading, word for word.
    if (op.op === "skip") {
      if (!inPlayNow) continue;
      const players = op.side === "both" ? [frame.master, otherPlayer(frame.master)] : [op.side === "opponent" ? otherPlayer(frame.master) : frame.master];
      for (const player of players) out.push({ source: frame.card, master: frame.master, kind: "skip", target: "", value: { what: op.what, player } });
    }
  }
}


// ── the layers a value is read through (9-9-1, 20-21) ───────────────────────

/** What a layer is handed: the value so far, the standing changes of its kind, the timed ones, and the card's printed bag for the one fallback that needs it. */
type Layer = (value: AttrValue | undefined, statics: EffectValue[], timed: EffectValue[], attrs: Attrs, name: string) => AttrValue | undefined;

type EffectValue = VmStatic["value"];

/** A cost change that names orbs ("reduce the energy cost by {r}"): the amount and the colours it was said in (20-21-2). */
export interface CostChange {
  by: number;
  colors: (Color | "any")[];
}

/**
 * Numbers added to a number — every change 9-9-1 makes to `power` and
 * `comboPower` — or keyword names unioned into a list, once each, which is
 * every change it makes to `keywords` (spec §2.5-1/§2.5-3, #275). Keyword
 * negations are applied after the layers are combined, because a named skill
 * negation beats both a printed keyword and a grant (9-1-5). One function rather than
 * a branch per attribute, because both are "every change of this kind,
 * folded into the value so far" — a layer picks which by what its own
 * changes actually carry, never by the attribute's name.
 */
function added(value: AttrValue | undefined, changes: EffectValue[]): AttrValue | undefined {
  let out = value;
  for (const add of changes) {
    if (typeof add === "number") out = (typeof out === "number" ? out : 0) + add;
    else if (add && typeof add === "object" && "name" in add) {
      const names = new Set(Array.isArray(out) ? (out as readonly string[]) : []);
      names.add((add as KeywordSkill).name);
      out = [...names];
    }
  }
  return out;
}

/**
 * Which effects belong to which declared layer.
 *
 * A layer no row names contributes nothing, which is what a printed-only
 * attribute wants; a layer this interpreter has no entry for is skipped, which
 * is what an attribute declaring a layer nobody has built yet wants.
 */
const LAYERS: Record<string, Layer> = {
  // 9-9-1-2: the standing changes. Every one this engine makes is additive.
  rewrite: (value, statics) => added(value, statics),
  // 9-9-1-3: the changes a resolved skill put in force for a duration.
  numeric: (value, _statics, timed) => added(value, timed),
  /**
   * 20-21: a **discount on the price being paid**, which is not a rewrite of
   * the printed cost and is not additive — 20-21-2 floors it at zero, and a
   * floor does not commute with an addition. Reducers of both origins are read
   * together, because "reduce by 1" means the same whether a [Permanent] stands
   * it or a skill put it in force for the turn (`playCost`, which adds the two
   * lists before it subtracts either).
   *
   * It reaches a **number** and a **colour list** with one arithmetic: taking 1
   * off a total takes one orb off the coloured requirement with it, which is
   * the loop `playCost` runs and the reason both attributes name this layer.
   * Which orb goes is the first still demanded — the legacy engine's greedy
   * choice, and the same choice, because `specifiedCost` is one entry per orb
   * in the order `specifiedCostOf` filled them.
   */
  reduction: (value, statics, timed, attrs, name) => {
    // FAQ (Skills Q24, dbs-cardgame.com game_faq): an energy cost reduced by a
    // [Permanent] "doesn't" reduce its specified cost with it, so a plain
    // number comes off the total alone. Only a reduction *by a coloured orb*
    // ("reduce the energy cost by {r}") moves both halves (20-21-2), and only
    // by the orbs of that colour the card really demands (20-21-2-1: the total
    // comes down "by the amount that was possible for X"). 1-2-2-1 keeps the
    // total from falling under the number of coloured orbs still demanded.
    // Only an energy price has a coloured half: a combo or Z-Energy cost is a bare number.
    const energy = name === "costOf" || name === "specifiedCost";
    const orbs: string[] = !energy ? [] : Array.isArray(value) ? [...(value as readonly string[])] : Array.isArray(attrs.specifiedCost) ? [...(attrs.specifiedCost as readonly string[])] : [];
    let by = 0;
    for (const n of [...statics, ...timed]) {
      if (typeof n === "number") by += n;
      else if (n && typeof n === "object" && "by" in n && "colors" in n) {
        const change = n as unknown as CostChange;
        if (change.by < 0) {
          by += change.by;
          continue;
        }
        for (const orb of change.colors) {
          if (orb === "any") {
            by += 1;
            continue;
          }
          const at = orbs.indexOf(orb);
          if (at >= 0) {
            orbs.splice(at, 1);
            by += 1;
          }
        }
      }
    }
    if (Array.isArray(value)) return orbs;
    if (typeof value !== "number") return value;
    if (!by) return value;
    return Math.max(energy ? Math.min(value, orbs.length) : 0, value - by);
  },
  /**
   * The coloured half said on its own (owner's ruling on BT19-039, 9 Sep 2026,
   * read off 13-2-1-3 and 20-21-2): "reduce the specified cost of this card by
   * {u}" relaxes which colours are demanded and moves the total **nothing**.
   * That is why it is a layer of `specifiedCost` and of no numeric attribute —
   * a number has nothing for it to do, and declaring it on one would be a
   * reading that quietly did nothing.
   */
  specified: (value, statics, timed, attrs) => {
    if (!Array.isArray(value)) return value;
    const orbs = [...(value as readonly string[])];
    for (const change of [...statics, ...timed]) {
      if (!change || typeof change !== "object" || !("colors" in change)) continue;
      const { colors, sign } = change as SpecifiedChange;
      for (const orb of colors) {
        if (sign === 1) {
          const at = orb === "any" ? (orbs.length ? 0 : -1) : orbs.indexOf(orb);
          if (at >= 0) orbs.splice(at, 1);
        } else {
          // Tightening with no colour named demands one more of whatever is
          // already demanded, or of the card's own first colour — the legacy
          // fallback, and the one place a layer reads another attribute.
          const own = (attrs.colors as readonly string[] | undefined)?.find((c) => c !== "Colorless");
          const add = orb === "any" ? (orbs[0] ?? own) : orb;
          if (add) orbs.push(add);
        }
      }
    }
    // 22-19-2: "treat as having no specified cost" is read after every other
    // change, as the legacy `playCost` clears it last.
    if ([...statics, ...timed].some((c) => !!c && typeof c === "object" && "all" in c && (c as SpecifiedChange).all)) return [];
    return orbs;
  },
};

/**
 * One attribute of one card, through the layers its declaration names.
 *
 * `printed` is the value the catalog gave (`attrsOf`); every layer after it is
 * this module's. An attribute the game declares no `layers:` for is its printed
 * value and nothing else — which is most of them, and is why `valueOf` can be
 * asked for any attribute rather than only the ones with layers.
 *
 * `statics` and `timed` are every change in force **about this card**; which of
 * them a layer sees is `LAYER_KINDS`, read here so that the pairing of an
 * attribute's name with an effect's `kind` lives in exactly one place. The
 * default is the attribute's own name, which is the whole of the rule for
 * everything but a price.
 */
/** An energy-cost change's value, with the orbs it was said in when it named any. */
function costValue(e: { kind: string; value: unknown; colors?: (Color | "any")[] }): EffectValue {
  if (e.kind === "cost" && typeof e.value === "number" && e.colors?.length) return { by: e.value, colors: e.colors } as unknown as EffectValue;
  return e.value as EffectValue;
}

export function valueOf(game: GameDefinition, attrs: Attrs, name: string, statics: VmStatic[], timed: ContinuousEffect[]): AttrValue | undefined {
  const declared = game.attributes[name];
  const printed = attrs[name];
  if (!declared?.layers?.length) return printed;
  let value: AttrValue | undefined = printed;
  for (const layer of declared.layers) {
    if (layer === "printed") continue;
    const read = LAYERS[layer];
    if (!read) continue; // a layer this interpreter has nothing for.
    const kind = LAYER_KINDS[name]?.[layer] ?? name;
    value = read(
      value,
      statics.filter((e) => e.kind === kind).map(costValue),
      timed.filter((e) => e.kind === kind).map(costValue),
      attrs,
      name,
    );
  }
  if (name === "keywords" && Array.isArray(value)) {
    const negated = new Set([
      ...statics.filter((e) => e.kind === "negateKeyword").map((e) => e.value as KeywordSkill["name"]),
      ...timed.filter((e) => e.kind === "negateKeyword").map((e) => e.value as KeywordSkill["name"]),
    ]);
    value = (value as readonly string[]).filter((keyword) => !negated.has(keyword as KeywordSkill["name"]));
  }
  return value;
}
