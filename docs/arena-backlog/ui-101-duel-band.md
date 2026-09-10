---
title: Arena: implement battle counters/combos staged duel band
milestone: Arena M3 — Battle staging and inspector
labels: done, enhancement, area:arena-ui, area:arena-contract, phase:battle-staging, model:sonnet-5
stage: ui
status: closed
closed_at: 2026-09-09
---
**Source:** `docs/arena-battle-staging-spec.md` §3.1–§3.4; `docs/arena-ui-motion-spec.md` §7.

**Status check, 9 Sep 2026 — this appears to be built.** The tree already has `BoardView.battle.counters` and `.contributions` (`src/lib/arena/view.ts`), `inBattle` on the `skill` beat (`src/lib/arena/beats.ts`), `src/components/arena/stage/DuelBand.tsx`, `Takeover.tsx` and the shared `BattleParts.tsx`, and §3.2 of the spec carries an "as built, retuned after play (7 Sep 2026)" timing table. The issue was filed from the spec's build list without checking the tree.

**Verification Checklist:**
- [x] 1. Counters built from battle record rather than inspecting Drop (`src/lib/arena/view.ts` lines 384-398); contributions surfaced directly from engine calculation into `view.battle.contributions` (`src/lib/arena/view.ts` lines 399-408); durations isolated to `src/components/arena/stage/motion.ts`; `DuelBand.tsx` and `Takeover.tsx` share common primitives (`BattleCardChip`, `ChainChip`, `TotalBadge`, `BattleOutcomeBanner`, `shapeBattle`) from `src/components/arena/stage/BattleParts.tsx`.
- [x] 2. Contract side: `docs/arena-client-contract.md` §3–§4 details verified; mirrored in `android/contract/src/main/kotlin/arena/Snapshot.kt` (`counters`, `contributions`); `npm run contract:emit` clean.
- [x] 3. Timing verified against `docs/arena-battle-staging-spec.md` §3.2 and motion definitions in `src/components/arena/stage/motion.ts`.

**Acceptance.** Verified and closed with all items satisfied.
