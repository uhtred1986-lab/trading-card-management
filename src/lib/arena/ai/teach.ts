/**
 * The Claude half of "In my words" (#473): one call, the way `clarify.ts`
 * asks about an unread skill — the app's one client, the same model, the
 * language reference as a cached system block, a Zod-shaped answer, and every
 * call an `ai_runs` row so its cost shows in `npm run ai:spend`.
 *
 * Everything that decides what the answer *means* — parse, validate, retry
 * once, at most three questions — is the pure loop in `teach/words.ts`; this
 * file only supplies its `ask`.
 */
import type { Db } from "@/db";
import { recordRun } from "@/lib/ai/client";
import { generateJson } from "@/lib/ai/core";
import { TeachReplySchema, type AskTeach, type TeachReply } from "../teach/words";

/** An `ask` for `teachInWords` that calls Claude and records the run against the rule. */
export function claudeTeacher(db: Db, meta: { ruleId: number; cardId: string; clause: string }): AskTeach {
  return async (prompt) => {
    const res = await generateJson({
      task: "arena_teach",
      tier: "best",
      maxTokens: 8000,
      thinking: "adaptive",
      // `medium`, not clarify's `high`: this one is answered on a phone, a
      // tap at a time, and a refused rule is retried with the parser's error.
      effort: "medium",
      schema: TeachReplySchema,
      system: [{ text: prompt.system, cache: "long" }],
      messages: [{ role: "user", parts: [{ type: "text", text: prompt.user }] }],
    });
    const { output } = await recordRun<TeachReply>(db, "arena_teach", { ...meta, user: prompt.user }, res);
    return output;
  };
}
