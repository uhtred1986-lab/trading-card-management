---
title: [P1] Arena: Consolidate desktop board status and contextual decision panel
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
issue: 564
priority: P1
touches: src/app/arena/[id]/page.tsx, src/components/arena/stage/ArenaStage.tsx
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Playable board and fullscreen cards. **Plan key:** U07.

**Depends on:** #561 (U04), #562 (U05), #563 (U06)

**Build.** Implement grounded desktop draft using existing artwork and skins: one match strip, central board/hand and contextual decision/selection panel; remove repeated permanent status column. Keep current decision visible while card inspection is pinned; place log/settings/history on demand.

**Files to verify first:** `src/app/arena/[id]/page.tsx`, `src/components/arena/stage/ArenaStage.tsx`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] 1440px main, counter, target and pinned-card fixtures keep decision readable without repeated status; keyboard and 200% text work; compare against current board and draft in both skins.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] Before/after actual-artwork fixtures at 1440 and 390 in both skins, plus short phones, keyboard, 200% text and reduced motion; no obscured primary decision.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/app/arena/[id]/page.tsx`, `src/components/arena/stage/ArenaStage.tsx` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
