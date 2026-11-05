/** R466: the first under-card Counter permission is the printed Trunks/Plan route. */
import { emptyFilter } from "../text/filters";
import type { Op } from "./script";

type Permit = Extract<Op, { op: "permit" }>;
/** Kept standalone until the reviewed route is wired into the shared Op schema. */
export type CounterUnderPermit = Omit<Permit, "what"> & {
  what: "counterFromUnder";
  counterUnder: { version: 1; asHand: true };
};

export function counterUnderPermit(): CounterUnderPermit {
  return {
    op: "permit",
    what: "counterFromUnder",
    counterUnder: { version: 1, asHand: true },
    until: "game",
    target: { sel: { special: "self" } },
    source: { ...emptyFilter(), names: ["universal tuffleization plan"] },
    price: {
      payment: { version: 1, readable: true, orbs: {}, either: [], marker: null, burst: null, spiritBoost: null },
      condition: null,
      ops: [],
    },
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function counterUnderPermitProblem(value: unknown): string | null {
  return canonical(value) === canonical(counterUnderPermit()) ? null :
    "rebuild the exact self Counter permission under your Battle Area's Universal Tuffleization Plan";
}

/** Owner-approved hand-equivalent discount, read only during this Counter's price query. */
export function underCounterOwnDiscount(): Op[] {
  return [{
    op: "if", cond: { kind: "isTurnPlayer", who: "opponent" }, then: [{
      op: "if", cond: {
        kind: "count", sel: { side: "you", area: "play", filter: { ...emptyFilter(), colors: ["Blue"], characters: ["baby"] } }, atLeast: 1,
      }, then: [{ op: "costReduction", target: { sel: { special: "self" } }, amount: 2, until: "game" }],
    }],
  }];
}

export function isUnderCounterOwnDiscount(ops: readonly Op[]): boolean {
  return canonical(ops) === canonical(underCounterOwnDiscount());
}
