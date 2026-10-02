/**
 * What the two "Teach it" panels (#473) share: a stored row as a `Rule`, the
 * words of the clause being taught, and a rule read back clause by clause.
 *
 * Pure and client-safe, like `lang/`: the verify scripts call it with no
 * database, and the panels may read a rule back in the browser.
 */
import { describeTrigger } from "../gaps";
import { costSentence, describeCond, describeScript, type Cond, type CostRecord, type Op } from "../vm/script";
import type { Trigger } from "../types";
import type { Rule } from "../lang/ast";
import type { RuleClause } from "../lang/path";

/** The row's fields a `Rule` is made of. */
export interface RuleFields {
  kind: string;
  trigger: unknown;
  cost: unknown;
  cond: unknown;
  ops: unknown;
}

/** A `card_rules` row as the rules language holds it: WHEN / COST / IF / THEN. */
export function ruleOfRow(row: RuleFields): Rule {
  return {
    kind: row.kind,
    trigger: ((row.trigger as Trigger[] | null) ?? []) as Trigger[],
    cost: (row.cost as CostRecord | null) ?? null,
    cond: (row.cond as Cond | null) ?? null,
    ops: ((row.ops as Op[] | null) ?? []) as Op[],
  };
}

/** The skill line without its leading tags: "[Auto] [Once per turn] When…" → "When…". */
export function effectText(printed: string): string {
  return printed
    .replace(/^\s*(?:\[[^\]]*\]\s*)+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The words the clause being taught is about: the first clause the compiler
 * could not read, or — when it read everything and read it wrongly — the
 * effect itself. The same choice `ai/clarify.ts` makes.
 */
export function clauseText(row: { unread: string[]; printed: string }): string {
  const raw = row.unread[0] ?? effectText(row.printed);
  return raw.replace(/[\s.,;:]+$/, "").trim();
}

/** The four clause names as the language writes them. */
export const CLAUSE_WORD: Record<RuleClause, string> = { trigger: "WHEN", cost: "COST", cond: "IF", ops: "THEN" };

/** One clause of a rule, in plain words — what the builder's block would read under it. Empty when the clause is. */
export function readClause(rule: Rule, clause: RuleClause): string {
  switch (clause) {
    case "trigger":
      return rule.trigger.length ? describeTrigger(rule.trigger) : "";
    case "cost":
      return costSentence(rule.cost) ?? "";
    case "cond":
      return rule.cond ? `if ${describeCond(rule.cond)}` : "";
    case "ops":
      return describeScript(rule.ops, { permanent: rule.kind === "permanent" });
  }
}

/** The whole rule in one sentence, clause by clause, for "the engine would read". */
export function readRuleWords(rule: Rule): string {
  const when = readClause(rule, "trigger");
  const cost = readClause(rule, "cost");
  const cond = readClause(rule, "cond");
  const then = readClause(rule, "ops") || "nothing";
  return [when, cost ? `pay ${cost}` : "", cond, then].filter(Boolean).join(", ");
}
