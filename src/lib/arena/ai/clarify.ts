/**
 * You explain a card in your own words; Claude turns that into two things.
 *
 *   1. A program in the effect language, saved against that card, so it plays
 *      correctly from the next game on — no referee call, no tokens, no wait.
 *   2. A written brief for teaching the compiler the *wording*, so every card
 *      that phrases it the same way is fixed for good. That brief is meant to
 *      be handed straight to Claude Code.
 *
 * The split matters: the program fixes one card now, the brief fixes the
 * pattern permanently. Only the second one ends the problem. Both live on the
 * rule's own row — the program in `ops`, the brief beside it — so what Claude
 * decided is never in a different place from what it decided about.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { cards as cardsTable, cardRules } from "@/db/schema";
import { MODEL, anthropic, hasAnthropic, recordRun } from "@/lib/ai/client";
import { parseSkills, validateProgram, type Op } from "../engine";
import { clauseShape } from "../gaps";
import { EFFECT_LANGUAGE } from "./opponent";
import { saveRule, setBrief, type RuleRow } from "../rules-store";

export const ClarificationSchema = z.object({
  meaning: z.string().max(300).describe("One sentence restating what the card does, in rules terms"),
  program: z.string().describe("A JSON array of operations for this card's skill. [] if nothing can be expressed."),
  confident: z.boolean().describe("False if the explanation left something genuinely ambiguous"),
  question: z.string().max(200).describe("If not confident, the one question that would settle it. Otherwise empty."),
  brief: z.string().describe("A markdown work item for a developer, as specified"),
});
export type Clarification = z.infer<typeof ClarificationSchema>;

const BRIEF_SPEC = `The brief is a work item handed to Claude Code, which will edit \`src/lib/arena/engine/compile.ts\`. That file turns printed card text into the effect language by matching one clause at a time in \`compileClause\`, and \`parseTarget\` turns a phrase like "up to 2 of your opponent's Battle Cards in Rest Mode" into a selector. Write the brief in markdown with exactly these sections:

## Wording
The shape of the clause to recognise, with the parts that vary written as placeholders. Quote one real example.

## What it should emit
The operations, as JSON, with a note on which parts come from the wording.

## Where it goes
Which function in compile.ts, and before or after which existing rule, and why the order matters if it does.

## Edge cases
What a naive regex would get wrong. Say plainly if there are none.

## Test
A case to add to \`scripts/verify-arena.ts\`, in the style \`const x = one("[Auto] …"); assert.deepEqual(x.ops, [...])\`.

Be concrete and short. Do not restate the effect language; the developer has it.`;

export interface ClarifyResult {
  clarification: Clarification;
  ops: Op[];
  /** True when the program was well formed and has been saved against the card. */
  saved: boolean;
}

/** The rule row's fields this needs — the workbench passes a whole row, the sync a fresh one. */
export type RuleToClarify = Pick<RuleRow, "id" | "cardId" | "side" | "skillIndex" | "printed" | "unread" | "pattern" | "kind">;

/**
 * Ask Claude what one skill does, and keep both halves of the answer.
 *
 * `explanation` may be null: the catalog sync asks Claude to read a new card
 * on its own, with nobody at the table to explain it.
 */
export async function clarifyRule(db: Db, rule: RuleToClarify, explanation: string | null): Promise<ClarifyResult> {
  if (!hasAnthropic()) throw new Error("ANTHROPIC_API_KEY is not set — this needs Claude.");
  const card = await db.query.cards.findFirst({ where: eq(cardsTable.id, rule.cardId) });
  if (!card) throw new Error("no such card");
  const side = rule.side === "back" ? "back" : "front";

  // The clause this is about: what the compiler could not read, or — when it
  // read the skill but read it wrongly — the effect itself.
  const clause = rule.unread[0] ?? rule.printed.replace(/^\s*(?:\[[^\]]*\]\s*)+/, "").replace(/\s+/g, " ").trim();
  // Every other card whose wording has the same shape: what one rule would fix.
  const shape = rule.unread.length ? clauseShape(clause) : rule.pattern;
  const siblings = shape ? await db.select({ cardId: cardRules.cardId }).from(cardRules).where(eq(cardRules.pattern, shape)) : [];
  const skill = parseSkills(side === "back" ? card.backSkill : card.skill).find((s) => s.index === rule.skillIndex);
  const said = explanation?.trim() ?? "";

  const res = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(ClarificationSchema) },
    system: [
      { type: "text", text: EFFECT_LANGUAGE, cache_control: { type: "ephemeral", ttl: "1h" } },
      { type: "text", text: BRIEF_SPEC },
    ],
    messages: [
      {
        role: "user",
        content: [
          `CARD: ${card.name} (${card.id}), ${card.cardType}, ${card.colors.join("/")}, cost ${card.energyCost ?? "—"}, ${card.power ?? "—"} power.`,
          `THE SKILL LINE: ${rule.printed.replace(/\s+/g, " ")}`,
          skill ? `The engine reads the tags as: ${skill.kind}${skill.cost ? `, cost "${skill.cost}"` : ""}.` : "",
          `THE PART IT COULD NOT READ: "${clause}"`,
          "",
          said ? `THE OWNER, WHO PLAYS THIS GAME, EXPLAINS IT LIKE THIS:` : "NOBODY HAS EXPLAINED THIS CARD. Read it yourself, as the printed rules text of a released card; where the text is genuinely ambiguous, say so in `question` and set `confident` to false.",
          said,
          "",
          `${siblings.length} card${siblings.length === 1 ? "" : "s"} phrase it the same way: ${siblings.map((s) => s.cardId).join(", ")}.`,
          "",
          said
            ? "Give the program for this card, and the brief for teaching the compiler the wording. Trust the owner's explanation over your own reading of the text where they differ, but say so in `meaning` if they differ."
            : "Give the program for this card, and the brief for teaching the compiler the wording.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });

  const { output } = await recordRun<Clarification>(db, "arena_referee", { ruleId: rule.id, cardId: rule.cardId, explanation: said || null }, res, undefined, MODEL);

  let parsed: unknown = [];
  try {
    parsed = JSON.parse(output.program);
  } catch {
    parsed = [];
  }
  const ok = validateProgram(parsed);
  const ops = ok ? (parsed as Op[]) : [];
  if (ok && ops.length) {
    // Claude wrote the program, so it is Claude's draft — the owner's words
    // are the explanation, not the authorship. It shows up for confirmation.
    await saveRule(db, {
      cardId: rule.cardId,
      side,
      skillIndex: rule.skillIndex,
      ops,
      source: "claude",
      status: "draft",
      explanation: said ? `${said}\n\nClaude: ${output.meaning}` : output.meaning,
      printed: rule.printed,
      kind: rule.kind ?? skill?.kind ?? "auto",
    });
  }
  // The brief is kept whether or not a program came back: teaching the
  // compiler the wording is the half that fixes every card phrased this way,
  // and it is worth having even when this one card could not be expressed.
  await setBrief(db, rule.id, { brief: output.brief, ...(ok && ops.length ? {} : { explanation: said || output.meaning }) });

  return { clarification: output, ops, saved: ok && ops.length > 0 };
}
