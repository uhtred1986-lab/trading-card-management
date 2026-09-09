---
title: Arena: costs.rules — planPayment parameterised (colours, X, either-orbs, markers, life, use-as-energy, alt costs)
milestone: Arena M8 — Rules engine actions and costs (Stage 5)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, area:arena-rulesets, phase:rules-stage5, model:opus-5
stage: 5
---
**Source:** plan Stage 5 ("`costs.rules` parameterises `planPayment`"); `planPayment`, `playCost`, `specifiedCostOf` in `src/lib/arena/engine/state.ts`; `orbTotals` in `engine.ts`; `CostRecord` in `script.ts`; the Stage 2 issues for X, `payWith` and cost modifiers; rule manual 8-3-2-3 (paying energy), 22-45 (Unison X), 22-30 ([Warrior of Universe 7]).

**Problem.** Payment is a search over the Energy Area with special branches for colours, either-orbs, X and [Warrior of Universe 7]. The rules engine needs the same search driven by **declared** cost kinds so a second game with a different resource can declare its own, and so DBS's alternative payments (markers, life, a card used as energy, an alt cost) are cost items rather than branches.

**Build.**
1. `DEFINE COST` in `rulesets/dbs/costs.rules`: `energy(orbs)` (total + specified colours + either-orbs + X), `marker(n)`, `life(n)`, `rest(self)`, `payWith(sel)`, `text` (unreadable, refuses), each naming what it consumes and how the payment prompt is asked.
2. `vm/costs.ts`: one planner over declared cost kinds that returns the same `Requirement` when a cost cannot be met (so `wording.ts`'s "needs {r}{r}, you have {r}" is unchanged) and the same payment prompt; specified-cost and cost-modifier effects from Stage 2 apply through the attribute layers.
3. The price shown (`priceOf` in `wording.ts`) and the price charged come from the same evaluation on both engines — a test that compares them over the harness cards.

**Out of scope.** Keyword-driven payments ([Energy-Exhaust], [Offering] — Stage 7).

**Acceptance.**
- Gate; `arena:diff` on every `harness.ts` game that pays a cost: identical events including which energy was rested.
- `verify/keywords.ts` cost cases (either-orbs, X, [Warrior of Universe 7] baseline, a [Counter] paid with a marker) green on both engines.
