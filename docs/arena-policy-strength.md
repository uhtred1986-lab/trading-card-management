# Bounded policy search experiment (#663 / #664)

O5 search is an optional, callable attack-sequence policy. The player opponent
remains the heuristic until the predeclared promotion gate passes. This experiment
does not change card rules, the online opponent, snapshots, replays or existing
saves. No database, provider or paid call was used.

## What the prototype does

`src/lib/arena/policy/search.ts` consumes only `PolicyInput` and `PolicyRng`, the
same restricted observation/legal-menu contract as the heuristic. Its value
imports stay inside the policy layer. It searches a maximum of two attacks,
comparing each current legal root attack over eight common sampled opponent hands.
The opponent may block or spend enough sampled combo to win the battle; the
attacker may continue with another visible attacker or stop. Public current power,
strike/critical, blockers, Revenge, Indestructible and Victory Strike contribute
to the score. Unmodelled card text and attacker exposure lower the score.

This is an approximate planning model, **not a second rules engine**. Only a
current menu decision ID is returned; the real engine executes every action and
all card skills. Future actions in the model are hypothetical. It does not
execute triggers, counter cards, draw/awakening effects, new Life-to-hand resources,
own combos, extra attacks, Unisons or future turns. A legal root can therefore
have an inaccurate predicted outcome. Those limitations belong in strength
evaluation, not a claimed rules proof.

The observation does not expose an opponent decklist. Each hidden hand slot is
sampled as 50% free 5,000 combo / 50% unusable, independently. That prior is
explicitly experimental and is not a claim about either deck's card distribution.
No hidden card identity/order or engine RNG is sampled. `sampleComboHand` uses
only public hand count and policy randomness. Common samples prevent different
root actions receiving different random hands.

Search runs only when the frozen heuristic already selects an attack, all
relevant cards have visible power, no Unison is present, and the structural limits
fit. Other windows and oversized positions keep the heuristic. Default limits:
4,096 nodes, 256 KiB structural workspace reservation, eight samples, depth two,
32 menu decisions, 16 visible cards and 32 hidden hand slots. These are a desktop
experimental profile calibrated below, not a performance promise for every device.

The host may inject `stop()` to supply a monotonic deadline, cancellation and
actual memory-pressure signal. It is polled before sampling, throughout the tree
and before returning an answer. The policy itself reads no ambient clock or heap.
Any stop or exhausted node/reservation budget discards incomplete scores **and
sample RNG advancement**, returning the exact heuristic answer/RNG for the current
menu. A tree is never retained; only the bounded root list, samples and depth-first
frames remain live. `reservedBytes` is a structural estimate, not a measured JS
heap cap. Browser heap is measured separately; a pressure callback handles actual
host pressure.

## Frozen comparison and promotion gate

The baseline is `localPolicy()` (main v1, combat v1, choices v1) from commit
`7dfe580729ba743705439875aac9b3c046128dba`. It was not changed or retuned. Search v1
was frozen before the first O5 holdout at SHA-256
`5e2e678fe89caf0a900ce2947b770d25ac7f3e9c659c8e30bd83fdc6fde21024`
for `src/lib/arena/policy/search.ts`.

`scripts/arena-search-eval.mts` declares the gate before looking at holdouts:
at least 40 curated seed pairs, at least 20 decisive pairs (won-both or lost-both),
and a 95% Wilson lower bound above 50% for won-both among decisive pairs. Every
game must complete with zero illegal answers and privacy failures. Chrome Worker
whole-step p95 must be at most 30 ms, max at most 300 ms, retained heap at most
16 MiB; policy-only p95 at most 5 ms and structural reservation at most 256 KiB.
These use the O1/O4 worker budgets in `docs/arena-worker-budgets.md` and the existing
5 ms policy allowance. A useful tactical result alone cannot promote a difficulty.

The gate is also present in the committed first dev report, generated before
holdouts. Immediately before the first holdout invocation, the session recorded
the original evaluator SHA-256
`d6eac7cefdd66eefb9ba4c748080a9ef924605926967ab26e001156bbc5415a4`
and frozen candidate hash. Later evaluator edits only compact the evidence and
add explicit seeds/source hashes; the gate and candidate remain unchanged.

