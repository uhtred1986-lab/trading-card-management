---
title: [P1] Arena: Reduce repeated evaluation in corrected zero-power checkpoints
milestone: Arena M2 — Gameplay UX/HUD completion
labels: backlog, blocked, enhancement, area:arena-vm, performance, model:opus-5
stage: ui
issue: 607
priority: P1
touches: src/lib/arena/vm/flow.ts, src/lib/arena/vm/program.ts
---
**Source:** `docs/arena-backlog/evidence/607/review-baseline.json`; `src/lib/arena/vm/flow.ts`; `src/lib/arena/vm/program.ts`; rule manual 21-6 and 21-1-2-2-1.

**Priority:** P1. **Parent:** #569; bounded engine checkpoint follow-up, independent of transport/polling #568. **Depends on:** #548 and #553 implementation context. Coordinate shared flow with #551.

**Measured evidence:** the reviewed combination at 64fda61 (runtime fingerprint 7d50d17d09d7bb896963096ac26d97f6000760eaa83e3d245e9562376d8ecb6e), with DATABASE_URL='', 25 warmups/100 samples: crowded-aura-12 apply p50 781.947 ms / p95 898.881 ms. Legal actions 4.002/5.651 ms; board view 15.772/17.152 ms. Small persisted applyToGame acknowledgement 2.402/3.046 ms, one query. Local/shared-host measurements, not hosted or physical phone results. The old S01 apply figure predates zero-power processing and is not an equivalent-correctness benchmark.

**Build:** profile the current crowded apply path and report the causal hot calls. Inspect repeated derived/static evaluation in resolveZeroPower and attrsNow; reuse evaluation only within an immutable checkpoint pass if evidence supports it. Recompute after every move, source change or resumed replacement. Preserve simultaneous subjects/causes, replacement identity, pending ordering and viewer privacy. No long-lived unkeyed cache.

**Acceptance:**
- [ ] Capture a profile and reproducible before/after measurements on the same corrected fixtures and source stamps; materially reduce crowded apply time without removing rule processing.
- [ ] Exact state, legal actions and emitted events remain equal for aura/source removal, simultaneous zero-power, pending Heroic, replacement suspend/JSON resume and source/negation changes.
- [ ] Demonstrate invalidation after a move changes the aura/static sources and isolation across matches/viewers; preserve frozen legacy corpus.
- [ ] Full local tests, typecheck, lint/build and relevant rule/reading fixtures pass with DATABASE_URL=''; real-deck/hosted/device checks remain explicitly owner-run.

**Scope:** one bounded PR; no polling/API redesign, new dependencies, live database or paid calls. #569 retains broader sharing across legal/rejection/view.
