/**
 * 9-10 on the rules engine: what stands in front of a card leaving play.
 *
 * A [Permanent] that says "if this card would be KO'd, send it to the Warp
 * instead" is a **standing offer** (`vm/effects.ts` collects it as a
 * `replaceLeave` static, the legacy `collectStatics`' reading word for word),
 * and this module is where it is read when the moment comes. Two readers, the
 * legacy engine's two (`engine/state.ts`):
 *
 *   `replacementChoices` — every replacement that answers this departure, for
 *   the two call sites that can stop and ask (`stepScript`'s `ko` and
 *   `moveTo` loops, shared): 9-10-2's choice between several and 9-10-3's
 *   "you may" are their questions, through `vm/host.ts`'s `replacementsFor`.
 *
 *   `leaveRoute` — what every mover does with the answer: the asked one the
 *   caller hands in, or, for the call sites that cannot wait (a battle's KO,
 *   a rule's move), the first mandatory, question-free match, which is the
 *   legacy `replacementFor`. A **redirect** changes where the card goes; a
 *   **substitute** keeps the card where it is and runs its program instead
 *   (9-10-1-1), inline unless the caller said it will run it as a frame of
 *   its own (`deferred`, #107).
 *
 * After the [Permanent]s, a keyword's own replacement: a `wouldLeave` hook
 * body ([Ultimate], 22-14-3) whose leaf is the same `replace` record, read
 * through the same redirect. It is the card's own rule rather than an effect
 * on it, so it is applied last and never offered as a 9-10-2 choice — the
 * legacy `move` folds [Ultimate] into the same line as a token's and a
 * Z-card's removal (19-1-7, 14-1-4), after the replacement, and this keeps
 * that order. Owner's decision of 1 Oct 2026 (`docs/arena-ruleset-spec.md`
 * §4): [Ultimate] rides on the 9-10 replacements, not on an `onLeave` query.
 *
 * Pure and client-safe: no database, no network, no `fs`.
 */
import type { EngineContext, GameEvent } from "../types";
import { canMakeOffer, stepScript } from "./script";
import { asksAQuestion, describeScript } from "./script-schema";
import { redirectOf } from "./common";
import { type Replacement } from "../types";
import type { MoveActor, MoveReason, PlayerId, ReplacementChoice, ReplacementResult } from "../types";
import type { GameDefinition } from "../rulesets";
import { log } from "./events";
import { vmHost } from "./host";
import { queryHookStatics, resolveSelector, staticsNow } from "./program";
import { masterOf } from "./triggers";
import { findCard, inPlayZones } from "./zones";
import type { VmState } from "./state";
import type { ScriptFrame } from "./script";

/**
 * A substitute is running: whatever it moves is moving for real, so a
 * replacement cannot replace its own replacement — the legacy
 * `applyingReplacement`. `ScriptFrame.replacing` says the same thing for a
 * deferred substitute, where a module flag would not survive the suspension.
 */
let applyingReplacement = false;

/** The zone 8-4-6-1's damage takes cards from — the same name `vm/battle.ts`'s `damageLife` reads. */
const LIFE_ZONE = "life";

/** Every replacement standing in front of this card's departures, in the order the statics are read (the legacy order). */
function standing(ctx: EngineContext, game: GameDefinition, state: VmState, id: string): { source: string; master: PlayerId; skillIndex?: number; r: Replacement }[] {
  const out = staticsNow(ctx, game, state)
    .filter((e) => e.kind === "replaceLeave" && e.target === id)
    .map((e) => ({ source: e.source, master: e.master, ...(e.skillIndex === undefined ? {} : { skillIndex: e.skillIndex }), r: e.value as Replacement }));
  // Timed replacements retain their selector and re-evaluate it at each
  // departure, including cards that enter the Battle Area after activation.
  for (const e of state.effects) {
    if (e.kind !== "replaceLeave" || !e.source || !e.master || !e.value || typeof e.value !== "object") continue;
    const stored = e.value as Replacement;
    const r: Replacement = { ...stored, source: stored.source ?? e.source, master: stored.master ?? e.master };
    const target = r.target ?? { special: "self" as const };
    const frame: ScriptFrame = { ops: [], ip: 0, vars: r.vars ?? {}, card: e.source, master: e.master };
    if (resolveSelector(ctx, game, state, frame, target).includes(id)) out.push({ source: e.source, master: e.master, ...(r.skillIndex === undefined ? {} : { skillIndex: r.skillIndex }), r });
  }
  return out;
}

