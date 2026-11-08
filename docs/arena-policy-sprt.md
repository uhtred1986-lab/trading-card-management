# The offline opponent's strength gate: SPRT on paired deals

From **8 November 2026** (owner decision in chat) a change to the local (offline) opponent is
accepted as stronger by a **sequential probability ratio test** on paired deals, the way chess
engines accept changes (Stockfish's fishtest). It replaces the decisive-pair Wilson gate that
#663, #826 and #899 used; their results and evidence stay as they were
([arena-policy-strength.md](arena-policy-strength.md), [arena-resource-search-826.md](arena-resource-search-826.md),
[#899's holdouts](arena-backlog/evidence/899/fresh-holdouts-2026-10-19/README.md)). No database,
provider or network is involved.

```
npm run arena:sprt -- --candidate NAME --baseline heuristic --seed-block sprt-gate-1 --out FILE   # a gate run
npm run arena:sprt -- --candidate NAME --baseline heuristic                                       # development, sprt-dev block
npm run arena:sprt -- --ladder --candidate NAME --pairs 40                                        # rating against the frozen ladder
npx tsx scripts/verify/arena-sprt-stats.mts    # the statistics (in npm test, under 1 s)
npx tsx scripts/verify/arena-sprt-runner.mts   # registries, real deals, the privacy check (in npm test, about 20 s)
```

## "Smart enough"

The owner's definition (8 November 2026) has two halves; a candidate needs both:

1. it passes the twelve strategy benchmarks AI-01 to AI-12 of
   [arena-strategy-validation.md](arena-strategy-validation.md), and
2. it beats today's heuristic by a measured margin: **SPRT H1 accepted** with logistic-Elo bounds
   **[elo0, elo1] = [0, 30]** and **α = β = 0.05** against `heuristic` (`localPolicy()` at the same
   commit), on a fresh `sprt-gate` seed block, with **zero integrity failures**.

The runner checks the conditions of the second half it can see and says "not a gate result" when one
is missing (a dev or consumed block, other bounds, another baseline, privacy checks off, a dirty
tree). Device budgets for shipping a difficulty (Worker step p95 and maximum, retained heap, policy
time: [arena-worker-budgets.md](arena-worker-budgets.md) and the limits #663/#826/#899 declared) are a
separate requirement this page does not change.

## What is paired

- **A deal** is deal number d of a seed block: engine seed `base + d`, policy seed
  `policyBase + d`, on matchup d mod 4 of the cycle AvA, AvB, BvA, BvB (A = audited SD15 Pride of
  the Saiyans, B = audited SD5 The Crimson Saiyan, the #649 decks of
  [arena-policy-evaluation.md](arena-policy-evaluation.md)).
- **Both seats.** The deal is played twice: the candidate in p1, then in p2. Decks, engine seed
  and each *physical seat's* policy RNG (`policyRng(2·policySeed + 1)` for p1, `+ 2` for p2) are
  the same in both games, as in #899. So an A/A deal (the same player in both chairs) is literally
  the same game twice and always splits; any harness asymmetry would show as a non-split pair.
- **The pair's score** is the candidate's points over its two games: a win 1, a draw ½, a loss or
  an unfinished game 0. The five possible totals 0, ½, 1, 1½, 2 are counted as the
  **pentanomial**. Seat and deal luck cancel inside a pair, and the pentanomial's variance carries
  the correlation of the two games, which a game-by-game count would ignore.

## The test

`scripts/lib/sprt.ts`, pure arithmetic:

- Logistic Elo to expected score: s = 1 / (1 + 10^(−elo/400)); elo1 = 30 is a 54.31 % score.
- Wald's bounds: accept H0 at LLR ≤ ln(β/(1−α)) = −2.944, H1 at LLR ≥ ln((1−β)/α) = +2.944.
- The generalised log-likelihood ratio in fishtest's normal approximation, with the empirical
  pentanomial variance:
  **LLR = n · (s1 − s0) · (2s̄ − s0 − s1) / (2σ̂²)**, where s̄ is the mean pair score per game
  (pair points / 2), σ̂² its per-pair variance and n the number of pairs. Empty cells get fishtest's
  1e-3 pseudo-count, so a degenerate sample has a small positive variance, never a NaN. The exact
  constrained-maximum-likelihood GSPRT (`llrExact`) is kept as a cross-check; on the cases in the
  verify script the approximation is within 15 %, and almost exact near zero.
- Outcomes are consumed **strictly in deal order**, the test is re-evaluated after every pair, and
  the run stops at the first decision or at `--max-games` (then "inconclusive at the cap"). Worker
  processes play deals in parallel, but deals finished beyond the decision are discarded unread, so
  the result is the same for any `--workers` (checked: in-process and three workers give identical
  reports).
- **One addition to fishtest:** the stopping rule is consulted only from **20 pairs, 10 of them
  informative** (not a 1–1 split). In this game most pairs split because the seat decides (75 % in
  #826's holdout, 84 % in #899's); an early sample of nearly all splits has a variance estimate near
  zero and a large, spurious LLR for H0. Simulated, fishtest's rule with only a 20-pair minimum
  rejected a true +30 Elo 13 % of the time at 84 % splits and 19 % at 90 % (β is meant to be 5 %);
  with no minimum at all, 66 % at 75 % splits. With the informative-pair minimum both error rates are
  at or under 5 % from 50 % to 90 % splits. A run in which the two
  players never disagree on a deal (an A/A run of identical players) therefore never decides and
  ends at its cap with an LLR far below the lower bound: there is no variance to test.
- Reported with the decision: W-D-L, the pentanomial, the LLR and bounds, **Elo with a 95 %
  interval** (the score interval s̄ ± 1.96·σ̂/√n mapped through logistic Elo), the likelihood of
  superiority, and the expected length of the test (`sprtExpectation`, Wald's Brownian
  approximation) at the run's own variance and at #826's and #899's.

## Why it replaces the decisive-pair Wilson gate

The old gate played a fixed 160 paired deals (#826, #899) and passed only with at least 20
decisive pairs (won-both or lost-both) and a 95 % Wilson lower bound above 50 % on won-both among
them. With 26 decisive pairs that needs 18 won-both (69 %); with 20, 15 (75 %). It discards the
split pairs, declares no power, and every miss reads "inconclusive" because it has no negative
answer. Simulated at the split rates those experiments saw:

| split pairs | true Elo | old gate passes (160 pairs, 320 games) | SPRT accepts H1 | SPRT games on average |
|---|---|---|---|---|
| 75 % (#826) | 0 | 2.6 % | 4.5 % | 355 |
| 75 % | +15 | 19.5 % | 50.9 % | 614 |
| 75 % | +30 | 60.0 % | 94.6 % | 357 |
| 75 % | +50 | 96.8 % | 99.8 % | 160 |
| 84 % (#899) | 0 | 2.3 % | 4.1 % | 262 |
| 84 % | +15 | 26.8 % | 48.6 % | 438 |
| 84 % | +30 | 76.1 % | 94.6 % | 244 |
| 84 % | +50 | 91.0 % | 100 % | 130 |

The SPRT names the margin it tests (+30 Elo), holds both error rates at 5 %, says "no" (H0) as
clearly as "yes", and spends games only while the evidence is unclear: on average no more than the
old 320-game schedule at +30 Elo. Read as one look at their final counts (not the sequential test
they would have been), the old holdouts give: #826 (11 won-both / 120 split / 29 lost-both) LLR
−9.0, H0; #899 (14 / 134 / 12) LLR −2.6, still undecided (Elo +4.3, 95 % interval −17 to +26);
#663 (3 / 35 / 2, 40 pairs) LLR −0.5, undecided with only 5 informative pairs. None of them would
have been a +30 Elo pass.

## Seed blocks

`scripts/lib/arena-seed-blocks.ts` is the registry. The runner refuses a consumed block, and the
registry refuses any block whose engine or policy seeds touch a consumed range or another block.

| range | status | what |
|---|---|---|
| 0 – 999,999 | consumed | fixture and scenario seeds, the #651 dev set (641,000–652,999, tuned against by every evaluator), #897 corpus packs (897,000+), #901 Claude duel (901,000+); policy seeds 7919+… |
| 10,000,000 – 10,999,999 | consumed | #663 search v1 holdout |
| 20,000,000 – 20,999,999 | consumed | #826 interrupted holdout |
| 30,000,000 – 30,999,999 | consumed | #826 holdout |
| 40,899,000 – 40,999,999 | consumed | #899 holdouts (policy seeds 89,940,000+ too) |
| `sprt-gate-1` … `sprt-gate-5`: 50,000,000 + 1,000,000·(N−1), policy 550,000,000 + … | open | one gate run each |
| `sprt-dev`: 60,000,000 – 60,999,999, policy 560,000,000+ | dev | development and tuning; never evidence of strength |

A gate run uses the next open `sprt-gate` block. The change that records its evidence sets that
block to `consumed` with `consumedBy` naming the evidence file, whether it passed or not: a retuned
candidate gets the next block, never the same deals again. `sprt-dev` may be reused freely.

## Players

`scripts/lib/arena-sprt-players.ts`. A player is a **seat player**
(`scripts/lib/arena-seat-duel.ts`): `(match, seat, revision, memory) => LocalStep`, the shape of
`localStep` in `src/lib/arena/policy/boundary.ts`, so a lookahead player gets the pinned match to
simulate on. Built in: `heuristic` (`localPolicy()` through `localStep`), `uniform` (a random legal
answer, `arena-policy-eval`'s baseline) and `shortcuts` (the #645 shortcuts, uniform elsewhere).
`uniform`, `shortcuts` and `heuristic` are the frozen ladder of `--ladder`. Add a player with
`registerPlayer(name, factory, description)` in that file, or in a module passed as
`--players-module FILE` (imported in the runner and in every worker). The contract:

- The factory is called afresh for every game and seat; nothing carries between games.
- Within a game the player decides from its arguments only; everything it carries goes through
  `memory` (its RNG included). The runner calls it a second time on a hidden-state twin
  (`permutedFor`: every card the seat cannot see swapped, hidden areas reordered, instance ids
  permuted) every `--privacy-every` (20) candidate decisions and requires the same observation,
  decision id, guard, picked cards and memory. A player that simulates on the real hidden cards
  fails this check (the verify script proves it with a deliberately peeking player).
- Return the policy's `answer` with the step when there is one (`answeringStep` does it for a
  `Policy`): without it the twin check cannot compare the cards of a pick.

`playDuel` (`scripts/verify/arena-policy-duel.ts`), which every earlier evaluator uses, now runs on
the same loop (`playSeatDuel`); its results are unchanged (54 games across all nine fixtures replayed
with byte-identical records).

## Integrity

Every game must finish. These are integrity failures, kept per game in the report, and **any one
fails the run** (exit 1), whatever the SPRT said: an illegal answer, an interruption (a window no
handler reads, a referee question, a guard with no exit), a seat with nothing to decide, the
3,000-move cap, an exception, a hidden-twin privacy failure, and a cycle-guard takeover of the
candidate. The game still counts in the pair, scored 0 for the candidate: nothing is dropped.

## The report (`--out`)

`format: "arena-sprt-v1"`: `config` (players and their descriptions, the seed block, bounds,
minimums, cap, fixture cycle, move cap, privacy interval), `source` (git commit, a hash of any
uncommitted change, whether the source changed during the run, Node version), `result` (decision,
verdict, gate eligibility and why not, W-D-L, pentanomial, LLR, bounds, Elo with interval, integrity
failures, twin checks, expected test lengths, and one line per pair: deal, fixture, seeds, points,
and per game the candidate's seat, winner, moves, stop, trace hash and twin checks) and `run` (wall
time, per-game time, workers, CPUs, host load, deals discarded past the decision; the only part that
is not deterministic). No private state is written. There is no `--resume`: the search evaluator's
checkpoint journal (`scripts/lib/arena-search-checkpoint.ts`) is built around search telemetry, and a
run restarts from scratch with the same result.

## Measured on 8 November 2026

The harness's own runs, on the development block (`sprt-dev`) with three worker processes on a
4-vCPU cloud host that other agents' test runs were sharing (load average 4–5 before these runs
started, about 2–3 for the last two). Reports: [evidence/sprt/](arena-backlog/evidence/sprt/README.md).

| run | games | result | LLR | Elo (95 %) | integrity | wall |
|---|---|---|---|---|---|---|
| `heuristic` vs `heuristic` (A/A), cap 400 games, commit 6259a06 | 400 (cap) | inconclusive at the cap: H1 not accepted; all 200 pairs split | −59,353.5 | +0.0 (−0.2, +0.2) | 0 (2,295 twin checks) | 1,289 s: 3.2 s/game |
| `heuristic` vs `uniform`, commit 548ecd7 | 40 | **H1** at pair 20, the minimum (40–0) | +4,397 | lower bound +943 | 0 (141 twin checks) | 43 s: 1.1 s/game |
| `--ladder` for `heuristic`, 12 deals each, commit 548ecd7 | 72 | uniform 24–0, shortcuts 24–0, heuristic 12–12 (all split) | – | – | 0 | 100 s: 1.4 s/game |
| **gate** `lookahead-hard` (v1, turn horizon) vs `heuristic`, `sprt-gate-1`, commit b7cd1a6 | 334 | **H0** accepted: no 30-Elo improvement (162–172; ptnml 32/0/108/0/27) | −2.98 | −10.4 (−41.9, +20.9) | 0 (1,966 twin checks) | 3,988 s: 11.9 s/game |

- **The A/A is exact.** All 200 A/A pairs are the same game twice (identical trace hashes): the
  pairing has no seat or memory asymmetry, and the first seat won 109 of the 200 deals. With no
  informative pair the minimum-sample rule never lets it decide, so it runs to its cap, as
  designed; its LLR is thousands below the H0 bound and H1 was never in reach.
- **Time per game.** Heuristic against heuristic, 211 moves on average: 9.6 s per game inside a
  contended worker (median 7.8 s, p95 22 s), 4–8 s alone in one process; with three workers the run
  delivered a game every **3.2 s** of wall time. Games against `uniform` are shorter (2.9 s each in a
  worker, 1.1 s of wall time per game with three). On this shared host three workers gave about 1.7×
  the throughput of one (5.4 s per game alone, 3.2 s with three); on an idle machine expect closer to 3×.
- **Expected length of a real gate run** at a true +30 Elo (Wald's approximation; simulated values
  in brackets): **232 games** (244) at #899's per-pair variance (0.041), **339 games** (357) at #826's
  (0.059). The longest runs are near +15 Elo, halfway between the hypotheses: 438–614 games
  simulated. At the heuristic's own speed that is roughly **12–33 minutes** of wall time with three
  workers here; a lookahead candidate multiplies its own share of each game by its slowdown per
  decision. The default cap of 2,000 games (about 1.8 hours at heuristic speed) leaves room beyond
  the slowest expected case; a gate run should declare its cap before it starts.
- An all-won sample (vs `uniform`) has no finite Elo: its point estimate and upper bound come from
  the 1e-3 pseudo-counts and mean nothing; its lower bound is the informative number.

## Limits

- Two starter decks. A pass says the candidate beats the heuristic by a measured margin **on the
  audited SD15/SD5 matchups**, not across archetypes; the strategy benchmarks and per-matchup reading
  (`pairOutcomes` carries the fixture of every pair) are where an archetype regression shows.
- The LLR is fishtest's normal approximation; the minimum-sample rule is this repository's, checked by
  simulation, not taken from fishtest. Wald's expected lengths ignore overshoot: real runs run a
  little longer and err a little less often (see the simulated column above).
- `heuristic` means `localPolicy()` at the run's commit. A candidate built on a changed heuristic is
  compared with that changed heuristic; the report's source pin says which.
- Node timings on a shared host are descriptive; they are not the Worker budgets.
