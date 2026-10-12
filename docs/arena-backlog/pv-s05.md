---
title: [P2] Arena: Share immutable derived evaluation by match revision
milestone: Arena M2 — Gameplay UX/HUD completion
labels: backlog, enhancement, area:arena-vm, phase:hud-workflow, model:opus-5, performance
stage: ui
issue: 569
status: closed
priority: P2
touches: src/lib/arena/snapshot.ts, src/lib/arena/session.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P2. **Delivery:** Measured speed and gameplan. **Plan key:** S05.

**Depends on:** #547 (T05), #565 (S01), #568 (S04)

**Build.** Profile first; share board-static evaluation among legal/rejection/view for one immutable revision and cache pinned definitions. Scope to the measured bottleneck. Key personalized caches by viewer and revision; preserve freshness and invalidate on revision changes.

**Delivered scope:** The original `touches` list predates the current `readingBoard` scope in `vm/program.ts` and the lazy legal getter in `games.ts`. A synchronous read session in `snapshot.ts` and `session.ts` now shares only viewer-independent standing-rule evaluation across the legal list, rejections, ability availability and board view of one loaded state. It uses the rules engine's token-wrapped context and exact pinned definition, then discards derived values when the projection returns. Personalized results are freshly built for each viewer; there is no persistent revision or whole-snapshot cache. The original plan's VM effects/view edits and separate pinned-definition cache were not needed for the measured bottleneck.

**Files verified:** `src/lib/arena/snapshot.ts`, `src/lib/arena/session.ts`, `src/lib/arena/games.ts` (`withLegal`), `src/lib/arena/vm/program.ts` (`readingBoard`). The existing contract and VM rules behavior do not change.

**Acceptance.**
- [x] Three quiet latest-main/candidate audit pairs show lower crowded-aura median p50 (43.386→41.395 ms) and checkpoint p50/p95 (59.053/69.995→52.974/61.229 ms), with identical state, legal, rejection and both-viewer hashes. Crowded-aura p95 remains mixed (47.445→49.419 ms); this is not a universal tail-latency improvement claim. The actual lazy projection reads standing rules 4→1 times without sharing hidden hand ids or reusing a later revision's state. See `evidence/569/read-session-result.json`.
- [x] `scripts/verify/derived-read-569.mts` covers an accepted one-energy play and exact rest event/state, wrong-seat refusal, stale and cloned reload projections, both viewers together, and different pinned runtime definitions.
- [x] `DATABASE_URL=''` typecheck, lint, focused #569 proof, rules-only Arena verification, `npm test` and build pass. Lint has five pre-existing prototype warnings and no errors. No VM/compiler semantics changed; glossary, reading diff and fuzz 40 do not apply.
- [x] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Local exact-head checks and evidence are recorded in the delivery PR. Hosted/device timings and production checks remain owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/snapshot.ts` and `src/lib/arena/session.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.

**Earlier read-only profile:** draft PR [#623](https://github.com/uhtred1986-lab/trading-card-management/pull/623) recorded same-revision legal/rejection/two-viewer projection counters, timings and CPU samples. On its base, the crowded S01 fixture measured 43.363/51.383 ms p50/p95; the S07 checkpoint fixture measured 52.051/57.456 ms. That diagnostic profile pointed to repeated board reads (`permanents`, `attrsNow`, `skillsShowing`, `programsOf`, `valueOf`), but was not a before/after speed result. The current-main comparison and stale/reload proof are in `evidence/569/README.md`.

**Bounded measured child:** #607 (P1) isolates the corrected zero-power checkpoint cost and reuses board readings only during frozen-pass discovery. On the same local crowded-aura fixture, apply p50/p95 fell from 656.847/887.796 ms to 83.144/95.482 ms; state, event, legal/rejected-action and masked-view hashes match ([baseline](evidence/607/checkpoint-cache-baseline.json), [optimized](evidence/607/checkpoint-cache-optimized.json)). The clean-stack pair is recorded in `pv-s07.md`; PR #612 merged and production-deployed. It is independent of polling #568 and of this issue's snapshot read session.
