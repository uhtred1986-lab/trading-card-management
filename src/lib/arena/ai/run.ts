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
import { areaOf, face, skillsOf, type Action, type Area, type PlayerId } from "../engine";
import { markRuleSeen, saveRule } from "../rules-store";
import { applyToGame, loadGame, type LoadedGame } from "../games";
import { recordDecision } from "./debug";
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

/**
 * In a game against Claude, Claude is always the second player.
 *
 * Named positively on purpose: written as `mode === "hotseat" ? null : "p2"`
 * it handed every future mode to Claude by default, and 1 v 1 was the first
 * one that would have been wrong.
 */
export function aiPlayerOf(game: { mode: string }): PlayerId | null {
  return game.mode === "sparring" || game.mode === "tournament" ? "p2" : null;
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

/** Piles the human cannot see, so a choice made out of one is a search (3-1-3). */
const HIDDEN_PILES = new Set<Area>(["deck", "hand", "warp", "zDeck"]);

/**
 * What Claude was shown in a search, and what it took — for a `debug` game
 * only.
 *
 * 3-1-3 keeps the opponent's search private, and in an ordinary game it stays
 * that way. But a solo game against Claude is also something to *audit*: "it
 * searched twice and I have no way to tell the turn was legitimate" is a fair
 * complaint, and the answer is to disclose it where the owner asked for it —
 * in the log of a game they turned debug on for. Everything here is already in
 * `arena_decisions`; this only puts it where it can be read during the game.
 */
function searchAside(game: LoadedGame, chosen: { action: Action; label: string }): string | null {
  const prompt = game.state.prompt;
  if (prompt.kind !== "chooseCards") return null;
  const cands = prompt.choice.candidates;
  if (cands.length < 2) return null;
  if (!cands.some((id) => HIDDEN_PILES.has(areaOf(game.state, id) ?? "deck") || (areaOf(game.state, id) === "life" && !game.state.cards[id]?.faceUp))) return null;
  const shown = cands.map((id) => face(game.ctx, game.state, id).name).join(", ");
  const took = chosen.action.type === "choose" ? chosen.action.cards.map((id) => face(game.ctx, game.state, id).name).join(", ") || "nothing" : chosen.label;
  return `[debug] ${game.state.players[prompt.player].name} looked at: ${shown} — took ${took}`;
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
      // Written with the move it explains, not collected for the end of the
      // batch — see `applyToGame`.
      const line = choice.say ? `${game.state.players[ai].name}: “${choice.say}”` : null;
      await applyToGame(db, gameId, chosen.action as Action, { say: line, aside: game.debug ? searchAside(game, chosen) : null });
      if (line) said.push(line);
    } catch (err) {
      return { steps, said, error: describeAiError(err) };
    }
  }
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

  // Nothing Claude decides is invisible again: a ruling that was a program
  // becomes the card's draft rule, with Claude's reason as its explanation.
  // It shows up in the worklist like any other draft — and the next game
  // loads it from the row, so the card is not put to the referee twice.
  const inst = game.state.cards[req.card];
  const d = game.ctx.defs[req.cardId];
  const side = inst?.flipped && d?.back ? "back" : "front";
  if (ruling.valid) {
    const sk = d ? skillsOf(d, side).find((k) => k.index === req.skillIndex) : undefined;
    await saveRule(db, { cardId: req.cardId, side, skillIndex: req.skillIndex, ops: ruling.ops, source: "claude", status: "draft", explanation: ruling.why, printed: req.text, kind: sk?.kind ?? "auto" });
  }
  // The skill has now actually come up in a game, which is what sorts the
  // Patterns page: a wording a game has met is worth teaching the compiler
  // before one that has not. The worked example is the draft written above,
  // so there is nowhere else for it to be kept.
  await markRuleSeen(db, req.cardId, side, req.skillIndex);

  const line = `referee on ${req.cardName}: ${ruling.why}`;
  await applyToGame(db, gameId, { type: "refereeRuling", player: req.master, ops: ruling.ops }, { say: line });
  return line;
}
