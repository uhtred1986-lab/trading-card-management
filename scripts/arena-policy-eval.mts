/**
 * #646, #647, #650, #651: how much the local policy is worth, measured — and whether it is safe.
 *
 * Seeded games on the five database-free fixtures (#641's, #644's, #646's, #647's, #650's) — and,
 * with `--audit`, the two audited Masters decks of #649 (SD15 / SD5, every ordered matchup) — the
 * local policy (`combat.ts`'s `localPolicy()`: the #645 shortcuts, the #646 Main Phase and its
 * payments, the #647 battle windows, the #650 constrained choices; a window none of them answers
 * interrupts, and the game is reported unfinished) against these baselines, in both seats:
 *
 *   uniform    `uniformPolicy` everywhere — no shortcuts, no heuristic
 *   shortcuts  `shortcutThen(uniformPolicy)` — the same shortcuts, every other window uniform
 *   main646    `mainPolicy(uniformPolicy)` — the #646 policy: the same shortcuts and Main Phase,
 *              uniform battle windows and choices
 *   combat647  `combatPolicy(uniformPolicy)` — the #647 policy: everything but the constrained
 *              choices, which are uniform, so the difference is #650's handlers alone
 *   selfplay   the local policy against itself: termination and latency of the complete heuristic
 *              when both seats play it, and its own seat bias
 *   control    the shortcuts baseline against itself (no local policy at all): each fixture's
 *              seat bias, which the rows above must be read against
 *
 * Reports (#651), per baseline and fixture: wins, losses, draws, games that stopped short — counted
 * apart from results and by kind (illegal decision, interruption, move cap) with every interruption's
 * detail — life damage, a 95 % Wilson interval on the win rate with its sample size, cycle-guard trips
 * and the per-decision wall time of the whole local step (overall and by window). Then: seat bias with
 * its control, a hidden-state paired check (every sampled decision of the local policy is replayed on
 * an equivalent information set — unseen cards swapped, hidden areas reordered, instance ids permuted
 * — and must give the same observation, the same answer and a playable move) and a determinism check
 * (the same seeds replayed must give the same record, trace hash included).
 *
 * Deterministic: the same flags give the same games, bar wall-clock times. No database, no provider, no
 * network. The seed sets are `scripts/verify/arena-policy-seeds.ts`: `dev` for everything here, `holdout`
 * reserved for O5 and refused without `--allow-holdout`. Method, results and limits:
 * `docs/arena-policy-evaluation.md`.
 *
 *   npm run arena:policy-eval                     # 20 games per fixture and baseline (10 per seat)
 *   npm run arena:policy-eval -- --games 40 --json
 *   npm run arena:policy-eval -- --audit --baselines combat647 --games 20
 *   npm run arena:policy-eval -- --check          # the small regression gate of `npm test`
 *
 * Flags: --games N (per fixture and baseline, even; default 20), --max-moves N (default 3000), --json,
 * --audit (add the #649 decks), --baselines a,b (a subset of the baselines above, by name),
 * --fixtures a,b (a subset, by name), --seed-set dev|holdout, --allow-holdout, --paired N (games per fixture with the hidden-state check;
 * default 2, 0 turns it off), --paired-every K (check every Kth decision of the local seat; default 4),
 * --determinism (replay every cell and compare; --check always replays one), --check (see below).
 *
 * `--check` is the regression gate: a few games on three fixtures against the uniform baseline, plus
 * the paired check and a replay, failing (exit 1) on any illegal decision, any cycle-guard trip, any
 * unexplained interruption or unfinished game, any hidden-state mismatch, any difference on replay, a
 * seed-set overlap or a local policy that does not beat uniform play. It is a tripwire for breakage,
 * not a strength measurement: its sample is far too small for that.
 */