Every deal is played from both seats. Engine seeds use the committed #651 ranges;
policy seeds are independent of them. Development uses indices 0–1. The final
holdout uses **indices 0–9 at the reserved +10,000,000 offset**, across all four
ordered SD15/SD5 matchups, once after freezing the candidate. There is no tuning
against these holdout results. All failures, unfinished games, stop details,
per-game/per-window timing distributions and decision/event trace hashes are
retained in the committed JSON, never scored as
draws or removed. Per-seat win/completion/illegal Wilson intervals are in that
report. Memory readings from Node include the engine, bundles and accumulated
report and are labelled accordingly; they are not compared to a browser heap cap.

## Tactical and privacy evidence

`scripts/verify/arena-policy-search.mts` stages a real-engine position with two
attackers and a distracting rested Battle Card. One-ply search and the frozen
heuristic choose the KO; two-ply search chooses a Leader attack. Playing the
actual engine battle windows proves search wins that turn and the heuristic does
not. The case uses 176 nodes and 7,360 reserved structural bytes. This named
development case is separate from the random matchups. After freezing, two more
tactical cases were added without tuning the candidate: a stronger standing
Blocker prevents a one-attack win, and a three-attacker finish **fails** when real
Life-to-hand cards let the defender combo. The latter was initially expected to
finish and did not; the proof now preserves this negative observation as a known
model limitation. It is not counted as a tactical success.

The focused proof also checks a nonempty hidden hand, 24 nontrivial hidden state
variants, currently legal root decisions, exact JSON reload continuation, six
emergency exits and cancellation/deadline/memory stops in the middle of a tree.
Live state, game RNG, input and supplied policy RNG do not mutate. The import
guard includes the search module and still rejects engine/provider/database/game
RNG/ambient clock access. Its unchanged contract checks cover 420 positions,
1,056 differing hidden permutations, stale/foreign/malformed answers and menu/
compound round trips. The final match report adds hidden twins across real games.

## Development results, including the failed first approach

The first implementation admitted only skill-less visible cards. It searched
zero positions in 16 real-deck games: 8–8, eight split pairs, 16/16 completion,
zero illegal and 92 nontrivial hidden twin checks. This inert approach was rejected
before holdouts. Its complete report is
`docs/arena-backlog/evidence/663/dev-conservative.json`.

The final approximate model searched actual curated positions in the same dev
deals: 10–6, pair totals 2 won-both / 6 split / 0 lost-both, all 16 games complete,
zero illegal and 88 differing hidden twins. It made 229 successful search decisions
and 33 node-budget fallbacks. See `docs/arena-backlog/evidence/663/dev.json`. Dev
strength is tuning evidence and earns no player-facing difficulty claim.

## Untouched holdout result: do not promote

The final 80 games completed with zero illegal decisions, zero unfinished games,
and 418 differing hidden twin checks. Search ran 975 decisions and reached its
node cap with exact heuristic fallback 196 times. The candidate won 41 and lost
39: **51.25% with a 95% Wilson interval of 40.49–61.91%**. Forty paired deals
contained 3 won-both, 35 splits and 2 lost-both. The decisive-pair proportion is
3/5 (60%), CI **23.07–88.24%**; the required 20 decisive pairs and lower bound
above 50% are both missed. Seat/deal effects account for most results.

| Curated matchup | p1 W–L (10 games) | p2 W–L (10 games) | Pair W/S/L | Policy p95 | Whole-step Node p95 | Largest reservation |
|---|---:|---:|---:|---:|---:|---:|
| SD15 v SD15 (`AvA`) | 7–3 | 3–7 | 0/10/0 | 0.43 ms | 29.70 ms | 16,320 B |
| SD15 v SD5 (`AvB`) | 10–0 | 0–10 | 0/10/0 | 0.54 ms | 28.80 ms | 20,544 B |
| SD5 v SD15 (`BvA`) | 6–4 | 4–6 | 1/8/1 | 0.94 ms | 26.61 ms | 18,880 B |
| SD5 v SD5 (`BvB`) | 8–2 | 3–7 | 2/7/1 | 1.60 ms | 35.84 ms | 21,824 B |

Each seat/matchup is 10/10 complete, 0/10 illegal; their Wilson intervals are
72.25–100% completion and 0–27.75% illegal, reflecting the small samples rather
than promising universal safety. Overall completion is 80/80, CI 95.42–100%;
illegal is 0/80, CI 0–4.58%. All per-seat win intervals, maxima and measured Node
heap distributions (includes the engine/report; not search-only memory) are in
`docs/arena-backlog/evidence/663/holdout.json`.

