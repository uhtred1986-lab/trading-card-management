# Resource-aware bounded search (#826)

Search v2 remains an explicitly selected experiment. The shipped heuristic and difficulty settings are unchanged. Development produced useful tactical corrections but **no measured whole-game strength gain**: depth 2 and depth 3 each finished 7–9 against the frozen heuristic on 16 audited games. The first +20M attempt was interrupted by an environment restart after 107 recorded console outcomes; it is retained as partial evidence, not a completed holdout. The completed +30M run used durable per-game checkpoints and finished **142–178**. Its paired confidence interval is wholly below 50%; the candidate is not promoted.

## Model and boundaries

The policy reads restricted observation, the current legal menu and its own RNG. Common abstract samples contain independent 50% free 5k combo / 50% unusable resources for public opponent hand counts and Life slots. Ordinary damage adds sampled Life resources to the simulated hand; Critical consumes the same slots without replenishment. Actual hidden identities/order are never read. This prior is a sensitivity assumption, not a catalog distribution.

Visible own hand/active Battle Card combo power and printed energy cost are enumerated with a spent-resource mask and remaining energy. A used field card cannot also attack; a spent resource cannot be spent again. Main attacks and attacker combo/pass decisions plan remaining visible attacks. Continuation utility discounts each additional attack by 1%, preferring an immediate finish over disposable resource pressure before the same finish. This is an explicit planning preference, not a rules claim.

The first defender-combo subcase supports a Leader with no own Battle Cards against an opponent with no hidden hand. It weighs the current damage against remaining public one-attack threats and sampled Life replenishment. It falls back for future Victory Strike/extra-attack keywords. This does not prove a forced survival line against arbitrary counters, activations, skill triggers or future draws.

Printed strike parameters are read only while the Strike keyword remains active. Current battles prefer resolved stakes. Negated printed Double Strike deals one modeled damage; a granted/unresolved Strike parameter falls back. Other unmodelled text receives an uncertainty penalty in the approximate offensive model. Counters, complex skill effects, extra attacks, cost reducers/alternative payments, Life replacements, Unisons and future turns remain unsupported or approximate. The engine remains the sole executor and legal root authority.

Hard limits remain 4096 nodes, 256 KiB structural workspace reservation, eight samples and depth at most three. Own combo resources are capped at eight, visible board cards at sixteen, hand count at thirty-two and Life at eight. Workspace includes all bounded resource subset frontiers. Every subset traversal consumes nodes. Exhaustion/cancellation/deadline/memory pressure discards partial scores and sample RNG advancement and returns the exact heuristic result.

## Executable development objectives

`scripts/verify/arena-policy-strategy.mts` runs numeric/keyword-only synthetic cards through the actual compiler and battle windows. These are subcases of AI-01/02/05, not whole benchmark passes or release-deck qualifications.

| Case | Independently declared objective / response | Heuristic | Search d2 / d3 |
| --- | --- | --- | --- |
| AI-01 own-combo lethal | Win this turn against a 20k Leader at one Life; actual 10k combo costs one energy | fail | pass / pass |
| AI-01 Life replenishment control | Three ordinary 10k attackers against three Life that contain free 5k defense; retain the actual non-finish as a negative control | pass | pass / pass |
| AI-02 defer first defense | Allow the first 15k hit, then survive the remaining 25k Double Strike using known 5k/paid 10k plus the declared 5k Life draw; numeric attacker continuation | fail | pass / pass |
| AI-05 Critical first | Win this turn with equal 10k Critical/normal attackers against two Life and no initial hand; numeric cheapest offered defense | fail | pass / pass |
| AI-05 normal first | **One-battle finish** with a 25k normal attacker against one Life and one free 5k guard; weak Critical first needs another battle and does not meet this objective | pass | pass / pass |

AI-02 survival is conditional on the declared actual Life draw and numeric response, not omniscient knowledge available to the policy. Its hidden twins have identical policy input and answers. Independent engine controls verify ordinary damage moves the actual Life card to Hand while Critical moves it to Drop, actual paid energy consumption, skill negation with unchanged printed text, and explicit fallback for unresolved granted Strike. Thirty-two new hidden twins cover main/attacker combo/defender combo and negated-skill positions, with legal budget fallbacks and input/live-state/RNG purity. Historical v1 false-lethal and stronger-Blocker failures remain consumed regression cases.

## Development evidence

The two runs use dev indices 0–1 for AvA, AvB, BvA and BvB, each from both seats. The candidate source SHA-256 in both retained reports is `76af79bb03effff5d2300394484692603e863b8231a80f16d9b6acda22822dc9`. The reports retain their actual pre-freeze dirty-tree provenance and original gate configuration; exporter refinements and the larger fresh gate were added afterward, before any fresh holdout. No historical metrics were rewritten.

| Candidate | W–L | Paired won/split/lost | Searched / node fallback / unsupported decisions | Maximum reservation | Maximum fixture Node policy p95 |
| --- | --- | --- | --- | --- | --- |
| depth 2 | 7–9 | 1 / 5 / 2 | 285 / 228 / 1124 | 132224 B | 2.14 ms |
| depth 3 | 7–9 | 0 / 7 / 1 | 267 / 235 / 1155 | 160896 B | 2.34 ms |

All 32 games completed, with zero illegal decisions and 90 hidden-twin checks per candidate. Node timings came from concurrent development processes, so they are not browser or mobile budget evidence. Two seeds provide little strength information. Depth three has no demonstrated advantage and causes more fallback. Retained per-game seed/seat/winner/completion/search/fallback/timing summaries are [dev-depth2.json](arena-backlog/evidence/826/dev-depth2.json) and [dev-depth3.json](arena-backlog/evidence/826/dev-depth3.json).

