/** R435: the owner-approved, per-arrival reading of Ultrasonic Exchange.
 * This is a persisted typed policy, not runtime interpretation of printed text.
 */
import { emptyFilter } from "../text/filters";
import type { Op } from "./script";
import { canonicalTaxValue } from "./tax-receipt";

export const COUNTER_ARRIVAL_POLICY = "eachQualifyingPlayV1" as const;
export interface CounterArrivalDescriptor {
  version: 1;
  policy: typeof COUNTER_ARRIVAL_POLICY;
}
export type CounterArrivalMode = Extract<Op, { op: "chooseMode" }> & {
  counterArrivalPolicy: typeof COUNTER_ARRIVAL_POLICY;
};

/** The corrected printed erratum is retained separately on the stored row. */
export function ultrasonicArrivalProgram(): Op[] {
  const choice: CounterArrivalMode = {
    op: "chooseMode",
    chooser: "opponent",
    counterArrivalPolicy: COUNTER_ARRIVAL_POLICY,
    modes: [
      {
        label: "Place the incoming Battle Card in its owner's Drop instead of playing it",
        ops: [{ op: "resolvingPlay", cardType: "BATTLE", instead: "drop" }],
      },
      {
        label: "Play it; choose an existing Battle Card to place in its owner's Drop",
        ops: [
          { op: "choose", chooser: "opponent", sel: { side: "opponent", area: "battle", count: 1, filter: { ...emptyFilter(), type: "BATTLE" } }, as: "arrivalFallback" },
          { op: "moveTo", target: { var: "arrivalFallback" }, to: "drop" },
        ],
      },
    ],
  };
  return [{
    op: "if",
    cond: { kind: "count", sel: { special: "resolving", filter: { ...emptyFilter(), type: "BATTLE", powerMax: 20000 } }, atLeast: 1 },
    then: [choice],
  }];
}

/** Exact whole-program contract; unrelated modal Counters remain unsupported.
 * Canonical JSON ignores object order and omitted undefined properties only.
 */
export function counterArrivalDescriptor(ops: unknown): CounterArrivalDescriptor | undefined {
  return canonicalTaxValue(ops) === canonicalTaxValue(ultrasonicArrivalProgram())
    ? { version: 1, policy: COUNTER_ARRIVAL_POLICY }
    : undefined;
}

export function hasCounterArrivalPolicy(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasCounterArrivalPolicy);
  if (!value || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  return Object.hasOwn(object, "counterArrivalPolicy") || Object.values(object).some(hasCounterArrivalPolicy);
}

export function counterArrivalPolicyProblem(ops: unknown): string | null {
  return hasCounterArrivalPolicy(ops) && !counterArrivalDescriptor(ops)
    ? "rebuild the exact per-arrival Counter decision policy"
    : null;
}
