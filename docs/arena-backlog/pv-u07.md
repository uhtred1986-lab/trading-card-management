---
title: [P1] Arena: Consolidate desktop board status and contextual decision panel
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
issue: 564
status: closed
priority: P1
touches: src/app/globals.css, src/components/arena/shared-display.tsx, src/components/arena/stage/ArenaStage.tsx
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Playable board and fullscreen cards. **Plan key:** U07.

**Depends on:** #561 (U04), #562 (U05), #563 (U06)

**Build.** Implement grounded desktop draft using existing artwork and skins: one match strip, central board/hand and contextual decision/selection panel; remove repeated permanent status column. Keep current decision visible while card inspection is pinned; place log/settings/history on demand.

**Files to verify first:** `src/app/arena/[id]/page.tsx`, `src/components/arena/stage/ArenaStage.tsx`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] 1440px main, Counter, target and pinned-card fixtures keep the current decision readable without a repeated status column. Keyboard and 200% text checks, both skins, the current board and the grounded draft are compared in [evidence/564/README.md](evidence/564/README.md).
- [x] The offline browser proof captures exact legal play, Counter, attack, Pass and payment actions, independently applies them through EngineAPI and asserts state, cost and events. Wrong-window Senzu and invalid target send no action; stale poll and reload retain the newer Counter decision.
- [x] Typecheck, lint, the focused browser scenario, npm test and build pass. No compiler/VM semantics or contract shape changed, so glossary, readings diff, fuzz 40 and contract emission are inapplicable.
- [x] Before/after real-artwork actual-app frames at 1440 and 390 in both skins, plus 390×667, 320×568 and 844×390 phone frames, keyboard, 200% text and reduced motion show unobscured primary decisions. Viewports are simulated in Chromium; no physical-device claim is made.
- [x] One bounded PR carries the evidence and this canonical backlog status. Live database, paid AI and production checks remain owner-run if needed and are not claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/app/arena/[id]/page.tsx`, `src/components/arena/stage/ArenaStage.tsx` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
