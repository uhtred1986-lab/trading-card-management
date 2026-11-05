/** R466: one explicit under-card Counter route, controlled by the top host. */
import type { EngineContext, GameEvent, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets";
import { IllegalAction } from "./illegal-action";
import type { ScriptFrame, SkillPrice } from "./script";
import type { VmState } from "./state";
import { counterUnderPermitProblem } from "./counter-under-contract";
import { underCounterExternalCostProblem, underCounterOwnCostProblem } from "./counter-under-price";
import { skillsShowing } from "./triggers";
import { findCard, hostOf } from "./zones";
import { dropEffectsOn, skillNegated, skillsNegated } from "./effects";
import { attrsNow, standingKindNegated } from "./program";
import { predicateOf } from "./filters";
import { sparkingIsValid } from "./validity";

export interface CounterUnderSource {
  version: 1;
  cardId: string;
  sourceEpoch: number;
  sourceOwner: PlayerId;
  host: string;
  hostEpoch: number;
  master: PlayerId;
}

export interface CounterUnderPermission {
  skillIndex: number;
  price: SkillPrice;
  policy: "asHandV1";
  source: CounterUnderSource;
}

export interface CounterUnderOccurrences {
  version: 1;
  cards: Record<string, CounterUnderSource>;
}

export function sameCounterUnderSource(state: VmState, card: string, source: CounterUnderSource): boolean {
  const instance = state.cards[card], host = state.cards[source.host];
  const location = findCard(state, source.host);
  return source.version === 1 && Number.isSafeInteger(source.sourceEpoch) && source.sourceEpoch >= 0 &&
    Number.isSafeInteger(source.hostEpoch) && source.hostEpoch >= 0 &&
    !!instance && instance.cardId === source.cardId && instance.owner === source.sourceOwner &&
    (instance.zoneEpoch ?? 0) === source.sourceEpoch && !instance.hidden &&
    !!host && !host.hidden && (host.zoneEpoch ?? 0) === source.hostEpoch &&
    hostOf(state, card) === source.host && location?.zone === "battle" && location.owner === source.master;
}

export function counterUnderPermission(
  ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string,
): CounterUnderPermission | null {
  const instance = state.cards[card], host = hostOf(state, card);
  const location = host ? findCard(state, host) : null;
  if (!instance || instance.hidden || !host || state.cards[host]?.hidden ||
    location?.zone !== "battle" || location.owner !== player || ctx.defs[instance.cardId]?.type !== "BATTLE" ||
    skillsNegated(state, card) || standingKindNegated(ctx, game, state, card, "permanent")) return null;
  const showing = skillsShowing(ctx, state, card);
  for (const skill of showing.skills) {
    if (skill.kind !== "permanent" || skillNegated(state, card, skill.index, skill.kind) ||
      !sparkingIsValid(state, player, skill.validity) || skill.bond != null) continue;
    const script = showing.scripts.bySkill[skill.index];
    if (!script || script.unsupported.length || script.ops.length !== 1) continue;
    const op = script.ops[0];
    if (op.op !== "permit" || op.what !== "counterFromUnder" || counterUnderPermitProblem(op) ||
      !op.source || !predicateOf(op.source, game)(attrsNow(ctx, game, state, host))) continue;
    return {
      skillIndex: skill.index, price: structuredClone(op.price!), policy: "asHandV1",
      source: { version: 1, cardId: instance.cardId, sourceEpoch: instance.zoneEpoch ?? 0,
        sourceOwner: instance.owner, host, hostEpoch: state.cards[host].zoneEpoch ?? 0, master: player },
    };
  }
  return null;
}

export function counterUnderAdmissionProblem(
  ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string,
): string | null {
  return counterUnderPermission(ctx, game, state, player, card)
    ? underCounterOwnCostProblem(ctx, game, state, card) ?? underCounterExternalCostProblem(ctx, game, state, card, player)
    : null;
}

export function counterUnderOccurrenceProblem(
  state: VmState, card: string, saved: CounterUnderOccurrences | undefined,
): string | null {
  if (saved && (saved.version !== 1 || !saved.cards || typeof saved.cards !== "object" || Array.isArray(saved.cards))) {
    return "rebuild the saved under-card Counter candidates";
  }
  const source = saved?.cards[card];
  if (!hostOf(state, card) && source === undefined) return null;
  if (!source || source.version !== 1 || !Number.isSafeInteger(source.sourceEpoch) || !Number.isSafeInteger(source.hostEpoch)) {
    return "rebuild the saved under-card Counter source and host occurrences";
  }
  return sameCounterUnderSource(state, card, source) ? null : "the original under-card Counter source or host is no longer available";
}

export function requireCounterUnderOccurrence(state: VmState, card: string, saved: CounterUnderOccurrences | undefined): void {
  const problem = counterUnderOccurrenceProblem(state, card, saved);
  if (problem) throw new IllegalAction(problem);
}

/** Admission conditions were checked before payment; resume preserves their
 * declaration rather than rechecking Baby/negation after a paid response. */
export function validCounterUnderOrigin(ctx: EngineContext, state: VmState, frame: ScriptFrame): boolean {
  const origin = frame.counterCost?.underOrigin, activation = frame.counterActivation;
  const declaration = frame.counterDeclaredScript;
  if (!origin || origin.version !== 1 || origin.policy !== "asHandV1" ||
    !Number.isSafeInteger(origin.permissionSkill) || origin.permissionSkill < 0 ||
    !origin.source || origin.source.version !== 1 || origin.source.master !== frame.master ||
    !Number.isSafeInteger(origin.source.sourceEpoch) || origin.source.sourceEpoch < 0 ||
    !Number.isSafeInteger(origin.source.hostEpoch) || origin.source.hostEpoch < 0 ||
    !state.sides[origin.source.sourceOwner] || typeof origin.source.host !== "string" ||
    state.cards[frame.card]?.cardId !== origin.source.cardId ||
    state.cards[frame.card]?.owner !== origin.source.sourceOwner ||
    !activation || activation.version !== 1 || activation.card !== frame.card || activation.from !== "under" ||
    activation.epoch !== origin.source.sourceEpoch || activation.skillIndex !== frame.skillIndex ||
    activation.kind !== frame.counterCost?.skill.kind ||
    !declaration || declaration.version !== 1 || declaration.card !== frame.card ||
    declaration.skillIndex !== frame.skillIndex || declaration.kind !== activation.kind ||
    !declaration.script || (declaration.script.kind !== undefined && declaration.script.kind !== declaration.kind)) return false;
  const permission = skillsShowing(ctx, state, frame.card).scripts.bySkill[origin.permissionSkill];
  return !!permission && permission.kind === "permanent" && !permission.unsupported.length &&
    permission.ops.length === 1 && counterUnderPermitProblem(permission.ops[0]) === null;
}

export function sameCounterUnderDeclaration(a: CounterUnderSource | undefined, b: CounterUnderSource | undefined): boolean {
  return !!a && !!b && a.version === 1 && b.version === 1 &&
    a.cardId === b.cardId && a.sourceEpoch === b.sourceEpoch && a.sourceOwner === b.sourceOwner &&
    a.host === b.host && a.hostEpoch === b.hostEpoch && a.master === b.master;
}

/** Use only after a successful original under-to-Drop staging. */
export function resetUnderCounterOccurrence(state: VmState, events: GameEvent[], card: string): () => void {
  return () => dropEffectsOn(state, events, card);
}