The promotion decision is **negative**. The experiment offers a useful callable
prototype and one demonstrated tactical improvement, but measured general strength
does not justify a new player-facing difficulty. `localPolicy()` remains the
default, so existing heuristic save version/configuration, reload and cancellation
behavior remain intact. No search option is advertised or persisted. A future
candidate needs new untouched seeds and another predeclared gate; these holdouts
are now used and must not become tuning evidence presented as unseen evaluation.

## Next experiment toward a stronger opponent

The next bounded increment should add sampled Life-to-hand replenishment after
non-Critical damage, consuming a common pre-sampled resource stream across roots.
The failed three-attacker holdout above is the regression case for that change;
it must predict the real defender's extra combo resources without learning their
actual identities. Add resource-aware own combos from the visible hand, and
compare depths two and three only after measuring their node/fallback costs.
Blocker use, conservative counter uncertainty and card/energy opportunity costs
need tactical tests where a greedy lethal estimate is wrong. Increasing the depth
without correcting resource replenishment would amplify the same error.

Tune that candidate on dev seeds and these now-used cases. Reserve a new,
non-overlapping seed range before testing it, freeze the policy and declare sample
size, decisive-pair uncertainty, completion/legality and Worker performance gates
before the first run. Ship a persisted opt-in difficulty only if that complete
gate passes, with cancellation/fallback/reload proofs for its actual worker/save
integration. No strength gain is claimed for this follow-up plan.

## Browser cost calibration (14 October 2026)

Unthrottled Linux Chrome 154 Worker, Node 24.19.0; the host also ran the independent
holdout process. No page rendering is part of these costs. Physical-phone tests
were waived for this work; there is no physical-phone measurement claim.

| Case | Sample | Policy/whole-step p95 | Max | Retained Worker heap | Result |
|---|---:|---:|---:|---:|---|
| Pure two-attack search | 200 calls | 0.4 ms policy | 2.2 ms | 0.48 MB (shared with wide case) | 200 searched |
| Pure wide legal menu | 200 calls | 1.2 ms policy | 4.3 ms | 0.48 MB | 200 exact heuristic fallbacks at 4,096 nodes |
| SD15/SD5, four ordered matchups, both seats | 8 games / 851 tested steps | 30.0 ms whole step | 102.6 ms | 7.89 MB | 8/8 complete, 0 guard trips, exact Node/Worker traces |
| Main-policy synthetic fixture, both seats, two dev deals | 4 games / 245 tested steps | **30.3 ms whole step, OVER 30** | 78.0 ms | 5.65 MB | 4/4 complete, exact Node/Worker traces |
| Same synthetic fixture, fresh rerun after holdout process finished | 4 games / 245 tested steps | 12.8 ms whole step | 26.0 ms | 5.65 MB | 4/4 complete, exact Node/Worker traces |

The pure Worker also receives cancellation and an expired real monotonic deadline;
both return the same current menu ID as the Node heuristic. The widest reservation
there is 18,880 bytes. These figures measure search at its node cap, including
fallback cost. The first synthetic whole-step run misses the strict p95 allowance
and stays in the evidence; it is not silently called a pass. A fresh rerun passes
without changing budgets or candidate code. Recordings:
`browser-policy.json`, `browser-curated.json`, `browser-synthetic.json`,
`browser-synthetic-rerun.json` under
`docs/arena-backlog/evidence/663/`.

## Reproduce

```bash
env -u DATABASE_URL npx tsx scripts/verify/arena-policy-search.mts
env -u DATABASE_URL npx tsx scripts/verify/arena-policy-contract.mts
env -u DATABASE_URL npm run arena:search-eval -- --seeds 2 --seed-set dev --out dev.json
# Holdouts are reserved; reruns of the frozen experiment verify it, never tune it.
env -u DATABASE_URL npm run arena:search-eval -- --seeds 10 --seed-set holdout --allow-holdout --out holdout.json
env -u DATABASE_URL npx tsx scripts/arena-search-bench.mts > browser-policy.json
env -u DATABASE_URL npm run arena:policy-browser -- --search --audit --seeds 1 --throttle 1 --json > browser-curated.json
env -u DATABASE_URL npm run arena:policy-browser -- --search --fixtures 646 --seeds 2 --throttle 1 --json > browser-synthetic.json
```

The worker agent ran focused proofs, typecheck and lint (zero errors; five existing
prototype warnings). The coordinator runs the combined full `npm test` and build
before merging. No Snapshot/compiler/rules changes are included, so contract
emission, glossary/readings and database-backed fuzz are not applicable to this
policy-only increment.
