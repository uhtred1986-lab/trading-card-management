/**
 * Play a whole game through the saved-game layer, the way the pages do.
 *
 * This is the round-trip the engine tests cannot cover: the state goes to
 * Postgres as JSON and comes back on every move, the view model is built each
 * time, and the log is written. Needs DATABASE_URL.
 *
 * `npm run arena:playthrough [-- deckA deckB]`
 */
import { db } from "../src/db";
import { arenaGames, decks } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { nextRandom } from "../src/lib/arena/engine";
import { applyToGame, loadGame, startGame } from "../src/lib/arena/games";
import { deckInputFor } from "../src/lib/arena/load";
import { boardView, tappable, viewerOf } from "../src/lib/arena/view";

const wanted = process.argv.slice(2).map(Number).filter(Number.isInteger);

const all = await db.select({ id: decks.id, name: decks.name }).from(decks);
const usable: number[] = [];
for (const d of all) {
  const input = await deckInputFor(db, d.id);
  if (input && input.input.main.length >= 50) usable.push(d.id);
}
const [a, b] = wanted.length === 2 ? wanted : [usable[0], usable[1] ?? usable[0]];
if (!a || !b) throw new Error("need two playable decks");

const id = await startGame(db, a, b, "hotseat");
console.log(`game ${id}: deck ${a} vs deck ${b}`);

let rng = 20260904;
const rand = () => {
  const r = nextRandom(rng);
  rng = r.state;
  return r.value;
};

let steps = 0;
for (;;) {
  const game = await loadGame(db, id);
  if (!game) throw new Error("the game vanished");
  // The board must build on every state, or a page would crash mid-game.
  const view = boardView(game.ctx, game.state, viewerOf(game.state), {});
  const taps = tappable(game.legal);
  if (steps === 0) {
    console.log(`first prompt: ${view.prompt.question}`);
    console.log(`taps: ${Object.keys(taps.byCard).length} cards, ${taps.bare.length} buttons`);
  }
  if (game.status !== "playing" || game.legal.length === 0) break;
  if (++steps > 800) {
    console.log("stopped after 800 moves");
    break;
  }
  const pool = game.legal.filter((l) => l.action.type !== "endMain" && l.action.type !== "concede");
  const pick = pool.length && rand() < 0.85 ? pool[Math.floor(rand() * pool.length)] : game.legal[Math.floor(rand() * game.legal.length)];
  await applyToGame(db, id, pick.action);
}

const done = await loadGame(db, id);
const row = await db.query.arenaGames.findFirst({ where: eq(arenaGames.id, id) });
console.log(`\n${steps} moves · status ${done?.status} · turn ${done?.state.turn}`);
console.log(`winner: ${done?.state.winner ?? "none"} — ${done?.state.overReason ?? ""}`);
console.log(`actions stored: ${(row?.actions as unknown[]).length}`);
console.log("\nlast lines of the log:");
for (const line of (done?.log ?? []).slice(-12)) console.log("  " + line);
process.exit(done?.status === "over" ? 0 : 1);
