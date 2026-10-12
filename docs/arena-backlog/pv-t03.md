---
title: [P0] Arena: Use monotonic game revision and action identity across clients
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, enhancement, area:arena-contract, phase:arena-home, model:opus-5
stage: ui
issue: 545
priority: P0
touches: src/lib/arena/games.ts, src/lib/arena/snapshot.ts, src/components/arena/stage/useLiveGame.ts, src/app/arena/actions.ts
status: closed
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P0. **Delivery:** Match integrity and recovery. **Plan key:** T03.

**Depends on:** None; ready for an isolated implementation.

**Build.** Expose authoritative game revision independent of beat sequence; increment on all relevant state/status writes including abandonment; require freshness and request identity in web/HTTP actions, retain CAS, reconcile responses monotonically. Update shared contract and emitted fixtures.

**Files to verify first:** `src/lib/arena/games.ts`, `src/lib/arena/snapshot.ts`, `src/components/arena/stage/useLiveGame.ts`, `src/app/arena/actions.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] Two clients see a no-beat abandonment; delayed lower revision never replaces newer state; duplicate actions apply once; competing actions return a typed stale response. **Evidence:** `scripts/verify/arena-revision.mts` verifies both readers see the status-only abandonment and revision poll wake; lower/equal responses cannot replace the newer same-game snapshot; a different game resets revision reconciliation; duplicate/retry leaves one saved action; a competing compare-and-swap write throws `StaleGame`, which the API action route maps to `stale`.
- [x] Positive, negative, stale/reload and interaction cases have explicit state and action assertions. **Evidence:** the PGlite scenario asserts action revision increments, no receipt after a lost CAS or stale abandonment, same-ID/different-payload conflict, durable retry recognition after later moves and terminal status, empty terminal legal/tap/rejection projections, and game identity reset. The web give-up control sends `live.game.revision`; stale/status/identity errors remain visible and trigger a refresh.
- [x] Typecheck, lint, scenario verification, `npm test`, and build pass; no VM/compiler changes apply. **Evidence:** `npm run typecheck`, `npm run lint` (five existing warnings, zero errors), `npx tsx scripts/verify-db.mts`, contract fixture emission, and `DATABASE_URL='' npm run build` passed locally on PR head `b0ac9fa`; root's full `npm test` also passed on that exact head, including both engine suites, PGlite revision/abandonment tests, and guards. Android contract decoding was updated, but its Gradle test is blocked locally as recorded below.
- [x] One bounded PR and canonical status updated on completion. **Evidence:** draft PR #586 carries this issue's code and acceptance record. No live database, paid AI, or production checks were run.

**Contract and migration notes.** The public contract is v2; all emitted Snapshot fixtures include the revision, and the Kotlin DTO and contract expectation were updated. `drizzle/0045_nifty_war_machine.sql` is additive only: it adds `action_receipts` as a non-null JSONB column with an empty-array default. No production database was changed. The Android contract test remains an owner-run limitation: Docker Gradle could not resolve Kotlin's Gradle plugin even with the session CA truststore and configured proxy; curl through that proxy returned HTTP 200 for both plugin marker POMs, while Gradle's HTTP client closed its connection and disabled the plugin repository. No dependencies or network policy were changed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/games.ts`, `src/lib/arena/snapshot.ts`, `src/components/arena/stage/useLiveGame.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
