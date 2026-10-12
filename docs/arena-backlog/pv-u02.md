---
title: [P1] Arena: Make card sheets and action controls accessible
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
status: closed
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
- [x] Keyboard opens/reviews/closes a sheet and focus returns to the launching control; background cannot receive focus; 320px and 200% text keep close/actions reachable.
- [x] Browser interaction checks cover keyboard paging with the close button focused, Tab/Shift+Tab containment, Escape, backdrop, swipe-close and action-pick unmount focus restoration, nested-modal isolation and loaded artwork.
- [x] Typecheck, lint, npm test and build pass. This UI change does not alter game rules, VM/compiler behavior or glossary fixtures.
- [x] Before/after app captures cover 1440px and 390px in both skins, plus 390×650 and 320×568 at 200% text with reduced motion. Screenshot-only artwork mapping and limitations are documented in `docs/arena-backlog/evidence/559/README.md`.
- [x] One bounded PR is prepared with evidence; canonical backlog status is closed. No live database, paid AI, or production checks were used.

**Owner-run checks:** No live database, paid AI, or production-settings access was used. Build and test commands ran locally with `DATABASE_URL=''`; artwork in the temporary screenshot fixture is an existing app capture crop mapped for this preview only, not live catalog imagery.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/components/arena/shared-sheets.tsx`, `src/components/arena/shared.tsx` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
