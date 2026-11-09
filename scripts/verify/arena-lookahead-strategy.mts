/**
 * The lookahead difficulties on the executable strategy subcases (`arena-policy-strategy.ts`, the
 * #826 cases of AI-01, AI-02 and AI-05 from `docs/arena-strategy-validation.md`). Same positions, same
 * declared opponents, same objectives and acceptable first moves; only the candidate seat is played by
 * `lookaheadStep` (Normal, Hard) instead of a `Policy`, since the lookahead plays the pinned match
 * forward. Prints one line per case and difficulty and asserts the expectations recorded below.
 *
 *   npx tsx scripts/verify/arena-lookahead-strategy.mts
 */
import assert from "node:assert/strict";
import { policyTurn, localStep } from "../../src/lib/arena/policy/boundary";
import { localPolicy } from "../../src/lib/arena/policy/combat";
import { localMemory } from "../../src/lib/arena/policy/main";
import { policyRng } from "../../src/lib/arena/policy/rng";
import { DIFFICULTIES, lookaheadStep, type Difficulty, type SearchReport } from "../../src/lib/arena/lookahead/step";
import { strategyCases } from "./arena-policy-strategy";

/**
 * What each difficulty is expected to do on each case (8 Nov 2026, lookahead v3): every case passes on
 * both. The heuristic alone fails AI-01 own-combo lethal and AI-05 Critical-first
 * (`arena-policy-strategy.mts`); the lookahead's search changes the first move of exactly those two.
 */
const ALL_PASS = { normal: "pass", hard: "pass" } as const;
const EXPECTED: Record<string, Record<Difficulty, "pass" | "fail">> = {
  "ai-01-own-combo-lethal": ALL_PASS, "ai-01-life-replenishment": ALL_PASS, "ai-05-critical-first": ALL_PASS,
  "ai-05-normal-first": ALL_PASS, "ai-02-defer-first-defense": ALL_PASS,
};
const SEARCH_CHANGES = new Set(["ai-01-own-combo-lethal", "ai-05-critical-first"]);

const t0 = performance.now();
const { cases } = await strategyCases();
const base = localPolicy();
const rows: { key: string; difficulty: Difficulty; outcome: "pass" | "fail" | "interrupted"; first: boolean; objective: boolean; changed: number; stop: string | null }[] = [];
for (const c of cases) {
  for (const difficulty of ["normal", "hard"] as Difficulty[]) {
    let match = c.match;
    const memory = { p1: localMemory(policyRng(82601)), p2: localMemory(policyRng(82602)) };
    let first: boolean | null = null, steps = 0, stop: string | null = null, battles = 0, changed = 0;
    for (; steps < 80 && match.state.phase !== "over" && match.state.turn === c.match.state.turn; steps++) {
      if (battles >= (c.horizonBattles ?? Infinity) && !match.state.battle) break;
      const seat = (match.state.prompt as { player?: "p1" | "p2" }).player;
      if (!seat) { stop = "no seat"; break; }
      const turn = policyTurn(match, seat, steps);
      const mine = seat === c.seat;
      const next = mine ? lookaheadStep(match, seat, steps, memory[seat], DIFFICULTIES[difficulty], base) : localStep(match, seat, steps, memory[seat], c.opponent);
      if (!next.ok) { stop = `${next.reason}:${next.detail}`; break; }
      const search = (next as { search?: SearchReport | null }).search;
      if (mine && search?.status === "searched" && search.chosen !== search.heuristic) changed++;
      if (mine && (c.seat === "p1" || turn.input.decisions.window === "combo") && first === null) {
        const action = turn.key.menu[next.id];
        first = !!action && c.acceptable(match, action as unknown as Record<string, unknown>);
      }
      battles += next.events.filter((event) => event.type === "powerCompare").length;
      memory[seat] = next.memory;
      match = next.match;
    }
    const objective = c.objective(match);
    rows.push({ key: c.key, difficulty, outcome: stop ? "interrupted" : first && objective ? "pass" : "fail", first: first === true, objective, changed, stop });
  }
}
for (const r of rows) console.log(`${r.key.padEnd(28)} ${r.difficulty.padEnd(6)} ${r.outcome.padEnd(11)} first-move-acceptable ${r.first} objective ${r.objective} search-changed ${r.changed}${r.stop ? ` stop ${r.stop}` : ""}`);
assert.ok(rows.every((r) => r.outcome !== "interrupted"), "no case is interrupted");
for (const r of rows) {
  assert.equal(r.outcome, EXPECTED[r.key]?.[r.difficulty], `${r.key}/${r.difficulty}`);
  assert.equal(r.changed > 0, SEARCH_CHANGES.has(r.key), `${r.key}/${r.difficulty}: the search changes the heuristic's move exactly where the heuristic fails`);
}
console.log(`arena-lookahead-strategy: ok — ${rows.length} rows in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
