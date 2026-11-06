/** R438: the bounded own-Drop Counter permission is executable stored data. */
import type { Color } from "../types";
import { emptyFilter } from "../text/filters";
import type { Op } from "./script";

export const COUNTER_DROP_COLORS = ["Red", "Blue", "Green", "Yellow"] as const;
export function counterDropPermit(color: Color): Extract<Op, { op: "permit" }> {
  return { op: "permit", what: "counterFromDrop", until: "game", target: { sel: { special: "self" } }, price: {
    payment: { version: 1, readable: true, orbs: {}, either: [], marker: null, burst: null, spiritBoost: null },
    condition: null,
    ops: [
      { op: "moveTo", target: { sel: { special: "self", area: "drop" } }, to: "removed" },
      { op: "choose", sel: { side: "you", area: "hand", count: 1, upTo: false, filter: { ...emptyFilter(), colors: [color] } }, as: "counterDropHand" },
      { op: "moveTo", target: { var: "counterDropHand" }, to: "removed" },
    ],
  } };
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
/** Exact bounded price/target authority, insensitive to JSON property order. */
export function counterDropPermitProblem(value: unknown): string | null {
  const actual = stable(value);
  return COUNTER_DROP_COLORS.some(color => actual === stable(counterDropPermit(color))) ? null : "rebuild the typed own-Drop Counter permission and mandatory removal price";
}