export function replacementIdentity(source: string, skillIndex: number | undefined, event: string | undefined, target: string): string {
  return JSON.stringify([event ?? "move", target, source, skillIndex ?? null]);
}

/**
 * Does this replacement answer to *this* departure — the cause it names and
 * whose skill caused it? The legacy `causeMatches`: "by a skill" is an
 * effect, the longer form adds the KO, and `bySide` narrows either to the
 * opponent's skill, which only a caller that knows the actor can satisfy. A
 * `life` replacement answers no Battle Area departure at all.
 */
function causeMatches(game: GameDefinition, state: VmState, id: string, r: Replacement, reason: MoveReason | undefined, actor: MoveActor, requestedTo?: string): boolean {
  if (r.kind === "life" || r.kind === "marker") return false;
  if (r.from) {
    const from = findCard(state, id)?.zone;
    if (!from || !r.from.some((zone) => zone === from) || from === requestedTo) return false;
  }
  if (r.by === "skill" && reason !== "effect") return false;
  if (r.by === "ko" && reason !== "ko") return false;
  if (r.by === "skillOrKo" && reason !== "effect" && reason !== "ko") return false;
  // A skill's KO is asked with the skill's controller as the actor; the
  // battle's KO (8-4-6-2) has none, and is not this rule's.
  if (r.by === "skillOrKoBySkill" && reason !== "effect" && !(reason === "ko" && actor !== undefined)) return false;
  if (r.requestedTo && r.requestedTo !== requestedTo) return false;
  if (r.bySide === "opponent" && (actor === undefined || actor === masterOf(game, state, id))) return false;
  return true;
}

/**
 * Every replacement that answers to this departure, for the two call sites
 * that can put 9-10-2's and 9-10-3's question (#107) — the legacy
 * `replacementChoicesFor`. `inSubstitute` is a caller itself standing in a
 * departure's place: a substitute cannot replace its own replacement, though
 * a redirect of some other card it moves still applies.
 */
export function replacementChoices(
  ctx: EngineContext,
  game: GameDefinition,
  state: VmState,
  id: string,
  reason: MoveReason | undefined,
  opts: { actor?: MoveActor; inSubstitute?: boolean; requestedTo?: string; comboCleanup?: true } = {},
): ReplacementChoice[] {
  const out: ReplacementChoice[] = [];
  const from = findCard(state, id)?.zone;
  const heldDestination = !!opts.requestedTo && (inPlayZones(game).includes(opts.requestedTo) || game.zones[opts.requestedTo]?.host === true);
  for (const { source, master, skillIndex, r } of standing(ctx, game, state, id)) {
    // Existing unscoped replacements still answer only departures out of
    // play. The native cleanup explicitly owns its older Combo exception.
    if (!r.from && !opts.comboCleanup && (from === "combo" || heldDestination)) continue;
    if (r.ops && (applyingReplacement || opts.inSubstitute)) continue;
    if (!causeMatches(game, state, id, r, reason, opts.actor, opts.requestedTo)) continue;
    // A timed substitute may refer to variables captured when installed.
    // Keep them on the frozen choice through a replacement prompt/reload.
    out.push({ source, ...(r.to ? { to: r.to } : {}), ...(r.position ? { position: r.position } : {}), mode: r.mode, optional: r.optional, ...(r.ops ? { ops: r.ops } : {}), ...(r.vars ? { vars: r.vars } : {}), master: r.master ?? master, ...((skillIndex ?? r.skillIndex) !== undefined ? { skillIndex: skillIndex ?? r.skillIndex } : {}) });
  }
  return offerable(ctx, game, state, id, out);
}

