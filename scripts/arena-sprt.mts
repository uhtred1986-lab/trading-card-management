#!/usr/bin/env node
/**
 * The arena's strength gate for the offline opponent (from 2026-11-08, owner decision): a
 * sequential probability ratio test on paired deals, as chess engines accept changes (fishtest).
 * Protocol, reasons and commands: `docs/arena-policy-sprt.md`. No database, provider or network.
 *
 *   npm run arena:sprt -- --candidate NAME --baseline NAME [--seed-block sprt-dev] [--workers N]
 *                         [--max-games 2000] [--out FILE]
 *   npm run arena:sprt -- --ladder --candidate NAME [--pairs 40] [--workers N] [--out FILE]
 *
 * Each deal is one engine seed of the chosen block on one of the audited SD15/SD5 matchups (cycled
 * AvA, AvB, BvA, BvB), played twice: the candidate in p1, then in p2, with the same per-seat policy
 * RNG. The pair scores 0–2 candidate points; the pentanomial GSPRT (`scripts/lib/sprt.ts`) runs over
 * the deal-ordered prefix and stops at the first decision (H1: the candidate is at least elo1 better;
 * H0: it is not better than elo0) or at `--max-games` ("inconclusive at cap"). Deals are played in
 * parallel by `--workers` child processes, but outcomes are consumed strictly in deal order, so the
 * result is the same for any worker count; deals finished past the decision are discarded unread.
 *
 * Every game must finish: illegal answers, interruptions, move-cap hits, exceptions, hidden-twin
 * privacy failures (every `--privacy-every`th candidate decision is replayed on a permuted twin) and
 * cycle-guard takeovers of the candidate are integrity failures, kept in the report, and fail the run.
 *
 * Flags:
 *   --candidate NAME, --baseline NAME   players from `scripts/lib/arena-sprt-players.ts` (heuristic,
 *                                       uniform, shortcuts) or a --players-module
 *   --players-module FILE               a module that calls registerPlayer(); repeatable
 *   --seed-block NAME                   a block of `scripts/lib/arena-seed-blocks.ts` (default sprt-dev);
 *                                       consumed blocks are refused
 *   --elo0 0 --elo1 30 --alpha 0.05 --beta 0.05 --min-pairs 20 --min-informative 10
 *   --max-games N                       cap on games (2 per deal; default 2000)
 *   --fixtures AvA,AvB,BvA,BvB          the matchup cycle (default all four)
 *   --max-moves 3000                    per game
 *   --privacy-every K                   twin check every Kth candidate decision (default 20; 0 = off)
 *   --workers N                         child processes (default CPUs − 1; 0 = play in this process)
 *   --progress N                        a progress line every N pairs (default 10)
 *   --ladder, --pairs N                 the candidate against uniform, shortcuts and heuristic, N deals
 *                                       each, Elo with a 95 % interval per opponent (no SPRT)
 *   --out FILE                          the JSON report
 *
 * Exit 0 when the run completed (whatever it decided), 1 on any integrity failure or a source change
 * during the run, 2 on bad arguments or a crashed worker. There is no --resume: the search
 * evaluator's checkpoint journal is built around its search telemetry, and a run here is restartable
 * from scratch with the same result.
 */
import { fork, type ChildProcess } from "node:child_process";
import { availableParallelism, loadavg } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import {
  DEFAULT_SPRT, addPair, eloEstimate, informativePairs, pentanomialStats, sprtExpectation, sprtState, validateConfig,
  type Pentanomial, type SprtConfig, type SprtState,
} from "./lib/sprt.ts";
import { dealSeeds, sprtSeedBlock, type SprtSeedBlock } from "./lib/arena-seed-blocks.ts";
import { LADDER, playerDescription, playerFactory } from "./lib/arena-sprt-players.ts";
import { playDeal, type DealOptions, type DealSpec, type PairOutcome } from "./lib/arena-sprt-deal.ts";
import { importPlayerModules, loadSprtFixtures, type FromWorker, type ToWorker } from "./lib/arena-sprt-worker.mts";
import { evaluationRunnerPin } from "./lib/evaluation-provenance.ts";
import { quantile } from "./verify/arena-policy-duel.ts";

