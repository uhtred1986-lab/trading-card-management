/** R476 reader only: admission stays blocked until the native entry procedure exists. */
import type { Color, Skill } from "../types";
import type { EnergyEntryExhaustPolicy } from "../vm/energy-entry-policy";
import { energyEntryPolicyProblem } from "../vm/energy-entry-policy";

const COLORS: Record<string, Color> = { red: "Red", blue: "Blue", green: "Green", yellow: "Yellow" };

export function compileEnergyEntryPolicy(skill: Skill): EnergyEntryExhaustPolicy | undefined {
  if (skill.kind !== "permanent" || skill.cost.trim() || skill.energyEither.length ||
    Object.values(skill.energyCost).some(Boolean) || skill.markerCost != null ||
    skill.burst != null || skill.spiritBoost != null) return;
  const text = skill.effect.toLowerCase().replace(/\s+/g, " ").trim();
  const match = /^when placing this card (?:in|into) your energy(?: area)? from any area, you may choose 1 (red|blue|green|yellow) card and 1 (red|blue|green|yellow) card in your drop area and send them to your warp\. if you do, negate this card's \[energy-exhaust\] skill\.$/.exec(text);
  if (!match) return;
  const policy: EnergyEntryExhaustPolicy = { version: 1, colors: [COLORS[match[1]], COLORS[match[2]]] };
  return energyEntryPolicyProblem(policy) ? undefined : policy;
}
