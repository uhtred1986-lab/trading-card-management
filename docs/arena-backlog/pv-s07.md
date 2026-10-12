---
title: [P1] Arena: Reduce repeated evaluation in corrected zero-power checkpoints
milestone: Arena M2 — Gameplay UX/HUD completion
labels: backlog, blocked, enhancement, area:arena-vm, performance, model:opus-5
stage: ui
issue: 607
priority: P1
status: closed
touches: src/lib/arena/vm/flow.ts, src/lib/arena/vm/program.ts
---
**Source:** `docs/arena-backlog/evidence/607/review-baseline.json`; `docs/arena-backlog/evidence/607/checkpoint-cache-baseline.json`; `docs/arena-backlog/evidence/607/checkpoint-cache-optimized.json`; `scripts/bench/arena-zero-power-607.mts`; `src/lib/arena/vm/flow.ts`; `src/lib/arena/vm/program.ts`; rule manual 21-6 and 21-1-2-2-1.

**Priority:** P1. **Parent:** #569; bounded engine checkpoint follow-up, independent of transport/polling #568. **Depends on:** #548 and #553 implementation context. Coordinate shared flow with #551.

**Measured evidence:** the reviewed combined baseline in `review-baseline.json` used commit 64fda61, runtime fingerprint `7d50d17d09d7bb896963096ac26d97f6000760eaa83e3d245e9562376d8ecb6e`, 25 warmups/100 samples: crowded-aura-12 apply p50 781.947 ms / p95 898.881 ms. This ticket's direct before/after comparison isolates the zero-power checkpoint on the same 102-card crowded-aura fixture with six Battle Cards at −5,000 power, 5 warmups/30 samples on an AMD EPYC 9V74: baseline source 5c2d598 (runtime fingerprint `f48e1eb56d8689dfe260a3b2a6b7d2167445b5aade1406d92ab2e5174a198757`) p50 656.847 ms / p95 887.796 ms; optimized source 4af8e90 (runtime fingerprint `585ea0dd4467cae0b0a3647fb597be0a9d94aedd2fa06b2ac4c4d77cded87a92`) p50 83.144 ms / p95 95.482 ms. The source diff between those refs is only `vm/flow.ts`; both reports have identical input, final state, event, event-sequence, legal/rejected action, and masked p1/p2 Snapshot hashes. The compact reports and exact harness command are checked in beside this ticket. These are local CPU measurements, not hosted or physical-phone results. The old S01 apply figure predates zero-power processing and is not an equivalent-correctness benchmark.

**Clean publication-stack check:** because the first paired run used the combined review branch as its base, the actual publication branch was rebenchmarked after stacking only #553 on #608/#551. On the same 5-warmup/30-sample fixture, prerequisite commit `3e9ee7a` measured p50 628.709 ms / p95 791.338 ms (runtime fingerprint `234f9b7ecca8f3aad7a37b9112895615febd9dd9af15c36fbf9f0494cfe2be6c`); #607 clean-stack head `a045d49` measured 72.133 ms / 80.835 ms (fingerprint `45682eb0a8ff8f8d6efb5181ec057e12bba4a664b8d8e1e92008794fa851cebd`). Input, final-state, event/event-sequence, legal/rejected-action and both viewer-snapshot hashes match exactly. Full portable reports are `evidence/607/clean-stack-baseline.json` and `evidence/607/clean-stack-optimized.json`. The original 5c2d598/4af8e90 measurements remain evidence from the earlier combined integration checkout; do not compare their absolute timing directly to this clean-stack pair.

**Build:** profiling found repeated permanent/static and attribute evaluation during one `resolveZeroPower` discovery pass. The bounded change wraps only the existing read-only standing, power/cause, frozen replacement-choice, and termination-bound discovery in `readingBoard`; it discards that scope before state mutation and prompts. Every subsequent checkpoint iteration, including one after a replacement answer/reload, gets a fresh scope against the then-current board. It does not cache across moves, effects, programs, games or viewers, and does not change the order or membership of the frozen replacement set. `scripts/verify/rule-processing.ts` and full `npm test` output match baseline byte-for-byte; the dedicated source-departure/replacement/reload cases continue asserting their state, event and pending-order outcomes. The benchmark hashes exact state, emitted events, legal/rejected actions, and the public snapshots for both viewers on its fixture; those hashes match between the two recorded sources. This is fixture evidence, not a claim of exhaustive equality over every match or viewer state. No long-lived unkeyed cache is introduced.

