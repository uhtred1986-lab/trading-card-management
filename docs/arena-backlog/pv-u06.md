---
title: [P1] Arena: Fit the phone board and crowded hand around the current decision
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, enhancement, area:arena-ui, phase:board-redesign, model:sonnet-5
stage: ui
issue: 563
status: closed
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
- [x] The DB-free EngineAPI browser matrix covers 390×844, 390×667, 320×568 and 844×390 in both skins with 12–20-card hands. It checks real touch reachability, every crowded-card 44px hit square, sticky Pass, public Unison/Z-Deck/Z-Energy/Drop/Warp review and hidden opponent Z-Deck identities. Safe insets are emulated by substituting existing CSS `env()` values; no physical device is claimed. See `evidence/563/README.md`.
- [x] Browser assertions send exact offered actions and inspect actual EngineAPI cost/state/events for combo, target, payment, counter, resource-blocked activation, charge/play drags, and Pass. They also check wrong-time ability hiding, same-view stale revision rejection and reload. The `public-zone-inspection-563` scenario covers both viewers and engine lanes, including privacy and state purity.
- [x] At source head `af28180`, typecheck, lint, `npm test`, and build passed with `DATABASE_URL=''`; lint has five pre-existing prototype warnings and no errors. Arena verification is 45/45 legacy and 44/45 rules-only; the rules-only lane excludes the VM legacy-parity suite, and separately names four runtime gaps plus the untested legacy save/replay fixture. Final contract emission/check passed 45/45 on both engines without tracked fixture changes. This UI/projection change does not modify the VM or compiler, so glossary, reading diff and fuzz 40 are not applicable.
- [x] Before/after 1440×900 and 390×844 screenshots use checked Senzu Bean BT11-053 and Whis BT1-055 artwork in both skins; short/small/landscape frames, real Tab/Enter, 200% text, reduced motion, fullscreen, public zones, payment and safe-inset emulation are documented in `evidence/563/README.md`. The 200% landscape stakes, consequence and expanded assumptions are reachable by actual touch swipes while Pass remains visible.
- [x] One bounded draft PR is prepared from this branch with evidence per acceptance bullet and this canonical status. Live database, paid, physical-device and production/deployment checks remain owner-run and are not claimed.

**Order and hot files.** Follow prerequisite merge order and `docs/arena-delivery-plan.md`. `src/components/arena/stage/ArenaStage.tsx`, `src/components/arena/stage/Hand.tsx`, `src/components/arena/stage/StageZones.tsx` must not have concurrent writers. Other ready issues can be assigned independently only after checking shared types/fixtures and migrations.

**Out of scope.** Other plan tickets, production configuration, live database writes, new dependencies and paid AI calls. Preserve completed existing features and the legacy oracle. The design prototype is not authoritative rules code.
