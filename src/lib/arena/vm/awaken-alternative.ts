/** R474: a free life gate OR one exact transfer from one own Battle pile. */
import type { Cond, Selector } from "./script";
import { condProblem, selectorProblem } from "./script-schema";

export interface AwakenAlternative {
  version: 1;
  free: Extract<Cond, { kind: "life" }>;
  host: Selector;
  count: number;
}
export function awakenAlternativeProblem(value: unknown): string | null {
  const a = value as AwakenAlternative | null;
  if (!a || typeof a !== "object" || Array.isArray(a) || a.version !== 1 || Object.keys(a).some(key => !["version", "free", "host", "count"].includes(key))) return "invalid alternative Awaken contract";
  if (!a.free || a.free.kind !== "life" || a.free.side !== "you" || !Number.isSafeInteger(a.free.atMost) || a.free.atMost! < 0 || Object.keys(a.free).some(key => !["kind", "side", "atMost"].includes(key))) return "alternative Awaken needs its own-life ceiling";
  if (!a.host || a.host.side !== "you" || a.host.area !== "battle" || Object.keys(a.host).some(key => !["side", "area", "filter"].includes(key)) || !a.host.filter) return "alternative Awaken needs one own Battle Area host";
  if (!Number.isSafeInteger(a.count) || a.count < 1) return "alternative Awaken needs an exact positive payer count";
  return condProblem(a.free) ?? selectorProblem(a.host, "awakenAlternative.host");
}
