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
import { legalActions, nextRandom, rejectedActions, type Action, type LegalAction } from "../src/lib/arena/engine";
import { BEAT_CAP, type Beat, type Beats } from "../src/lib/arena/beats";
import { isEngineId } from "../src/lib/arena/engines";
import { applyToGame, loadGame, startGame } from "../src/lib/arena/games";
import { deckInputFor } from "../src/lib/arena/load";
import { boardView, tappable, viewerOf, type BoardView } from "../src/lib/arena/view";
import { waitingFor } from "../src/lib/arena/snapshot";

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

/** What the battle staging relies on, seen over a real game. */
const battles = { seen: 0, counters: 0, triggers: 0 };

/**
 * `docs/arena-battle-staging-spec.md` §5: what a battle says about itself has
 * to hold on every state a real game passes through, because a staging draws
 * it and computes nothing of its own.
 *
 * A counter and a combo card are never the same card — one is in the Drop and
 * the other in the Combo Area — and `contributions` never names a card that is
 * not in the fight. Those two are what a chain is numbered and attributed
 * from; either being wrong is a band that lies about who did what.
 */
/**
 * `docs/arena-hud-spec.md` §1.1: if the prompt belongs to the viewer and the
 * viewer has at least one legal action, nothing on the board may state that
 * the opponent is acting.
 *
 * The one-line fix in `ArenaStage` is worth half of nothing if a later
 * refactor can silently undo it, and every "is the opponent acting" on the
 * board now comes from `waitingFor`. So the invariant is asserted against the
 * real card pool on every move of a whole game — which is where the odd prompt
 * kinds live that a synthetic fixture never reaches.
 */
function auditWhoseMove(game: { status: string; state: Parameters<typeof viewerOf>[0]; legal: LegalAction[] }, move: number): void {
  if (game.status !== "playing" || game.legal.length === 0) return;
  const viewer = viewerOf(game.state);
  const prompt = game.state.prompt;
  const mine = !("player" in prompt) || !prompt.player || prompt.player === viewer;
  if (!mine) return;
  const waiting = waitingFor({ ai: null, state: game.state, status: "playing", viewer });
  assert.equal(waiting, "you", `move ${move}: the prompt is the viewer's with ${game.legal.length} legal actions, but the board would say the opponent is acting`);
}

function auditBattle(view: BoardView, move: number): void {
  const b = view.battle;
  if (!b) return;
  battles.seen++;
  const combo = new Set([...view.you.combo, ...view.them.combo].map((c) => c.id));
  const counters = b.counters ?? [];
  battles.counters += counters.length;
  for (const c of counters) {
    assert.ok(!combo.has(c.card.id), `move ${move}: ${c.card.id} is both a counter and a combo card`);
    assert.ok(c.after >= 0, `move ${move}: a counter with no place in its chain`);
  }
  const inFight = new Set([b.attacker, b.guard, ...combo, ...counters.map((c) => c.card.id)]);
  for (const id of Object.keys(b.contributions ?? {})) {
    assert.ok(inFight.has(id), `move ${move}: contributions names ${id}, which is not in the battle`);
  }
  assert.ok(b.contributions?.[b.attacker] != null, `move ${move}: the attacker contributes nothing to its own attack`);
  assert.ok(b.contributions?.[b.guard] != null, `move ${move}: the guard contributes nothing to its own defence`);
  // The figures are the sum of their parts, which is the promise the band's
  // per-card numbers make. A counter is deliberately not a term: it moved the
  // guard's power rather than standing beside it.
  const sum = (side: "you" | "them") => view[side].combo.reduce((n, c) => n + (b.contributions?.[c.id] ?? 0), 0);
  const attackingSide = view.turnPlayer === view.you.player ? "you" : "them";
  const guardingSide = attackingSide === "you" ? "them" : "you";
  assert.equal(b.contributions![b.attacker] + sum(attackingSide), b.attackPower, `move ${move}: the attack figure is not its parts`);
  assert.equal(b.contributions![b.guard] + sum(guardingSide), b.guardPower, `move ${move}: the guard figure is not its parts`);
}

/** How the rejection side behaved: the `other` valve, and what it cost. */
const rejections = { total: 0, other: new Map<string, number>(), byKind: new Map<string, number>(), ms: 0, legalMs: 0, prompts: 0 };

