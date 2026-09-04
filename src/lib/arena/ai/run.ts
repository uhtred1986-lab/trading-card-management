/**
 * Driving Claude's side of a game.
 *
 * `advance` runs until the human has to decide something: Claude's own moves
 * when it is Claude's turn, and referee rulings whenever a card's text defeats
 * the compiler — those can belong to either player, so they are handled even
 * in a hot-seat game.
 *
 * Everything Claude spends is added up on the game row, so the end screen can
 * show what the match actually cost rather than an estimate.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { arenaGames } from "@/db/schema";
import { describeAiError } from "@/lib/ai/client";
import type { Action, PlayerId } from "../engine";
import { applyToGame, loadGame, type LoadedGame } from "../games";
import { stateText } from "./view";
import { chooseMove, ruleOnCard, type Tier } from "./opponent";

/** Anthropic list prices, US dollars per million tokens (checked 4 Sep 2026). */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Millionths of a dollar for one call. Cached input is billed at a tenth. */
export function costMicros(spend: { model: string; input: number; output: number; cached: number }): number {
  const p = PRICES[spend.model] ?? PRICES["claude-opus-5"];
  const dollars = (spend.input * p.input + spend.cached * p.input * 0.1 + spend.output * p.output) / 1_000_000;
  return Math.round(dollars * 1_000_000);
}

/** In a game against Claude, Claude is always the second player. */
export function aiPlayerOf(game: { mode: string }): PlayerId | null {
  return game.mode === "hotseat" ? null : "p2";
}

async function addSpend(db: Db, gameId: number, spend: { model: string; input: number; output: number; cached: number } | null): Promise<void> {
  if (!spend) return;
  const row = await db.query.arenaGames.findFirst({ where: eq(arenaGames.id, gameId) });
  if (!row) return;
  await db
    .update(arenaGames)
    .set({
      aiCalls: row.aiCalls + 1,
      aiInputTokens: row.aiInputTokens + spend.input,
      aiOutputTokens: row.aiOutputTokens + spend.output,
      aiCachedTokens: row.aiCachedTokens + spend.cached,
      aiCostMicros: row.aiCostMicros + costMicros(spend),
    })
    .where(eq(arenaGames.id, gameId));
}

export interface AdvanceResult {
  /** How many actions the server took on its own. */
  steps: number;
  /** Lines to append to the log for what Claude said and did. */
  said: string[];
  error: string | null;
}

/**
 * Take every decision that is not the human's, until one is. Bounded, so a
 * loop in the rules can never spin the server.
 */
export async function advance(db: Db, gameId: number, maxSteps = 80): Promise<AdvanceResult> {
  const said: string[] = [];
  let steps = 0;
  for (; steps < maxSteps; steps++) {
    const game = await loadGame(db, gameId);
    if (!game || game.status !== "playing") break;
    const ai = aiPlayerOf(game);
    const prompt = game.state.prompt;

    try {
      if (prompt.kind === "referee") {
        const done = await runReferee(db, game, gameId);
        if (done) said.push(done);
        continue;
      }
      if (!ai || !("player" in prompt) || prompt.player !== ai) break;
      const choice = await chooseMove(db, game.ctx, game.state, game.legal, ai, game.mode as Tier);
      await addSpend(db, gameId, choice.spend);
      const action = game.legal[choice.index].action as Action;
      await applyToGame(db, gameId, action);
      if (choice.say) said.push(`${game.state.players[ai].name}: “${choice.say}”`);
    } catch (err) {
      return { steps, said, error: describeAiError(err) };
    }
  }
  if (said.length) await appendLog(db, gameId, said);
  return { steps, said, error: null };
}

async function runReferee(db: Db, game: LoadedGame, gameId: number): Promise<string | null> {
  const prompt = game.state.prompt;
  if (prompt.kind !== "referee") return null;
  const req = prompt.request;
  const situation = stateText(game.ctx, game.state, req.master);
  const ruling = await ruleOnCard(db, { cardId: req.cardId, cardName: req.cardName, text: req.text, unsupported: req.unsupported }, situation);
  await addSpend(db, gameId, ruling.spend);
  await applyToGame(db, gameId, { type: "refereeRuling", player: req.master, ops: ruling.ops });
  return `referee on ${req.cardName}: ${ruling.why}`;
}

async function appendLog(db: Db, gameId: number, lines: string[]): Promise<void> {
  const row = await db.query.arenaGames.findFirst({ where: eq(arenaGames.id, gameId) });
  if (!row) return;
  await db
    .update(arenaGames)
    .set({ log: [...((row.log as string[]) ?? []), ...lines].slice(-400) })
    .where(eq(arenaGames.id, gameId));
}