import { playDuel, quantile, summarise, wilson, type DuelResult, type DuelSummary } from "./verify/arena-policy-duel.ts";
import { loadAuditFixtures, loadFixtures, type Fixture } from "./verify/arena-policy-fixtures.mts";
import { permutedFor } from "./verify/arena-policy-permute.ts";
import { gameSeed, SEED_SETS, verifySeedSets } from "./verify/arena-policy-seeds.ts";
import type { PlayerId } from "../src/lib/arena/types";
import type { PinnedMatch } from "../src/lib/arena/browser";
import { applyDecision, policyTurn } from "../src/lib/arena/policy/boundary";
import { stableJson, uniformPolicy, type Policy } from "../src/lib/arena/policy/contract";
import { policyRng } from "../src/lib/arena/policy/rng";
import { shortcutThen } from "../src/lib/arena/policy/shortcuts";
import { mainPolicy, MAIN_POLICY_VERSION } from "../src/lib/arena/policy/main";
import { combatPolicy, localPolicy, COMBAT_POLICY_VERSION } from "../src/lib/arena/policy/combat";
import { CHOICE_POLICY_VERSION } from "../src/lib/arena/policy/choices";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const known = new Set(["--games", "--max-moves", "--json", "--audit", "--baselines", "--seed-set", "--allow-holdout", "--paired", "--paired-every", "--determinism", "--check", "--fixtures"]);
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--") && !known.has(a)) { console.error(`unknown flag ${a}`); process.exit(2); }
}
const CHECK = process.argv.includes("--check");
const games = Number(flag("games") ?? (CHECK ? 2 : 20));
const maxMoves = Number(flag("max-moves") ?? 3000);
const json = process.argv.includes("--json");
const pairedGames = Number(flag("paired") ?? 2);
const pairedEvery = Number(flag("paired-every") ?? (CHECK ? 10 : 4));
const determinism = CHECK || process.argv.includes("--determinism");
const setName = (flag("seed-set") ?? "dev") as keyof typeof SEED_SETS;
if (!Number.isInteger(games) || games < 2 || games % 2) { console.error("--games must be an even integer >= 2"); process.exit(2); }
if (!Number.isInteger(pairedGames) || pairedGames < 0 || !Number.isInteger(pairedEvery) || pairedEvery < 1) { console.error("--paired must be >= 0 and --paired-every >= 1"); process.exit(2); }
if (!(setName in SEED_SETS)) { console.error(`--seed-set: unknown set ${setName} (known: ${Object.keys(SEED_SETS).join(", ")})`); process.exit(2); }
const seedSet = SEED_SETS[setName];
if (seedSet.reserved && !process.argv.includes("--allow-holdout")) {
  console.error(`the ${seedSet.name} seed set is reserved for O5: nothing is tuned against it. Pass --allow-holdout to run it on purpose.`);
  process.exit(2);
}
if (games / 2 > seedSet.size) { console.error(`--games ${games} needs ${games / 2} seeds; the ${seedSet.name} set has ${seedSet.size}`); process.exit(2); }

const allFixtures: Fixture[] = await loadFixtures();
const fixtures: Fixture[] = CHECK ? allFixtures.filter((f) => ["646", "647", "650"].includes(f.name)) : [...allFixtures];
if (process.argv.includes("--audit")) fixtures.push(...(await loadAuditFixtures()));
const onlyFixtures = flag("fixtures")?.split(",").map((s) => s.trim());
if (onlyFixtures) {
  const unknown = onlyFixtures.filter((n) => !fixtures.some((f) => f.name === n));
  if (unknown.length) { console.error(`--fixtures: unknown ${unknown.join(",")} (known: ${fixtures.map((f) => f.name).join(", ")})`); process.exit(2); }
  fixtures.splice(0, fixtures.length, ...fixtures.filter((f) => onlyFixtures.includes(f.name)));
}
verifySeedSets(fixtures.map((f) => f.seed));

const local = localPolicy();
interface Baseline { name: string; policy: Policy; test?: Policy }
const allBaselines: Baseline[] = [
  { name: "uniform", policy: uniformPolicy },
  { name: "shortcuts", policy: shortcutThen(uniformPolicy) },
  { name: "main646", policy: mainPolicy(uniformPolicy) },
  { name: "combat647", policy: combatPolicy(uniformPolicy) },
  // The local policy against itself: its termination, latency and seat bias when both seats play it.
  { name: "selfplay", policy: local },
  // The control: the baseline against itself, so a fixture's seat bias is visible beside the rows above.
  { name: "control", policy: shortcutThen(uniformPolicy), test: shortcutThen(uniformPolicy) },
];
const wanted = flag("baselines")?.split(",").map((s) => s.trim());
const baselines = wanted ? allBaselines.filter((b) => wanted.includes(b.name)) : CHECK ? allBaselines.filter((b) => b.name === "uniform") : allBaselines;
if (wanted && baselines.length !== wanted.length) { console.error(`--baselines: unknown name in ${wanted.join(",")} (known: ${allBaselines.map((b) => b.name).join(", ")})`); process.exit(2); }


