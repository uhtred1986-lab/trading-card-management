---
title: Arena: BT29-040 "returned to hand → bottom of the deck instead" replacement
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: enhancement, backlog, area:arena-compiler, phase:capability-gap, area:arena-vm, model:opus-5, ready-for-agent
issue: 540
stage: ui
touches: src/lib/arena/vm/script-schema.ts, src/lib/arena/compile/targets.ts, src/lib/arena/glossary.ts
priority: P1
---
**Source:** owner's ruling of 4 Oct 2026 on BT29-040 #0 ("Yes, Time to Die!", Cooler Armored Squadron deck), stored on the row's `explanation`. Related: `docs/arena-move-replacement-scope.md`, `docs/arena-backlog/ui-107-move-replacement.md`.

**Card.** "[Activate: Main/Battle][Limit 1] If your Leader is blue: Until the end of your opponent's turn, if your opponent's Battle Card would be returned to its owner's hand by a skill on your card, place it at the bottom of its owner's deck instead."

**Ruling.** Teach the engine. Until then, the referee rules on it.

**Build.** A timed move replacement: target the opponent's Battle Cards; event: a move to hand caused by a skill of the controller's cards; replacement: bottom of the owner's deck; duration: until the end of the opponent's next turn. Reuse the replacement op from ui-107 if it covers this; extend its `by`/`bySide` fields if not. Compile BT29-040 #0, then the glossary entry.

**Acceptance.**
- Gate: `typecheck`, `lint`, `test`, `build`, `arena:fuzz 40`.
- `scripts/verify/readings.ts`, on both engines: after BT29-040 resolves, BT29-031's attack return puts the card on the bottom of the deck. An opponent's own bounce of their card still goes to hand. After the opponent's turn ends, returns go to hand again.

## Delivery reconciliation — 11 Oct 2026

**Priority:** P1. **Depends on:** None for its bounded scope.

Keep this bounded timed bounce replacement separate from #541/#542. Reuse completed move-replacement primitive #107; acceptance still needs cause/controller distinction and opponent-next-turn expiry.

Execution order and hot-file ownership: `docs/arena-delivery-plan.md`. Full review: `docs/arena-playability-review.md`.
