/**
 * Play a game against Claude through the real server path, with a hard cap on
 * how many paid decisions it may make, and report what it actually cost.
 *
 * `npm run arena:vs -- [maxCalls] [tier] [deckA] [deckB] [--engine legacy|rules]`
 * Default: 6 calls on the Sparring tier, which is a fraction of a cent.
 * Pass 0 for maxCalls to run without spending anything (no API key needed):
 * the opponent then takes the first legal move and the referee rules nothing.
 *
 * `--engine` (default `legacy`) is passed straight to `startGame`, which
 * resolves it through `playableEngine` and, since #149, `assertEngineForMode`
 * too — the rules engine plays hot-seat only, so `--engine rules` with the
 * default `sparring` tier refuses there before a deck is even read, the same
 * refusal the `/arena` form gives for that combination. `--engine rules
 * hotseat` runs, and the board-drawing calls below are narrowed to the
 * legacy `GameState` accordingly (`legacyState`) since the stand-in that
 * plays every seat here reads `boardView` directly rather than through
 * `engineFor`.
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { arenaGames, decks } from "../src/db/schema";
import { advance } from "../src/lib/arena/ai/run";
import { isEngineId, legacyState } from "../src/lib/arena/engines";
import { loadGame, startGame, type ArenaMode } from "../src/lib/arena/games";
import { deckInputFor } from "../src/lib/arena/load";
import { boardView, tappable, viewerOf } from "../src/lib/arena/view";

const argv = process.argv.slice(2);
const engineArg = argv.indexOf("--engine");
const engineId = engineArg >= 0 ? argv[engineArg + 1] : "legacy";
if (!isEngineId(engineId)) throw new Error(`--engine must be one of legacy, rules; got ${engineId}`);
// Same guard as the fuzzer and the playthrough: with no `--engine`, dropping
// nothing at all keeps the positional arguments below in their usual order.
const positional = argv.filter((a, i) => engineArg < 0 || (i !== engineArg && i !== engineArg + 1));

const maxCalls = positional[0] != null ? Number(positional[0]) : 6;
const tier = (positional[1] as ArenaMode) ?? "sparring";
const wanted = positional.slice(2).map(Number).filter(Number.isInteger);

if (maxCalls === 0) {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.APP_ANTHROPIC_API_KEY;
}

const all = await db.select({ id: decks.id, name: decks.name }).from(decks);
const usable: number[] = [];
for (const d of all) {
  const input = await deckInputFor(db, d.id);
  if (input && input.input.main.length >= 50) usable.push(d.id);
}
const [a, b] = wanted.length === 2 ? wanted : [usable[0], usable[1] ?? usable[0]];

const id = await startGame(db, a, b, tier, true, undefined, engineId);
console.log(`game ${id}: deck ${a} vs deck ${b}, tier ${tier}, engine ${engineId}, at most ${maxCalls} paid decisions\n`);

let humanMoves = 0;
for (let i = 0; i < 400; i++) {
  const before = (await db.query.arenaGames.findFirst({ where: eq(arenaGames.id, id) }))!.aiCalls;
  if (before >= maxCalls && maxCalls > 0) {
    console.log(`\nstopping: Claude has made ${before} paid decisions`);
    break;
  }
  const ran = await advance(db, id);
  if (ran.error) {
    console.error("advance failed:", ran.error);
    break;
  }
  for (const line of ran.said) console.log("  " + line);

  const game = await loadGame(db, id);
  if (!game || game.status !== "playing") break;
  const state = legacyState(game.state);
  // The board must build on every state, or the page would crash mid-game.
  boardView(game.ctx, state, "p1", {});
  tappable(game.legal);
  // The stand-in plays for whoever is being asked, except Claude itself.
  const ai = tier === "hotseat" ? null : "p2";
  const pr = state.prompt;
  if (!("player" in pr) || pr.player === ai) {
    if (ran.steps === 0) {
      console.error("nobody can move — prompt is", pr.kind);
      break;
    }
    continue;
  }
  // Stand in for the human: take a legal move that is not simply ending the turn.
  const pool = game.legal.filter((l) => l.action.type !== "endMain" && l.action.type !== "concede");
  const pick = pool.length ? pool[0] : game.legal[0];
  const { applyToGame } = await import("../src/lib/arena/games");
  await applyToGame(db, id, pick.action);
  humanMoves++;
}

const row = (await db.query.arenaGames.findFirst({ where: eq(arenaGames.id, id) }))!;
const game = await loadGame(db, id);
const dollars = row.aiCostMicros / 1_000_000;
console.log(`\n${humanMoves} moves from the stand-in player, turn ${row.turn}, status ${row.status}`);
console.log(`Claude: ${row.aiCalls} calls · ${row.aiInputTokens} input · ${row.aiCachedTokens} cached · ${row.aiOutputTokens} output · $${dollars.toFixed(4)}`);
console.log(`viewer would be ${game ? viewerOf(game.state) : "?"}; prompt now: ${game?.state.prompt.kind}`);
console.log("\nlast lines of the log:");
for (const line of (game?.log ?? []).slice(-14)) console.log("  " + line);
process.exit(0);