type StopKind = "illegal" | "interrupted" | "notAsked" | "limit" | "noSeat";
type Stops = Record<StopKind, number>;
interface Row extends Omit<DuelSummary, "finished"> {
  baseline: string;
  fixture: string;
  winRate: number | null;
  /** Decided games (wins + losses): the sample the interval is about. */
  decided: number;
  ci95: [number, number];
  /** Games that stopped short, by kind. They are neither wins nor draws. */
  stops: Stops;
  /** Seed pairs (one deal, played from both seats) among those where both games were decided: the policy won both, split them (the seat decided it) or lost both. */
  seedPairs: { wonBoth: number; split: number; lostBoth: number };
  /** Every distinct interruption / refusal detail, with its count. */
  stopDetails: Record<string, number>;
  stepMs?: { n: number; p50: number; p95: number; max: number };
}
interface Played { cell: string; seat: PlayerId; k: number; r: DuelResult }

const emptyStops = (): Stops => ({ illegal: 0, interrupted: 0, notAsked: 0, limit: 0, noSeat: 0 });
/** The detail of a stop with its seat prefix and instance ids kept: "p1: interrupted: unsupported decision: ...". */
const detailOf = (r: DuelResult) => (r.stopped ?? "").replace(/\s+/g, " ").slice(0, 200);

async function playCell(f: Fixture, b: Baseline, n: number): Promise<Played[]> {
  const out: Played[] = [];
  for (let g = 0; g < n; g++) {
    const seat: PlayerId = g % 2 === 0 ? "p1" : "p2";
    const k = Math.floor(g / 2);
    // Each game seed is played once from each seat, so the deal is shared between the two.
    const r = await playDuel({ bundle: f.bundle, interpreterRevision: f.revision, gameSeed: gameSeed(seedSet, f.seed, k), policySeed: 7919 + g, testSeat: seat, test: b.test ?? local, baseline: b.policy, maxMoves });
    out.push({ cell: f.name, seat, k, r });
  }
  return out;
}

function rowOf(baseline: string, fixture: string, played: Played[], withSteps: boolean): Row {
  const s = summarise(played);
  const [lo, hi] = wilson(s.wins, s.wins + s.losses);
  const stops = emptyStops();
  const stopDetails: Record<string, number> = {};
  for (const { r } of played) {
    if (!r.stopKind) continue;
    stops[r.stopKind]++;
    const d = detailOf(r);
    stopDetails[d] = (stopDetails[d] ?? 0) + 1;
  }
  const seedPairs = { wonBoth: 0, split: 0, lostBoth: 0 };
  const byDeal = new Map<string, DuelResult[]>();
  for (const x of played) byDeal.set(`${x.cell}/${x.k}`, [...(byDeal.get(`${x.cell}/${x.k}`) ?? []), x.r]);
  for (const pair of byDeal.values()) {
    if (pair.length !== 2 || pair.some((r) => r.winner !== "test" && r.winner !== "baseline")) continue;
    const won = pair.filter((r) => r.winner === "test").length;
    if (won === 2) seedPairs.wonBoth++; else if (won === 1) seedPairs.split++; else seedPairs.lostBoth++;
  }
  const steps = played.flatMap((x) => x.r.steps.filter((st) => st.role === "test").map((st) => st.ms));
  return {
    baseline, fixture, games: s.games, wins: s.wins, losses: s.losses, draws: s.draws, unfinished: s.unfinished,
    winRate: s.wins + s.losses ? s.wins / (s.wins + s.losses) : null, decided: s.wins + s.losses, ci95: [lo, hi],
    bySeat: s.bySeat, damageDealt: s.damageDealt, damageTaken: s.damageTaken, guards: s.guards, stops, seedPairs, stopDetails,
    ...(withSteps && steps.length ? { stepMs: { n: steps.length, p50: quantile(steps, 0.5), p95: quantile(steps, 0.95), max: Math.max(...steps) } } : {}),
  };
}

const recordOf = (played: Played[]) => played.map(({ seat, k, r }) => ({ seat, k, over: r.over, winner: r.winner, reason: r.reason, moves: r.moves, turn: r.turn, dealt: r.damageDealt, taken: r.damageTaken, guards: r.guards, stopped: r.stopped, stopKind: r.stopKind, trace: r.trace }));

