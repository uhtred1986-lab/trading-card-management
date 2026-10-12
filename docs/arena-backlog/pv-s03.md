---
title: [P1] Arena: Record concurrent AI usage atomically
milestone: Arena M2 — Gameplay UX/HUD completion
labels: backlog, ready-for-agent, enhancement, area:ai, phase:hud-workflow, model:sonnet-5, performance
stage: ui
issue: 567
priority: P1
status: closed
touches: src/lib/arena/ai/run.ts, src/db/schema.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Measured speed and gameplan. **Plan key:** S03.

**Depends on:** None; ready for an isolated implementation.

**Build.** Use atomic cumulative usage increments and per-call/revision attribution, including paid calls whose stale moves are rejected. Keep provider/billed semantics from #515; additive migration only if necessary. Separate this from #381 model selection and #518 provider deployment.

**Files to verify first:** `src/lib/arena/ai/run.ts`, `src/db/schema.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] Two overlapping mocked calls retain both token/cost totals; a paid answer whose real `applyToGame` CAS loses is still accounted; concurrent retries with the same identity add usage once, and reusing an identity with different usage fails without changing totals. Covered in `scripts/verify/arena-ai-usage.ts`.
- [x] The PGlite scenarios assert cumulative counters, per-call provider/billed/revision/cache-write attribution, the exact usage ledger, stale action history, and usage preservation when `abandonGame` races accounting.
- [x] `DATABASE_URL='' npm run typecheck`, `DATABASE_URL='' npm run lint`, `DATABASE_URL='' npm test`, and `DATABASE_URL='' npm run build` pass. Lint has five existing prototype warnings and no errors. VM/compiler glossary and fuzz checks do not apply.
- [x] One bounded PR carries this implementation, migration and acceptance evidence; this canonical record is closed with it. No live database, paid provider, or production checks were run or required.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/ai/run.ts`, `src/db/schema.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
