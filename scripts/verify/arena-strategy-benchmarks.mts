/**
 * The strategy benchmarks (`docs/arena-strategy-validation.md`), built 9 Nov 2026 on the kit in
 * `scripts/verify/strategy/kit.ts`: every case is solved exhaustively through the real engine (the
 * answer key), checked to discriminate (some first moves reach the objective, some do not), and then
 * played by the heuristic, Normal and Hard. Prints the matrix; `--json FILE` writes it.
 *
 *   npx tsx scripts/verify/arena-strategy-benchmarks.mts [--only ai-06] [--json out.json]
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { localPolicy } from "../../src/lib/arena/policy/combat";
import { DIFFICULTIES, lookaheadStep } from "../../src/lib/arena/lookahead/step";
import { answeringStep } from "../lib/arena-seat-duel";
import { benchBundle, judge, solve, type BenchCase, type Candidate, type Result } from "./strategy/kit";
import { AI03_CARDS, ai03Cases } from "./strategy/ai-03";
import { AI04_CARDS, ai04Cases } from "./strategy/ai-04";
import { AI06_CARDS, ai06Cases } from "./strategy/ai-06";

const flag = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const t0 = performance.now();
const FAMILIES: { cards: Parameters<typeof benchBundle>[0]; cases: (bundle: Awaited<ReturnType<typeof benchBundle>>) => Promise<BenchCase[]> }[] = [
  { cards: AI03_CARDS, cases: ai03Cases },
  { cards: AI04_CARDS, cases: ai04Cases },
  { cards: AI06_CARDS, cases: ai06Cases },
];
const bundle = await benchBundle(FAMILIES.flatMap((f) => f.cards));
const only = flag("--only");
const cases = (await Promise.all(FAMILIES.map((f) => f.cases(bundle)))).flat().filter((c) => !only || c.benchmark === only);

const base = localPolicy();
const CANDIDATES: Record<string, Candidate> = {
  heuristic: answeringStep(base) as Candidate,
  normal: ((m, s, r, mem) => lookaheadStep(m, s, r, mem, DIFFICULTIES.normal, base)) as Candidate,
  hard: ((m, s, r, mem) => lookaheadStep(m, s, r, mem, DIFFICULTIES.hard, base)) as Candidate,
};

const results: Result[] = [];
for (const c of cases) {
  const oracle = solve(c);
  assert.ok(oracle.acceptable.size > 0, `${c.key}: no line reaches the objective — the case is unwinnable as built`);
  assert.ok(oracle.acceptable.size < oracle.options.length, `${c.key}: every first move reaches the objective — the case does not discriminate`);
  for (const [name, candidate] of Object.entries(CANDIDATES)) results.push(judge(c, oracle, name, candidate));
  console.log(`${c.key.padEnd(34)} ${c.variant.padEnd(8)} acceptable ${oracle.acceptable.size}/${oracle.options.length} (oracle ${oracle.nodes} nodes) | ` +
    Object.keys(CANDIDATES).map((n) => `${n} ${results.find((r) => r.key === c.key && r.candidate === n)!.outcome}`).join(", "));
}
const byCandidate = Object.fromEntries(Object.keys(CANDIDATES).map((n) => [n, results.filter((r) => r.candidate === n && r.outcome === "pass").length]));
console.log(`passes of ${cases.length} cases: ${JSON.stringify(byCandidate)}`);
assert.ok(results.every((r) => r.outcome !== "interrupted"), "no candidate is interrupted");
const out = flag("--json");
if (out) writeFileSync(out, JSON.stringify({ cases: cases.map((c) => ({ benchmark: c.benchmark, key: c.key, variant: c.variant, seat: c.seat, note: c.note, horizon: c.horizon })), results }, null, 1) + "\n");
console.log(`arena-strategy-benchmarks: ${cases.length} cases in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