## Reviewed freeze

`scripts/verify/arena-search-protocol.ts` predeclares depth 2, the complete seed lists, thresholds and RNG formulas. Fresh engine seeds use base **30,000,000**, fixture bases 649–652, indices 0–39, each played from both seats: 160 paired deals / 320 games. The v1 +10M holdouts and interrupted +20M range are consumed and are never presented as fresh. The candidate/engine integrated source and fixture/policy hashes must be reviewed and frozen before running this command:

```sh
npx tsx scripts/arena-search-eval.mts --seed-set holdout --allow-holdout --seeds 40 --depth 2 --max-moves 3000 --checkpoint /tmp/search826-checkpoint.json --out /tmp/search826-holdout.json --manifest /tmp/search826-holdout-manifest.json
```

The statistical gate requires all 160 curated pairs, at least 20 decisive pairs, a pooled paired-win 95% Wilson lower bound above 0.5, and no fixture whose paired-win interval upper bound is below 0.5. Every fixture interval and an insufficient-power marker are reported; pooled success would not establish every matchup. All games must complete, with zero illegal decisions, execution/privacy failures. Failed/interrupted/limited attempts remain in the denominator. Promotion additionally requires the independent held-out tactical coverage review and browser worker p95 <=30ms, max <=300ms, retained heap <=16MiB, Node policy p95 <=5ms and search reservation <=256KiB. Browser timing and heap checks are external gates; `strengthEligible` alone never promotes a policy. If the gate fails, retain the negative result and reserve a new seed range for any retuned candidate.

Both CLI exporters accept `--manifest FILE`. They pin source before and after the run, reject source changes during execution, write files with mode 0600, validate the strict shared manifest and export only hashes, seed/RNG provenance, explicit mappings and outcomes. Synthetic recipes are unmapped. Audited SD15/SD5 lists map explicitly to their starter controls. Failed/error/interrupted decision attempts and unfinished games remain rows. The manifests never contain actions, state, prompts, raw traces or paths. A 320-game manifest fits the portal's 512 KiB limit. Importing evidence does not pass a complete benchmark automatically.

Focused validation: search regression, strategy proof, policy boundary, manifest parser, TypeScript and changed-file ESLint passed. The coordinator owns combined gates, browser budgets, final integrated freeze and holdout authorization.

Clean-tree strategy receipts at implementation commit `9dd250d8d886d7cb63fa8355674d42bf231b3376` are [strategy-manifest.json](arena-backlog/evidence/826/strategy-manifest.json) and [strategy-report.json](arena-backlog/evidence/826/strategy-report.json). The manifest's 15 rows include all three heuristic failures. It validates against the integrated 512 KiB importer. Browser receipts now identify the current search version/depth and include runner source and fixture/policy digests, with a source-change check across measurement.

## Completed fresh holdout

The reviewed candidate ran at clean source `1852227ecb3c699ad17f283fdea7ea64dd062118`.
All 320 games completed: **142 wins, 178 losses**, no draws, illegal actions,
interruptions, action limits or execution failures. All 1,763 nontrivial hidden
twins agreed. The 160 paired deals produced 11 won-both, 120 split and 29 lost-both
pairs. On the 40 decisive pairs, the paired-win 95% Wilson interval was
**16.11–42.83%**; split pairs are excluded from that conditional interval. No
draw-containing pairs occurred. This fails the strength gate and provides evidence
of regression in this two-starter corpus, despite the tactical subcase gains.

| Matchup (A = audited SD15; B = audited SD5) | Candidate W–L | Won / split / lost pairs | Decisive paired 95% interval |
|---|---|---|---|
| A versus A | 31–49 | 2 / 27 / 11 | 4.33–42.24% |
| A versus B | 38–42 | 3 / 32 / 5 | 13.68–69.43% |
| B versus A | 36–44 | 1 / 34 / 5 | 3.01–56.35% |
| B versus B | 37–43 | 5 / 27 / 8 | 17.71–64.48% |

Every individual matchup has fewer than 20 decisive pairs and retains its
insufficient-power marker. A versus A also fails the per-fixture regression gate.
The default remains the existing heuristic; there is no new hard difficulty.

Eight development games agreed exactly between Node, the module Worker and the
4×-throttled main-thread comparison. Worker step p95 was 27.4 ms, max 81.8 ms,
retained heap 8,068,212 bytes; all passed the declared worker limits. Maximum
fixture Node policy p95 was 1.962 ms and structural search reservation 137,856
bytes. Measurements ran on the shared Linux host alongside other validation, not
a physical phone. The throttled main-thread p95/max (142.1/356.7 ms) are separate
diagnostics, not the Worker gate. Zero unfinished games or guard trips occurred
in the browser comparison. Budget success does not override the strength failure.

Retained evidence: [aggregate summary](arena-backlog/evidence/826/holdout-summary.json),
[all game outcomes](arena-backlog/evidence/826/holdout-30m.json),
[importable manifest](arena-backlog/evidence/826/holdout-30m-manifest.json), and
[browser parity/budgets](arena-backlog/evidence/826/browser-v2.json). Subsequent
review fixes change only capability metadata, checkpoint Windows portability and
documentation; the evaluated policy and engine files are unchanged. The +30M seeds
are now consumed. Any retuned candidate needs a new reviewed freeze and fresh range.
