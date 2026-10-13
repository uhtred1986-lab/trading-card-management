/**
 * Play random legal games between real decks to shake out engine crashes.
 * Needs DATABASE_URL: `npm run arena:fuzz -- [games] [deckA deckB]` (uses --env-file=.env.local).
 */
import { db } from "../src/db";
import { decks } from "../src/db/schema";
import { nextRandom } from "../src/lib/arena/vm/rng";
import { RULES, isVmState, type VmState } from "../src/lib/arena/vm";
import { deckInputFor, defsForCards } from "../src/lib/arena/load";
import { rulesFor } from "../src/lib/arena/rules-store";

const argv = process.argv.slice(2);
const { createGame, apply, legalActions } = RULES;
const games = Number(argv[0] ?? 20);
const fixed = argv.length >= 3 ? [Number(argv[1]), Number(argv[2])] : null;

/** The invariant checked after every move: every card in exactly one place (3-1). */
function checkRules(state: unknown): VmState {
  if (!isVmState(state)) throw new Error(`the rules engine returned a state it does not recognise: ${JSON.stringify(state).slice(0, 120)}`);
  const seen = new Map<string, number>();
  for (const side of Object.values(state.sides)) {
    for (const [zone, ids] of Object.entries(side.zones)) {
      for (const id of ids) {
        if (!state.cards[id]) throw new Error(`${side.id}'s ${zone} holds ${id}, which is not a card in the game`);
        seen.set(id, (seen.get(id) ?? 0) + 1);
      }
    }
  }
  for (const card of Object.values(state.cards)) for (const u of card.under) seen.set(u, (seen.get(u) ?? 0) + 1);
  for (const id of Object.keys(state.cards)) {
    if (seen.get(id) !== 1) throw new Error(`${id} (${state.cards[id].cardId}) is in ${seen.get(id) ?? 0} places, not 1`);
  }
  return state;
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
  // Rows, not a compile: the same context a real game gets.
  const ctx = { defs, scripts: await rulesFor(db, defs) };
  const seed = Math.floor(rand() * 1e9);
  let steps = 0;
  let last = "";
  try {
    // Played through the engine's own menu. The bias: end the turn less often than
    // anything else, so a game has content — which means taking the mulligan and
    // the charge skip rather than jumping straight to the next turn.
    let v = checkRules(createGame(ctx, { seed, p1: da.input, p2: dbk.input }).state);
    while (v.phase !== "over" && steps < 4000) {
      const legal = legalActions(ctx, v);
      if (!legal.length) throw new Error(`no legal actions at prompt ${JSON.stringify(v.prompt)}`);
      const pool = legal.filter((l) => l.action.type !== "endMain" && l.action.type !== "concede");
      const pick = pool.length && rand() < 0.85 ? pool[Math.floor(rand() * pool.length)] : legal[Math.floor(rand() * legal.length)];
      last = pick.label;
      const r = apply(ctx, v, pick.action);
      for (const e of r.events) if (e.type === "note") notes.set(e.text.slice(0, 60), (notes.get(e.text.slice(0, 60)) ?? 0) + 1);
      v = checkRules(r.state);
      steps++;
    }
    results.push(`${a.name} vs ${b.name}: ${v.phase === "over" ? `${v.winner ? v.sides[v.winner].name + " won" : "draw"} (${v.overReason}) after turn ${v.turn}` : `still running after ${steps} actions, turn ${v.turn}`}`);
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