/**
 * The identity `rejectedActions` dedupes on: its own `cardOf`, which reads a
 * one-card `cards` as well as `card` and `attacker`. A `choose` prompt carries
 * neither of the latter, so keying on those alone would read one rejection per
 * unofferable card as the same entry repeated.
 *
 * An activation is keyed by its skill index too — one rejection per card per
 * action type, except an activation, which is one per skill line. The same
 * shape as `scripts/verify/harness.ts`, and the two are the only two places
 * that promise is written down.
 */
function cardKeyOf(a: Action): string {
  const x = a as { card?: string | null; attacker?: string; cards?: string[]; skill?: number };
  if (typeof x.card === "string") return x.card + (a.type === "activate" && typeof x.skill === "number" ? `#${x.skill}` : "");
  if (typeof x.attacker === "string") return x.attacker;
  if (Array.isArray(x.cards)) return x.cards.join(",");
  return "";
}

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
    const key = `${r.action.type}:${cardKeyOf(r.action)}`;
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
    if (b.n > from) {
      kinds.set(b.t, (kinds.get(b.t) ?? 0) + 1);
      // How often a skill said for itself that it belonged to a battle. Not an
      // assertion about which card: a card that is in no battle at all can
      // still have an [Auto] that fires during one ("when your opponent
      // attacks"), so "the card is in the fight" would be a false rule.
      if (b.t === "skill" && b.inBattle) battles.triggers++;
    }
    for (const card of cardsIn(b)) {
      assert.ok(after.art[card], `move ${move}: the ${b.t} beat names ${card} but carries no face for it`);
    }
  }
  if (after.list.length) assert.equal(after.seq, last, `move ${move}: seq is not the highest beat number`);
}

const argv = process.argv.slice(2);
const engineArg = argv.indexOf("--engine");
const engine = engineArg >= 0 ? argv[engineArg + 1] : undefined;
if (engine !== undefined && !isEngineId(engine)) throw new Error(`--engine must be one of legacy, rules; got ${engine}`);
// Same guard as the fuzzer: with no `--engine`, `engineArg + 1` is 0 and the
// first deck id would be dropped.
const wanted = argv
  .filter((a, i) => engineArg < 0 || (i !== engineArg && i !== engineArg + 1))
  .map(Number)
  .filter(Number.isInteger);

const all = await db.select({ id: decks.id, name: decks.name }).from(decks);
const usable: number[] = [];
for (const d of all) {
  const input = await deckInputFor(db, d.id);
  if (input && input.input.main.length >= 50) usable.push(d.id);
}
const [a, b] = wanted.length === 2 ? wanted : [usable[0], usable[1] ?? usable[0]];
if (!a || !b) throw new Error("need two playable decks");

const id = await startGame(db, a, b, "hotseat", true, undefined, engine ?? "legacy");
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
  auditBattle(view, steps + 1);
  auditWhoseMove(game, steps + 1);
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
console.log(`\nbattles: ${battles.seen} states with one open · ${battles.counters} counters recorded · ${battles.triggers} skills fired inside one`);

const seen = [...kinds.entries()].sort((x, y) => y[1] - x[1]);
console.log(`\nbeats produced (${seen.reduce((n, [, c]) => n + c, 0)} across ${seen.length} kinds):`);
console.log("  " + seen.map(([k, c]) => `${k} ${c}`).join(" · "));

// The rejection side (`docs/arena-workflow-spec.md` §5/§6): how much of the
// vocabulary a real game used, how often the `other` valve was needed, and
// what computing it cost per prompt against the menu itself.
const byKind = [...rejections.byKind.entries()].sort((x, y) => y[1] - x[1]);
console.log(
  `\nrejections: ${rejections.total} across ${rejections.prompts} prompts, ${(rejections.ms / Math.max(1, rejections.prompts)).toFixed(2)} ms each (the menu itself: ${(rejections.legalMs / Math.max(1, rejections.prompts)).toFixed(2)} ms)`,
);
console.log("  " + (byKind.map(([k, c]) => `${k} ${c}`).join(" · ") || "none"));
const others = [...rejections.other.entries()].sort((x, y) => y[1] - x[1]);
console.log(`other (${others.reduce((n, [, c]) => n + c, 0)}):`);
for (const [detail, c] of others.slice(0, 12)) console.log(`  ${c} × ${detail}`);

process.exit(done?.status === "over" ? 0 : 1);
