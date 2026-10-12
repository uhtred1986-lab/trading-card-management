---
title: [P1] Arena: Acknowledge human actions before resumable AI advance
milestone: Arena M2 — Gameplay UX/HUD completion
labels: backlog, blocked, enhancement, area:arena-contract, phase:hud-workflow, model:sonnet-5, performance
stage: ui
issue: 566
priority: P1
touches: src/app/arena/actions.ts, src/lib/arena/ai/advance-lease.ts, src/lib/arena/ai/debug.ts, src/lib/arena/ai/opponent.ts, src/lib/arena/ai/run.ts, src/components/arena/stage/ArenaStage.tsx, src/components/arena/stage/PromptPanel.tsx, src/db/schema.ts, drizzle/0048_arena_advance_leases.sql, scripts/verify/arena-advance-leases.mts, scripts/verify/arena-advance-browser-evidence.mts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Measured speed and gameplan. **Plan key:** S02.

**Depends on:** #545 (T03), #565 (S01)

**Build.** Return persisted player snapshot promptly; consolidate web/HTTP advance through a bounded resumable path and per-game revision lease. Prevent duplicate model calls, release/recover failed lease and expose resume. Maintain authoritative revision/CAS; use mocked AI for proof.

**Files to verify first:** `src/app/arena/actions.ts`, `src/lib/arena/games.ts`, `src/lib/arena/ai/opponent.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] Slow mocked AI never delays player acknowledgement; two simultaneous advances produce one decision call; crash/retry resumes without applying or billing a duplicate decision. **Progress:** PGlite verifies the persisted human action completes before a blocked fake provider; two actual concurrent `advance()` calls start one request. A recorded `ai_runs` result/checkpoint resumes with one usage receipt, one decision projection, and one applied action, matching the selected semantic Action even if the current legal menu is reordered. A read/finish race proves a stale claimant cannot resurrect an `applied` revision. If a worker stops after a provider attempt but before its result is stored, the outcome is unknowable: the lease becomes attention-required and never resends; the UI exposes a manual Retry for recoverable failures, while this ambiguous case remains fail-closed. This is partial recovery rather than automatic recovery of an unrecorded response; acceptance remains partial pending owner review of that provider limitation. **UI evidence:** `docs/arena-backlog/evidence/566/README.md` compares base `74701713` with this branch at phone/desktop sizes and both skins; the browser proof checks Retry after an advance error and confirms it does not repeat the human action.
- [x] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions. **Evidence:** `scripts/verify/arena-advance-leases.mts` covers active lease contention, stable call identity, post-record failure recovery, semantic-action recovery across a reordered legal list, fail-closed behavior when that action is no longer legal, idempotent usage/decision writes, one applied game action, stale read/finish fencing, and no provider recall after an unknown outcome. The same PGlite case runs two actual `advance()` calls against a blocked fake provider and verifies the human CAS finished first.
- [x] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable. **Evidence:** `DATABASE_URL='' npm run typecheck`, `npm run lint` (zero errors; five pre-existing prototype warnings), `npx tsx scripts/verify-db.mts`, `npm test`, and `npm run build` passed locally. The full suite retains its named rules-engine skipped/not-run parity cases; this change makes no VM/compiler claims.
- [x] One bounded draft PR and canonical evidence are recorded: [PR #611](https://github.com/uhtred1986-lab/trading-card-management/pull/611), stacked on #605 and explicitly referencing #566 because unknown provider outcomes remain fail-closed. Live database/paid/production checks are owner-run and not claimed.

**Implementation notes.** Migration `drizzle/0048_arena_advance_leases.sql` is additive: it creates private per-game-revision lease/checkpoint rows and adds nullable stable call IDs to AI run and decision rows. The chosen semantic Action is stored in the private result/checkpoint and checked against the current legal list during recovery, so an old numeric menu index cannot silently select a different move. Web `act()` returns after the human CAS; ArenaStage starts the shared lease-protected advance separately. There is no provider-wide idempotency guarantee, and no automatic retry is made when a response may have been charged but was not durably recorded. No live database or paid-provider calls are part of local verification.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/app/arena/actions.ts`, `src/lib/arena/games.ts`, `src/lib/arena/ai/opponent.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
