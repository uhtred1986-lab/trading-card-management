/** Private SL proposals live in feedback, never executable card_rules drafts. No new schema. */
import { createHash } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import type { Db } from "@/db";
import { arenaFeedback, cardRules } from "@/db/schema";
import { listRemoteIssues, syncFeedbackItem, type FeedbackItem } from "@/lib/github";
import { generateRuleExplanation } from "./ai/explain-rule";
import { explainDecision, type ExplanationDecision, type ExplanationResult } from "./rule-explanation";
import { reviewVersion } from "./rule-review-version";
import { saveReviewedExplanation, type RuleRow } from "./rules-store";
import { canonical } from "./lang/print";
import { AiError } from "@/lib/ai/errors";

interface Proposal {
  type: "rule-explanation-v1"; base: string; explanation: string; decision: ExplanationDecision;
  token: string; approved: boolean; issueUrl: string | null; issueError: string | null;
}
export interface ExplanationServices {
  generate(db: Db, rule: RuleRow, explanation: string): Promise<unknown>;
  sync(item: FeedbackItem): Promise<{ url: string }>;
}
const defaults: ExplanationServices = {
  generate: generateRuleExplanation,
  sync: async (item) => {
    // A retry must not create another issue from the integration's stale cache.
    const remote = await listRemoteIssues(undefined, { forceRefresh: true });
    const result = await syncFeedbackItem(item, undefined, remote);
    if (!result.issue.html_url) throw new Error("GitHub did not return an issue link.");
    return { url: result.issue.html_url };
  },
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const envelope = (value: unknown): Proposal => {
  if (!value || typeof value !== "object" || (value as Proposal).type !== "rule-explanation-v1") throw new Error("No explanation proposal exists here.");
  return value as Proposal;
};
const mutable = (row: RuleRow, expected: string) => {
  if (!expected || reviewVersion(row) !== expected) throw new Error("This skill changed. Reload it before requesting or approving an explanation.");
  if (row.status === "confirmed" || row.status === "corrected") throw new Error("Reopen the approved interpretation before requesting a replacement.");
};
const resultOf = (id: number, state: Proposal): ExplanationResult => ({
  decision: state.decision, proposalId: id, token: state.token, issueUrl: state.issueUrl, issueError: state.issueError,
});

/** No call is made until the owner presses Request draft. Provider dependencies are injectable for offline integration. */
export async function requestRuleExplanation(db: Db, id: number, expected: string, explanation: string, reportedBy: string | null, services: ExplanationServices = defaults): Promise<ExplanationResult> {
  if (!Number.isInteger(id) || typeof explanation !== "string" || !explanation.trim() || explanation.length > 12000) throw new Error("Explain the complete intended skill in 1–12000 characters.");
  const row = await db.query.cardRules.findFirst({ where: eq(cardRules.id, id) });
  if (!row) throw new Error("No such rule.");
  mutable(row, expected);
  let answer: unknown;
  try { answer = await services.generate(db, row, explanation.trim()); }
  catch (error) {
    if (error instanceof AiError && error.kind === "bad_output") return { decision: { kind: "invalid", error: "Claude returned invalid output. Nothing was changed; revise the explanation or try again." }, proposalId: null, token: null, issueUrl: null, issueError: null };
    throw error;
  }
  const decision = explainDecision(answer, row.kind, row.printed, row.skillIndex);
  if (decision.kind === "question" || decision.kind === "invalid") return { decision, proposalId: null, token: null, issueUrl: null, issueError: null };
  const response = await db.transaction(async (transaction) => {
    const tx = transaction as unknown as Db;
    const [current] = await tx.select().from(cardRules).where(eq(cardRules.id, id)).for("update");
    if (!current) throw new Error("No such rule.");
    mutable(current, expected); // Includes edits made while the model was answering.
    const key = digest({ ruleId: id, base: expected, explanation: explanation.trim(), kind: decision.kind,
      proposal: decision.kind === "unsupported" ? [...decision.missing].sort() : decision.rule });
    const marker = `[rule-explanation:${key}]`;
    const [existing] = await tx.select().from(arenaFeedback).where(and(eq(arenaFeedback.noteId, id), like(arenaFeedback.note, `${marker}%`))).for("update");
    if (existing) return resultOf(existing.id, envelope(existing.state));
    const state: Proposal = { type: "rule-explanation-v1", base: expected, explanation: explanation.trim(), decision,
      token: digest({ base: expected, explanation: explanation.trim(), decision }), approved: false, issueUrl: null, issueError: null };
    const note = [marker, decision.kind === "unsupported" ? "Engine coding required; not an approved rule." : "Owner-requested rule proposal; awaiting explicit approval.",
      `Card: ${row.cardId}; face: ${row.side}; skill: ${row.skillIndex}; rule: ${id}`,
      `Printed text:\n${row.printed}`, `Owner explanation:\n${explanation.trim()}`, `Proposed interpretation:\n${decision.meaning}`,
      decision.kind === "unsupported" ? `Proposed rule:\n${decision.proposed}\nMissing capability:\n${decision.missing.join("\n")}` : decision.reading].join("\n\n");
    const [saved] = await tx.insert(arenaFeedback).values({ kind: decision.kind === "supported" ? "rule-proposal" : "rule", note, noteId: id, cardId: row.cardId, skillIndex: row.skillIndex, reportedBy, state }).returning();
    return resultOf(saved.id, state);
  });
  return decision.kind === "unsupported" ? retryExplanationIssue(db, response.proposalId!, services) : response;
}

/** Serialize external sync with its persisted receipt. Retried HTTP failures refresh GitHub before creating. */
export async function retryExplanationIssue(db: Db, proposalId: number, services: ExplanationServices = defaults): Promise<ExplanationResult> {
  return db.transaction(async (transaction) => {
    const tx = transaction as unknown as Db;
    const [feedback] = await tx.select().from(arenaFeedback).where(eq(arenaFeedback.id, proposalId)).for("update");
    if (!feedback) throw new Error("No such coding feedback.");
    const state = envelope(feedback.state);
    if (state.decision.kind !== "unsupported") throw new Error("This proposal does not require a coding issue.");
    if (!state.issueUrl) {
      try { state.issueUrl = (await services.sync(feedback)).url; state.issueError = null; }
      catch { state.issueError = "Feedback is saved. GitHub sync failed; no issue link is confirmed. Retry when the integration is available."; }
      await tx.update(arenaFeedback).set({ state }).where(eq(arenaFeedback.id, proposalId));
    }
    return resultOf(proposalId, state);
  });
}

export async function approveRuleExplanation(db: Db, id: number, proposalId: number, token: string): Promise<void> {
  await db.transaction(async (transaction) => {
    const tx = transaction as unknown as Db;
    // Same lock order as request: rule before feedback, avoiding cross-request deadlocks.
    const [row] = await tx.select().from(cardRules).where(eq(cardRules.id, id)).for("update");
    if (!row) throw new Error("No such rule.");
    const [feedback] = await tx.select().from(arenaFeedback).where(and(eq(arenaFeedback.id, proposalId), eq(arenaFeedback.noteId, id))).for("update");
    if (!feedback) throw new Error("No such rule proposal.");
    const state = envelope(feedback.state);
    if (state.approved || !token || state.token !== token || state.token !== digest({ base: state.base, explanation: state.explanation, decision: state.decision })) throw new Error("This proposal changed or was already approved. Review a fresh draft.");
    if (state.decision.kind !== "supported") throw new Error("Only a complete supported proposal can be approved.");
    // Revalidate at approval against the current runtime, not just the model's earlier answer.
    mutable(row, state.base);
    const check = explainDecision({ meaning: state.decision.meaning, confident: true, question: "", missingCapability: "", ruleJson: JSON.stringify(state.decision.rule) }, row.kind, row.printed, row.skillIndex);
    if (check.kind !== "supported") throw new Error("This proposal requires further capability review before approval.");
    await saveReviewedExplanation(tx, id, state.base, check.rule, `${state.explanation}\n\nClaude's proposed interpretation: ${check.meaning}`);
    state.approved = true;
    await tx.update(arenaFeedback).set({ state, status: "fixed", resolution: "Owner explicitly approved this exact complete rule proposal.", resolvedAt: new Date() }).where(eq(arenaFeedback.id, proposalId));
  });
}
