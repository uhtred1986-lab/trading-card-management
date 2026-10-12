---
title: [P1] Arena: Measure arena acknowledgement polling AI and rendering costs
milestone: Arena M2 — Gameplay UX/HUD completion
labels: backlog, ready-for-agent, enhancement, area:arena-contract, phase:hud-workflow, model:sonnet-5, performance
stage: ui
issue: 565
priority: P1
status: closed
touches: src/lib/arena/snapshot.ts, src/lib/arena/games.ts, src/components/arena/stage/useLiveGame.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Measured speed and gameplan. **Plan key:** S01.

**Depends on:** None; ready for an isolated implementation.

**Build.** Create reproducible local benchmark fixtures and sanitized timings for apply/legal/rejection/view, DB queries, response bytes, persisted acknowledgement, AI and browser frame cost. Report p50/p95 by board/effect/history size; separate local CPU from hosted results. No paid/live calls required for agent proof.

**Files to verify first:** `src/lib/arena/snapshot.ts`, `src/lib/arena/games.ts`, `src/components/arena/stage/useLiveGame.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] Small and crowded aura fixtures yield reproducible, phase-separated p50/p95 measurements; long-history serialization, storage-only writes, actual `applyToGame` acknowledgements, short-window polling, and the standard 15-second idle poll are recorded. Runtime source fingerprints distinguish the measured checkout from the `74701713` reference. The runner asserts opposing-hand masking and writes aggregate metrics only. Hosted p95 and a representative physical phone remain owner-run.
- [x] Positive legal action, negative illegal action with unchanged input state, real preloaded-game `applyToGame` CAS acknowledgement/reload, and hidden-hand masking are asserted by the benchmark; stale gameplay mutation remains covered by `scripts/verify/arena-revision.mts`. The long action/log arrays are explicitly synthetic benchmark history and are not replayed.
- [x] Typecheck, lint, benchmark scenario, `npm test`, and build pass. No VM/compiler behavior changed; glossary and fuzz checks do not apply.
- [x] One bounded PR contains the scripts, methodology, measured evidence, and canonical status. Live database, paid provider, hosted p95, and physical-phone checks are explicitly owner-run and were not claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/snapshot.ts`, `src/lib/arena/games.ts`, `src/components/arena/stage/useLiveGame.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
