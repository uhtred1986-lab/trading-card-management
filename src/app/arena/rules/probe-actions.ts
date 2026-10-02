"use server";

/**
 * Try it → fix it (#470): the server half of the panel the block builder
 * mounts (`components/arena/rules/tryit/TryItPanel.tsx`).
 *
 * The rule tried is the one in the builder, unsaved — read and checked here
 * (`readRule`, against the row's own skill tag) and never written. The only
 * write is the owner's judgements (`card_rules.expectations`). Every action
 * checks `isArenaAdmin()`: Try it reads nothing secret, but it is the
 * builder's, and the builder is an admin's tool.
 *
 * A file of its own rather than more of `app/arena/actions.ts`, which the
 * builder (#469) is changing at the same time.
 */
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { cardRules } from "@/db/schema";
import { isArenaAdmin } from "@/lib/auth";
import { readRule } from "@/lib/arena/lang";
import { defsForCards } from "@/lib/arena/load";
import { ruleById, setExpectations } from "@/lib/arena/rules-store";
import { probeRuleOf, readExpectations, tryRule, type Expectation, type TryResult } from "@/lib/arena/tryit";

const REFUSED = "admins only";
/** Kept boards per try: a judged or changed board each, and no more than a phone screen can sensibly hold. */
const MAX_EXTRA = 24;

/**
 * Try a rule that has not been saved: every board its trigger and condition
 * call for, plus `boards` (the keys of judged and changed boards), on the
 * engine games use and on the legacy one beside it.
 */
export async function tryRuleAction(cardId: string, side: "front" | "back", skillIndex: number, rule: unknown, boards: string[] = []): Promise<{ error: string | null; result: TryResult | null }> {
  if (!(await isArenaAdmin())) return { error: REFUSED, result: null };
  const [row] = await db
    .select({ kind: cardRules.kind })
    .from(cardRules)
    .where(and(eq(cardRules.cardId, cardId), eq(cardRules.side, side === "back" ? "back" : "front"), eq(cardRules.skillIndex, skillIndex)));
  // The printed tag comes off the row; with no row yet, off the rule, which
  // `readRule` still checks for shape.
  const kind = row?.kind ?? (rule && typeof rule === "object" && typeof (rule as { kind?: unknown }).kind === "string" ? (rule as { kind: string }).kind : "");
  const read = readRule(rule, kind);
  if ("error" in read) return { error: read.error.message, result: null };
  const def = (await defsForCards(db, [cardId]))[cardId];
  if (!def) return { error: "no such card", result: null };
  const keys = Array.isArray(boards) ? boards.filter((k): k is string => typeof k === "string" && k.length <= 400).slice(0, MAX_EXTRA) : [];
  return { error: null, result: tryRule(probeRuleOf(read.rule, def, side === "back" ? "back" : "front", skillIndex), keys) };
}

/** `tryRuleAction` for the rule row the builder is editing. */
export async function tryRuleByIdAction(ruleId: number, rule: unknown, boards: string[] = []): Promise<{ error: string | null; result: TryResult | null }> {
  if (!(await isArenaAdmin())) return { error: REFUSED, result: null };
  const row = await ruleById(db, ruleId);
  if (!row) return { error: "no such rule", result: null };
  return tryRuleAction(row.cardId, row.side === "back" ? "back" : "front", row.skillIndex, rule, boards);
}

/** The owner's judgements on this rule, as stored. */
export async function expectationsAction(ruleId: number): Promise<{ error: string | null; expectations: Expectation[] }> {
  if (!(await isArenaAdmin())) return { error: REFUSED, expectations: [] };
  const row = await ruleById(db, ruleId);
  if (!row) return { error: "no such rule", expectations: [] };
  return { error: null, expectations: readExpectations(row.expectations) };
}

/**
 * Keep the owner's judgements as the rule's tests. Written as they are made
 * rather than with the rule's SAVE: a judgement is about what the *card*
 * should do, true of every version of its rule, and the builder's save is
 * not this panel's to extend. Checked, not trusted: whatever is not an
 * expectation is dropped.
 */
export async function saveExpectationsAction(ruleId: number, expectations: unknown): Promise<{ error: string | null; saved: number }> {
  if (!(await isArenaAdmin())) return { error: REFUSED, saved: 0 };
  const row = await ruleById(db, ruleId);
  if (!row) return { error: "no such rule", saved: 0 };
  const list = readExpectations(expectations).slice(0, MAX_EXTRA * 2);
  await setExpectations(db, ruleId, list);
  revalidatePath("/arena/rules");
  return { error: null, saved: list.length };
}
