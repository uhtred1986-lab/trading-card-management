/** R486: plain Combo entry belongs to its original native Battle activation. */
import type { EngineContext, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import type { ScriptFrame } from "./script";
import { battleIntact } from "./battle-damage";
import { findCard } from "./zones";
import { COPIED_SKILL_BASE } from "./common";
import { skillsShowing } from "./triggers";
import { NotYet } from "./errors";

export interface EnergyComboScope {
  version: 1;
  turn: number;
  turnPlayer: PlayerId;
  actor: PlayerId;
  activation: { version: 2; kind: "activate"; scope?: number };
  attacker: { card: string; epoch: number; attacks: number };
  guard: { card: string; epoch: number };
  target: string;
  step: "offense" | "defense";
  flow: { depth: number; phase: "battle"; index: number; repeats: number; reask: true; asking?: (PlayerId | null)[] };
  source: { card: string; epoch: number; holder: PlayerId; origin: "hand" | "battle"; via?: string };
}
export function captureEnergyComboScope(ctx: EngineContext, game: GameDefinition, state: VmState, frame: ScriptFrame, id: string): EnergyComboScope {
  const b = state.battle, top = state.flow.at(-1), at = findCard(state, id), source = state.cards[id];
  const fail = (): never => { throw new NotYet("plain Combo Energy entry needs its original live Battle activation", "R486"); };
  if (!b || b.endCombo !== undefined || b.negated || !battleIntact(state) || state.phase !== "battle" ||
    !["offense", "defense"].includes(b.step) || b.skipped?.some(step => step === b.step) ||
    b.damage || b.markerLoss || b.guardKo || !top || top.phase !== "battle" || top.reask !== true || top.skipped ||
    game.phases.battle.steps[top.index] !== (b.step === "offense" ? "battleOffenseCombo" : "battleDefenseCombo")) return fail();
  const actor = b.step === "offense" ? state.turnPlayer : state.turnPlayer === "p1" ? "p2" : "p1";
  const origin = b.comboOrigins?.[id];
  const activation = frame.skillEffectOrigin;
  if (activation?.version !== 2 || activation.kind !== "activate" || frame.skillIndex === undefined ||
    frame.skillIndex >= COPIED_SKILL_BASE || frame.copiedSkillCapture) return fail();
  const skill = skillsShowing(ctx, state, frame.card).skills.find(s => s.index === frame.skillIndex);
  if (!skill || !["activate:battle", "activate:main/battle"].includes(skill.kind) || frame.trigger !== undefined ||
    frame.replacing || frame.replacementAuto || frame.replacementFallback || frame.master !== actor || !source ||
    at?.zone !== "combo" || at.owner !== actor || source.owner !== actor || source.hidden || source.under.length ||
    !["hand", "battle"].includes(origin ?? "")) return fail();
  const attacker = state.cards[b.attacker], guard = state.cards[b.guard], attacks = attacker?.attacksThisTurn;
  if (!attacker || !guard || typeof attacks !== "number" || !Number.isSafeInteger(attacks) || attacks < 1 ||
    !Number.isSafeInteger(state.turn) || state.turn < 1 || !Number.isSafeInteger(top.index) || !Number.isSafeInteger(top.repeats)) return fail();
  // These are existing native facts, not a new battle serial or a state snapshot.
  // A resumed child must still belong to this exact activation and Combo source.
  return {
    version: 1, turn: state.turn, turnPlayer: state.turnPlayer, actor,
    activation: { version: 2, kind: "activate", ...(activation.scope !== undefined ? { scope: activation.scope } : {}) },
    attacker: { card: b.attacker, epoch: attacker.zoneEpoch ?? 0, attacks },
    guard: { card: b.guard, epoch: guard.zoneEpoch ?? 0 }, target: b.target, step: b.step as "offense" | "defense",
    flow: { depth: state.flow.length, phase: "battle", index: top.index, repeats: top.repeats, reask: true,
      ...(top.asking ? { asking: [...top.asking] } : {}) },
    source: { card: id, epoch: source.zoneEpoch ?? 0, holder: at.owner, origin: origin as "hand" | "battle",
      ...(b.comboVia?.[id] !== undefined ? { via: b.comboVia[id] } : {}) },
  };
}
