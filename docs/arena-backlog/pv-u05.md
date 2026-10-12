---
title: [P1] Arena: Make battle stakes resources and pass consequences explicit
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
status: closed
issue: 562
priority: P1
touches: src/components/arena/stage/DuelBand.tsx, src/components/arena/stage/PromptPanel.tsx, src/components/arena/stage/StageZones.tsx, src/components/arena/stage/ArenaStage.tsx, src/components/arena/stage/Hand.tsx, src/lib/arena/view.ts, src/lib/arena/vm/view.ts, src/lib/arena/vm/battle.ts, src/lib/arena/vm/battle-damage.ts, android/contract/src/main/kotlin/arena/Snapshot.kt
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-client-contract.md`; `docs/agent-brief.md`.

**Priority:** P1. **Delivery:** Playable board and fullscreen cards. **Plan key:** U05.

**Depends on:** #558 (U01)

**Build.** Show actor/window, current attacker/defender totals, tie result, damage/strike/critical/lethal implications, public blockers/restrictions and expiry, and what Pass does. Keep both players' life and ready/total energy by colour visible; allow energy/payment inspection. State assumptions when a response can change the result.

**Files to verify first:** `src/components/arena/stage/DuelBand.tsx`, `src/components/arena/stage/PromptPanel.tsx`, `src/components/arena/stage/StageZones.tsx`. Update the contract/types/fixtures/glossary where the behavior requires it; verify actual symbols before editing.

**Acceptance.**
- [x] Tied, Double Strike, Critical and potential lethal examples explain the immediate Pass consequence before submission, conditionally. EngineAPI browser fixtures verify their DOM summaries in both skins; exact payment choices preview remaining payment colours. No hidden hand/life identities enter the stakes or public energy rows. Existing colour-grant/payment divergence is disclosed in inspection and tracked separately by #626.
- [x] `scripts/verify/battle-stakes-562.ts` asserts actual resolver outcomes, held/negated/removed/completed battles, effective Strike grants, optional replacements, pending Autos, Unison markers, Indestructible, exact payment rest/movement, public rows for both viewers, source/turn expiry, old-view fallback, serialization and stale revisions. The browser captures a real Counter-to-Defense update and rejects an older poll.
- [x] Typecheck, lint, focused scenarios, npm test and build pass on integrated main c1abbe1d plus this feature. Contract emission passes and its additive fixture changes are reviewed. Existing damage/intact queries are extracted unchanged; no new compiler/mechanic reading requires glossary or reading-diff changes. DB-backed fuzz 40 is owner-run. Kotlin offline decoding was attempted but its required plugin is absent from the cache; this remains explicitly unverified.
- [x] Before/after EngineAPI fixtures with actual Senzu/Whis artwork cover 1440, 390 and 390×650 in both skins. Browser assertions cover real Tab/Enter, phone touch interaction, 200% text, reduced motion, zero horizontal overflow, and Pass fully visible/unobscured with assumptions collapsed and expanded. Both phone skins prove a 44px unobscured legal hand tap at normal size, actual combo engine actions and power refresh at normal/200% text, touch scrolling on short phones, and hand/occupied-row fullscreen inspection. Only empty lifted Battle rows compact; occupied rows retain their footprint. Evidence is in `docs/arena-backlog/evidence/562/README.md`.
- [x] One bounded draft PR supplies evidence per acceptance item and closes this canonical file. No live database, paid-provider, configuration, migration or production checks are claimed. Owner-run/unavailable checks are listed in the evidence and PR.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/components/arena/stage/DuelBand.tsx`, `src/components/arena/stage/PromptPanel.tsx`, `src/components/arena/stage/StageZones.tsx` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
