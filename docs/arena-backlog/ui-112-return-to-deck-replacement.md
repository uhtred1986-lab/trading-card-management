---
title: Arena: BT29-040 "returned to hand → bottom of the deck instead" replacement
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: enhancement, backlog, area:arena-compiler, phase:capability-gap, area:arena-vm, model:opus-5, ready-for-agent
issue: 540
stage: ui
touches: src/lib/arena/compile/effects.ts, src/lib/arena/compile/shared.ts, src/lib/arena/effects.ts, src/lib/arena/engine/state.ts, src/lib/arena/types.ts, src/lib/arena/vm/common.ts, src/lib/arena/vm/effects.ts, src/lib/arena/vm/flow.ts, src/lib/arena/vm/host.ts, src/lib/arena/vm/replace.ts, src/lib/arena/vm/script-host.ts, src/lib/arena/vm/script-schema.ts, src/lib/arena/vm/script.ts, src/lib/arena/glossary.ts, scripts/verify/readings.ts, contract/fixtures/effect-language.txt, contract/fixtures/language-reference.txt
priority: P1
status: closed
---
**Source:** owner's ruling of 4 Oct 2026 on BT29-040 #0 ("Yes, Time to Die!", Cooler Armored Squadron deck), stored on the row's `explanation`. Related: `docs/arena-move-replacement-scope.md`, `docs/arena-backlog/ui-107-move-replacement.md`.

**Card.** "[Activate: Main/Battle][Limit 1] If your Leader is blue: Until the end of your opponent's turn, if your opponent's Battle Card would be returned to its owner's hand by a skill on your card, place it at the bottom of its owner's deck instead."

**Ruling.** Teach the engine. Until then, the referee rules on it.

**Build.** Compile BT29-040 #0 as a timed `replaceLeave`: target opponent Battle Cards, match a skill-caused move whose original destination is hand and whose actor is the target's opponent, then place at the bottom of the owner's deck through the opponent's next turn. Existing static replacements keep their prior behavior.

**Acceptance.**
- Gate: `typecheck`, `lint`, `test`, `build`, `arena:fuzz 40`.
- `scripts/verify/readings.ts`, on legacy and rules engines: the DB-free fixture models BT29-031's attack-return event after BT29-040 resolves and checks bottom-of-owner-deck placement, the opponent's own self-bounce to hand, a move to Drop remaining unaffected, and the same attack return to hand after the opponent's turn ends. The source card text and ruling are retained above; no live catalog row is read by the fixture.

## Delivery reconciliation — 11 Oct 2026

**Priority:** P1. **Depends on:** None for its bounded scope.

Keep this bounded timed bounce replacement separate from #541/#542. It extends the completed #107 move-replacement path with original-destination filtering, actor-side filtering, and timed selectors. The rules engine and legacy engine now both read the same activation and expiry behavior.

Execution order and hot-file ownership: `docs/arena-delivery-plan.md`. Full review: `docs/arena-playability-review.md`.


**Database-backed acceptance limitation:** `arena:fuzz 40` was not run because the repository instructions prohibit use of the environment database URL (it belongs to another app), and no application-specific live URL was supplied. The focused rules checks above are DB-free; owner real-deck fuzz remains outstanding.
