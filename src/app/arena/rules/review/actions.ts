"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { currentUser, isArenaAdmin } from "@/lib/auth";
import { reviewOpenRule } from "@/lib/arena/draft";
import { parsePath } from "@/lib/arena/lang/path";
import { WRONG_REASONS, type ClauseTag, type WrongReason } from "@/lib/arena/rule-review";
import { flagWrong, reviewItemById, sameWordingIds, unflagWrong, type FlagReceipt, type ReviewItem } from "@/lib/arena/rule-review-store";
import { confirmAllAction } from "../../actions";

/**
 * The phone review queue's own writes (#472). Reads right, its Undo and the
 * Undo of Confirm all call the workbench's actions directly; these are the
 * writes that had no action yet. Each checks `isArenaAdmin()` itself — the
 * page shows a non-admin the queue read-only, but an action is a public
 * endpoint and does not trust the page.
 */

const NOT_ADMIN = "only an arena admin can record a verdict";
const TAGS: (ClauseTag | "UNREAD")[] = ["WHEN", "COST", "IF", "DO", "UNREAD"];

function revalidate() {
  revalidatePath("/arena/rules");
  revalidatePath("/arena/rules/review");
  revalidatePath("/arena/feedback");
}

/** Wrong: the clause and the reason, and an optional note, onto the row's `explanation`. The rule stays a draft. */
export async function flagWrongAction(id: number, raw: { tag: unknown; path: unknown; reason: unknown; note: unknown }): Promise<{ error: string | null; receipt: FlagReceipt | null }> {
  if (!(await isArenaAdmin())) return { error: NOT_ADMIN, receipt: null };
  const tag = TAGS.find((t) => t === raw.tag);
  const reason = WRONG_REASONS.find((r) => r === raw.reason) as WrongReason | undefined;
  if (!tag) return { error: "which part reads wrong?", receipt: null };
  if (!reason) return { error: "pick what is off", receipt: null };
  let path: string | null = null;
  if (typeof raw.path === "string" && raw.path) {
    try {
      parsePath(raw.path);
      path = raw.path;
    } catch {
      return { error: "that part of the rule does not exist", receipt: null };
    }
  }
  const note = typeof raw.note === "string" ? raw.note : null;
  const receipt = await flagWrong(db, id, { tag, path, reason, note }, await currentUser());
  if (!receipt) return { error: "no such rule", receipt: null };
  revalidate();
  return { error: null, receipt };
}

/** Undo of Wrong. */
export async function unflagWrongAction(receipt: FlagReceipt): Promise<{ error: string | null }> {
  if (!(await isArenaAdmin())) return { error: NOT_ADMIN };
  if (!Number.isInteger(receipt?.ruleId) || !Number.isInteger(receipt?.feedbackId) || typeof receipt?.written !== "string") return { error: "there is nothing to undo" };
  await unflagWrong(db, { ruleId: receipt.ruleId, feedbackId: receipt.feedbackId, written: receipt.written, previous: typeof receipt.previous === "string" ? receipt.previous : null });
  revalidate();
  return { error: null };
}

/**
 * Confirm all N+1: `confirmAllAction` with the row's pattern, narrowed to the
 * unflagged drafts of it (`sameWordingIds`), so a draft someone flagged as
 * wrong is not confirmed behind their back. Returns the rule ids it aimed at,
 * so the phone can mark the ones in its queue.
 */
export async function confirmSameWordingAction(id: number): Promise<{ error: string | null; confirmed: number; batchId: number | null; ids: number[] }> {
  if (!(await isArenaAdmin())) return { error: NOT_ADMIN, confirmed: 0, batchId: null, ids: [] };
  const same = await sameWordingIds(db, id);
  if (!same) return { error: "this rule is not a draft with a pattern to confirm", confirmed: 0, batchId: null, ids: [] };
  const res = await confirmAllAction({ pattern: same.pattern, ruleIds: same.ids });
  revalidatePath("/arena/rules/review");
  return { ...res, ids: same.ids };
}

/** Ask Claude: the sync's drafting (`draft.ts`) for this one open skill; what comes back is a draft to check. */
export async function askClaudeAction(id: number, keep: { decks: string[]; firedIn: number | null }): Promise<{ error: string | null; item: ReviewItem | null }> {
  if (!(await isArenaAdmin())) return { error: "only an arena admin can ask Claude for a draft", item: null };
  const r = await reviewOpenRule(db, id);
  revalidate();
  const decks = Array.isArray(keep?.decks) ? keep.decks.filter((d): d is string => typeof d === "string").slice(0, 50) : [];
  const item = await reviewItemById(db, id, { decks, firedIn: Number.isInteger(keep?.firedIn) ? keep.firedIn : null });
  return { error: r.drafted ? null : `Claude could not draft it: ${r.why ?? "no program came back"}`, item };
}
