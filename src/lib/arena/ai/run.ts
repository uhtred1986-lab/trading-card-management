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
import { costMicros } from "@/lib/ai/models";
import { skillsOf } from "../text/cards";
import { type Action, type Area, type PlayerId } from "../types";
import { markRuleSeen, saveRule } from "../rules-store";
import { applyToGame, loadGame, StaleGame, type LoadedGame } from "../games";
import { legacyState } from "../engines";
import { nameOf } from "../engine-state";
import { recordDecision } from "./debug";
import { shownName, stateText } from "./view";
import { tableOf } from "./table";
import { chooseMove, ruleOnCard, type Tier } from "./opponent";

/** Re-exported from models.ts for backward compatibility (#515). */
export { PRICES, costMicros } from "@/lib/ai/models";

/**
 * In a game against Claude, Claude is always the second player.
 *
 * Named positively on purpose: written as `mode === "hotseat" ? null : "p2"`
 * it handed every future mode to Claude by default, and 1 v 1 was the first
 * one that would have been wrong. `chooseMove` below reads the board through
 * the `zoneOf`/`catalogDefOf` seam for its "cannot go wrong" shortcuts (#162)
 * and through `tableOf` (`./table.ts`, #457) for everything it puts to
 * Claude, so a game against Claude plays through on either engine.
 */
export function aiPlayerOf(game: { mode: string }): PlayerId | null {
  return game.mode === "sparring" || game.mode === "tournament" ? "p2" : null;
}

/**
 * What a decision row records as its model (admin views only, never the
 * players'): the model alone on the Anthropic API, as it always was, and
 * `provider · model` on any other provider so an admin sees who answered.
 */
export function decisionModel(spend: { model: string; provider?: string } | null): string | null {
  if (!spend) return null;
  return spend.provider && spend.provider !== "anthropic-api" ? `${spend.provider} · ${spend.model}` : spend.model;
}

