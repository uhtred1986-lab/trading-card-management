# Arena local performance baseline

This is a reproducible CPU and persistence baseline for the rules engine as it stood at repository commit `74701713`. The later #548 zero-power changes were not part of this measurement. The numbers are local diagnostics, not hosted SLOs or a promise about a physical phone.

Run `DATABASE_URL='' npm run arena:perf` for deterministic EngineAPI fixtures and in-memory PGlite measurements. Run `DATABASE_URL='' npm run dev` in one terminal and `DATABASE_URL='' npm run arena:perf:browser` in another for headless Chromium frame intervals. The CPU runner requires `--engine rules`, performs 25 warmups and 100 timed samples for each engine phase, and reports nearest-rank p50/p95 in milliseconds. It prints fixture labels and aggregate metrics only; it never prints the snapshot, SQL, query parameters, card identifiers, player names, or hidden hands. The browser runner uses only the dev preview's `play` and `over` contract fixtures and reports frame intervals plus Long Task API entries. A requestAnimationFrame interval is not the cost of React rendering.

The runner records the checkout's actual `measuredHead`, whether runtime sources are dirty, and a SHA-256 fingerprint over `src/lib/arena/**/*.ts(x)` plus `src/db/schema.ts`. The reference commit remains a separate field. This recorded run used head `1bfa9a266252d41b8c955f5411e63c3dfbc945b3`, `runtimeSourcesDirty: false`, and fingerprint `f86d5195c9c3c16655592017ecad8f0151e0b8f65ad64ae6e87a9423ef812159`; runtime source was still the 74701713 baseline. Measured in the provided Linux x86_64 environment with Node `v24.19.0`; browser measurements used headless Chromium `154.0.8037.57`. These figures vary by machine and should be rerun on the target host before comparing changes.

| Fixture | Shape | Phase | p50 ms | p95 ms | Snapshot bytes |
| --- | --- | --- | ---: | ---: | ---: |
| small | 1 player Battle Card, no aura; 20 synthetic log lines | legalActions | 1.151 | 1.756 | — |
| small | same | apply | 0.387 | 2.413 | — |
| small | same | illegal action rejection | 0.166 | 0.242 | — |
| small | same | rejectedActions | 0.795 | 1.233 | — |
| small | same | boardView | 0.085 | 0.194 | — |
| small | same | snapshot build | 0.906 | 1.433 | — |
| small | same | snapshot serialization | 0.021 | 0.023 | 10,127 |
| crowded aura | 12 Battle Cards, including 8 aura sources; 6 opposing cards | legalActions | 3.324 | 4.688 | — |
| crowded aura | same | apply | 0.524 | 0.862 | — |
| crowded aura | same | illegal action rejection | 0.168 | 0.235 | — |
| crowded aura | same | rejectedActions | 3.087 | 5.228 | — |
| crowded aura | same | boardView | 16.331 | 19.219 | — |
| crowded aura | same | snapshot build | 18.916 | 21.114 | — |
| crowded aura | same | snapshot serialization | 0.106 | 0.189 | 29,996 |
| long history | 2 aura sources, 4 Battle Cards, 1,000 synthetic log lines | legalActions | 0.914 | 1.232 | — |
| long history | same | apply | 0.398 | 0.692 | — |
| long history | same | illegal action rejection | 0.167 | 0.331 | — |
| long history | same | rejectedActions | 0.779 | 1.286 | — |
| long history | same | boardView | 0.492 | 0.914 | — |
| long history | same | snapshot build | 1.480 | 2.052 | — |
| long history | same | snapshot serialization | 0.051 | 0.106 | 32,546 |

Snapshot serialization is measured against a prebuilt snapshot so it does not include view assembly. `snapshotBuild` includes board view, legality display, and rejections.

The storage-only calibration updates a synthetic game row in PGlite with a 250-action/500-line history payload: p50 `1.877 ms`, p95 `2.231 ms`, one SQL query per write acknowledgement, and `39,265` serialized payload bytes. The app-path measurement seeds a synthetic practice deck with three card definitions (one leader and two Battle Cards) and 50 main-deck entries, starts a rules-engine game, loads it once, and calls `applyToGame` with the preloaded game, a legal action, and its expected revision. This fixture is for the app persistence path; it makes no tournament-legality claim. The same valid base row is restored outside each timed sample. The 250 pass actions and 500 log lines are synthetic payload history only; they are not replayed and do not claim a genuine 250-move game. `applyToGame` measured p50 `2.539 ms`, p95 `3.091 ms`, and one SQL query per acknowledgement. The acknowledged state/actions/log JSON subset measured `38,404` bytes. A separate reload verified the persisted state, action history, and revision.

The standard idle `waitForRevision` window was measured directly in PGlite at 15 seconds from the reloaded row's actual revision: elapsed `15,002 ms`, `17` reads, unchanged result. Three additional short 50 ms calibration waits each used two reads. These counts describe the current polling schedule on local PGlite and are reported as observations, not fixed guarantees.

AI timing is explicitly mocked and separated from engine CPU: a fixed 20 ms delay yielded p50 `20.214 ms` and p95 `20.593 ms` (15 samples). It is not a provider benchmark and made no network call.

| Headless preview viewport | Fixture | rAF interval p50/p95 | Frames >50 ms | Long Tasks |
| --- | --- | --- | ---: | --- |
| phone emulation (390×844) | play | 16.70 / 16.70 ms | 0/120 | 3, max 121 ms |
| phone emulation (390×844) | over | 16.70 / 16.80 ms | 0/120 | 2, max 285 ms |
| desktop (1440×900) | play | 16.70 / 16.70 ms | 0/120 | 2, max 68 ms |
| desktop (1440×900) | over | 16.70 / 16.80 ms | 0/120 | 3, max 127 ms |

The phone is Chromium device emulation on the same host, not a representative physical phone. The preview fixtures are contract snapshots, not the synthetic aura fixture, and headless frame intervals should not be read as a device rendering benchmark.

The script asserts that each fixture accepts a legal EngineAPI action, rejects an opponent's illegal action without mutating the original state, masks the opposing hand in the snapshot, and persists/reloads the supplied state. Stale/retry gameplay behavior is unchanged by this measurement-only change and remains covered by the existing Arena revision verification. No live database, paid AI, hosted p95, or real-phone result is claimed; hosted p95 and representative-phone measurements remain owner-run.
