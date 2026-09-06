/**
 * Driving Claude's side of a game.
 *
 * `advance` runs until the human has to decide something: Claude's own moves
 * when it is Claude's turn, and referee rulings whenever a card's text defeats
 * the compiler — those can belong to either player, so they are handled even
 * in a hot-seat game.
 *
 * Every decision is written down, whether or not it cost anything, so a
 * finished game can be read back move by move and the opponent tuned. Clauses
 * the compiler could not read are added to the backlog as they come up.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { arenaGames } from "@/db/schema";
import { describeAiError } from "@/lib/ai/client";
import type { Action, PlayerId } from "../engine";
import { applyToGame, loadGame, type LoadedGame } from "../games";
import { appendBeats, type Beats, type NumberedBeat } from "../beats";
import { noteUnreadText, recordDecision } from "./debug";
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

async function addSpend(db: Db, gameId: number, spend: { model: string; input: number; output: number; cached: number } | null): Promise<number> {
  if (!spend) return 0;
  const micros = costMicros(spend);
  const row = await db.query.arenaGames.findFirst({ where: eq(arenaGames.id, gameId) });
  if (!row) return micros;
  await db
    .update(arenaGames)
    .set({
      aiCalls: row.aiCalls + 1,
      aiInputTokens: row.aiInputTokens + spend.input,
      aiOutputTokens: row.aiOutputTokens + spend.output,
      aiCachedTokens: row.aiCachedTokens + spend.cached,
      aiCostMicros: row.aiCostMicros + micros,
    })
    .where(eq(arenaGames.id, gameId));
  return micros;
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

      const started = Date.now();
      const choice = await chooseMove(db, game.ctx, game.state, game.legal, ai, game.mode as Tier);
      const micros = await addSpend(db, gameId, choice.spend);
      const chosen = game.legal[choice.index];
      await recordDecision(db, {
        gameId,
        turn: game.state.turn,
        phase: game.state.phase,
        promptKind: prompt.kind,
        player: ai,
        kind: "move",
        decidedBy: choice.spend ? (choice.how.startsWith("Claude answered") ? "fallback" : "claude") : "rule",
        how: choice.how,
        model: choice.spend?.model ?? null,
        menu: game.legal.map((l) => l.label),
        chosenIndex: choice.index,
        chosenLabel: chosen.label,
        say: choice.say,
        promptText: game.debug && choice.spend ? stateText(game.ctx, game.state, ai) : null,
        spend: choice.spend ? { ...choice.spend, micros } : null,
        latencyMs: choice.spend ? Date.now() - started : null,
      });
      await applyToGame(db, gameId, chosen.action as Action);
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
  const started = Date.now();
  const situation = stateText(game.ctx, game.state, req.master);
  const ruling = await ruleOnCard(db, { cardId: req.cardId, cardName: req.cardName, text: req.text, unsupported: req.unsupported }, situation);
  const micros = await addSpend(db, gameId, ruling.spend);

  // The clauses that got us here go on the backlog, with what Claude decided
  // as a worked example of what the compiler should learn to emit.
  await noteUnreadText(
    db,
    req.unsupported.map((clause) => ({ cardId: req.cardId, skillIndex: req.skillIndex, clause, skillText: req.text })),
    true,
    { ops: ruling.ops, why: ruling.why },
  );

  await recordDecision(db, {
    gameId,
    turn: game.state.turn,
    phase: game.state.phase,
    promptKind: "referee",
    player: req.master,
    kind: "referee",
    decidedBy: ruling.spend ? "claude" : "rule",
    how: `${req.cardName}: ${ruling.why}`,
    model: ruling.spend?.model ?? null,
    menu: req.unsupported,
    chosenLabel: `${ruling.ops.length} operation${ruling.ops.length === 1 ? "" : "s"}`,
    promptText: game.debug && ruling.spend ? `${req.text}\n\n${situation}` : null,
    spend: ruling.spend ? { ...ruling.spend, micros } : null,
    latencyMs: ruling.spend ? Date.now() - started : null,
  });

  await applyToGame(db, gameId, { type: "refereeRuling", player: req.master, ops: ruling.ops });
  return `referee on ${req.cardName}: ${ruling.why}`;
}

/**
 * Claude's table talk, to the log and to the animation queue both.
 *
 * These land at the end of the batch rather than beside the move each was said
 * about, because that is when `advance` collects them — the same order the log
 * has always shown them in.
 */
async function appendLog(db: Db, gameId: number, lines: string[]): Promise<void> {
  const row = await db.query.arenaGames.findFirst({ where: eq(arenaGames.id, gameId) });
  if (!row) return;
  const prev = (row.beats as Beats | null) ?? null;
  let n = prev?.seq ?? 0;
  const said = lines.map((text): NumberedBeat => ({ t: "say", text, n: ++n }));
  await db
    .update(arenaGames)
    .set({
      log: [...((row.log as string[]) ?? []), ...lines].slice(-400),
      beats: appendBeats(prev, { seq: n, list: said, art: {} }),
    })
    .where(eq(arenaGames.id, gameId));
}