async function addSpend(db: Db, gameId: number, spend: { model: string; provider?: string; input: number; output: number; cached: number } | null): Promise<number> {
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
  // Read through `tableOf` (#457), so a debug game discloses the same search
  // on either engine. A card under another (23-2) stands in no area, which
  // reads as the deck here — hidden, as it always has.
  const prompt = game.state.prompt;
  if (prompt.kind !== "chooseCards") return null;
  const t = tableOf(game.ctx, game.state);
  const cands = prompt.choice.candidates;
  if (cands.length < 2) return null;
  const areaOf = (id: string) => (t.area(id) ?? "deck") as Area;
  if (!cands.some((id) => HIDDEN_PILES.has(areaOf(id)) || (areaOf(id) === "life" && !t.faceUp(id)))) return null;
  const shown = cands.map((id) => shownName(t, id)).join(", ");
  const took = chosen.action.type === "choose" ? chosen.action.cards.map((id) => shownName(t, id)).join(", ") || "nothing" : chosen.label;
  return `[debug] ${t.name(prompt.player)} looked at: ${shown} — took ${took}`;
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
 *
 * `warm` is a game this request has just loaded or written (`act()`'s own
 * move): its cards and rules are this game's for the whole run, so each step
 * reads the row and nothing else. A referee ruling can write a rule, so after
 * one they are read again.
 */
export async function advance(db: Db, gameId: number, maxSteps = 80, warm?: Pick<LoadedGame, "ctx" | "art">): Promise<AdvanceResult> {
  const said: string[] = [];
  let steps = 0;
  let reuse = warm;
  for (; steps < maxSteps; steps++) {
    const game = await loadGame(db, gameId, reuse);
    if (!game || game.status !== "playing") break;
    reuse = game;
    const ai = aiPlayerOf(game);
    const prompt = game.state.prompt;

    try {
      if (prompt.kind === "referee") {
        reuse = undefined;
        const done = await runReferee(db, game, gameId);
        if (done) said.push(done);
        continue;
      }
      if (!ai || !("player" in prompt) || prompt.player !== ai) break;

      // Claude's own move, on whichever engine dealt the game: `chooseMove`
      // and `stateText` both read the table through `tableOf` (#457).
      const state = game.state;
      const started = Date.now();
      const choice = await chooseMove(db, game.ctx, state, game.legal, ai, game.mode as Tier);
      const micros = await addSpend(db, gameId, choice.spend);
      const chosen = game.legal[choice.index];
      await recordDecision(db, {
        gameId,
        turn: state.turn,
        phase: state.phase,
        promptKind: prompt.kind,
        player: ai,
        kind: "move",
        decidedBy: choice.spend ? (choice.how.startsWith("Claude answered") ? "fallback" : "claude") : "rule",
        how: choice.how,
        model: decisionModel(choice.spend),
        menu: game.legal.map((l) => l.label),
        chosenIndex: choice.index,
        chosenLabel: chosen.label,
        say: choice.say,
        promptText: game.debug && choice.spend ? stateText(game.ctx, state, ai) : null,
        spend: choice.spend ? { ...choice.spend, micros } : null,
        latencyMs: choice.spend ? Date.now() - started : null,
      });
      // Written with the move it explains, not collected for the end of the
      // batch — see `applyToGame`.
      const line = choice.say ? `${nameOf(state, ai)}: “${choice.say}”` : null;
      // Applied to the board it was decided on, not to a fresh read of the
      // row: Claude's call takes seconds, and a move chosen off one menu must
      // not be played on whatever board is there by the time it answers.
      await applyToGame(db, gameId, chosen.action as Action, { say: line, aside: game.debug ? searchAside(game, chosen) : null }, { game });
      if (line) said.push(line);
    } catch (err) {
      // Someone else moved the game on while Claude was deciding — another
      // request advancing the same game. That one carries on from the board
      // it wrote; this one has nothing left that is its to decide.
      if (err instanceof StaleGame) return { steps, said, error: null };
      return { steps, said, error: describeAiError(err) };
    }
  }
  return { steps, said, error: null };
}

async function runReferee(db: Db, game: LoadedGame, gameId: number): Promise<string | null> {
  const prompt = game.state.prompt;
  if (prompt.kind !== "referee") return null;
  // The referee is Stage 6's on the rules engine (`docs/arena-rules-language.md`):
  // nothing there ever puts this prompt, so a `"referee"` kind is the legacy
  // engine's in practice — `legacyState` makes that the checked fact this
  // function reads rather than an assumption a future rules-engine referee
  // would silently violate.
  const state = legacyState(game.state);
  const req = prompt.request;
  const started = Date.now();
  const situation = stateText(game.ctx, state, req.master);
  const ruling = await ruleOnCard(db, { cardId: req.cardId, cardName: req.cardName, text: req.text, unsupported: req.unsupported }, situation);
  const micros = await addSpend(db, gameId, ruling.spend);

  await recordDecision(db, {
    gameId,
    turn: state.turn,
    phase: state.phase,
    promptKind: "referee",
    player: req.master,
    kind: "referee",
    decidedBy: ruling.spend ? "claude" : "rule",
    how: `${req.cardName}: ${ruling.why}`,
    model: decisionModel(ruling.spend),
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
  const inst = state.cards[req.card];
  const d = game.ctx.defs[req.cardId];
  const side = inst?.flipped && d?.back ? "back" : "front";
  if (ruling.valid) {
    const sk = d ? skillsOf(d, side).find((k) => k.index === req.skillIndex) : undefined;
    await saveRule(db, { cardId: req.cardId, side, skillIndex: req.skillIndex, ops: ruling.ops, source: "claude", status: "draft", explanation: ruling.why, printed: req.text, kind: sk?.kind ?? "auto" });
  }
  // The skill has now actually come up in a game, which is what sorts the
  // same-wording groups: a wording a game has met is worth teaching the compiler
  // before one that has not. The worked example is the draft written above,
  // so there is nowhere else for it to be kept.
  await markRuleSeen(db, req.cardId, side, req.skillIndex);

  const line = `referee on ${req.cardName}: ${ruling.why}`;
  await applyToGame(db, gameId, { type: "refereeRuling", player: req.master, ops: ruling.ops }, { say: line });
  return line;
}
