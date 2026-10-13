/**
 * #646, #647, #650: how much the local policy is worth, measured.
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
 *   control    the shortcuts baseline against itself (no local policy at all): each fixture's
 *              seat bias, which the rows above must be read against
 *
 * Reports wins, losses, draws, unfinished games, life damage dealt and taken, a 95 % Wilson interval
 * on the win rate and the per-decision wall time of the whole local step. Deterministic: the same
 * flags give the same games. No database, no provider, no network.
 *
 *   npm run arena:policy-eval                     # 20 games per fixture and baseline (10 per seat)
 *   npm run arena:policy-eval -- --games 40 --json
 *   npm run arena:policy-eval -- --audit --baselines combat647 --games 20
 *
 * Flags: --games N (per fixture and baseline, even; default 20), --max-moves N (default 3000), --json,
 * --audit (add the #649 decks), --baselines a,b (a subset of the baselines above, by name).
 */
import { fixtureBundle, FIXTURE_REVISION, FIXTURE_SEED } from "./verify/arena-browser-fixture.ts";
import { policyFixtureBundle, POLICY_FIXTURE_REVISION, POLICY_FIXTURE_SEED } from "./verify/arena-policy-fixture.ts";
import { mainFixtureBundle, MAIN_FIXTURE_REVISION, MAIN_FIXTURE_SEED } from "./verify/arena-policy-main-fixture.ts";
import { combatFixtureBundle, COMBAT_FIXTURE_REVISION, COMBAT_FIXTURE_SEED } from "./verify/arena-policy-combat-fixture.ts";
import { playDuel, quantile, summarise, wilson, type DuelResult, type DuelSummary } from "./verify/arena-policy-duel.ts";
import type { PlayerId } from "../src/lib/arena/types";
import { uniformPolicy, type Policy } from "../src/lib/arena/policy/contract";
import { shortcutThen } from "../src/lib/arena/policy/shortcuts";
import { mainPolicy, MAIN_POLICY_VERSION } from "../src/lib/arena/policy/main";
import { combatPolicy, localPolicy, COMBAT_POLICY_VERSION } from "../src/lib/arena/policy/combat";
import { CHOICE_POLICY_VERSION } from "../src/lib/arena/policy/choices";
import { choicesFixtureBundle, CHOICES_FIXTURE_REVISION, CHOICES_FIXTURE_SEED } from "./verify/arena-policy-choices-fixture.ts";
import { DECKS, deckBundle, loadSnapshot, resolveDeck, RUNTIME as AUDIT_RUNTIME } from "./arena-deck-audit.mts";
import type { ReplayBundleRecord } from "../src/lib/arena/replay-core";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const known = new Set(["--games", "--max-moves", "--json", "--audit", "--baselines"]);
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--") && !known.has(a)) { console.error(`unknown flag ${a}`); process.exit(2); }
}
const games = Number(flag("games") ?? 20);
const maxMoves = Number(flag("max-moves") ?? 3000);
const json = process.argv.includes("--json");
if (!Number.isInteger(games) || games < 2 || games % 2) { console.error("--games must be an even integer >= 2"); process.exit(2); }

const fixtures: { name: string; bundle: ReplayBundleRecord; revision: string; seed: number }[] = [
  { name: "641", bundle: await fixtureBundle(), revision: FIXTURE_REVISION, seed: FIXTURE_SEED },
  { name: "644", bundle: await policyFixtureBundle(), revision: POLICY_FIXTURE_REVISION, seed: POLICY_FIXTURE_SEED },
  { name: "646", bundle: await mainFixtureBundle(), revision: MAIN_FIXTURE_REVISION, seed: MAIN_FIXTURE_SEED },
  { name: "647", bundle: await combatFixtureBundle(), revision: COMBAT_FIXTURE_REVISION, seed: COMBAT_FIXTURE_SEED },
  { name: "650", bundle: await choicesFixtureBundle(), revision: CHOICES_FIXTURE_REVISION, seed: CHOICES_FIXTURE_SEED },
];
if (process.argv.includes("--audit")) {
  const catalog = loadSnapshot().cards;
  const cards = [...new Map(DECKS.flatMap((d) => resolveDeck(d, catalog).rows.map((r) => [r.card.id, r.card] as const))).values()];
  // One bundle (both decks' cards compiled once), its decklists swapped per ordered matchup.
  const base = (await deckBundle(cards, { p1: DECKS[0], p2: DECKS[1] }, catalog)) as ReplayBundleRecord & { decks: Record<PlayerId, unknown> };
  const deckOf = { [DECKS[0].key]: base.decks.p1, [DECKS[1].key]: base.decks.p2 };
  for (const [i, [p1, p2]] of [[DECKS[0], DECKS[0]], [DECKS[0], DECKS[1]], [DECKS[1], DECKS[0]], [DECKS[1], DECKS[1]]].entries()) {
    fixtures.push({ name: `${p1.key}v${p2.key}`, bundle: { ...base, decks: { p1: deckOf[p1.key], p2: deckOf[p2.key] } } as ReplayBundleRecord, revision: AUDIT_RUNTIME, seed: 649 + i });
  }
}
const local = localPolicy();
const allBaselines: { name: string; policy: Policy; test?: Policy }[] = [
  { name: "uniform", policy: uniformPolicy },
  { name: "shortcuts", policy: shortcutThen(uniformPolicy) },
  { name: "main646", policy: mainPolicy(uniformPolicy) },
  { name: "combat647", policy: combatPolicy(uniformPolicy) },
  // The control: the baseline against itself, so a fixture's seat bias is visible beside the rows above.
  { name: "control", policy: shortcutThen(uniformPolicy), test: shortcutThen(uniformPolicy) },
];
const wanted = flag("baselines")?.split(",").map((s) => s.trim());
const baselines = wanted ? allBaselines.filter((b) => wanted.includes(b.name)) : allBaselines;
if (wanted && baselines.length !== wanted.length) { console.error(`--baselines: unknown name in ${wanted.join(",")} (known: ${allBaselines.map((b) => b.name).join(", ")})`); process.exit(2); }

