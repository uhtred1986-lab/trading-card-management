/**
 * Learn the lookahead's position value from play (owner's SPRT focus, 8 Nov 2026).
 *
 * The first evaluation (`evaluate.ts`'s hand-set weights) made the lookahead passive: hitting a Leader
 * hands its owner a card (Life to hand), and the hand-set weights valued that card nearly as much as
 * the Life, so the further the lookahead looked, the less it attacked (gate 1: H0; the reply horizon
 * on sprt-dev: 4-16 after 20 games). Here the value is fitted instead: the heuristic plays itself on
 * development seeds, every seat's view at the start of each of its Main Phases is recorded with
 * whether that seat went on to win, and a logistic regression of the result on the view's features
 * gives the weights `evaluate.ts` turns into a win probability.
 *
 *   npx tsx scripts/arena-lookahead-fit.mts --collect --games 120 --seed 60500000 --out rows-a.jsonl
 *   npx tsx scripts/arena-lookahead-fit.mts --fit rows-a.jsonl rows-b.jsonl ... [--model-out model.json]  # prints weights JSON
 *
 * Seeds: the `sprt-dev` block (development; never strength evidence). Only the seat's own restricted
 * observation is read, so the fitted value can read nothing a player could not.
 */
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { loadAuditFixtures } from "./verify/arena-policy-fixtures.mts";
import { createPinnedMatch } from "../src/lib/arena/browser";
import { localStep, policyTurn } from "../src/lib/arena/policy/boundary";
import { localPolicy } from "../src/lib/arena/policy/combat";
import { localMemory, type LocalMemory } from "../src/lib/arena/policy/main";
import { policyRng } from "../src/lib/arena/policy/rng";
import type { PlayerId } from "../src/lib/arena/types";
import { FEATURE_NAMES, features } from "../src/lib/arena/lookahead/evaluate";

const flag = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

async function collect() {
  const games = Number(flag("--games") ?? 40);
  const seed0 = Number(flag("--seed") ?? 60_500_000);
  const out = flag("--out") ?? "rows.jsonl";
  writeFileSync(out, "");
  const fixtures = await loadAuditFixtures();
  const policy = localPolicy();
  let rows = 0;
  for (let g = 0; g < games; g++) {
    const f = fixtures[g % fixtures.length];
    let { match } = await createPinnedMatch({ bundle: f.bundle, seed: seed0 + g, interpreterRevision: f.revision });
    const memory: Record<PlayerId, LocalMemory> = { p1: localMemory(policyRng(2 * (seed0 + g) + 1)), p2: localMemory(policyRng(2 * (seed0 + g) + 2)) };
    const seen = new Set<string>();
    const pending: { seat: PlayerId; x: number[] }[] = [];
    for (let n = 0; n < 3000 && match.state.phase !== "over"; n++) {
      const seat = (match.state.prompt as { player?: PlayerId }).player;
      if (!seat) break;
      if (match.state.prompt.kind === "main" && !seen.has(`${match.state.turn}:${seat}`)) {
        seen.add(`${match.state.turn}:${seat}`);
        // Both seats' views of the same moment: the one to act and the one waiting.
        for (const p of ["p1", "p2"] as const) pending.push({ seat: p, x: features(policyTurn(match, p, n).input.observation) });
      }
      const step = localStep(match, seat, n, memory[seat], policy);
      if (!step.ok) break;
      memory[seat] = step.memory;
      match = step.match;
    }
    const last = [...(match.beats?.list ?? [])].reverse().find((b) => b.t === "over") as { winner: PlayerId | null } | undefined;
    if (match.state.phase !== "over" || !last?.winner) continue;
    for (const r of pending) appendFileSync(out, JSON.stringify({ g: seed0 + g, f: f.name, y: r.seat === last.winner ? 1 : 0, x: r.x }) + "\n");
    rows += pending.length;
    if ((g + 1) % 10 === 0) console.log(`${g + 1}/${games} games, ${rows} rows`);
  }
  console.log(`wrote ${rows} rows to ${out}`);
}