/**
 * 9-10-3 (#720): a voluntary substitute the affected player could not pay in
 * full is not offered (`canMakeOffer`, read against this board). The rest keep
 * their order, so the menu's indexes are the ones the prompt shows.
 */
function offerable(ctx: EngineContext, game: GameDefinition, state: VmState, id: string, choices: ReplacementChoice[]): ReplacementChoice[] {
  const master = masterOf(game, state, id);
  return choices.filter((c) => canMakeOffer(c, id, master, (frame, sel) => resolveSelector(ctx, game, state, { ...frame, vars: { ...((c as ReplacementChoice & { vars?: Record<string, string[]> }).vars ?? {}), ...frame.vars } }, sel)));
}

/**
 * Every `life` replacement answering to this life card's own move to `dest`
 * (#272) — the legacy `lifeReplacementChoicesFor`, the one reader a battle's
 * damage asks (`vm/battle.ts`'s `damageLife`), the way `replacementChoices` is
 * the one the Battle Area's two suspendable sites ask. Every printed card in
 * this family says "if **you** would…", so it is scoped by whose rule it is
 * (`master`) rather than by a target card; `lifeTo` narrows it to one
 * destination when the card names one. No cause to match: damage is the only
 * thing that puts a card out of the life area this way.
 */
export function lifeReplacementChoices(ctx: EngineContext, game: GameDefinition, state: VmState, id: string, dest: "hand" | "drop"): ReplacementChoice[] {
  const owner = masterOf(game, state, id);
  const out: ReplacementChoice[] = [];
  for (const e of staticsNow(ctx, game, state)) {
    if (e.kind !== "replaceLeave") continue;
    const r = e.value as Replacement;
    if (r.kind !== "life" || r.master !== owner || (r.lifeTo && r.lifeTo !== dest)) continue;
    // "…would reveal **this card** from your life": the rule is the taken card's
    // own, so no other life card answers to it (and a copy in play does not).
    if (r.lifeSelf && e.source !== id) continue;
    if (r.ops && applyingReplacement) continue;
    out.push({ source: e.source, ...(r.to ? { to: r.to } : {}), mode: r.mode, optional: r.optional, ...(r.ops ? { ops: r.ops } : {}), ...(r.master ? { master: r.master } : {}), ...(r.skillIndex !== undefined ? { skillIndex: r.skillIndex } : {}) });
  }
  return offerable(ctx, game, state, id, out);
}

/**
 * Every `marker` replacement standing in front of this Unison losing one
 * marker to an attack (13-5-2, SD13-02) — the legacy
 * `markerReplacementChoicesFor`, the one reader `vm/battle.ts`'s Damage Step
 * asks, once per marker (5-13-4-2). Scoped by target, like the Battle Area
 * family; always a substitute, which the caller queues as a program.
 */
export function markerReplacementChoices(ctx: EngineContext, game: GameDefinition, state: VmState, id: string): ReplacementChoice[] {
  const out: ReplacementChoice[] = [];
  for (const { source, r } of standing(ctx, game, state, id)) {
    if (r.kind !== "marker" || !r.ops?.length) continue;
    out.push({ source, optional: r.optional, ops: r.ops, ...(r.master ? { master: r.master } : {}), ...(r.skillIndex !== undefined ? { skillIndex: r.skillIndex } : {}) });
  }
  return offerable(ctx, game, state, id, out);
}

