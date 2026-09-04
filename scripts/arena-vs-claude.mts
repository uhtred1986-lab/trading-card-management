/**
 * Play a game against Claude through the real server path, with a hard cap on
 * how many paid decisions it may make, and report what it actually cost.
 *
 * `npm run arena:vs -- [maxCalls] [tier] [deckA] [deckB]`
 * Default: 6 calls on the Sparring tier, which is a fraction of a cent.
 * Pass 0 for maxCalls to run without spending anything (no API key needed):
 * the opponent then takes the first legal move and the referee rules nothing.
 */
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { arenaGames, decks } from "../src/db/schema";
import { advance } from "../src/lib/arena/ai/run";
import { loadGame, startGame, type ArenaMode } from "../src/lib/arena/games";
import { deckInputFor } from "../src/lib/arena/load";
import { boardView, tappable, viewerOf } from "../src/lib/arena/view";

const maxCalls = process.argv[2] != null ? Number(process.argv[2]) : 6;
const tier = (process.argv[3] as ArenaMode) ?? "sparring";
const wanted = process.argv.slice(4).map(Number).filter(Number.isInteger);

if (maxCalls === 0) delete process.env.ANTHROPIC_API_KEY;

const all = await db.select({ id: decks.id, name: decks.name }).from(decks);
const usable: number[] = [];
for (const d of all) {
  const input = await deckInputFor(db, d.id);
  if (input && input.input.main.length >= 50) usable.push(d.id);
}
const [a, b] = wanted.length === 2 ? wanted : [usable[0], usable[1] ?? usable[0]];

const id = await startGame(db, a, b, tier);
console.log(`game ${id}: deck ${a} vs deck ${b}, tier ${tier}, at most ${maxCalls} paid decisions\n`);

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
  // The board must build on every state, or the page would crash mid-game.
  boardView(game.ctx, game.state, "p1", {});
  tappable(game.legal);
  // The stand-in plays for whoever is being asked, except Claude itself.
  const ai = tier === "hotseat" ? null : "p2";
  const pr = game.state.prompt;
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
