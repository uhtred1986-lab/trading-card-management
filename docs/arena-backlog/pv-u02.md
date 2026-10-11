---
title: [P1] Arena: Make card sheets and action controls accessible
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
issue: 559
priority: P1
touches: src/components/arena/shared-sheets.tsx, src/components/arena/shared.tsx
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Playable board and fullscreen cards. **Plan key:** U02.

**Depends on:** None; ready for an isolated implementation.

**Build.** Provide dialog semantics, initial focus, focus containment and restoration, Escape/close, inert background and reachable 44px controls; preserve reduced motion and readable 200% text. Reuse the shared primitive rather than bespoke viewer focus code.

**Files to verify first:** `src/components/arena/shared-sheets.tsx`, `src/components/arena/shared.tsx`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] Keyboard opens/reviews/closes a sheet and focus returns to the launching control; background cannot receive focus; 320px and 200% text keep close/actions reachable.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] Before/after actual-artwork fixtures at 1440 and 390 in both skins, plus short phones, keyboard, 200% text and reduced motion; no obscured primary decision.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/components/arena/shared-sheets.tsx`, `src/components/arena/shared.tsx` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