// ---- 1. The games.
const started = Date.now();
const rows: Row[] = [];
const cells: { baseline: string; fixture: string; played: Played[] }[] = [];
for (const b of baselines) {
  const all: Played[] = [];
  for (const f of fixtures) {
    const played = await playCell(f, b, games);
    cells.push({ baseline: b.name, fixture: f.name, played });
    all.push(...played);
    rows.push(rowOf(b.name, f.name, played, true));
  }
  rows.push(rowOf(b.name, "all", all, true));
}

// ---- 2. Seat bias, with its control.
interface SeatBias { baseline: string; fixture: string; p1Wins: number; p2Wins: number; decided: number; p1Share: number | null; ci95: [number, number]; verdict: string }
const seatBias: SeatBias[] = [];
/** The first seat's share of decided games, whoever played the local policy: a seat bias shows as a share away from 50 %. */
function biasOf(baseline: string, fixture: string, played: Played[]): SeatBias {
  // `test` plays `seat`; the first seat's wins are the test's wins from p1 plus the baseline's from p2 (= test losses from p2).
  const p1Wins = played.filter((x) => (x.seat === "p1" && x.r.winner === "test") || (x.seat === "p2" && x.r.winner === "baseline")).length;
  const p2Wins = played.filter((x) => (x.seat === "p2" && x.r.winner === "test") || (x.seat === "p1" && x.r.winner === "baseline")).length;
  const decided = p1Wins + p2Wins;
  const [lo, hi] = wilson(p1Wins, decided);
  const verdict = !decided ? "no decided games" : lo > 0.5 ? "p1 favoured" : hi < 0.5 ? "p2 favoured" : "no bias detectable";
  return { baseline, fixture, p1Wins, p2Wins, decided, p1Share: decided ? p1Wins / decided : null, ci95: [lo, hi], verdict };
}
for (const b of baselines) {
  const mine = cells.filter((c) => c.baseline === b.name);
  for (const c of mine) seatBias.push(biasOf(c.baseline, c.fixture, c.played));
  seatBias.push(biasOf(b.name, "all", mine.flatMap((c) => c.played)));
}

// ---- 3. Hidden-state variants (paired).
interface Paired { fixture: string; games: number; positions: number; nontrivial: number; observationMismatch: number; answerMismatch: number; unplayable: number; examples: string[] }
const paired: Paired[] = [];
async function pairedCheck(f: Fixture): Promise<Paired> {
  const p: Paired = { fixture: f.name, games: 0, positions: 0, nontrivial: 0, observationMismatch: 0, answerMismatch: 0, unplayable: 0, examples: [] };
  for (let g = 0; g < pairedGames; g++) {
    const seat: PlayerId = g % 2 === 0 ? "p1" : "p2";
    let every = 0;
    await playDuel({
      bundle: f.bundle, interpreterRevision: f.revision, gameSeed: gameSeed(seedSet, f.seed, Math.floor(g / 2)), policySeed: 7919 + g, testSeat: seat, test: local, baseline: uniformPolicy, maxMoves,
      observe: (match: PinnedMatch, who: PlayerId, revision: number) => {
        if (who !== seat || every++ % pairedEvery) return;
        p.positions++;
        const turn = policyTurn(match, who, revision);
        const rng = policyRng(revision + 7);
        const answer = local(turn.input, rng).answer;
        const twin = permutedFor(match, who, revision * 31 + 1);
        if (stableJson(twin.state) !== stableJson(match.state)) p.nontrivial++;
        const twinTurn = policyTurn(twin, who, revision);
        const note = (what: string) => { if (p.examples.length < 3) p.examples.push(`${f.name} game ${g} r${revision} ${turn.input.decisions.window}: ${what}`); };
        if (stableJson(twinTurn.input) !== stableJson(turn.input)) { p.observationMismatch++; note("observation or decisions differ"); return; }
        const twinAnswer = local(twinTurn.input, rng).answer;
        if (stableJson({ id: twinAnswer.id, cards: twinAnswer.cards }) !== stableJson({ id: answer.id, cards: answer.cards })) { p.answerMismatch++; note(`answer ${twinAnswer.id} vs ${answer.id}`); return; }
        if (!applyDecision(twin, twinTurn.key, twinAnswer).ok) { p.unplayable++; note(`${twinAnswer.id} does not play on the twin`); }
      },
    });
    p.games++;
  }
  return p;
}
if (pairedGames > 0) for (const f of fixtures) paired.push(await pairedCheck(f));

