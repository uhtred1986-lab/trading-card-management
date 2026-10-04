/**
 * Claude reviews the finished game and coaches.
 *
 * Same pattern as the deck summary: one call, structured output, recorded in
 * `ai_runs`. It reads the event log rather than the final state, because what
 * matters is the shape of the game, not where the cards ended up. The advice
 * is written to feed the Deck Improvement Wizard, so it names cards.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { arenaGames } from "@/db/schema";
import { hasAnthropic, recordRun } from "@/lib/ai/client";
import { generateJson } from "@/lib/ai/core";
import type { PlayerId } from "../types";
import { loadGame } from "../games";
import { sideName } from "../engines";
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

  // Engine-neutral (#457): the fields read here are the ones both state
  // shapes share by name, the seat names come through `sideName`, and
  // `decklistText` reads only each card's owner and catalog id.
  const s = game.state;
  const outcome = s.winner ? `${sideName(s, s.winner)} won — ${s.overReason}` : `A draw — ${s.overReason}`;
  // Always p1: against Claude the human is the first player, and in hot-seat
  // and 1 v 1 both sides are people, so the review is written from p1's chair.
  const human: PlayerId = "p1";
  const res = await generateJson({
    task: "arena_review",
    tier: "standard",
    maxTokens: 6000,
    thinking: "adaptive",
    effort: "medium",
    schema: GameReviewSchema,
    system: [
      {
        text: "You are coaching a Dragon Ball Super Card Game player after a game they just played. Be specific and concrete, name cards and turns, and keep every point to one sentence. Do not flatter. If the game was decided by draws rather than decisions, say so plainly rather than inventing a lesson.",
      },
    ],
    messages: [
      {
        role: "user",
        parts: [
          {
            type: "text",
            text: [
              `RESULT: ${outcome} on turn ${s.turn}.`,
              `The player you are coaching is ${sideName(s, human)}; their opponent was ${sideName(s, human === "p1" ? "p2" : "p1")}.`,
              "",
              `THEIR DECK:\n${decklistText(game.ctx, s, human)}`,
              "",
              `EVENT LOG:\n${game.log.join("\n")}`,
            ].join("\n"),
          },
        ],
      },
    ],
  });

  const { output } = await recordRun<GameReview>(db, "arena_review", { gameId, outcome }, res, game.p1DeckId ?? undefined);
  await db
    .update(arenaGames)
    .set({ review: JSON.stringify(output), reviewAt: new Date() })
    .where(eq(arenaGames.id, gameId));
  return output;
}
