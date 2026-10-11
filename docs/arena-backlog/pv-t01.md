---
title: [P0] Arena: Verify deck readiness per printed skill and runtime capability
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, ready-for-agent, enhancement, area:arena-contract, phase:arena-home, model:opus-5
stage: ui
status: closed
issue: 543
priority: P0
touches: src/lib/arena/readiness.ts, src/lib/arena/rules-store.ts, src/lib/arena/deck-preview.ts, src/components/arena/PlayPicker.tsx, src/components/arena/DeckPreviewSheet.tsx, scripts/verify-readiness.mts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P0. **Delivery:** Match integrity and recovery. **Plan key:** T01.

**Depends on:** None; ready for an isolated implementation.

**Build.** Count front/back printed skills and required zones against actual records; distinguish missing, draft, open, confirmed-supported and confirmed-unsupported. Preserve the practice/referee path and existing open-rule blocking. A status alone is not runtime support. Native keyword-only lines need no compiler row and are displayed as native with runtime support unverified.

**Files to verify first:** `src/lib/arena/readiness.ts`, `src/lib/arena/rules-store.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] A leader with one missing back skill and an otherwise confirmed deck is incomplete; truly textless cards are plain; a confirmed unsupported skill cannot be reported verified.
- [x] Positive, negative, stale/reload and interaction cases have explicit PGlite assertions: front/back matching, absent back record, textless with orphan rule, native-only skill, stale printed line, open+missing precedence, unread confirmed row, unsupported Auto cost/trigger and unimplemented trigger/window; incomplete/native decks remain practice and only current open rows block.
- [x] Typecheck, lint, relevant scenario verification, npm test and build pass. This readiness change does not edit VM/compiler implementation or glossary fixtures.
- [x] One bounded PR with evidence is prepared; four PlayPicker screenshots cover 390×844 and 1440×900 in anime/night skins under `docs/arena-backlog/evidence/543/`.

**Owner-run checks:** No live database, paid AI, or production-settings access was used. Build and PGlite checks ran locally with `DATABASE_URL=''`; the initial `npm ci` hit the local optional-platform lockfile mismatch and the worktree used the already verified dependency tree from the same lockfile, without running another install.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/readiness.ts`, `src/lib/arena/rules-store.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