// ---- 4. Determinism: the same seeds, replayed.
interface Replay { baseline: string; fixture: string; games: number; identical: boolean; firstDifference: string | null }
const replays: Replay[] = [];
if (determinism) {
  const targets = CHECK ? cells.filter((c) => c.fixture === fixtures[0].name).slice(0, 1) : cells;
  for (const c of targets) {
    const f = fixtures.find((x) => x.name === c.fixture)!;
    const b = baselines.find((x) => x.name === c.baseline)!;
    const again = recordOf(await playCell(f, b, games));
    const first = recordOf(c.played);
    const i = first.findIndex((x, j) => stableJson(x) !== stableJson(again[j]));
    replays.push({ baseline: c.baseline, fixture: c.fixture, games: first.length, identical: i < 0, firstDifference: i < 0 ? null : `game ${i}: ${stableJson(first[i])} vs ${stableJson(again[i])}` });
  }
}

// ---- 5. Latency of the complete heuristic: every decision the local policy took, by window.
interface Latency { window: string; n: number; p50: number; p90: number; p95: number; p99: number; max: number }
const latencyOf = (window: string, ms: number[]): Latency => ({ window, n: ms.length, p50: quantile(ms, 0.5), p90: quantile(ms, 0.9), p95: quantile(ms, 0.95), p99: quantile(ms, 0.99), max: ms.length ? Math.max(...ms) : 0 });
const testSteps = cells.filter((c) => c.baseline !== "control").flatMap((c) => c.played.flatMap((x) => x.r.steps.filter((s) => s.role === "test")));
const latency: Latency[] = [latencyOf("all", testSteps.map((s) => s.ms)), ...[...new Set(testSteps.map((s) => s.window))].sort().map((w) => latencyOf(w, testSteps.filter((s) => s.window === w).map((s) => s.ms)))];

// ---- 6. Expectations (reported, not gated: a small run cannot meet them) and gates.
// The local policy should beat each weaker baseline with the interval clear of 50 %; against itself, its
// own earlier layer (combat647) and the control no direction is expected.
const EXPECT_BEATS = ["uniform", "shortcuts", "main646"];
const expectations = EXPECT_BEATS.flatMap((name) => {
  const all = rows.find((r) => r.baseline === name && r.fixture === "all");
  return all ? [{ baseline: name, expectation: "win rate 95 % interval lower bound above 50 %", n: all.decided, lower: all.ci95[0], met: all.ci95[0] > 0.5 }] : [];
});

const nonControl = rows.filter((r) => r.fixture === "all");
const failures: string[] = [];
const tally = (pick: (r: Row) => number) => nonControl.reduce((n, r) => n + pick(r), 0);
if (tally((r) => r.stops.illegal) > 0) failures.push(`${tally((r) => r.stops.illegal)} illegal decision(s) (must be zero)`);
if (tally((r) => r.guards.test) > 0) failures.push(`${tally((r) => r.guards.test)} cycle-guard trip(s) by the local policy`);
if (CHECK) {
  const bad = tally((r) => r.unfinished);
  if (bad) failures.push(`${bad} unfinished game(s): ${rows.flatMap((r) => Object.keys(r.stopDetails)).join(" | ")}`);
}
for (const p of paired) {
  if (p.observationMismatch || p.answerMismatch || p.unplayable) failures.push(`hidden-state variants differ on ${p.fixture}: ${p.examples.join("; ")}`);
}
for (const r of replays) if (!r.identical) failures.push(`replay of ${r.baseline}/${r.fixture} differs: ${r.firstDifference}`);
if (CHECK) {
  const uni = nonControl.find((r) => r.baseline === "uniform")!;
  if (uni.wins <= uni.losses) failures.push(`the local policy does not beat uniform play (${uni.wins}-${uni.losses})`);
  if (!paired.some((p) => p.nontrivial > 0)) failures.push("no hidden-state variant differed from the real state: the paired check proves nothing");
  if (paired.reduce((n, p) => n + p.positions, 0) === 0) failures.push("no position was checked for hidden-state invariance");
}
const seconds = (Date.now() - started) / 1000;
const policy = `main v${MAIN_POLICY_VERSION} + combat v${COMBAT_POLICY_VERSION} + choices v${CHOICE_POLICY_VERSION}`;

