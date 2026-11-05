/** R476: an optional two-card effect before an Energy-Exhaust arrival.
 * This descriptor does not activate a skill or authorize a movement by itself. */
import type { Color } from "../types";

export interface EnergyEntryExhaustPolicy {
  version: 1;
  /** One distinct card from each color slot, from the controller's own Drop. */
  colors: [Color, Color];
}

const COLORS = ["Red", "Blue", "Green", "Yellow"] as const;

export function energyEntryPolicyProblem(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "invalid Energy entry policy";
  const policy = value as EnergyEntryExhaustPolicy;
  if (policy.version !== 1 || Object.keys(policy).some(key => key !== "version" && key !== "colors") ||
    !Array.isArray(policy.colors) || policy.colors.length !== 2 ||
    policy.colors.some(color => !(COLORS as readonly unknown[]).includes(color)) ||
    policy.colors[0] === policy.colors[1]) return "Energy entry policy needs two different printed color slots";
  return null;
}