const RUNNER_VERSION = "sprt-1";
const AUDIT_CYCLE = ["AvA", "AvB", "BvA", "BvB"];
/** Per-pair variances of earlier holdouts, for the expected-length table (pentanomials from their reports). */
const REFERENCE_VARIANCES: { name: string; pentanomial: Pentanomial }[] = [
  { name: "#826 holdout (11 won-both, 120 split, 29 lost-both)", pentanomial: [29, 0, 120, 0, 11] },
  { name: "#899 holdout (14 won-both, 134 split, 12 lost-both)", pentanomial: [12, 0, 134, 0, 14] },
];

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const VALUED = new Set(["--candidate", "--baseline", "--players-module", "--seed-block", "--elo0", "--elo1", "--alpha", "--beta", "--min-pairs", "--min-informative", "--max-games", "--fixtures", "--max-moves", "--privacy-every", "--workers", "--progress", "--pairs", "--out"]);
const BARE = new Set(["--ladder", "--help"]);
function usage(message: string): never {
  console.error(`arena:sprt: ${message}\nSee the flags at the top of scripts/arena-sprt.mts or docs/arena-policy-sprt.md.`);
  process.exit(2);
}
for (let i = 0; i < argv.length; i++) {
  if (VALUED.has(argv[i])) { if (argv[i + 1] === undefined) usage(`${argv[i]} needs a value`); i++; } else if (!BARE.has(argv[i])) usage(`unknown argument ${argv[i]}`);
}
if (argv.includes("--help")) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
  process.exit(0);
}
const flag = (name: string): string | undefined => { const i = argv.lastIndexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const flags = (name: string): string[] => argv.flatMap((a, i) => (a === name ? [argv[i + 1]] : []));
function int(name: string, fallback: number, min: number): number {
  const raw = flag(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min) usage(`${name} must be an integer ≥ ${min} (got ${raw})`);
  return value;
}
function num(name: string, fallback: number): number {
  const raw = flag(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value)) usage(`${name} must be a number (got ${raw})`);
  return value;
}

