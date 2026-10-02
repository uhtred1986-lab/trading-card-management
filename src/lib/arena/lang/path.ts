/**
 * A place inside one `Rule`, written the way you would reach it in code:
 * `trigger`, `cost`, `cond`, `cond.conds[1]`, `ops[2]`, `ops[2].ops[0]`.
 *
 * The one address the rule tooling shares: the block builder (#469) opens the
 * block a path names, Try it (#470) tags each probe beat with the path of the
 * op or condition that made it, and the review queue (#472) names the clause a
 * verdict is about. A path is relative to the `Rule` itself and is only ever
 * built from the rule's own field names — nothing here knows what an op is.
 *
 * Client-safe and pure, like the rest of `lang/`.
 */
import type { Rule } from "./ast";

export type RulePath = string;

/** The four clause blocks, in the order a rule reads. */
export type RuleClause = "trigger" | "cost" | "cond" | "ops";
export const RULE_CLAUSES: readonly RuleClause[] = ["trigger", "cost", "cond", "ops"];

/** One step of a path: a field name or a list index. */
export type PathStep = string | number;

const STEP = /([A-Za-z_$][\w$]*)|\[(\d+)\]/g;

/** `"ops[2].ops[0]"` → `["ops", 2, "ops", 0]`. Throws on anything else, so a malformed path is never silently the root. */
export function parsePath(path: RulePath): PathStep[] {
  const steps: PathStep[] = [];
  let at = 0;
  for (const m of path.matchAll(STEP)) {
    const gap = path.slice(at, m.index);
    // A field name follows a dot (or opens the path); an index follows nothing.
    const want = m[1] !== undefined && steps.length > 0 ? "." : "";
    if (gap !== want) throw new Error(`bad rule path "${path}" at ${at}`);
    steps.push(m[1] !== undefined ? m[1] : Number(m[2]));
    at = (m.index ?? 0) + m[0].length;
  }
  if (at !== path.length || steps.length === 0 || typeof steps[0] !== "string") throw new Error(`bad rule path "${path}"`);
  return steps;
}

/** `["ops", 2, "ops", 0]` → `"ops[2].ops[0]"`. */
export function formatPath(steps: readonly PathStep[]): RulePath {
  return steps.map((s, i) => (typeof s === "number" ? `[${s}]` : i === 0 ? s : `.${s}`)).join("");
}

/** A child of `path`: `childPath("ops[2]", "ops", 0)` → `"ops[2].ops[0]"`. */
export function childPath(path: RulePath, ...steps: PathStep[]): RulePath {
  return formatPath([...parsePath(path), ...steps]);
}

/** The clause block a path lives in. */
export function clauseOf(path: RulePath): RuleClause {
  const head = parsePath(path)[0];
  if (!(RULE_CLAUSES as readonly string[]).includes(head as string)) throw new Error(`rule path "${path}" is not in a clause`);
  return head as RuleClause;
}

/** What the path points at in `rule`, or `undefined` when it no longer exists (the rule was edited since). */
export function resolvePath(rule: Rule, path: RulePath): unknown {
  let at: unknown = rule;
  for (const s of parsePath(path)) {
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<string | number, unknown>)[s];
  }
  return at;
}