interface Row extends Omit<DuelSummary, "finished"> {
  baseline: string;
  fixture: string;
  winRate: number | null;
  ci95: [number, number];
  stepMs?: { p50: number; p95: number; max: number };
  stopped?: (string | null)[];
}
const rows: Row[] = [];
const started = Date.now();
for (const b of baselines) {
  const all: { seat: PlayerId; r: DuelResult }[] = [];
  for (const f of fixtures) {
    const results: { seat: PlayerId; r: DuelResult }[] = [];
    for (let g = 0; g < games; g++) {
      const seat: PlayerId = g % 2 === 0 ? "p1" : "p2";
      // Each game seed is played once from each seat, so the deal is shared between the two.
      const r = await playDuel({ bundle: f.bundle, interpreterRevision: f.revision, gameSeed: f.seed * 1000 + Math.floor(g / 2), policySeed: 7919 + g, testSeat: seat, test: b.test ?? local, baseline: b.policy, maxMoves });
      results.push({ seat, r });
    }
    all.push(...results);
    const s = summarise(results);
    const steps = results.flatMap((x) => x.r.stepMs);
    const [lo, hi] = wilson(s.wins, s.wins + s.losses);
    rows.push({
      baseline: b.name, fixture: f.name, games: s.games, wins: s.wins, losses: s.losses, draws: s.draws, unfinished: s.unfinished,
      winRate: s.wins + s.losses ? s.wins / (s.wins + s.losses) : null, ci95: [lo, hi],
      bySeat: s.bySeat, damageDealt: s.damageDealt, damageTaken: s.damageTaken, guards: s.guards,
      stepMs: { p50: quantile(steps, 0.5), p95: quantile(steps, 0.95), max: Math.max(...steps) },
      stopped: results.filter((x) => x.r.stopped).map((x) => x.r.stopped),
    });
  }
  const s = summarise(all);
  const [lo, hi] = wilson(s.wins, s.wins + s.losses);
  rows.push({ baseline: b.name, fixture: "all", games: s.games, wins: s.wins, losses: s.losses, draws: s.draws, unfinished: s.unfinished, winRate: s.wins + s.losses ? s.wins / (s.wins + s.losses) : null, ci95: [lo, hi], bySeat: s.bySeat, damageDealt: s.damageDealt, damageTaken: s.damageTaken, guards: s.guards });
}

if (json) {
  console.log(JSON.stringify({ policy: `main v${MAIN_POLICY_VERSION} + combat v${COMBAT_POLICY_VERSION} + choices v${CHOICE_POLICY_VERSION}`, gamesPerFixture: games, maxMoves, rows, seconds: (Date.now() - started) / 1000 }, null, 2));
} else {
  const pct = (x: unknown) => (typeof x === "number" ? `${(x * 100).toFixed(0)} %` : "-");
  console.log(`Local policy (main v${MAIN_POLICY_VERSION} + combat v${COMBAT_POLICY_VERSION} + choices v${CHOICE_POLICY_VERSION}) vs baselines, ${games} games per fixture (half from each seat), max ${maxMoves} moves`);
  console.log("baseline   fixture  W-L-D (unfinished)   win rate (95 % CI)     p1 W-L  p2 W-L  damage dealt/taken  guard trips  step p95 ms");
  for (const r of rows) {
    console.log(
      `${String(r.baseline).padEnd(10)} ${String(r.fixture).padEnd(8)} ${`${r.wins}-${r.losses}-${r.draws} (${r.unfinished})`.padEnd(20)} ${`${pct(r.winRate)} (${pct(r.ci95[0])}-${pct(r.ci95[1])})`.padEnd(22)} ${`${r.bySeat.p1.wins}-${r.bySeat.p1.losses}`.padEnd(7)} ${`${r.bySeat.p2.wins}-${r.bySeat.p2.losses}`.padEnd(7)} ${`${r.damageDealt}/${r.damageTaken}`.padEnd(19)} ${`${r.guards.test}/${r.guards.baseline}`.padEnd(12)} ${r.stepMs ? r.stepMs.p95.toFixed(1) : ""}`,
    );
  }
  console.log(`${((Date.now() - started) / 1000).toFixed(0)} s`);
}
