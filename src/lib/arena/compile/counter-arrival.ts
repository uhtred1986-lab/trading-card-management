/** R435: preserve the corrected erratum text, compile the owner's FAQ policy. */
import type { Skill } from "../types";
import type { Script } from "../vm/script";
import { ultrasonicArrivalProgram } from "../vm/counter-arrival-policy";

const ULTRASONIC = "you can activate this skill if your opponent declares they're playing a battle card with 20000 power or less. your opponent may place that battle card in their drop area instead of playing it. if they don't, they choose 1 of their battle cards and place it in its owner's drop area.";

export function compileCounterArrival(skill: Skill): Script | null {
  const text = skill.effect.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  if (skill.kind !== "counter:play" || skill.cost.trim() || text !== ULTRASONIC) return null;
  // The typed incoming condition is evaluated for each actual arrival. Hoisting
  // it into row.cond would wrongly refuse unknown-card skill declarations.
  return { ops: ultrasonicArrivalProgram(), unsupported: [], keepResolutionCondition: true };
}
