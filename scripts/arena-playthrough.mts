/**
 * Play a whole game through the saved-game layer, the way the pages do.
 *
 * This is the round-trip the engine tests cannot cover: the state goes to
 * Postgres as JSON and comes back on every move, the view model is built each
 * time, and the log is written. Needs DATABASE_URL.
 *
 * `npm run arena:playthrough [-- deckA deckB]`
 */
import assert from "node:assert/strict";
import { db } from "../src/db";
import { arenaGames, decks } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { legalActions, nextRandom, rejectedActions, type LegalAction } from "../src/lib/arena/engine";
import { BEAT_CAP, type Beat, type Beats } from "../src/lib/arena/beats";
import { applyToGame, loadGame, startGame } from "../src/lib/arena/games";
import { deckInputFor } from "../src/lib/arena/load";
import { boardView, tappable, viewerOf } from "../src/lib/arena/view";

/**
 * The cards a beat names. Each of them must have brought its own face along,
 * because by the time a client draws one it may be gone from the board.
 */
function cardsIn(b: Beat): string[] {
  switch (b.t) {
    case "draw":
      return b.card ? [b.card] : [];
    case "move":
    case "mode":
    case "flip":
    case "markers":
    case "token":
    case "ko":
    case "skill":
      return [b.card];
    case "attack":
      return [b.attacker, b.target];
    case "block":
      return [b.guard, b.by];
    case "clash":
      return [b.attacker, b.guard];
    case "damage":
      return b.cards;
    default:
      return [];
  }
}

const kinds = new Map<string, number>();

/** How the rejection side behaved: the `other` valve, and what it cost. */
const rejections = { total: 0, other: new Map<string, number>(), byKind: new Map<string, number>(), ms: 0, legalMs: 0, prompts: 0 };

/**
 * `docs/arena-workflow-spec.md` §5: on every move, no action is both legal
 * and rejected, no rejection is without a reason, and the `other` kind is
 * counted — a growing number of them means the vocabulary is missing a kind.
 * The real card pool is the only place the long tail of `activatable` runs.
 */
function auditRejections(game: { ctx: Parameters<typeof rejectedActions>[0]; state: Parameters<typeof rejectedActions>[1]; legal: LegalAction[] }, move: number): void {
  // What the menu costs against what the rejections cost, on the same state.
  const t0 = performance.now();
  legalActions(game.ctx, game.state);
  const t1 = performance.now();
  const rejected = rejectedActions(game.ctx, game.state, game.legal);
  rejections.ms += performance.now() - t1;
  rejections.legalMs += t1 - t0;
  rejections.prompts++;
  const legal = new Set(game.legal.map((l) => JSON.stringify(l.action)));
  const keys = new Set<string>();
  for (const r of rejected) {
    rejections.total++;
    assert.ok(r.why.length > 0, `move ${move}: "${r.label}" is rejected for no reason`);
    assert.ok(!legal.has(JSON.stringify(r.action)), `move ${move}: "${r.label}" is both legal and rejected`);
    const a = r.action as { type: string; card?: string; attacker?: string };
    const key = `${a.type}:${a.card ?? a.attacker ?? ""}`;
    assert.ok(!keys.has(key), `move ${move}: two rejections for ${key}`);
    keys.add(key);
    for (const w of r.why) {
      rejections.byKind.set(w.kind, (rejections.byKind.get(w.kind) ?? 0) + 1);
      if (w.kind === "other") rejections.other.set(w.detail, (rejections.other.get(w.detail) ?? 0) + 1);
    }
  }
}

/**
 * What a client relies on, checked against the real card pool rather than the
 * synthetic cards in `verify-arena.ts`: numbering that only ever climbs, a
 * bounded queue, and a face for every card a beat names.
 */
function auditBeats(before: Beats | null, after: Beats | null, move: number): void {
  assert.ok(after, `move ${move}: applyToGame left no beats`);
  assert.ok(after.seq >= (before?.seq ?? 0), `move ${move}: the beat counter went backwards`);
  assert.ok(after.list.length <= BEAT_CAP, `move ${move}: the queue grew past its cap`);

  // Only what this move added: nothing clears the queue here, so the whole
  // list is still on the row and tallying all of it would count every beat
  // once per remaining move.
  const from = before?.seq ?? 0;
  let last = 0;
  for (const b of after.list) {
    assert.ok(b.n > last, `move ${move}: beat numbers are not increasing (${b.n} after ${last})`);
    last = b.n;
    if (b.n > from) kinds.set(b.t, (kinds.get(b.t) ?? 0) + 1);
    for (const card of cardsIn(b)) {
      assert.ok(after.art[card], `move ${move}: the ${b.t} beat names ${card} but carries no face for it`);
    }
  }
  if (after.list.length) assert.equal(after.seq, last, `move ${move}: seq is not the highest beat number`);
}

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
  auditRejections(game, steps + 1);
  if (++steps > 800) {
    console.log("stopped after 800 moves");
    break;
  }
  const pool = game.legal.filter((l) => l.action.type !== "endMain" && l.action.type !== "concede");
  const pick = pool.length && rand() < 0.85 ? pool[Math.floor(rand() * pool.length)] : game.legal[Math.floor(rand() * game.legal.length)];
  const next = await applyToGame(db, id, pick.action);
  // `toBeats` is exhaustive over GameEvent, but only against real card text
  // does a whole game exercise the events those cards actually fire.
  auditBeats(game.beats, next.beats, steps);
}

const done = await loadGame(db, id);
const row = await db.query.arenaGames.findFirst({ where: eq(arenaGames.id, id) });
console.log(`\n${steps} moves · status ${done?.status} · turn ${done?.state.turn}`);
console.log(`winner: ${done?.state.winner ?? "none"} — ${done?.state.overReason ?? ""}`);
console.log(`actions stored: ${(row?.actions as unknown[]).length}`);
console.log("\nlast lines of the log:");
for (const line of (done?.log ?? []).slice(-12)) console.log("  " + line);

// Which beats a real game actually produced. A kind that never appears here is
// one no client has ever been seen to draw — worth knowing before trusting it.
const seen = [...kinds.entries()].sort((x, y) => y[1] - x[1]);
console.log(`\nbeats produced (${seen.reduce((n, [, c]) => n + c, 0)} across ${seen.length} kinds):`);
console.log("  " + seen.map(([k, c]) => `${k} ${c}`).join(" · "));

// The rejection side (`docs/arena-workflow-spec.md` §5/§6): how much of the
// vocabulary a real game used, how often the `other` valve was needed, and
// what computing it cost per prompt against the menu itself.
const byKind = [...rejections.byKind.entries()].sort((x, y) => y[1] - x[1]);
console.log(`\nrejections: ${rejections.total} across ${rejections.prompts} prompts, ${(rejections.ms / Math.max(1, rejections.prompts)).toFixed(2)} ms each (the menu itself: ${(rejections.legalMs / Math.max(1, rejections.prompts)).toFixed(2)} ms)`);
console.log("  " + (byKind.map(([k, c]) => `${k} ${c}`).join(" · ") || "none"));
const others = [...rejections.other.entries()].sort((x, y) => y[1] - x[1]);
console.log(`other (${others.reduce((n, [, c]) => n + c, 0)}):`);
for (const [detail, c] of others.slice(0, 12)) console.log(`  ${c} × ${detail}`);

process.exit(done?.status === "over" ? 0 : 1);