**Acceptance:**
- [x] Capture a repeatable before/after crowded-checkpoint measurement with explicit runtime fingerprints and stable output hashes; reduce local apply p50/p95 from 656.847/887.796 ms to 83.144/95.482 ms on the recorded fixture without removing rule processing.
- [x] Benchmark fixture state, emitted events, legal/rejected actions and masked p1/p2 snapshots hash identically; the existing named rule-processing and full test suites pass against both baseline and optimized code, including source departure, frozen replacement availability, pending ordering and JSON-resumed replacement assertions. This does not claim exhaustive state equality for all games/viewers.
- [x] Cache scope ends before the first mutation; the next checkpoint iteration reads fresh statics after source/move changes. Full npm-test output is byte-identical; the benchmark explicitly fingerprints both viewer projections. Frozen legacy corpus unchanged.
- [x] Full local `npm test`, typecheck, lint and build pass with `DATABASE_URL=''`; lint has six existing warnings. `npm run test:rules` and `git diff --check` pass. Real-deck `arena:fuzz 40`, hosted latency and physical-device checks remain owner-run; fuzz requires database deck rows and this environment's credential belongs to another application.

**Reproduction:** from a clean optimized checkout, run `DATABASE_URL='' npx tsx scripts/bench/arena-zero-power-607.mts --engine rules --warmup=5 --samples=30 --label=optimized --source-ref=4af8e9004e2f913ff447c0d3257be50a494ebbbe`. To repeat the before/after pair without switching branches, run this from the repository root; the trap restores the optimized file even if the baseline run fails:

```sh
set -eu
saved_flow="$(mktemp)"
cp src/lib/arena/vm/flow.ts "$saved_flow"
restore_flow() { cp "$saved_flow" src/lib/arena/vm/flow.ts; rm -f "$saved_flow"; }
trap restore_flow EXIT HUP INT TERM
git show 5c2d5986cd66db450d225230ecea0a1a2b78906c:src/lib/arena/vm/flow.ts > src/lib/arena/vm/flow.ts
DATABASE_URL='' npx tsx scripts/bench/arena-zero-power-607.mts --engine rules --warmup=5 --samples=30 --label=baseline-5c2d598 --source-ref=5c2d5986cd66db450d225230ecea0a1a2b78906c > docs/arena-backlog/evidence/607/checkpoint-cache-baseline.json
restore_flow
trap - EXIT HUP INT TERM
DATABASE_URL='' npx tsx scripts/bench/arena-zero-power-607.mts --engine rules --warmup=5 --samples=30 --label=optimized-4af8e90 --source-ref=4af8e9004e2f913ff447c0d3257be50a494ebbbe > docs/arena-backlog/evidence/607/checkpoint-cache-optimized.json
```

The harness refuses a nonempty `DATABASE_URL`, reports the actual checkout HEAD, runtime-source fingerprint/dirty bit, CPU model, fixture, sample policy and state/event/action/view hashes, and writes no private payloads. For a CPU profile without adding a dependency, create `.git/arena607-cpu-profile` and prefix a benchmark command with `node --cpu-prof --cpu-prof-dir=.git/arena607-cpu-profile --import tsx`; keep the generated local profile out of the commit. Checked-in JSON is the durable evidence, not the temporary copy needed to restore source. The baseline report's `measuredHead` is the optimized harness checkout while `sourceRef` and runtime fingerprint identify the temporarily restored baseline flow; its runtime dirty flag is expected for that comparison.

**Scope:** one bounded PR; no polling/API redesign, new dependencies, live database or paid calls. #569 retains broader sharing across legal/rejection/view.
