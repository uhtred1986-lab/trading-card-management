/**
 * The strategy benchmarks (`docs/arena-strategy-validation.md`), built 9 Nov 2026 on the kit in
 * `scripts/verify/strategy/kit.ts`: every case is solved exhaustively through the real engine (the
 * answer key), checked to discriminate (some first moves reach the objective, some do not), and then
 * played by the heuristic, Normal and Hard. A family may also give **risk cases** (AI-11,
 * `strategy/ai-11.ts`): one position played out in several declared deals of the hidden cards, scored
 * by the share of the declared weight each first move is acceptable in, with the candidate's first
 * answer required to be the same in every deal and on hidden-state twins. Prints the matrix;
 * `--json FILE` writes it.
 *
 *   npx tsx scripts/verify/arena-strategy-benchmarks.mts [--only ai-06[,ai-07]] [--json out.json]
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
import { AI07_CARDS, ai07Cases } from "./strategy/ai-07";
import { AI08_CARDS, ai08Cases } from "./strategy/ai-08";
import { AI09_CARDS, ai09Cases } from "./strategy/ai-09";
import { AI10_CARDS, ai10Cases } from "./strategy/ai-10";
import { AI11_CARDS, ai11RiskCases, judgeRisk, solveRisk, type RiskCase } from "./strategy/ai-11";
import { AI12_CARDS, ai12Cases } from "./strategy/ai-12";

const flag = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const t0 = performance.now();
type Bundle = Awaited<ReturnType<typeof benchBundle>>;
const FAMILIES: { cards: Parameters<typeof benchBundle>[0]; cases: (bundle: Bundle) => Promise<BenchCase[]>; risks?: (bundle: Bundle) => Promise<RiskCase[]> }[] = [
  { cards: AI03_CARDS, cases: ai03Cases },
  { cards: AI04_CARDS, cases: ai04Cases },
  { cards: AI06_CARDS, cases: ai06Cases },
  { cards: AI07_CARDS, cases: ai07Cases },
  { cards: AI08_CARDS, cases: ai08Cases },
  { cards: AI09_CARDS, cases: ai09Cases },
  { cards: AI10_CARDS, cases: ai10Cases },
  { cards: AI11_CARDS, cases: async () => [], risks: ai11RiskCases },
  { cards: AI12_CARDS, cases: ai12Cases },
];
const bundle = await benchBundle(FAMILIES.flatMap((f) => f.cards));
const only = flag("--only")?.split(",");
const cases = (await Promise.all(FAMILIES.map((f) => f.cases(bundle)))).flat().filter((c) => !only || only.includes(c.benchmark));
const risks = (await Promise.all(FAMILIES.map((f) => f.risks?.(bundle) ?? Promise.resolve([])))).flat().filter((c) => !only || only.includes(c.benchmark));

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
const riskShares: Record<string, Record<string, number>> = {};
for (const rc of risks) {
  const oracle = solveRisk(rc);
  riskShares[rc.key] = oracle.share;
  assert.ok(oracle.riskAcceptable.size > 0, `${rc.key}: no first move reaches the objective in ${rc.threshold} of the declared weight — the risk case is unwinnable as built`);
  assert.ok(oracle.riskAcceptable.size < oracle.options.length, `${rc.key}: every first move is risk-acceptable — the risk case does not discriminate`);
  for (const [name, candidate] of Object.entries(CANDIDATES)) {
    const r = judgeRisk(rc, oracle, name, candidate);
    assert.ok(r.twinNontrivial > 0, `${rc.key}: no hidden-state twin differed from its deal — the invariance check proved nothing`);
    results.push(r);
  }
  const shares = oracle.options.map((o) => oracle.share[o].toFixed(2)).join("/");
  console.log(`${rc.key.padEnd(34)} ${rc.variant.padEnd(8)} risk-acceptable ${oracle.riskAcceptable.size}/${oracle.options.length} (shares ${shares}, ${rc.deals.length} deals, oracle ${oracle.nodes} nodes) | ` +
    Object.keys(CANDIDATES).map((n) => {
      const r = results.find((x) => x.key === rc.key && x.candidate === n) as ReturnType<typeof judgeRisk>;
      return `${n} ${r.outcome}${r.invariant ? "" : " (not invariant)"}`;
    }).join(", "));
}
const total = cases.length + risks.length;
const byCandidate = Object.fromEntries(Object.keys(CANDIDATES).map((n) => [n, results.filter((r) => r.candidate === n && r.outcome === "pass").length]));
console.log(`passes of ${total} cases: ${JSON.stringify(byCandidate)}`);
assert.ok(results.every((r) => r.outcome !== "interrupted"), "no candidate is interrupted");
const out = flag("--json");
if (out) writeFileSync(out, JSON.stringify({
  cases: cases.map((c) => ({ benchmark: c.benchmark, key: c.key, variant: c.variant, seat: c.seat, note: c.note, horizon: c.horizon })),
  risks: risks.map((rc) => ({ benchmark: rc.benchmark, key: rc.key, variant: rc.variant, seat: rc.seat, note: rc.note, rule: rc.rule, threshold: rc.threshold, deals: rc.deals.map((d) => ({ label: d.label, weight: d.weight })), horizon: rc.deals[0].case.horizon, shares: riskShares[rc.key] })),
  results,
}, null, 1) + "\n");
console.log(`arena-strategy-benchmarks: ${total} cases in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
