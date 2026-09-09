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
 */
import { validateProgram, type Cond, type CostRecord, type Op } from "../engine/script";
import { TRIGGERS } from "../gaps";
import type { Rule } from "./ast";

export type Invalid = { field: "rule" | "kind" | "trigger" | "cost" | "cond" | "ops"; message: string };

const condOk = (c: unknown): boolean => validateProgram([{ op: "if", cond: c as Cond, then: [] }]);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * `kind` is what the row already says; a rule that names another one is
 * refused rather than silently kept, because the tag decides *when* the engine
 * even looks at the skill.
 */
export function validateRule(rule: unknown, kind: string): Invalid | null {
  if (!isObject(rule)) return { field: "rule", message: "that is not a rule" };
  if (rule.kind !== kind) return { field: "kind", message: `the skill is [${kind}] — the tag comes off the card and cannot be edited here` };
  if (!Array.isArray(rule.trigger) || rule.trigger.some((t) => typeof t !== "string")) return { field: "trigger", message: "WHEN is a list of moments" };
  const unknown = (rule.trigger as string[]).filter((t) => !(TRIGGERS as readonly string[]).includes(t));
  if (unknown.length) return { field: "trigger", message: `the engine knows no moment called ${unknown.map((t) => JSON.stringify(t)).join(", ")} — a trigger it never fires is a skill that never happens` };
  if (new Set(rule.trigger as string[]).size !== rule.trigger.length) return { field: "trigger", message: "the same moment is named twice" };
  if (rule.cond != null && !condOk(rule.cond)) return { field: "cond", message: "that condition is not one the engine can ask" };
  if (rule.cost != null) {
    const bad = costProblem(rule.cost);
    if (bad) return { field: "cost", message: bad };
  }
  if (!validateProgram(rule.ops)) return { field: "ops", message: "that is not a valid program — every step needs its required fields and known values" };
  return null;
}

/** The same check, narrowing: `null` back means the value really is a `Rule`. */
export function readRule(rule: unknown, kind: string): { rule: Rule } | { error: Invalid } {
  const bad = validateRule(rule, kind);
  return bad ? { error: bad } : { rule: rule as Rule };
}

function costProblem(cost: unknown): string | null {
  if (!isObject(cost)) return "a price is a record of its own, not a sentence";
  const c = cost as unknown as CostRecord;
  if (typeof c.text !== "string" || !isObject(c.orbs) || !Array.isArray(c.either)) return "the price is missing the shape a record has";
  for (const [orb, n] of Object.entries(c.orbs)) if (!Number.isInteger(n) || n < 1) return `${orb} is charged ${JSON.stringify(n)} times`;
  if (c.either.some((group) => !Array.isArray(group) || group.length < 2)) return "an either-orb needs two colours or more";
  for (const n of [c.marker, c.burst, c.spiritBoost]) if (n !== null && !Number.isInteger(n)) return "a marker, Burst or Spirit Boost count is a whole number or nothing";
  if (c.condition != null && !condOk(c.condition)) return "the price states a condition the engine cannot ask";
  if (c.program != null && !validateProgram(c.program as Op[])) return "the price charges a program the engine cannot run";
  return null;
}