/** L2-regularised logistic regression by Newton's method (IRLS). Returns the bias then one weight per feature. */
function fitLogistic(X: number[][], y: number[], lambda = 1): number[] {
  const d = X[0].length + 1;
  const w = new Array(d).fill(0);
  for (let it = 0; it < 50; it++) {
    const g = new Array(d).fill(0);
    const H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let i = 0; i < X.length; i++) {
      const xi = [1, ...X[i]];
      const z = xi.reduce((s, v, k) => s + v * w[k], 0);
      const p = 1 / (1 + Math.exp(-z));
      for (let a = 0; a < d; a++) {
        g[a] += (p - y[i]) * xi[a];
        for (let b = 0; b < d; b++) H[a][b] += p * (1 - p) * xi[a] * xi[b];
      }
    }
    for (let a = 1; a < d; a++) { g[a] += lambda * w[a]; H[a][a] += lambda; }
    // Solve H · step = g (Gaussian elimination).
    const A = H.map((row, i) => [...row, g[i]]);
    for (let c = 0; c < d; c++) {
      let piv = c;
      for (let r = c + 1; r < d; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]];
      for (let r = 0; r < d; r++) {
        if (r === c || A[c][c] === 0) continue;
        const k = A[r][c] / A[c][c];
        for (let k2 = c; k2 <= d; k2++) A[r][k2] -= k * A[c][k2];
      }
    }
    const step = A.map((row, i) => row[d] / (A[i][i] || 1));
    let moved = 0;
    for (let a = 0; a < d; a++) { w[a] -= step[a]; moved = Math.max(moved, Math.abs(step[a])); }
    if (moved < 1e-7) break;
  }
  return w;
}

function logLoss(X: number[][], y: number[], w: number[]): { loss: number; accuracy: number } {
  let loss = 0, right = 0;
  for (let i = 0; i < X.length; i++) {
    const z = w[0] + X[i].reduce((s, v, k) => s + v * w[k + 1], 0);
    const p = Math.min(1 - 1e-9, Math.max(1e-9, 1 / (1 + Math.exp(-z))));
    loss -= y[i] ? Math.log(p) : Math.log(1 - p);
    if ((p >= 0.5 ? 1 : 0) === y[i]) right++;
  }
  return { loss: loss / X.length, accuracy: right / X.length };
}

function fit(files: string[]) {
  const rows = files.flatMap((f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { g: number; y: number; x: number[] }));
  // Hold out whole games (every fifth) so the check is on unseen games.
  const train = rows.filter((r) => r.g % 5 !== 0), test = rows.filter((r) => r.g % 5 === 0);
  const w = fitLogistic(train.map((r) => r.x), train.map((r) => r.y));
  const base = (s: typeof rows) => { const p = s.reduce((a, r) => a + r.y, 0) / s.length; return -(p * Math.log(p) + (1 - p) * Math.log(1 - p)); };
  const tr = logLoss(train.map((r) => r.x), train.map((r) => r.y), w), te = logLoss(test.map((r) => r.x), test.map((r) => r.y), w);
  console.log(`rows ${rows.length} (train ${train.length}, held-out games' rows ${test.length})`);
  console.log(`log loss train ${tr.loss.toFixed(4)} / held-out ${te.loss.toFixed(4)} (coin ${base(test).toFixed(4)}); accuracy held-out ${(te.accuracy * 100).toFixed(1)} %`);
  const model = { bias: +w[0].toFixed(4), weights: Object.fromEntries(FEATURE_NAMES.map((n, k) => [n, +w[k + 1].toFixed(4)])) };
  console.log(JSON.stringify(model, null, 1));
  const out = flag("--model-out");
  if (out) { writeFileSync(out, JSON.stringify(model) + "\n"); console.log(`wrote ${out}`); }
}

if (process.argv.includes("--collect")) await collect();
else if (process.argv.includes("--fit")) fit(process.argv.slice(process.argv.indexOf("--fit") + 1).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--model-out"));
else console.log("usage: --collect --games N --seed S --out FILE | --fit FILE...");
