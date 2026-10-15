"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireSl, isArenaAdmin, currentUser } from "@/lib/auth";
import { approveRuleExplanation, requestRuleExplanation, retryExplanationIssue } from "@/lib/arena/rule-explanation-store";
import type { ExplanationResult } from "@/lib/arena/rule-explanation";
import { reopenReviewedRule, type ReviewItem } from "@/lib/arena/rule-review-store";

export async function reopenReviewedRuleAction(id: number, context: { decks: string[]; firedIn: number | null }): Promise<{ error: string | null; item: ReviewItem | null }> {
  await requireSl();
  if (!(await isArenaAdmin())) return { error: "Only an arena admin can reopen rule reviews.", item: null };
  if (!Number.isInteger(id) || !context || !Array.isArray(context.decks) || !context.decks.every((name) => typeof name === "string") || (context.firedIn !== null && !Number.isInteger(context.firedIn))) return { error: "Invalid review context.", item: null };
  try {
    const item = await reopenReviewedRule(db, id, context);
    revalidatePath("/arena/rules");
    revalidatePath("/arena/rules/review");
    return { error: null, item };
  } catch (error) { return { error: error instanceof Error ? error.message : "Could not reopen this interpretation.", item: null }; }
}

export async function requestExplanationAction(id: number, version: string, explanation: string): Promise<{ error: string | null; result: ExplanationResult | null }> {
  await requireSl();
  if (!(await isArenaAdmin())) return { error: "Only an arena admin can request rule explanations.", result: null };
  try {
    const result = await requestRuleExplanation(db, id, version, explanation, await currentUser());
    revalidatePath("/arena/feedback");
    return { error: null, result };
  } catch (error) { return { error: error instanceof Error ? error.message : "Could not request a rule draft.", result: null }; }
}

export async function approveExplanationAction(id: number, proposalId: number, token: string): Promise<{ error: string | null }> {
  await requireSl();
  if (!(await isArenaAdmin())) return { error: "Only an arena admin can approve rule explanations." };
  if (!Number.isInteger(id) || !Number.isInteger(proposalId) || typeof token !== "string") return { error: "No valid proposal was selected." };
  try {
    await approveRuleExplanation(db, id, proposalId, token);
    revalidatePath("/arena/rules");
    revalidatePath("/arena/rules/review");
    return { error: null };
  } catch (error) { return { error: error instanceof Error ? error.message : "The proposal could not be approved." }; }
}

export async function retryExplanationIssueAction(proposalId: number): Promise<{ error: string | null; result: ExplanationResult | null }> {
  await requireSl();
  if (!(await isArenaAdmin())) return { error: "Only an arena admin can sync coding feedback.", result: null };
  if (!Number.isInteger(proposalId)) return { error: "No coding feedback was selected.", result: null };
  try { return { error: null, result: await retryExplanationIssue(db, proposalId) }; }
  catch (error) { return { error: error instanceof Error ? error.message : "Could not sync coding feedback.", result: null }; }
}
