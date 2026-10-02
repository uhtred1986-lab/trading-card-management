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
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Db } from "@/db";
import { MODEL, anthropic, recordRun } from "@/lib/ai/client";
import { TeachReplySchema, type AskTeach, type TeachReply } from "../teach/words";

/** An `ask` for `teachInWords` that calls Claude and records the run against the rule. */
export function claudeTeacher(db: Db, meta: { ruleId: number; cardId: string; clause: string }): AskTeach {
  return async (prompt) => {
    const res = await anthropic().messages.parse({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      // `medium`, not clarify's `high`: this one is answered on a phone, a
      // tap at a time, and a refused rule is retried with the parser's error.
      output_config: { effort: "medium", format: zodOutputFormat(TeachReplySchema) },
      system: [{ type: "text", text: prompt.system, cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [{ role: "user", content: prompt.user }],
    });
    const { output } = await recordRun<TeachReply>(db, "arena_teach", { ...meta, user: prompt.user }, res, undefined, MODEL);
    return output;
  };
}
