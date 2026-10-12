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
