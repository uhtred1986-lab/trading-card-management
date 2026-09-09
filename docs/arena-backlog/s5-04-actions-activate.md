---
title: Arena: actions.rules — activate, with one rejection per skill line
milestone: Arena M8 — Rules engine actions and costs (Stage 5)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, area:arena-rulesets, phase:rules-stage5, model:opus-5
stage: 5
---
**Source:** plan Stage 5; the `activate` handler and `whyNotActivate` in `src/lib/arena/engine/engine.ts`; `docs/arena-workflow-spec.md` §3.2 as amended 8 Sep 2026 (an activation is one rejection **per skill line**, because a card prints up to nine and one being on the menu says nothing about the others); `Script.price` from `card_rules.cost`; `docs/arena-refusals-spec.md`.

**Problem.** [Activate:Main] and [Activate:Battle] skills are the action whose legality depends on the *record* — its price, its hoisted condition, its once-per-turn flag — and whose refusal is per line rather than per card. On the rules engine the record must be read exactly as the legacy engine reads it, or a corrected rule plays differently depending on the engine.

**Build.**
1. `ACTION activate` in `actions.rules`: `FOR` every skill line of every card in play (and in hand where the record's WHEN says so) whose kind matches the phase; `COST` the record's price (`Script.price` — an unknown price refuses, never plays free, the 8 Sep 2026 precedent); `REFUSE` the hoisted condition, once-per-turn, negated skills, prohibitions in force; `DO` run the program and fire `skillActivated` (a counter window moment).
2. The interpreter's one-rejection rule keys an activation by `(card, skillIndex)`; assert it in `scripts/verify/harness.ts` and `scripts/arena-playthrough.mts` on both engines — the two places must say the same thing.
3. `taps.whyByCard` and the card sheet need no change: same `Requirement` shapes.

**Out of scope.** [Counter] windows (Stage 6); keyword-gated activations (Stage 7).

**Acceptance.**
- Gate; `arena-fuzz 40 --engine rules` with activations, 0 crashes.
- `arena:diff` on `contract/fixtures/activate.json`'s game: identical; a card with three skill lines shows three rejections on both engines for the same board.
- `arena:reprobe --engine rules` on the `activate` family: 0 moved against the stored probes.
