# #569 immutable-revision evaluation audit

This is a local, read-only profile of the rules engine at base commit `08b65df`. It reuses the
S01 small and crowded-aura fixtures and the S07 crowded zero-power checkpoint fixture. Each
measurement holds one state at revision 1, repeatedly computes its legal list and builds views
for both seats, then asserts that the state, outcome, legal/rejected results, and each viewer's
snapshot hashes remain stable. The S07 fixture's input-state, legal-list, and rejected-list hashes
match the clean-stack S07 baseline.

Reproduce from the repository root:

```sh
DATABASE_URL='' npx tsx scripts/arena-revision-cache-audit-569.mts --engine rules \
  > docs/arena-backlog/evidence/569/revision-cache-audit.json
```

The runner refuses a nonempty `DATABASE_URL`; it makes no database or provider calls. It fingerprints
all files under `src/lib/arena` plus the fixture harness, so newly added VM modules and the actual
view builder are included automatically. It records the measured commit, fixture and output hashes,
method invocation counters, p50/p95 timings, and sanitized Node Inspector CPU samples. The report
contains aggregate JSON only; it excludes card payloads and raw CPU-profile stacks. The Inspector's
`nodeHitCount` is reported as a profiler field, not as an exact function call count.

With five warmups and 30 timed samples on the local AMD EPYC host, the S01 crowded fixture's
legal-then-two-viewer projection measured p50/p95 of 43.363/51.383 ms. S07's corresponding path
measured 52.051/57.456 ms. These timings vary between local runs; the JSON report for each run is
the source of record. In each two-viewer execution, the engine computed legal actions once,
`buildSnapshot` requested rejection evaluation once, and it called ability availability and board
view twice. These are actual engine API calls: `legalFor` only filters the supplied legal list and
does not call `legalActions` again. Per-method timings are separated in the JSON. The S07 profile's
leading sampled self-time functions during that whole projection path include `permanents`,
`attrsNow`, `skillsShowing`, `programsOf`, `valueOf`, and `compileCardCached`; that points to repeated
board reading as the useful next question, but does not establish the amount a cache would save.

This is diagnostic evidence, not a before/after speed claim or an acceptance pass for #569. The
profile samples are local CPU data; hosted and device p95 are unmeasured. The harness keeps two
viewers' own hand rows separate, verifies the opposing hand is absent for each viewer, and checks
that face-down opposing life instance ids stay out of each projection. Identical viewer outputs
within one revision do not establish that cached personalized data can safely cross viewers.

Any follow-up should begin with the smallest bounded memo whose lifetime is one loaded match
revision and whose key includes match id, engine, and the pinned rules context/definition identity;
a revision number alone can collide across games. `vm.apply` clones its prior state before mutation,
but the proposal must still treat state as immutable only across a read-only projection window and
must discard derived values after a successful revision advance or reload. Keep ability availability,
rejections, and serialized snapshots viewer-scoped because prompt eligibility, hidden cards, status,
and other snapshot inputs affect them. Avoid a process-global cache: match/viewer data should not
outlive its bounded owner or be reused across tenants. The current measurements do not authorize or
justify implementing that cache; first prove invalidation and hidden-information boundaries with
state, cost, event, and view assertions.

## Scoped read-session result

`read-session-result.json` compares current-main `3e3785a` with the candidate source using the
same S01/S07 audit runner three times per side, sequentially on the same local host. The candidate
reuses the existing VM `readingBoard` scope for one synchronous snapshot construction. That scope
starts before the lazy legal getter runs and ends when the projection returns. It holds only
viewer-independent standing rules; legal, rejected, ability and serialized view results are still
computed normally for their viewer. It does not keep a cache across requests or revisions.

For one real `snapshotOfGame` lazy-getter path, the unchanged
`scripts/arena-derived-read-count-569.mts` reports one legal getter call on each side and exact
V8 `readStatics` calls of **4 before → 1 after**; the serialized snapshot SHA-256 is identical.
The S01 crowded-aura three-run median p50/p95 changed from 48.319/56.339 ms to
43.611/48.061 ms. The S07 crowded zero-power checkpoint changed from 60.012/75.844 ms to
50.481/58.440 ms. The small fixture is noise-sized and makes no speed claim. Each of the six
profile runs had identical state, legal, rejected and both-viewer snapshot hashes.

`scripts/verify/derived-read-569.mts --engine rules` tests the actual lazy getter, both seats'
hand masking even when they share one scope, an accepted one-energy play with its energy-rest
event and state, a wrong-seat refusal, advanced revision, cloned reload, and two pinned runtime
definitions whose attribute layers produce different power. The test confirms a new context and
the token-wrapper identity cannot borrow the earlier scope. Timing is local Node CPU only; no
hosted or device p95 was measured. No live database or paid provider was used.

## Latest-main replication

After #675 merged, the same scripts ran sequentially against clean main `2d1d8f8` and the
integrated candidate `ecdab63`; the matching lockfile used the same local dependencies. Exact
`readStatics` calls remain **4 → 1**, the lazy legal getter remains **1 → 1**, and the real
`snapshotOfGame` SHA-256 is identical. Across the S01 small, S01 crowded-aura and S07 checkpoint
fixtures, state, outcome, legal, rejected and both viewer hashes all match.

This one 30-sample timing pair is mixed: crowded-aura p50/p95 is
41.779/44.703 → 41.395/49.419 ms, while the S07 checkpoint is
48.669/69.995 → 52.616/61.518 ms. The small fixture is 3.310/4.040 →
3.408/4.778 ms. These differences are local timing noise; this single latest-main pair confirms
reduced repeated evaluation and output parity, but does not establish a consistent wall-time gain.
The earlier three-pair result above remains evidence for that older base only. Full values and
source fingerprints are in `read-session-result.json`.
