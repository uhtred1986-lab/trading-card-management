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
 * pattern permanently. Only the second one ends the problem.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { cards as cardsTable, cardTextNotes } from "@/db/schema";
import { MODEL, anthropic, hasAnthropic, recordRun } from "@/lib/ai/client";
import { parseSkills, validateProgram, type Op } from "../engine";
import { EFFECT_LANGUAGE } from "./opponent";
import { saveScript } from "../scripts";

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

export async function clarifyCard(db: Db, noteId: number, explanation: string): Promise<ClarifyResult> {
  if (!hasAnthropic()) throw new Error("ANTHROPIC_API_KEY is not set — this needs Claude.");
  const note = await db.query.cardTextNotes.findFirst({ where: eq(cardTextNotes.id, noteId) });
  if (!note) throw new Error("no such note");
  const card = await db.query.cards.findFirst({ where: eq(cardsTable.id, note.cardId) });
  if (!card) throw new Error("no such card");

  // Every other card whose wording has the same shape: what one rule would fix.
  const siblings = await db.select({ cardId: cardTextNotes.cardId, clause: cardTextNotes.clause }).from(cardTextNotes).where(eq(cardTextNotes.pattern, note.pattern));
  const skill = parseSkills(card.skill).find((s) => s.index === note.skillIndex);

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
          `THE SKILL LINE: ${note.skillText.replace(/\s+/g, " ")}`,
          skill ? `The engine reads the tags as: ${skill.kind}${skill.cost ? `, cost "${skill.cost}"` : ""}.` : "",
          `THE PART IT COULD NOT READ: "${note.clause}"`,
          "",
          `THE OWNER, WHO PLAYS THIS GAME, EXPLAINS IT LIKE THIS:`,
          explanation.trim(),
          "",
          `${siblings.length} card${siblings.length === 1 ? "" : "s"} phrase it the same way: ${siblings.map((s) => s.cardId).join(", ")}.`,
          "",
          "Give the program for this card, and the brief for teaching the compiler the wording. Trust the owner's explanation over your own reading of the text where they differ, but say so in `meaning` if they differ.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });

  const { output } = await recordRun<Clarification>(db, "arena_referee", { noteId, cardId: note.cardId, explanation }, res, undefined, MODEL);

  let parsed: unknown = [];
  try {
    parsed = JSON.parse(output.program);
  } catch {
    parsed = [];
  }
  const ok = validateProgram(parsed);
  const ops = ok ? (parsed as Op[]) : [];
  if (ok && ops.length) {
    await saveScript(db, {
      cardId: note.cardId,
      skillIndex: note.skillIndex,
      ops,
      source: "user",
      explanation: explanation.trim(),
      meaning: output.meaning,
    });
  }

  await db
    .update(cardTextNotes)
    .set({
      explanation: explanation.trim(),
      explainedAt: new Date(),
      brief: output.brief,
      lastRuling: ops,
      lastRulingWhy: output.meaning,
      // Only the compiler learning the wording closes it for good; a saved
      // program fixes this one card, which is not the same thing.
      status: note.status,
    })
    .where(eq(cardTextNotes.id, noteId));

  return { clarification: output, ops, saved: ok && ops.length > 0 };
}

/** Cards with a stored program already, so the page can show what is settled. */
export async function explainedNotes(db: Db) {
  return db.select().from(cardTextNotes).where(and(eq(cardTextNotes.status, "open")));
}
