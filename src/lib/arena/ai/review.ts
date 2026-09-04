/**
 * Claude reviews the finished game and coaches.
 *
 * Same pattern as the deck summary: one call, structured output, recorded in
 * `ai_runs`. It reads the event log rather than the final state, because what
 * matters is the shape of the game, not where the cards ended up. The advice
 * is written to feed the Deck Improvement Wizard, so it names cards.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { arenaGames } from "@/db/schema";
import { MODEL, anthropic, hasAnthropic, recordRun } from "@/lib/ai/client";
import { loadGame } from "../games";
import { decklistText } from "./view";

export const GameReviewSchema = z.object({
  verdict: z.string().describe("2–3 sentences: how the game was won or lost"),
  turningPoint: z.string().describe("One moment that decided it, with the turn number"),
  wellPlayed: z.array(z.string()).max(3).describe("What the human did well"),
  toWorkOn: z.array(z.string()).max(3).describe("Concrete play mistakes, each one sentence"),
  deckAdvice: z.array(z.string()).max(4).describe("Changes to the human's deck, naming cards, for the Deck Improvement Wizard"),
});
export type GameReview = z.infer<typeof GameReviewSchema>;

export async function reviewGame(db: Db, gameId: number): Promise<GameReview | null> {
  const game = await loadGame(db, gameId);
  if (!game || game.status === "playing") return null;
  if (!hasAnthropic()) return null;

  const s = game.state;
  const outcome = s.winner ? `${s.players[s.winner].name} won — ${s.overReason}` : `A draw — ${s.overReason}`;
  const human = game.mode === "hotseat" ? "p1" : "p1";
  const res = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 6000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: zodOutputFormat(GameReviewSchema) },
    system:
      "You are coaching a Dragon Ball Super Card Game player after a game they just played. Be specific and concrete, name cards and turns, and keep every point to one sentence. Do not flatter. If the game was decided by draws rather than decisions, say so plainly rather than inventing a lesson.",
    messages: [
      {
        role: "user",
        content: [
          `RESULT: ${outcome} on turn ${s.turn}.`,
          `The player you are coaching is ${s.players[human].name}; their opponent was ${s.players[human === "p1" ? "p2" : "p1"].name}.`,
          "",
          `THEIR DECK:\n${decklistText(game.ctx, s, human)}`,
          "",
          `EVENT LOG:\n${game.log.join("\n")}`,
        ].join("\n"),
      },
    ],
  });

  const { output } = await recordRun<GameReview>(db, "arena_review", { gameId, outcome }, res, game.p1DeckId ?? undefined, MODEL);
  await db
    .update(arenaGames)
    .set({ review: JSON.stringify(output), reviewAt: new Date() })
    .where(eq(arenaGames.id, gameId));
  return output;
}
