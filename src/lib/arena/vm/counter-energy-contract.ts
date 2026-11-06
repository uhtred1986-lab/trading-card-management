/** R463: bounded energy-origin Counter permissions, with mandatory energy. */
import { emptyFilter } from "../text/filters";
import type { Op } from "./script";

export function counterEnergyPermit(leaderGate: boolean, discard: boolean): Extract<Op, { op: "permit" }> {
  return {
    op: "permit",
    what: "counterFromEnergy",
    until: "game",
    target: { sel: { special: "self" } },
    price: {
      payment: { version: 1, readable: true, orbs: {}, either: [], marker: null, burst: null, spiritBoost: null },
      condition: leaderGate
        ? { kind: "leaderMatches", filter: { ...emptyFilter(), colors: ["Blue"], traits: ["red ribbon army"] } }
        : null,
      ops: discard ? [
        { op: "choose", sel: { side: "you", area: "hand", count: 1, upTo: false }, as: "counterEnergyHand" },
        { op: "moveTo", target: { var: "counterEnergyHand" }, to: "drop" },
      ] : [],
    },
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function counterEnergyPermitProblem(value: unknown): string | null {
  const actual = stable(value);
  const supported = [[false, true], [true, true], [true, false]];
  return supported.some(([leader, discard]) => actual === stable(counterEnergyPermit(leader, discard)))
    ? null
    : "rebuild the typed own-energy Counter permission and mandatory price";
}

/** R463's one paid-admission consumer; an inner repeated gate is not this body. */
export function counterEnergyAttackBody(ops: readonly Op[]): boolean {
  const choose = ops[1];
  if (choose?.op !== "choose") return false;
  const expected: Op[] = [
    { op: "negateAttack" },
    { op: "choose", sel: { special: "self" }, as: choose.as, ...(choose.reason === undefined ? {} : { reason: choose.reason }) },
    { op: "play", target: { var: choose.as } },
    { op: "if", cond: { kind: "counterActivatedFrom", from: "energy", skill: "counter:attack" }, then: [
      { op: "moveTo", target: { sel: { side: "you", area: "deck", count: 1, upTo: false, take: 1 } }, to: "energy", mode: "rest", reveal: true, owner: "you" },
    ] },
  ];
  return stable(ops) === stable(expected);
}
