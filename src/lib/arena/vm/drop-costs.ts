/** #920: explicitly printed Drop activations pay their action price before use. */
import type { EngineContext, GameEvent, PlayerId, Requirement } from "../types";
import type { GameDefinition } from "../rulesets";
import { activationMoment, resolveActivation, type ActivationLine } from "./activate";
import { AutoPaymentFailed, automaticPriceHost, canFinishAutomaticPrice, readableAutomaticPrice } from "./auto-costs";
import { IllegalAction } from "./common";
import { spendSkillCostUses } from "./costs";
import { NotYet } from "./errors";
import { fire, log } from "./events";
import { stepScript, type ScriptFrame } from "./script";
import type { VmState } from "./state";
import { findCard } from "./zones";

export interface DropCost { line: ActivationLine; moment: ReturnType<typeof activationMoment> }

/** Keyword moves gain no permission; the activation reader already requires explicit persisted Drop scope. */
export function hasDropActionPrice(state: VmState, line: ActivationLine): boolean {
  return !line.keyword && findCard(state, line.card)?.zone === "drop" && !!line.script?.price?.ops?.length;
}
const frameFor = (ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, x?: number): ScriptFrame => ({
  card: line.card, master: player, skillIndex: line.skillIndex, usage: line.skill.usage as import("./usage").UsageRecord, validity: line.skill.validity as import("./validity").ValidityRecord, ops: line.script!.price!.ops!, ip: 0, vars: {}, ...(x === undefined ? {} : { x }),
  dropCost: { line, moment: activationMoment(ctx, game, state, player, line) },
});
function finishes(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, charge: (s: VmState) => void): boolean {
  readableAutomaticPrice(line.script!.price!.ops!, "Drop activation", "#920");
  const copy = structuredClone(state); charge(copy);
  return canFinishAutomaticPrice(ctx, game, copy, frameFor(ctx, game, copy, player, line));
}
export function dropPriceRefusals(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, charge: (s: VmState) => void): Requirement[] {
  if (!hasDropActionPrice(state, line)) return [];
  try { return finishes(ctx, game, state, player, line, charge) ? [] : [{ kind: "other", detail: "its Drop activation skill cost cannot be paid in full" }]; }
  catch (err) { if (err instanceof NotYet) return [{ kind: "other", detail: err.message }]; throw err; }
}
export function assertDropPricePayable(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, charge: (s: VmState) => void): void {
  if (hasDropActionPrice(state, line) && !finishes(ctx, game, state, player, line, charge)) throw new IllegalAction("the Drop activation's skill cost cannot be paid in full");
}
export function queueDropCost(ctx: EngineContext, game: GameDefinition, state: VmState, player: PlayerId, line: ActivationLine, x?: number): void {
  state.programs.unshift(frameFor(ctx, game, state, player, line, x));
}
export function stepDropCost(ctx: EngineContext, game: GameDefinition, state: VmState, ev: GameEvent[], frame: ScriptFrame): "done" | "wait" {
  const fail = () => { log(ev, { type: "note", text: "Drop activation failed: its skill cost could not be paid in full" }); return "done" as const; };
  try {
    if (!(frame.awaiting === "replaceMove" && state.lastMode !== null) && !canFinishAutomaticPrice(ctx, game, state, frame)) {
      if (frame.awaiting) throw new IllegalAction("that choice cannot pay the Drop activation's skill cost");
      return fail();
    }
    const result = stepScript(automaticPriceHost(ctx, game, state, ev), frame);
    if (result === "wait") {
      if (state.prompt.kind === "chooseCards") state.prompt.choice.candidates = state.prompt.choice.candidates.filter((id) => {
        const copy = structuredClone(state); copy.lastChoice = [id]; return canFinishAutomaticPrice(ctx, game, copy, frame);
      });
      return "wait";
    }
  } catch (err) { if (err instanceof AutoPaymentFailed) return fail(); throw err; }
  const { line, moment } = frame.dropCost!;
  // The action price was paid here, so resolve once with that price waived.
  // This boundary spends Once/Limit only now and hands cost choices to effects.
  resolveActivation(ctx, game, state, ev, frame.master, line, frame.x, undefined, { ops: line.script!.ops, vars: frame.vars }, true);
  spendSkillCostUses(ctx, game, state, ev, frame.card, line.skill);
  fire(ctx, game, state, moment);
  return "done";
}
