"use client";

import { RuleReview } from "./RuleReview";
import type { ReviewItem } from "@/lib/arena/rule-review-store";
import type { ExplanationActions } from "./RuleExplanationPanel";
import type { ExplanationResult } from "@/lib/arena/rule-explanation";
import type { Rule } from "@/lib/arena/lang/ast";

/** Dev-only page supplies synthetic outcomes; never calls a provider or database. */
export const PREVIEW_RULE: Rule = {
  kind: "activate:main", trigger: [], cost: { text: "Pay one red and one other energy", orbs: { Red: 1, any: 1 }, either: [], marker: null, burst: null, spiritBoost: null, condition: null, program: null },
  cond: null, ops: [{ op: "draw", n: 2 }],
};
const item = (id: number, name: string): ReviewItem => ({
  id, reviewVersion: "fixture-v1", cardId: `PREVIEW-${id}`, name, meta: "Battle · Red · cost 2", imageUrl: null,
  side: "front", skillIndex: 0, kindLabel: "Activate: Main", tag: PREVIEW_RULE.kind,
  printed: "[Activate: Main] Pay one red and one other energy: Draw 2 cards.", ...PREVIEW_RULE,
  unread: [], status: "draft", source: "compiler", pattern: null, explanation: null, timesSeen: 0, probe: null, firedIn: null, decks: [], sameWording: 0,
});

export function RuleExplanationPreview({ outcome }: { outcome: string }) {
  const request: ExplanationActions["request"] = async (_id, _version, explanation) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const base: ExplanationResult = { proposalId: 1, token: "fixture-exact-token", issueUrl: null, issueError: null,
      decision: { kind: "supported", rule: PREVIEW_RULE, meaning: "In your main phase, pay one red and one other energy, then draw two cards.", reading: "WHEN activate:main\nCOST one red and one other energy\nIF none\nTHEN draw 2" } };
    if (outcome === "question") base.decision = { kind: "question", meaning: "The drawing effect is clear.", question: "Do you pay the energy before drawing? Add your answer to the explanation." };
    if (outcome === "invalid") base.decision = { kind: "invalid", error: "The synthetic proposal has an unknown operation. Nothing was changed." };
    if (outcome === "coding" || outcome === "pending") {
      base.decision = { kind: "unsupported", missing: ["Synthetic missing runtime capability"], meaning: explanation, proposed: "WHEN main phase; COST 2 energy; IF none; THEN synthetic unimplemented effect" };
      if (outcome === "coding") base.issueUrl = "https://github.com/uhtred1986-lab/trading-card-management/issues/836";
      else base.issueError = "Feedback is saved. GitHub sync failed; no issue link is confirmed.";
    }
    return { error: null, result: base };
  };
  const actions: ExplanationActions = { request,
    approve: async (_id, _proposal, token) => ({ error: token === "fixture-exact-token" ? null : "This proposal changed." }),
    retry: async () => ({ error: null, result: { ...((await request(1, "fixture-v1", "Retry fixture")).result!), issueUrl: "https://github.com/uhtred1986-lab/trading-card-management/issues/836", issueError: null } }),
  };
  return <RuleReview admin={outcome !== "readonly"} items={[item(900001, "Synthetic rule review"), item(900002, "Next synthetic skill")]}
    scope="Synthetic offline preview" backHref="/arena/rules/review/preview" explanationActions={actions} confirmAction={async () => ({ error: null })} />;
}
