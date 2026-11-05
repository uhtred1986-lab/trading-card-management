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

/** Detect a descriptor anywhere so unsupported wrappers never erase it. */
export function containsEnergyEntryDescriptor(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsEnergyEntryDescriptor);
  if (!value || typeof value !== "object") return false;
  const op = value as Record<string, unknown>;
  return op.op === "energyEntryExhaust" || Object.values(op).some(containsEnergyEntryDescriptor);
}

/** Whole stored descriptor only; an altered or mixed-body procedure is not guessed. */
export function energyEntryDescriptor(ops: readonly import("./script").Op[]): EnergyEntryExhaustPolicy | undefined {
  if (!containsEnergyEntryDescriptor(ops)) return;
  if (ops.length !== 1 || ops[0].op !== "energyEntryExhaust") return;
  const policy: EnergyEntryExhaustPolicy = { version: 1, colors: ops[0].colors };
  return energyEntryPolicyProblem(policy) ? undefined : policy;
}
