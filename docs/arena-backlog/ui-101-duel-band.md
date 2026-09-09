---
title: Arena: implement battle counters/combos staged duel band
milestone: Arena M3 — Battle staging and inspector
labels: backlog, enhancement, area:arena-ui, area:arena-contract, phase:battle-staging, model:sonnet-5
stage: ui
---
**Source:** `docs/arena-battle-staging-spec.md` §3.1–§3.4; `docs/arena-ui-motion-spec.md` §7.

**Status check, 9 Sep 2026 — this appears to be built.** The tree already has `BoardView.battle.counters` and `.contributions` (`src/lib/arena/view.ts`), `inBattle` on the `skill` beat (`src/lib/arena/beats.ts`), `src/components/arena/stage/DuelBand.tsx`, `Takeover.tsx` and the shared `BattleParts.tsx`, and §3.2 of the spec carries an "as built, retuned after play (7 Sep 2026)" timing table. The issue was filed from the spec's build list without checking the tree.

**What is left is to verify and close**, or to file the residue precisely:
1. Confirm each §3.1–§3.4 item against the tree: counters built from the battle's own record (not by inspecting the Drop); contributions surfaced from the power calculation, never recomputed in a client; durations in `motion.ts` only; `DuelBand` and `Takeover` importing the same parts from `BattleParts.tsx` (decision 1).
2. Confirm the contract side: `docs/arena-client-contract.md` §3–§4 describe `counters`, `contributions`, `inBattle`; `android/contract/.../Snapshot.kt` mirrors them; `npm run contract:emit` and `npm run android:test` are clean.
3. Measure §3.2's timing target in `arena:playthrough` (two combos, one counter, one trigger ≈ 3.1 s at 1×) and note whether the resolve sweep should be cut.
4. Anything missing becomes a new, narrowly scoped issue; then close this one with a comment listing what was verified.

**Acceptance.** A closing comment with the checklist above, each item ticked with the file and line that satisfies it, or a linked follow-up issue.
