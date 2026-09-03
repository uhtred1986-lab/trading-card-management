/**
 * Play random legal games between real decks to shake out engine crashes.
 * Needs DATABASE_URL: `npm run arena:fuzz -- [games] [deckA deckB]` (uses --env-file=.env.local).
 */
import { db } from "../src/db";
import { decks } from "../src/db/schema";
import { apply, createGame, legalActions, nextRandom, type GameState, type PlayerId } from "../src/lib/arena/engine";
import { deckInputFor, defsForCards } from "../src/lib/arena/load";

const games = Number(process.argv[2] ?? 20);
const fixed = process.argv.length >= 5 ? [Number(process.argv[3]), Number(process.argv[4])] : null;

function check(s: GameState): void {
  const seen = new Map<string, number>();
  for (const p of ["p1", "p2"] as PlayerId[]) {
    const ps = s.players[p];
    const all = [ps.leader, ps.unison, ...ps.deck, ...ps.hand, ...ps.drop, ...ps.warp, ...ps.life, ...ps.battle, ...ps.combo, ...ps.energy, ...ps.zDeck, ...ps.zEnergy, ...ps.removed].filter(Boolean) as string[];
    for (const id of all) {
      seen.set(id, (seen.get(id) ?? 0) + 1);
      for (const u of s.cards[id].under) seen.set(u, (seen.get(u) ?? 0) + 1);
    }
    if (ps.life.length > 8) throw new Error(`${p} has ${ps.life.length} life`);
  }
  for (const id of Object.keys(s.cards)) if (seen.get(id) !== 1) throw new Error(`${id} (${s.cards[id].cardId}) found ${seen.get(id) ?? 0} times`);
}

const all = await db.select({ id: decks.id, name: decks.name }).from(decks);
const usable: { id: number; name: string }[] = [];
for (const d of all) {
  const di = await deckInputFor(db, d.id);
  if (di && di.input.main.length >= 50) usable.push(d);
}
console.log(`decks: ${usable.map((d) => `${d.id} ${d.name}`).join(" | ")}`);

let rng = 12345;
const rand = () => {
  const r = nextRandom(rng);
  rng = r.state;
  return r.value;
};

const notes = new Map<string, number>();
let crashes = 0;
const results: string[] = [];
for (let g = 0; g < games; g++) {
  const a = fixed ? usable.find((d) => d.id === fixed[0])! : usable[Math.floor(rand() * usable.length)];
  const b = fixed ? usable.find((d) => d.id === fixed[1])! : usable[Math.floor(rand() * usable.length)];
  const da = (await deckInputFor(db, a.id))!;
  const dbk = (await deckInputFor(db, b.id))!;
  const defs = await defsForCards(db, [...da.cardIds, ...dbk.cardIds]);
  const ctx = { defs };
  const seed = Math.floor(rand() * 1e9);
  let s: GameState;
  let steps = 0;
  let last = "";
  try {
    s = createGame(ctx, { seed, p1: da.input, p2: dbk.input }).state;
    check(s);
    while (s.phase !== "over" && steps < 600) {
      const legal = legalActions(ctx, s);
      if (!legal.length) throw new Error(`no legal actions at prompt ${JSON.stringify(s.prompt)}`);
      // Bias: end the turn less often than picking any other action, so games have content.
      const pool = legal.filter((l) => l.action.type !== "endMain" && l.action.type !== "concede");
      const pick = pool.length && rand() < 0.85 ? pool[Math.floor(rand() * pool.length)] : legal[Math.floor(rand() * legal.length)];
      last = pick.label;
      const r = apply(ctx, s, pick.action);
      s = r.state;
      for (const e of r.events) if (e.type === "note") notes.set(e.text.replace(/^[^:]+: /, "").slice(0, 60), (notes.get(e.text.replace(/^[^:]+: /, "").slice(0, 60)) ?? 0) + 1);
      check(s);
      steps++;
    }
    results.push(`${a.name} vs ${b.name}: ${s.phase === "over" ? `${s.winner ? s.players[s.winner].name + " won" : "draw"} (${s.overReason}) after turn ${s.turn}` : `still running after ${steps} actions, turn ${s.turn}`}`);
  } catch (err) {
    crashes++;
    console.error(`CRASH in ${a.name} vs ${b.name} (seed ${seed}) after ${steps} actions, last action "${last}":`, err);
  }
}
for (const r of results) console.log(r);
console.log(`\n${games} games, ${crashes} crashes`);
const top = [...notes.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12);
if (top.length) console.log("most frequent uninterpreted effects:\n" + top.map(([t, n]) => `  ${n}× ${t}`).join("\n"));
process.exit(crashes ? 1 : 0);
