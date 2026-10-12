---
title: [P1] Arena: Make battle stakes resources and pass consequences explicit
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, ready-for-agent, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
issue: 562
priority: P1
touches: src/components/arena/stage/DuelBand.tsx, src/components/arena/stage/PromptPanel.tsx, src/components/arena/stage/StageZones.tsx
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Playable board and fullscreen cards. **Plan key:** U05.

**Depends on:** #558 (U01)

**Build.** Show actor/window, current attacker/defender totals, tie result, damage/strike/critical/lethal implications, public blockers/restrictions and expiry, and what Pass does. Keep both players' life and ready/total energy by colour visible; allow energy/payment inspection. State assumptions when a response can change the result.

**Files to verify first:** `src/components/arena/stage/DuelBand.tsx`, `src/components/arena/stage/PromptPanel.tsx`, `src/components/arena/stage/StageZones.tsx`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [ ] A tied attack, Double Strike, Critical and lethal example each explains Pass before submission; payment preview updates remaining coloured energy; no hidden hand/life information enters the summary.
- [ ] Positive, negative, stale/reload and interaction cases appropriate to this change have explicit state/cost/event assertions.
- [ ] Typecheck, lint, relevant scenario verification, npm test and build pass; VM/compiler work includes glossary updates, reading diff and fuzz 40 where applicable.
- [ ] Before/after actual-artwork fixtures at 1440 and 390 in both skins, plus short phones, keyboard, 200% text and reduced motion; no obscured primary decision.
- [ ] One bounded PR, clear evidence per acceptance bullet, and canonical backlog status updated on completion. Live database/paid/production checks are listed as owner-run rather than claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/components/arena/stage/DuelBand.tsx`, `src/components/arena/stage/PromptPanel.tsx`, `src/components/arena/stage/StageZones.tsx` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
