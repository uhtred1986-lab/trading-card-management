# Arena local performance baseline

This is a reproducible CPU and persistence baseline for the rules engine as it stood at repository commit `74701713`. The later #548 zero-power changes were not part of this measurement. The numbers are local diagnostics, not hosted SLOs or a promise about a physical phone.

Run `DATABASE_URL='' npm run arena:perf` for deterministic EngineAPI fixtures and in-memory PGlite measurements. Run `DATABASE_URL='' npm run dev` in one terminal and `DATABASE_URL='' npm run arena:perf:browser` in another for headless Chromium frame intervals. The CPU runner requires `--engine rules`, performs 25 warmups and 100 timed samples for each engine phase, and reports nearest-rank p50/p95 in milliseconds. It prints fixture labels and aggregate metrics only; it never prints the snapshot, SQL, query parameters, card identifiers, player names, or hidden hands. The browser runner uses only the dev preview's `play` and `over` contract fixtures and reports frame intervals plus Long Task API entries. A requestAnimationFrame interval is not the cost of React rendering.

Measured in the provided Linux x86_64 environment with Node `v24.19.0`; browser measurements used headless Chromium `154.0.8037.57`. These figures vary by machine and should be rerun on the target host before comparing changes.

| Fixture | Shape | Phase | p50 ms | p95 ms | Snapshot bytes |
| --- | --- | --- | ---: | ---: | ---: |
| small | 1 player Battle Card, no aura; 20 synthetic log lines | legalActions | 1.067 | 1.742 | — |
| small | same | apply | 0.368 | 0.589 | — |
| small | same | illegal action rejection | 0.165 | 0.247 | — |
| small | same | rejectedActions | 0.746 | 1.034 | — |
| small | same | boardView | 0.078 | 0.185 | — |
| small | same | snapshot build | 0.804 | 1.094 | — |
| small | same | snapshot serialization | 0.022 | 0.035 | 10,127 |
| crowded aura | 12 Battle Cards, including 8 aura sources; 6 opposing cards | legalActions | 2.954 | 3.605 | — |
| crowded aura | same | apply | 0.493 | 0.626 | — |
| crowded aura | same | illegal action rejection | 0.167 | 0.196 | — |
| crowded aura | same | rejectedActions | 2.530 | 3.108 | — |
| crowded aura | same | boardView | 15.147 | 18.808 | — |
| crowded aura | same | snapshot build | 17.776 | 20.071 | — |
| crowded aura | same | snapshot serialization | 0.106 | 0.169 | 29,996 |
| long history | 2 aura sources, 4 Battle Cards, 1,000 synthetic log lines | legalActions | 0.862 | 1.123 | — |
| long history | same | apply | 0.367 | 0.467 | — |
| long history | same | illegal action rejection | 0.168 | 0.257 | — |
| long history | same | rejectedActions | 0.745 | 1.024 | — |
| long history | same | boardView | 0.487 | 0.678 | — |
| long history | same | snapshot build | 1.557 | 2.249 | — |
| long history | same | snapshot serialization | 0.053 | 0.068 | 32,546 |

Snapshot serialization is measured against a prebuilt snapshot so it does not include view assembly. `snapshotBuild` includes board view, legality display, and rejections.

For persistence, the runner updates and acknowledges a synthetic game row in PGlite with a 250-action/500-line history payload: p50 `1.818 ms`, p95 `2.468 ms`, one SQL query per acknowledgement, and `39,265` serialized payload bytes. An idle 50 ms `waitForRevision` measured two DB reads: an immediate read and one final read at the timeout. These counts apply to the current implementation and this local in-memory database. The reload assertion confirms stored state matches the input state.

AI timing is explicitly mocked and separated from engine CPU: a fixed 20 ms delay yielded p50 `20.298 ms` and p95 `20.463 ms` (15 samples). It is not a provider benchmark and made no network call.

| Headless preview viewport | Fixture | rAF interval p50/p95 | Frames >50 ms | Long Tasks |
| --- | --- | --- | ---: | --- |
| phone emulation (390×844) | play | 16.70 / 16.70 ms | 0/120 | 3, max 121 ms |
| phone emulation (390×844) | over | 16.70 / 16.80 ms | 0/120 | 2, max 285 ms |
| desktop (1440×900) | play | 16.70 / 16.70 ms | 0/120 | 2, max 68 ms |
| desktop (1440×900) | over | 16.70 / 16.80 ms | 0/120 | 3, max 127 ms |

The phone is Chromium device emulation on the same host, not a representative physical phone. The preview fixtures are contract snapshots, not the synthetic aura fixture, and headless frame intervals should not be read as a device rendering benchmark.

The script asserts that each fixture accepts a legal EngineAPI action, rejects an opponent's illegal action without mutating the original state, masks the opposing hand in the snapshot, and persists/reloads the supplied state. Stale/retry gameplay behavior is unchanged by this measurement-only change and remains covered by the existing Arena revision verification. No live database, paid AI, hosted p95, or real-phone result is claimed; hosted p95 and representative-phone measurements remain owner-run.
