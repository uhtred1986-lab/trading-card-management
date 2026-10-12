---
title: [P1] Arena: Pin immutable match rules and export reproducible replay bundles
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, enhancement, area:arena-contract, phase:arena-home, model:opus-5
stage: ui
issue: 547
priority: P1
touches: src/lib/arena/games.ts, src/lib/arena/replay-bundle.ts, src/lib/arena/offline-replay.ts, src/lib/arena/vm/index.ts, src/db/schema.ts
status: in_progress
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Match integrity and recovery. **Plan key:** T05.

**Depends on:** #545 (T03), #567 (migration 0046 prerequisite)

**Build.** Persist ruleset, catalogue and card-program revision/hash at match creation; cache immutable bundles by revision and viewer-safe reads; export revision, seed and actions for offline reproduction. Define backward-compatible old-game handling. Additive migrations only; no automatic rewrite of existing matches.

**Files to verify first:** `src/lib/arena/games.ts`, `src/lib/arena/rules-store.ts`, `src/lib/arena/rulesets/load.ts`, `src/db/schema.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] A card correction changes a newly created game but leaves an ongoing game/replay unchanged; offline replay resolves the same printed/program bundle without a live database. **Evidence:** `scripts/verify/arena-replay.ts` starts a game, changes its card name/cost and confirmed Permanent program, then verifies the old game keeps the original effect and one-energy play legality across reload while a new game gets the corrected cost/program. With four energy, both revisions apply the play but rest one versus four energy and emit different cost events. Its offline runner reconstructs the exact saved state from bundle + original decks + seed + actions with no database input.
- [x] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions. **Evidence:** PGlite asserts old/new live board power, old/new legal play under limited energy, one-versus-four energy actually rested at apply time, identical old-game events after reload, corrected-vs-original zone visibility in Snapshot beat masking, and corrected-vs-original rules in the AI table. It rejects foreign/unknown runtime revisions, unknown formats, tampered/missing stored bundles and cross-game cache reuse, and verifies ordinary snapshots omit seed, decks, actions and bundle details. Export service checks non-SL, seated SL, unseated SL on versus and unknown-game paths; an invalid stored bundle is present during denial cases to prove denial precedes bundle validation.
- [x] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable. **Evidence:** `DATABASE_URL='' npx tsc --noEmit`, `DATABASE_URL='' npm run lint` (zero errors; five existing warnings in prototype JavaScript), `DATABASE_URL='' npx tsx scripts/verify-db.mts`, `DATABASE_URL='' npm test`, and `DATABASE_URL='' npm run build` pass. The rules suite reports its pre-existing 18 named rules-engine gaps and two legacy parity suites not run; no new gap is claimed by this work. `DATABASE_URL='' npm run db:generate` produced migration 0047 and its snapshot/journal after the #567/0046 prerequisite. Glossary, reading diff and fuzz gates do not apply.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed. **Evidence:** the #547 implementation is isolated on `arena-547-immutable-replay`; this branch is stacked on #567 commit `531571a2` so migration 0047 follows 0046. No live database writes, paid AI calls, or production checks were run. The Android Snapshot contract did not change.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/games.ts`, `src/lib/arena/rules-store.ts`, `src/lib/arena/rulesets/load.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.

**Compatibility and export limits.** Migration `drizzle/0047_spooky_thunderbolt.sql` is additive: it creates a content-addressed bundle table and adds nullable bundle/deck-input columns; it does not rewrite existing matches. A row without a pin stays loadable using its historical compatibility path and its admin export is explicitly `exact: false`; no current deck or rule data is substituted into that export. Exact offline replay also requires the same interpreter source revision as the bundle. A missing or hash-invalid bundle fails closed. No live database, production deployment, or user-device check was performed.
