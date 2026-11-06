/** R435: preserve the corrected erratum text, compile the owner's FAQ policy. */
import type { Skill } from "../types";
import type { Script } from "../vm/script";
import { ultrasonicArrivalProgram, ULTRASONIC_EFFECT } from "../vm/counter-arrival-policy";

export function compileCounterArrival(skill: Skill): Script | null {
  const text = skill.effect.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  if (skill.kind !== "counter:play" || skill.cost.trim() || text !== ULTRASONIC_EFFECT) return null;
  // The typed incoming condition is evaluated for each actual arrival. Hoisting
  // it into row.cond would wrongly refuse unknown-card skill declarations.
  return { ops: ultrasonicArrivalProgram(), unsupported: [], keepResolutionCondition: true };
}
