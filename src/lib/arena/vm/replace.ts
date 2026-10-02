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
import { stepScript } from "./script";
import { asksAQuestion, describeScript } from "./script-schema";
import { redirectOf } from "./common";
import { type Replacement } from "../types";
import type { MoveActor, MoveReason, ReplacementChoice, ReplacementResult } from "../types";
import type { GameDefinition } from "../rulesets";
import { log } from "./events";
import { vmHost } from "./host";
import { queryHookStatics, staticsNow } from "./program";
import { masterOf } from "./triggers";
import { inPlayZones } from "./zones";
import type { VmState } from "./state";

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
function standing(ctx: EngineContext, game: GameDefinition, state: VmState, id: string): { source: string; r: Replacement }[] {
  return staticsNow(ctx, game, state)
    .filter((e) => e.kind === "replaceLeave" && e.target === id)
    .map((e) => ({ source: e.source, r: e.value as Replacement }));
}

/**
 * Does this replacement answer to *this* departure — the cause it names and
 * whose skill caused it? The legacy `causeMatches`: "by a skill" is an
 * effect, the longer form adds the KO, and `bySide` narrows either to the
 * opponent's skill, which only a caller that knows the actor can satisfy. A
 * `life` replacement answers no Battle Area departure at all.
 */
function causeMatches(game: GameDefinition, state: VmState, id: string, r: Replacement, reason: MoveReason | undefined, actor: MoveActor): boolean {
  if (r.kind === "life") return false;
  if (r.by === "skill" && reason !== "effect") return false;
  if (r.by === "ko" && reason !== "ko") return false;
  if (r.by === "skillOrKo" && reason !== "effect" && reason !== "ko") return false;
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
  opts: { actor?: MoveActor; inSubstitute?: boolean } = {},
): ReplacementChoice[] {
  const out: ReplacementChoice[] = [];
  for (const { source, r } of standing(ctx, game, state, id)) {
    if (r.ops && (applyingReplacement || opts.inSubstitute)) continue;
    if (!causeMatches(game, state, id, r, reason, opts.actor)) continue;
    out.push({ source, ...(r.to ? { to: r.to } : {}), mode: r.mode, optional: r.optional, ...(r.ops ? { ops: r.ops } : {}), ...(r.master ? { master: r.master } : {}), ...(r.skillIndex !== undefined ? { skillIndex: r.skillIndex } : {}) });
  }
  return out;
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
    if (r.ops && applyingReplacement) continue;
    out.push({ source: e.source, ...(r.to ? { to: r.to } : {}), mode: r.mode, optional: r.optional, ...(r.ops ? { ops: r.ops } : {}), ...(r.master ? { master: r.master } : {}), ...(r.skillIndex !== undefined ? { skillIndex: r.skillIndex } : {}) });
  }
  return out;
}

/**
 * The deterministic answer, for a departure nobody can be asked about — the
 * legacy `replacementFor`. The first mandatory, question-free match wins: an
 * optional one is not taken on anyone's behalf, and a substitute that would
 * ask is left unapplied rather than half-run (§1.4 of
 * `docs/arena-move-replacement-scope.md`).
 */
function replacementFor(ctx: EngineContext, game: GameDefinition, state: VmState, id: string, reason: MoveReason | undefined): Replacement | null {
  for (const { r } of standing(ctx, game, state, id)) {
    if (r.optional) continue;
    if (r.ops && applyingReplacement) continue;
    if (r.ops && asksAQuestion(r.ops)) continue;
    if (!causeMatches(game, state, id, r, reason, undefined)) continue;
    return r;
  }
  return null;
}

/** What a departure becomes: the card stays where it is (a substitute ran, or will), or it goes here, in this mode. */
export type LeaveRoute = { stays: true } | { stays: false; to: string; mode?: string };

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
  opts: { reason?: MoveReason; replaced?: ReplacementResult | null },
): LeaveRoute {
  const inPlay = inPlayZones(game);
  const held = (zone: string | null) => !!zone && (inPlay.includes(zone) || game.zones[zone]?.host === true);
  let mode: string | undefined;
  const fromLife = from === LIFE_ZONE;
  if (((from && inPlay.includes(from)) || fromLife) && !held(to)) {
    const instead: Replacement | ReplacementResult | null = opts.replaced !== undefined ? opts.replaced : fromLife ? null : replacementFor(ctx, game, state, id, opts.reason);
    if (instead?.ops?.length) {
      log(ev, { type: "note", text: `${nameOf(ctx, state, id)} stays where it is; ${describeScript(instead.ops)} instead` });
      if (!("deferred" in instead && instead.deferred)) runReplacement(ctx, game, state, ev, id, instead);
      return { stays: true };
    }
    if (instead?.to && instead.to !== to) {
      log(ev, { type: "note", text: `${nameOf(ctx, state, id)} goes to the ${instead.to} instead` });
      to = instead.to;
      mode = instead.mode;
    } else if (instead && opts.replaced !== undefined) {
      // A route the affected player picked says how the card arrives as well
      // as where, even when where is where it was going anyway.
      mode = instead.mode;
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
  return { stays: false, to, ...(mode ? { mode } : {}) };
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
