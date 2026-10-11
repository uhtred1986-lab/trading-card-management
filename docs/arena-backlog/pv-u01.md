---
title: [P1] Arena: Expose authoritative ability availability and decision data
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, blocked, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
issue: 558
priority: P1
touches: src/lib/arena/snapshot.ts, src/lib/arena/vm/view.ts, src/lib/arena/view.ts
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Playable board and fullscreen cards. **Plan key:** U01.

**Depends on:** #544 (T02), #545 (T03)

**Build.** Extend Snapshot with per-instance skill identity, manual availability/refusal reason, timing/zone/ownership/limit, pending Auto and passive effects; include authoritative cost/payment preview and decision actor/window. Use engine legal/rejection logic, not duplicated client timing rules. Update web/Android contract docs and fixtures.

**Files to verify first:** `src/lib/arena/snapshot.ts`, `src/lib/arena/vm/view.ts`, `src/lib/arena/view.ts`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] The same card in Main, Battle, opponent turn, wrong zone and exhausted-limit cases produces the right availability; hidden opponent skills/cards are masked; stale submission still fails server-side.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] Before/after actual-artwork fixtures at 1440 and 390 in both skins, plus short phones, keyboard, 200% text and reduced motion; no obscured primary decision.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/lib/arena/snapshot.ts`, `src/lib/arena/vm/view.ts`, `src/lib/arena/view.ts` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