/**
 * The deterministic answer, for a departure nobody can be asked about — the
 * legacy `replacementFor`. The first mandatory, question-free match wins: an
 * optional one is not taken on anyone's behalf, and a substitute that would
 * ask is left unapplied rather than half-run (§1.4 of
 * `docs/arena-move-replacement-scope.md`).
 */
function replacementFor(
  ctx: EngineContext,
  game: GameDefinition,
  state: VmState,
  id: string,
  reason: MoveReason | undefined,
  actor?: PlayerId,
  used: ReadonlySet<string> = new Set<string>(),
  event?: string,
  requestedTo?: string,
  explicitFromOnly = false,
): { source: string; route: Replacement; identity: string } | null {
  for (const { source, master, skillIndex, r } of standing(ctx, game, state, id)) {
    if (explicitFromOnly && !r.from) continue;
    const identity = replacementIdentity(source, skillIndex ?? r.skillIndex, event, id);
    if (used.has(identity)) continue;
    if (r.optional) continue;
    if (r.ops && applyingReplacement) continue;
    if (r.ops && asksAQuestion(r.ops)) continue;
    if (!causeMatches(game, state, id, r, reason, actor, requestedTo)) continue;
    return { source, route: { ...r, source: r.source ?? source, master: r.master ?? master, skillIndex: skillIndex ?? r.skillIndex }, identity };
  }
  return null;
}

/** What a departure becomes: the card stays where it is (a substitute ran, or will), or it goes here, in this mode. */
export type LeaveRoute = { stays: true; replacement?: string } | { stays: false; to: string; mode?: string; position?: "top" | "bottom"; replacement?: string };

/**
 * The 9-10 half of a move, read before the card goes anywhere — every mover
 * on this engine asks it (`vm/flow.ts`'s `moved`, `vm/host.ts`'s `moveTo`),
 * which is the legacy `move`'s one block.
 *
 * `replaced` is the caller's own answer when it has one: `undefined` means
 * "look one up" (the deterministic path), `null` "there is none". A card
 * leaving one of the zones that are in play for one that is not held in play
 * (a combo is) is the only departure a [Permanent]'s replacement answers.
 * A life card's own departure (#272) is the other one, but only with the
 * caller's answer: battle damage is the one site that asks about it
 * (`lifeReplacementChoices`), and nothing is looked up for it here — the
 * legacy `move`'s `wasLife`.
 * A caller that already asked about a hand departure may supply its selected
 * route; the mover honours that answer without discovering new hand routes.
 * Then the keyword's own `wouldLeave` rule, which also answers a card leaving
 * a combo — the legacy `wasInPlay || wasCombo`.
 */