const ladder = argv.includes("--ladder");
const candidate = flag("--candidate") ?? usage("--candidate NAME is required");
const baseline = flag("--baseline");
if (!ladder && !baseline) usage("--baseline NAME is required (or --ladder)");
if (ladder && baseline) usage("--ladder plays the frozen ladder; it takes no --baseline");
const playersModules = flags("--players-module").map((f) => resolve(f));
const sprt: SprtConfig = {
  elo0: num("--elo0", DEFAULT_SPRT.elo0), elo1: num("--elo1", DEFAULT_SPRT.elo1),
  alpha: num("--alpha", DEFAULT_SPRT.alpha), beta: num("--beta", DEFAULT_SPRT.beta),
  minPairs: int("--min-pairs", DEFAULT_SPRT.minPairs, 1), minInformativePairs: int("--min-informative", DEFAULT_SPRT.minInformativePairs, 0),
};
try { validateConfig(sprt); } catch (error) { usage(String((error as Error).message)); }
const maxGames = int("--max-games", 2000, 2);
const maxPairs = Math.floor(maxGames / 2);
const ladderPairs = int("--pairs", 40, 1);
const fixtureCycle = (flag("--fixtures") ?? AUDIT_CYCLE.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const maxMoves = int("--max-moves", 3000, 1);
const privacyEvery = int("--privacy-every", 20, 0);
const workers = int("--workers", Math.max(1, availableParallelism() - 1), 0);
const progressEvery = int("--progress", 10, 1);
const outFile = flag("--out");
let block: SprtSeedBlock;
try { block = sprtSeedBlock(flag("--seed-block") ?? "sprt-dev"); } catch (error) { usage(String((error as Error).message)); }
if ((ladder ? ladderPairs : maxPairs) > block.size) usage(`seed block ${block.name} has ${block.size} deals`);
await importPlayerModules(playersModules);
for (const name of [candidate, ...(ladder ? LADDER : [baseline!])]) {
  try { playerFactory(name); } catch (error) { usage(String((error as Error).message)); }
}
const options: DealOptions = { maxMoves, privacyEvery };
const specOf = (deal: number, opponent: string): DealSpec => {
  const { engineSeed, policySeed } = dealSeeds(block, deal);
  return { deal, fixture: fixtureCycle[deal % fixtureCycle.length], engineSeed, policySeed, candidate, baseline: opponent };
};

// ---------------------------------------------------------------- the pool

interface Pool { size: number; submit(spec: DealSpec): Promise<PairOutcome>; close(): void }

async function inProcessPool(): Promise<Pool> {
  const fixtures = await loadSprtFixtures(fixtureCycle);
  return { size: 1, submit: (spec) => playDeal(spec, fixtures.get(spec.fixture)!, options), close: () => {} };
}

async function processPool(size: number): Promise<Pool> {
  const script = fileURLToPath(new URL("./lib/arena-sprt-worker.mts", import.meta.url));
  const idle: ChildProcess[] = [];
  const waiting: { spec: DealSpec; resolve: (o: PairOutcome) => void; reject: (e: Error) => void }[] = [];
  const busy = new Map<ChildProcess, (typeof waiting)[number]>();
  let closing = false;
  const crash = (child: ChildProcess, why: string) => {
    if (closing) return;
    const job = busy.get(child);
    const error = new Error(`a worker process failed${job ? ` on deal ${job.spec.deal}` : ""}: ${why}`);
    if (job) job.reject(error); else for (const w of waiting.splice(0)) w.reject(error);
  };
  const dispatch = () => {
    while (idle.length && waiting.length) {
      const child = idle.pop()!, job = waiting.shift()!;
      busy.set(child, job);
      child.send({ type: "deal", spec: job.spec } satisfies ToWorker);
    }
  };
  const children = await Promise.all(Array.from({ length: size }, () => new Promise<ChildProcess>((ready, fail) => {
    const child = fork(script, ["--arena-sprt-worker"], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
    child.on("message", (message: FromWorker) => {
      if (message.type === "ready") ready(child);
      else if (message.type === "fatal") { fail(new Error(message.error)); crash(child, message.error); }
      else {
        const job = busy.get(child)!;
        busy.delete(child);
        idle.push(child);
        job.resolve(message.outcome);
        dispatch();
      }
    });
    child.on("exit", (code, signal) => { fail(new Error(`exited ${code ?? signal} before it was ready`)); crash(child, `exited (${code ?? signal})`); });
    child.send({ type: "init", fixtures: fixtureCycle, playersModules, options } satisfies ToWorker);
  })));
  idle.push(...children);
  return {
    size,
    submit: (spec) => new Promise((res, rej) => { waiting.push({ spec, resolve: res, reject: rej }); dispatch(); }),
    close: () => { closing = true; for (const c of children) c.kill(); },
  };
}

/**
 * Plays deals 0..count−1 through the pool, at most `pool.size` in flight, and hands them to `consume`
 * strictly in order; stops when `consume` returns true. Deals finished past that point are returned
 * as `discarded`, unread by the caller's statistics.
 */
function orderedRun(pool: Pool, count: number, specAt: (i: number) => DealSpec, consume: (o: PairOutcome) => boolean): Promise<{ consumed: number; discarded: PairOutcome[] }> {
  return new Promise((done, fail) => {
    const finished = new Map<number, PairOutcome>();
    let next = 0, consumed = 0, inFlight = 0, stopped = false;
    const settle = () => {
      while (!stopped && finished.has(consumed)) {
        const outcome = finished.get(consumed)!;
        finished.delete(consumed);
        consumed++;
        if (consume(outcome)) stopped = true;
      }
      if (stopped || consumed === count) done({ consumed, discarded: [...finished.values()] });
      else pump();
    };
    const pump = () => {
      while (!stopped && next < count && inFlight < pool.size) {
        const i = next++;
        inFlight++;
        pool.submit(specAt(i)).then((outcome) => { inFlight--; finished.set(i, outcome); settle(); }, fail);
      }
    };
    if (count === 0) done({ consumed: 0, discarded: [] }); else pump();
  });
}

// ---------------------------------------------------------------- reporting helpers

const signed = (x: number, digits = 1) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${x.toFixed(digits)}` : x > 0 ? "+inf" : "-inf");
const eloText = (counts: Pentanomial) => {
  const e = eloEstimate(counts);
  return e ? `Elo ${signed(e.elo)} [${signed(e.eloCi95[0])}, ${signed(e.eloCi95[1])}] LOS ${(100 * e.los).toFixed(1)} %` : "Elo -";
};
interface Tally { pairs: number; games: number; wins: number; draws: number; losses: number; unfinished: number; counts: Pentanomial; integrity: number; privacyChecks: number; nontrivialTwins: number }
const emptyTally = (): Tally => ({ pairs: 0, games: 0, wins: 0, draws: 0, losses: 0, unfinished: 0, counts: [0, 0, 0, 0, 0], integrity: 0, privacyChecks: 0, nontrivialTwins: 0 });
function tallyPair(t: Tally, o: PairOutcome): Tally {
  const next = { ...t, pairs: t.pairs + 1, counts: addPair(t.counts, o.points) };
  for (const g of o.games) {
    next.games++;
    if (g.winner === "candidate") next.wins++; else if (g.winner === "baseline") next.losses++; else if (g.winner === "draw") next.draws++; else next.unfinished++;
    next.integrity += g.integrity.length ? 1 : 0;
    next.privacyChecks += g.privacy.checks;
    next.nontrivialTwins += g.privacy.nontrivial;
  }
  return next;
}
const wdl = (t: Tally) => `W-D-L ${t.wins}-${t.draws}-${t.losses}${t.unfinished ? ` (+${t.unfinished} unfinished)` : ""}`;
const compactPair = (o: PairOutcome) => ({
  deal: o.deal, fixture: o.fixture, engineSeed: o.engineSeed, policySeed: o.policySeed, baseline: o.baseline, points: o.points,
  games: o.games.map((g) => ({ candidateSeat: g.candidateSeat, winner: g.winner, moves: g.moves, turn: g.turn, stopKind: g.stopKind, trace: g.trace, guards: g.guards, twins: [g.privacy.checks, g.privacy.nontrivial], ...(g.integrity.length ? { integrity: g.integrity } : {}) })),
});
const integrityOf = (pairs: PairOutcome[]) => pairs.flatMap((o) => o.games.flatMap((g) => g.integrity.map((what) => `deal ${o.deal} (${o.fixture}, seed ${o.engineSeed}, candidate ${g.candidateSeat}, vs ${o.baseline}): ${what}`)));
function timing(pairs: PairOutcome[], wallMs: number, poolSize: number) {
  const ms = pairs.flatMap((o) => o.games.map((g) => g.ms));
  return {
    workers: poolSize, cpus: availableParallelism(), loadAverage: { atStart: loadAtStart, atEnd: loadavg().map((x) => Number(x.toFixed(2))) },
    wallSeconds: wallMs / 1000, games: ms.length,
    wallSecondsPerGame: ms.length ? wallMs / 1000 / ms.length : null,
    gameSeconds: ms.length ? { mean: ms.reduce((a, b) => a + b, 0) / ms.length / 1000, p50: quantile(ms, 0.5) / 1000, p95: quantile(ms, 0.95) / 1000, max: Math.max(...ms) / 1000 } : null,
  };
}
function expectations(counts: Pentanomial) {
  const rows: { variance: string; perPairVariance: number; elo: number; pAcceptH1: number; expectedGames: number }[] = [];
  const own = pentanomialStats(counts);
  const sources = [
    ...(own && informativePairs(counts) >= sprt.minInformativePairs ? [{ name: "this run", variance: own.variance }] : []),
    ...REFERENCE_VARIANCES.map((r) => ({ name: r.name, variance: pentanomialStats(r.pentanomial)!.variance })),
  ];
  for (const s of sources) for (const elo of [sprt.elo0, (sprt.elo0 + sprt.elo1) / 2, sprt.elo1, 2 * sprt.elo1]) {
    const e = sprtExpectation({ elo, variance: s.variance, ...sprt });
    rows.push({ variance: s.name, perPairVariance: s.variance, elo, pAcceptH1: e.pAcceptH1, expectedGames: e.expectedGames });
  }
  return rows;
}

// ---------------------------------------------------------------- run

const sourceAtStart = evaluationRunnerPin("arena-policy-eval", RUNNER_VERSION);
// The host's 1/5/15-minute load: timings from a shared machine say so.
const loadAtStart = loadavg().map((x) => Number(x.toFixed(2)));
const started = performance.now();
let pool: Pool;
try { pool = workers === 0 ? await inProcessPool() : await processPool(workers); } catch (error) { console.error(`arena:sprt: could not start the workers: ${String(error)}`); process.exit(2); }
process.on("SIGINT", () => { pool.close(); process.exit(130); });
const fixtureNote = `fixtures ${fixtureCycle.join(",")} cycled by deal, seed block ${block.name} [${block.status}] engine seeds ${block.base}+deal, policy seeds ${block.policyBase}+deal`;
const config = {
  candidate, baseline: ladder ? null : baseline, ladder: ladder ? [...LADDER] : null,
  players: Object.fromEntries([candidate, ...(ladder ? LADDER : [baseline!])].map((n) => [n, playerDescription(n)])),
  playersModules: playersModules.map((f) => f.replace(process.cwd(), ".")),
  seedBlock: block, fixtureCycle, maxMoves, privacyEvery,
  ...(ladder ? { pairsPerOpponent: ladderPairs } : { maxGames, maxPairs, sprt }),
};

let report: Record<string, unknown>;
let integrityFailures = 0;
try {
  if (!ladder) {
    console.log(`SPRT ${candidate} vs ${baseline}: H0 Elo ${sprt.elo0}, H1 Elo ${sprt.elo1}, alpha ${sprt.alpha}, beta ${sprt.beta}, decisions from ${sprt.minPairs} pairs (${sprt.minInformativePairs} informative), cap ${maxPairs} pairs / ${maxPairs * 2} games; ${fixtureNote}; ${pool.size} worker(s)`);
    let tally = emptyTally();
    let state: SprtState = sprtState(tally.counts, sprt);
    const consumedPairs: PairOutcome[] = [];
    const line = () => {
      const wall = (performance.now() - started) / 1000;
      console.log(`pairs ${tally.pairs} games ${tally.games} | ${wdl(tally)} | ptnml ${tally.counts.join(",")} | LLR ${state.llr.toFixed(2)} (${state.lower.toFixed(2)}, ${state.upper.toFixed(2)}) | ${eloText(tally.counts)} | ${(wall / tally.games).toFixed(2)} s/game wall${tally.integrity ? ` | ${tally.integrity} INTEGRITY FAILURE(S)` : ""}`);
    };
    const { discarded } = await orderedRun(pool, maxPairs, (i) => specOf(i, baseline!), (outcome) => {
      consumedPairs.push(outcome);
      tally = tallyPair(tally, outcome);
      state = sprtState(tally.counts, sprt);
      for (const what of integrityOf([outcome])) console.log(`  INTEGRITY ${what}`);
      if (state.decision || tally.pairs % progressEvery === 0 || tally.pairs === maxPairs) line();
      return state.decision !== null;
    });
    const wallMs = performance.now() - started;
    pool.close();
    const integrity = integrityOf(consumedPairs);
    integrityFailures = integrity.length;
    const decision = state.decision ?? "inconclusive";
    const notGate: string[] = [];
    if (block.status !== "open") notGate.push(`seed block ${block.name} is ${block.status}, not a fresh gate block`);
    if (sprt.elo0 !== 0 || sprt.elo1 !== 30 || sprt.alpha !== 0.05 || sprt.beta !== 0.05 || sprt.minPairs !== DEFAULT_SPRT.minPairs || sprt.minInformativePairs !== DEFAULT_SPRT.minInformativePairs) notGate.push("the SPRT parameters are not the declared gate's");
    if (fixtureCycle.join(",") !== AUDIT_CYCLE.join(",")) notGate.push("not the declared fixture cycle");
    if (privacyEvery === 0) notGate.push("hidden-twin privacy checks were off");
    if (baseline !== "heuristic") notGate.push(`the baseline is ${baseline}, not heuristic`);
    if (sourceAtStart.dirtyTreeSha256) notGate.push("the working tree was not clean");
    const verdict = integrityFailures ? `FAIL: ${integrityFailures} integrity failure(s)`
      : decision === "H1" ? (notGate.length ? `H1 accepted (not a gate result: ${notGate.join("; ")})` : `PASS: H1 accepted, ${candidate} is at least ${sprt.elo1} Elo stronger at the stated error rates`)
      : decision === "H0" ? `H0 accepted: no ${sprt.elo1}-Elo improvement${notGate.length ? ` (not a gate result: ${notGate.join("; ")})` : ""}`
      : `INCONCLUSIVE at the cap of ${maxPairs} pairs / ${maxPairs * 2} games`;
    const elo = eloEstimate(tally.counts);
    report = {
      format: "arena-sprt-v1", mode: "sprt", config,
      result: {
        decision, stoppedBy: state.decision ? "sprt" : "cap", verdict, gateEligible: notGate.length === 0 && !integrityFailures, notGateReasons: notGate,
        pairs: tally.pairs, games: tally.games, wins: tally.wins, draws: tally.draws, losses: tally.losses, unfinished: tally.unfinished,
        pentanomial: tally.counts, informativePairs: informativePairs(tally.counts), llr: state.llr, bounds: [state.lower, state.upper], elo,
        integrityFailures, integrity, privacyChecks: tally.privacyChecks, nontrivialTwins: tally.nontrivialTwins,
        expectations: expectations(tally.counts),
        pairOutcomes: consumedPairs.map(compactPair),
      },
      run: { ...timing(consumedPairs, wallMs, pool.size), discardedPastDecision: { deals: discarded.length, integrityFailures: integrityOf(discarded).length } },
    };
    console.log(`Decision: ${verdict}`);
    console.log(`  ${tally.pairs} pairs, ${tally.games} games, ${wdl(tally)}, pentanomial ${tally.counts.join(",")} (${informativePairs(tally.counts)} informative), LLR ${state.llr.toFixed(3)} in (${state.lower.toFixed(3)}, ${state.upper.toFixed(3)}), ${eloText(tally.counts)}`);
    console.log(`  hidden-twin checks ${tally.privacyChecks} (${tally.nontrivialTwins} with a really different state), integrity failures ${integrityFailures}`);
    if (discarded.length) console.log(`  ${discarded.length} deal(s) finished past the decision were discarded unread${integrityOf(discarded).length ? `; NOTE ${integrityOf(discarded).length} of their games had an integrity failure: ${integrityOf(discarded).join(" | ")}` : ""}`);
  } else {
    console.log(`Ladder for ${candidate}: ${ladderPairs} deals against each of ${LADDER.join(", ")}; ${fixtureNote}; ${pool.size} worker(s)`);
    const jobs = LADDER.flatMap((opponent) => Array.from({ length: ladderPairs }, (_, d) => specOf(d, opponent)));
    const consumedPairs: PairOutcome[] = [];
    await orderedRun(pool, jobs.length, (i) => jobs[i], (outcome) => { consumedPairs.push(outcome); for (const what of integrityOf([outcome])) console.log(`  INTEGRITY ${what}`); return false; });
    const wallMs = performance.now() - started;
    pool.close();
    const rows = LADDER.map((opponent) => {
      const mine = consumedPairs.filter((o) => o.baseline === opponent);
      const tally = mine.reduce(tallyPair, emptyTally());
      const integrity = integrityOf(mine);
      console.log(`  vs ${opponent.padEnd(10)} ${String(tally.pairs).padStart(4)} pairs | ${wdl(tally)} | ptnml ${tally.counts.join(",")} | ${eloText(tally.counts)}${integrity.length ? ` | ${integrity.length} INTEGRITY FAILURE(S)` : ""}`);
      return { opponent, pairs: tally.pairs, games: tally.games, wins: tally.wins, draws: tally.draws, losses: tally.losses, unfinished: tally.unfinished, pentanomial: tally.counts, elo: eloEstimate(tally.counts), integrity, privacyChecks: tally.privacyChecks, nontrivialTwins: tally.nontrivialTwins };
    });
    integrityFailures = rows.reduce((n, r) => n + r.integrity.length, 0);
    report = { format: "arena-sprt-v1", mode: "ladder", config, result: { rows, integrityFailures, pairOutcomes: consumedPairs.map(compactPair) }, run: timing(consumedPairs, wallMs, pool.size) };
  }
} catch (error) {
  pool.close();
  console.error(`arena:sprt: the run stopped: ${String(error instanceof Error ? error.message : error)}`);
  process.exit(2);
}

const sourceAtEnd = evaluationRunnerPin("arena-policy-eval", RUNNER_VERSION);
const changed = JSON.stringify(sourceAtStart) !== JSON.stringify(sourceAtEnd);
report = { ...report, source: { start: sourceAtStart, end: sourceAtEnd, changedDuringRun: changed, node: process.version } };
const run = report.run as ReturnType<typeof timing>;
console.log(`Wall ${run.wallSeconds.toFixed(0)} s for ${run.games} games with ${run.workers} worker(s) on ${run.cpus} CPUs (load ${run.loadAverage.atStart[0]} at start, ${run.loadAverage.atEnd[0]} at end): ${run.wallSecondsPerGame?.toFixed(2)} s/game; one game takes ${run.gameSeconds?.mean.toFixed(2)} s on average in its process (p95 ${run.gameSeconds?.p95.toFixed(2)} s)`);
console.log(`Source ${sourceAtStart.gitCommit}${sourceAtStart.dirtyTreeSha256 ? " (dirty tree)" : " (clean)"}${changed ? "; SOURCE CHANGED DURING THE RUN: the result is not evidence" : ""}`);
if (!ladder) {
  for (const row of ((report.result as { expectations: ReturnType<typeof expectations> }).expectations)) {
    if (row.elo === sprt.elo1) console.log(`  expected length at a true ${signed(row.elo, 0)} Elo with the per-pair variance of ${row.variance} (${row.perPairVariance.toFixed(4)}): ${row.expectedGames.toFixed(0)} games, P(H1) ${row.pAcceptH1.toFixed(2)}`);
  }
}
if (outFile) {
  const { result, ...head } = report as { result: { pairOutcomes: unknown[] } & Record<string, unknown> } & Record<string, unknown>;
  const { pairOutcomes, ...summary } = result;
  // One pair per line, so a long report stays reviewable.
  const body = JSON.stringify({ ...head, result: { ...summary, pairOutcomes: "@@PAIRS@@" } }, null, 2);
  fs.writeFileSync(outFile, `${body.replace('"@@PAIRS@@"', `[\n${pairOutcomes.map((p) => `      ${JSON.stringify(p)}`).join(",\n")}\n    ]`)}\n`);
  console.log(`Report: ${outFile}`);
}
process.exit(integrityFailures || changed ? 1 : 0);
