---
title: [P1] Arena: Fit the phone board and crowded hand around the current decision
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
issue: 563
priority: P1
touches: src/components/arena/stage/ArenaStage.tsx, src/components/arena/stage/Hand.tsx, src/components/arena/stage/StageZones.tsx
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Playable board and fullscreen cards. **Plan key:** U06.

**Depends on:** #560 (U03), #561 (U04), #562 (U05) — merged. Ready after checking shared stage/hand writers.

**Current baseline:** #562 makes stakes, resources and Pass explicit and fixes its own phone hand overlap by compacting empty lifted rows. It proves visible legal combo taps at normal phone size and touch-scroll access on short/200% screens. This issue still owns 12–20-card hands, smaller phones, landscape/safe areas and the full phone board; preserve those merged controls and real-artwork evidence.

**Build.** Implement compact real-artwork phone board, expandable horizontal hand and sticky decision dock from the grounded draft. Reduce empty slots and chrome; keep uncommon/public zones inspectable and cinematic staging optional. Preserve current prompt/target access and both skins.

**Files to verify first:** `src/components/arena/stage/ArenaStage.tsx`, `src/components/arena/stage/Hand.tsx`, `src/components/arena/stage/StageZones.tsx`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] 390x844, 390x667 and 320x568 fixtures keep actor/resources/action visible; 12–20-card hands remain reviewable; Unison, Z zones, Drop and Warp are reachable; landscape and safe areas don't cover decisions.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] Before/after actual-artwork fixtures at 1440 and 390 in both skins, plus short phones, keyboard, 200% text and reduced motion; no obscured primary decision.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/components/arena/stage/ArenaStage.tsx`, `src/components/arena/stage/Hand.tsx`, `src/components/arena/stage/StageZones.tsx` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