export function leaveRoute(
  ctx: EngineContext,
  game: GameDefinition,
  state: VmState,
  ev: GameEvent[],
  id: string,
  from: string | null,
  to: string,
  opts: { reason?: MoveReason; replaced?: ReplacementResult | null; actor?: PlayerId; usedReplacements?: ReadonlySet<string>; event?: string },
): LeaveRoute {
  const inPlay = inPlayZones(game);
  const held = (zone: string | null) => !!zone && (inPlay.includes(zone) || game.zones[zone]?.host === true);
  let mode: string | undefined;
  let insteadPosition: "top" | "bottom" | undefined;
  const fromLife = from === LIFE_ZONE;
  // #609: only the native 8-5-8 cleanup may hand a previously answered
  // Combo departure to this mover. General automatic discovery stays scoped
  // to in-play departures; the battle step owns this one prompt and cursor.
  const answeredComboCleanup = from === "combo" && opts.event?.startsWith("8-5-8:") && opts.replaced !== undefined;
  const ordinaryDeparture = !!from && inPlay.includes(from) && !held(to);
  // An explicit source-area rule also applies from Combo, and when a card
  // leaves Battle for another held area. Ordinary replacements retain their
  // existing in-play-to-outside scope.
  const scopedDeparture = (from === "battle" || from === "combo") && from !== to;
  const selected = (ordinaryDeparture || scopedDeparture) && opts.replaced === undefined
    ? replacementFor(ctx, game, state, id, opts.reason, opts.actor, opts.usedReplacements, opts.event, to, !ordinaryDeparture)
    : null;
  const selectedIdentity = selected?.identity ?? (opts.replaced?.source ? replacementIdentity(opts.replaced.source, opts.replaced.skillIndex, opts.event, id) : undefined);
  // A suspendable price can already have asked the affected player about a
  // hand card. The answer must reach the move, even though automatic
  // replacement discovery remains scoped to in-play departures and life.
  const answeredHandDeparture = from === "hand" && opts.replaced != null;
  // A strict cost can also ask about a declared deck/life/pool departure.
  // Honor that supplied answer without widening automatic discovery.
  const answeredCostDeparture = opts.reason === "cost" && opts.replaced != null;
  if (((((from && inPlay.includes(from)) || fromLife) || answeredHandDeparture || answeredCostDeparture || answeredComboCleanup) && !held(to)) || (scopedDeparture && (selected || opts.replaced != null))) {
    const instead: Replacement | ReplacementResult | null = opts.replaced !== undefined ? opts.replaced : selected?.route ?? null;
    if (instead?.ops?.length) {
      log(ev, { type: "note", text: `${nameOf(ctx, state, id)} stays where it is; ${describeScript(instead.ops)} instead` });
      if (!("deferred" in instead && instead.deferred)) runReplacement(ctx, game, state, ev, id, instead);
      return { stays: true, ...(selectedIdentity ? { replacement: selectedIdentity } : {}) };
    }
    if (instead?.to) {
      log(ev, { type: "note", text: `${nameOf(ctx, state, id)} goes to the ${instead.to}${instead.mode === "rest" ? " in Rest Mode" : ""} instead` });
      to = instead.to;
      mode = instead.mode;
      insteadPosition = instead.position;
    } else if (instead && opts.replaced !== undefined) {
      // A route the affected player picked says how the card arrives as well
      // as where, even when where is where it was going anyway.
      mode = instead.mode;
      insteadPosition = instead.position;
    }
  }
  // The card's own rule (22-14-3): a `wouldLeave` body's `replace` record,
  // one move of the card itself, read as the redirect a [Permanent]'s is.
  if (held(from) && !held(to)) {
    for (const fact of queryHookStatics(ctx, game, state, id, "wouldLeave")) {
      if (fact.op !== "replace") continue;
      const redirect = redirectOf(fact.with);
      if (redirect && redirect.to !== to) to = redirect.to;
    }
  }
  return { stays: false, to, ...(mode ? { mode } : {}), ...(insteadPosition ? { position: insteadPosition } : {}), ...(selectedIdentity ? { replacement: selectedIdentity } : {}) };
}

/**
 * 9-10 with a program in the event's place, run here and now: the card whose
 * departure was replaced is `subject`. Safe to run synchronously because only
 * a question-free program reaches it — an asking one is skipped by
 * `replacementFor` or deferred by the caller that can wait for it.
 */
function runReplacement(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], id: string, r: Replacement | ReplacementResult): void {
  if (applyingReplacement || !r.ops?.length) return;
  applyingReplacement = true;
  try {
    stepScript(vmHost(ctx, game, state, ev), { ops: r.ops, ip: 0, vars: {}, card: r.source ?? id, master: r.master ?? masterOf(game, state, id), subject: id, replacing: id, ...(r.skillIndex !== undefined ? { skillIndex: r.skillIndex } : {}) });
  } finally {
    applyingReplacement = false;
  }
}

/** The face showing (1-9), for the log's words. */
function nameOf(ctx: EngineContext, state: VmState, id: string): string {
  const inst = state.cards[id];
  const def = inst ? ctx.defs[inst.cardId] : undefined;
  return (inst?.flipped && def?.back ? def.back.name : def?.name) ?? id;
}