if (json) {
  console.log(JSON.stringify({ policy, seedSet: seedSet.name, gamesPerFixture: games, maxMoves, rows, seatBias, paired, replays, latency, expectations, failures, seconds }, null, 2));
} else {
  const pct = (x: unknown) => (typeof x === "number" ? `${(x * 100).toFixed(0)} %` : "-");
  console.log(`Local policy (${policy}) vs baselines, ${games} games per fixture (half from each seat), seed set ${seedSet.name}, max ${maxMoves} moves`);
  console.log("baseline   fixture  W-L-D (unfinished)   win rate (95 % CI, n)        p1 W-L  p2 W-L  damage dealt/taken  guards  stops i/n/l  seed pairs W/S/L  step p95 ms");
  for (const r of rows) {
    console.log(
      `${String(r.baseline).padEnd(10)} ${String(r.fixture).padEnd(8)} ${`${r.wins}-${r.losses}-${r.draws} (${r.unfinished})`.padEnd(20)} ${`${pct(r.winRate)} (${pct(r.ci95[0])}-${pct(r.ci95[1])}, n=${r.decided})`.padEnd(28)} ${`${r.bySeat.p1.wins}-${r.bySeat.p1.losses}`.padEnd(7)} ${`${r.bySeat.p2.wins}-${r.bySeat.p2.losses}`.padEnd(7)} ${`${r.damageDealt}/${r.damageTaken}`.padEnd(19)} ${`${r.guards.test}/${r.guards.baseline}`.padEnd(7)} ${`${r.stops.illegal}/${r.stops.interrupted}/${r.stops.limit}`.padEnd(12)} ${`${r.seedPairs.wonBoth}/${r.seedPairs.split}/${r.seedPairs.lostBoth}`.padEnd(17)} ${r.stepMs ? r.stepMs.p95.toFixed(1) : ""}`,
    );
  }
  const details = rows.filter((r) => r.fixture !== "all").flatMap((r) => Object.entries(r.stopDetails).map(([d, n]) => `  ${r.baseline}/${r.fixture} x${n}: ${d}`));
  if (details.length) console.log(`Games that stopped short (neither win nor draw):\n${details.join("\n")}`);
  console.log("Seat bias (share of decided games won by the FIRST seat, whoever plays the policy; 50 % = none):");
  for (const s of seatBias.filter((x) => x.fixture === "all" || baselines.some((b) => b.name === "control") && x.baseline === "control")) {
    console.log(`  ${s.baseline.padEnd(10)} ${s.fixture.padEnd(8)} p1 ${s.p1Wins} / p2 ${s.p2Wins}  p1 share ${pct(s.p1Share)} (${pct(s.ci95[0])}-${pct(s.ci95[1])})  ${s.verdict}`);
  }
  if (paired.length) {
    console.log(`Hidden-state variants (every ${pairedEvery}th decision of the local seat, ${pairedGames} games per fixture):`);
    for (const p of paired) console.log(`  ${p.fixture.padEnd(8)} positions ${p.positions}, state changed in ${p.nontrivial}, observation mismatches ${p.observationMismatch}, answer mismatches ${p.answerMismatch}, unplayable ${p.unplayable}`);
  }
  for (const e of expectations) console.log(`Expectation vs ${e.baseline}: ${e.expectation} (n=${e.n}, lower ${pct(e.lower)}): ${e.met ? "met" : "NOT met"}`);
  if (replays.length) for (const r of replays) console.log(`Replay ${r.baseline}/${r.fixture}: ${r.identical ? `identical (${r.games} games)` : `DIFFERS ${r.firstDifference}`}`);
  console.log("Latency of the local step, local policy's decisions only (ms):");
  for (const l of latency) console.log(`  ${l.window.padEnd(14)} n=${String(l.n).padEnd(7)} p50 ${l.p50.toFixed(2)}  p90 ${l.p90.toFixed(2)}  p95 ${l.p95.toFixed(2)}  p99 ${l.p99.toFixed(2)}  max ${l.max.toFixed(1)}`);
  console.log(`${seconds.toFixed(0)} s`);
  if (failures.length) console.log(`FAIL:\n${failures.map((f) => `  ${f}`).join("\n")}`);
  else if (CHECK) console.log("arena:policy-eval --check: ok");
}
process.exit(failures.length ? 1 : 0);
