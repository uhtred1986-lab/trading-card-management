import { comboQualificationProblem } from "../vm/combo-qualification";
import { costRecordProblem } from "../vm/skill-payment";
/**
 * Is this rule executable? The structural half of the workbench's Save, and
 * the whole of it on the server, where the rule arrives as JSON from a browser
 * and nothing about its shape may be assumed.
 *
 * `validateProgram` already answers this for a program; a rule is a program
 * plus three things a person can now edit — the triggers, the price and the
 * hoisted condition — and each can be written in a way that parses and then
 * means nothing to the engine. A trigger the engine never fires is the
 * sharpest of the three: it reads perfectly, and the skill simply never
 * happens.
 *
 * The kind is checked rather than read: nothing on the workbench may change
 * the printed skill tag, so a rule whose WHEN names a different one is a
 * mistake to say out loud, not a change to store.
 *
 * The moments a WHEN may name are the **game's** (`rulesets/words.ts`, #137),
 * off `triggers.rules`, rather than a constant of the engine's.
 */
import { completeFilters, condProblem, programProblem } from "../vm/script";
import { whenMoments } from "../rulesets/words";
import type { Rule } from "./ast";

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export type Invalid = { field: "rule" | "kind" | "trigger" | "combo" | "cost" | "cond" | "ops"; message: string };

/**
 * `kind` is what the row already says; a rule that names another one is
 * refused rather than silently kept, because the tag decides *when* the engine
 * even looks at the skill.
 */
export function validateRule(rule: unknown, kind: string): Invalid | null {
  if (!isObject(rule)) return { field: "rule", message: "that is not a rule" };
  if (rule.kind !== kind) return { field: "kind", message: `the skill is [${kind}] — the tag comes off the card and cannot be edited here` };
  if (!Array.isArray(rule.trigger) || rule.trigger.some((t) => typeof t !== "string")) return { field: "trigger", message: "WHEN is a list of moments" };
  // The game's own moments, less the counter windows a [Counter] answers in
  // — `rulesets/words.ts` says why that is a reading of the declarations and
  // not a second list (#137).
  const moments = whenMoments();
  const unknown = (rule.trigger as string[]).filter((t) => !moments.includes(t));
  if (unknown.length) return { field: "trigger", message: `the engine knows no moment called ${unknown.map((t) => JSON.stringify(t)).join(", ")} — a trigger it never fires is a skill that never happens` };
  if (new Set(rule.trigger as string[]).size !== rule.trigger.length) return { field: "trigger", message: "the same moment is named twice" };
  if (rule.combo != null) {
    const bad = comboQualificationProblem(rule.combo);
    if (bad) return { field: "combo", message: bad };
    const q = rule.combo as import("../vm/combo-qualification").ComboQualification;
    if (!rule.trigger.includes(q.timing === "entry" ? "comboUsed" : "comboed"))
      return { field: "combo", message: "typed combo timing has no corresponding WHEN trigger" };
  }
  if (rule.cond != null) {
    const bad = condProblem(rule.cond, 0, false, "cond");
    if (bad) return { field: "cond", message: `that condition is not one the engine can ask — ${bad}` };
  }
  if (rule.cost != null) {
    const bad = costProblem(rule.cost);
    if (bad) return { field: "cost", message: bad };
  }
  // 20-5: the price is what binds X, so it is read before the steps are
  // checked. A rule that says `X` with no X in its price is refused here
  // rather than resolving as nothing at the table.
  //
  // Two prices bind one: an energy `{X}` (`cost.x`), and a price that is a
  // *choice* carrying `bindX` ("discard any number of cards: … X cards"),
  // whose value crosses into the effect on the same continuation its names
  // do. Only the price program's own top-level steps count, the same rule
  // `validateProgram` applies inside a program: a `bindX` in a branch has not
  // bound anything unless the branch ran.
  const xBound = isObject(rule.cost) && (isObject((rule.cost as Record<string, unknown>).x) || bindsX((rule.cost as Record<string, unknown>).program));
  //
  // Every step, condition, selector and filter is checked key by key
  // (3 Oct 2026): BT31-132 was stored with `"from"` where a selector says
  // `fromVar`, and the engine chose from the Battle Area instead.
  const bad = programProblem(rule.ops, 0, xBound, "ops");
  if (bad) return { field: "ops", message: `that is not a valid program — ${bad}` };
  return null;
}

/**
 * The same check, narrowing: `null` back means the value really is a `Rule`.
 * The rule handed back has every filter made whole (`completeFilters`): a
 * partial filter is accepted, since Claude writes only the measures it means,
 * but it is stored as the whole filter it means.
 */
export function readRule(rule: unknown, kind: string): { rule: Rule } | { error: Invalid } {
  const bad = validateRule(rule, kind);
  return bad ? { error: bad } : { rule: completeFilters(rule as Rule) };
}

/** Does this price's program bind X, at its own top level? */
function bindsX(program: unknown): boolean {
  return Array.isArray(program) && program.some((op) => isObject(op) && op.op === "choose" && op.bindX === true);
}

function costProblem(cost: unknown): string | null {
  return costRecordProblem(cost);
}
