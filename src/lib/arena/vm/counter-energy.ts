/** R463: permission is read only from the original own energy occurrence. */
import type { EngineContext, GameEvent, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets";
import type { ScriptFrame, SkillPrice } from "./script";
import type { VmState } from "./state";
import { counterEnergyPermitProblem } from "./counter-energy-contract";
import { skillsShowing } from "./triggers";
import { findCard } from "./zones";
import { dropEffectsOn, skillNegated, skillsNegated } from "./effects";
import { sparkingIsValid } from "./validity";
import { condHolds } from "./program";
import { IllegalAction } from "./illegal-action";
import type { CounterDropOccurrences } from "./counter-drop";
/** Use only as moved.beforeTriggers: a failed/redirected staging must not reset the source. */
export function resetEnergyCounterOccurrence(state: VmState, ev: GameEvent[], card: string): () => void {
  return () => dropEffectsOn(state, ev, card);
}

export interface CounterEnergyPermission {
  skillIndex: number;
  price: SkillPrice;
}

/** Until R454 preserves original movement-Auto programs, refuse only an Auto
 * whose typed movement pattern can answer the rule's Energy-to-Drop staging. */
export function counterEnergyMovementProblem(
  ctx: EngineContext, game: GameDefinition, state: VmState, card: string,
): string | null {
  const showing = skillsShowing(ctx, state, card);
  const carried: Record<string, unknown> = { from: "energy", to: "drop", asPlay: false };
  const matches = (want: unknown, got: unknown): boolean => Array.isArray(want)
    ? want.some(value => matches(value, got)) : got !== undefined && want === got;
  for (const skill of showing.skills) {
    if (skill.kind !== "auto") continue;
    for (const name of showing.scripts.bySkill[skill.index]?.trigger ?? []) {
      const trigger = game.triggers[name];
      if (trigger?.on.event === "moved" && Object.entries(trigger.on.args).every(([key, value]) =>
        key === "watcher" || matches(value, carried[key]))) {
        return "preserve an original energy-movement Auto before activating this Counter from energy";
      }
    }
  }
  return null;
}

function readCounterEnergyPermission(
  ctx: EngineContext,
  game: GameDefinition,
  state: VmState,
  player: PlayerId,
  card: string,
): CounterEnergyPermission | null {
  const inst = state.cards[card];
  if (
    !inst || inst.owner !== player || inst.hidden ||
    findCard(state, card)?.zone !== "energy" ||
    ctx.defs[inst.cardId]?.type !== "BATTLE" || skillsNegated(state, card)
  ) return null;

  const showing = skillsShowing(ctx, state, card);
  for (const skill of showing.skills) {
    if (
      skill.kind !== "permanent" || skillNegated(state, card, skill.index, skill.kind) ||
      !sparkingIsValid(state, player, skill.validity) || skill.bond != null
    ) continue;
    const script = showing.scripts.bySkill[skill.index];
    if (!script || script.unsupported.length || script.ops.length !== 1) continue;
    const op = script.ops[0];
    if (op.op !== "permit" || op.what !== "counterFromEnergy" || counterEnergyPermitProblem(op)) continue;
    const frame: ScriptFrame = { ops: [], ip: 0, vars: {}, card, master: player };
    if (op.price?.condition && !condHolds(ctx, game, state, frame, op.price.condition)) continue;
    return { skillIndex: skill.index, price: structuredClone(op.price!) };
  }
  return null;
}

export function counterEnergyPermission(
  ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string,
): CounterEnergyPermission | null {
  const permission = readCounterEnergyPermission(ctx, game, state, player, card);
  return permission && !counterEnergyMovementProblem(ctx, game, state, card) ? permission : null;
}

export function counterEnergyAdmissionProblem(
  ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, card: string,
): string | null {
  return readCounterEnergyPermission(ctx, game, state, player, card)
    ? counterEnergyMovementProblem(ctx, game, state, card) : null;
}

/**
 * The permission and its Leader/negation gates were checked at declaration.
 * Resuming payment validates the stored contract and declaration identity;
 * it does not turn those admission gates into fresh resolution conditions.
 * The caller separately requires the original energy occurrence to remain.
 */
export function validCounterEnergyOrigin(ctx: EngineContext, state: VmState, frame: ScriptFrame): boolean {
  const origin = frame.counterCost?.energyOrigin;
  if (
    !origin || origin.version !== 1 ||
    !Number.isSafeInteger(origin.sourceEpoch) || origin.sourceEpoch < 0 ||
    !Number.isSafeInteger(origin.permissionSkill) || origin.permissionSkill < 0
  ) return false;
  const activation = frame.counterActivation;
  if (
    !activation || activation.version !== 1 || activation.from !== "energy" ||
    activation.card !== frame.card || activation.epoch !== origin.sourceEpoch ||
    activation.skillIndex !== frame.skillIndex || activation.kind !== frame.counterCost?.skill.kind
  ) return false;
  const declaration = frame.counterDeclaredScript;
  if (!declaration || declaration.version !== 1 || declaration.card !== frame.card ||
    declaration.skillIndex !== frame.skillIndex || declaration.kind !== activation.kind ||
    !declaration.script || (declaration.script.kind !== undefined && declaration.script.kind !== declaration.kind)) return false;
  const inst = state.cards[frame.card];
  if (!inst || inst.owner !== frame.master || ctx.defs[inst.cardId]?.type !== "BATTLE") return false;
  const script = skillsShowing(ctx, state, frame.card).scripts.bySkill[origin.permissionSkill];
  return !!script && script.kind === "permanent" && !script.unsupported.length &&
    script.ops.length === 1 && counterEnergyPermitProblem(script.ops[0]) === null;
}

export function counterEnergyOccurrenceProblem(
  state: VmState,
  card: string,
  saved: CounterDropOccurrences | undefined,
): string | null {
  const epoch = saved?.cards?.[card];
  if (saved && (saved.version !== 1 || !saved.cards || typeof saved.cards !== "object" || Array.isArray(saved.cards))) {
    return "rebuild the saved energy Counter candidates";
  }
  if (findCard(state, card)?.zone !== "energy" && epoch === undefined) return null;
  if (!Number.isSafeInteger(epoch) || epoch! < 0) return "rebuild the saved energy Counter occurrence";
  if (findCard(state, card)?.zone !== "energy" || (state.cards[card]?.zoneEpoch ?? 0) !== epoch) {
    return "the original energy Counter occurrence is no longer available";
  }
  return null;
}

export function requireCounterEnergyOccurrence(
  state: VmState,
  card: string,
  saved: CounterDropOccurrences | undefined,
): void {
  const problem = counterEnergyOccurrenceProblem(state, card, saved);
  if (problem) throw new IllegalAction(problem);
}
