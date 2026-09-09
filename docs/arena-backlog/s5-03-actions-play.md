---
title: Arena: actions.rules — play, playUnison, playZ, growUnison and offering on the rules engine
milestone: Arena M8 — Rules engine actions and costs (Stage 5)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, area:arena-rulesets, phase:rules-stage5, model:opus-5
stage: 5
---
**Source:** plan Stage 5; the play handlers and `resolvePlay` in `src/lib/arena/engine/engine.ts`, `playCost`/`planPayment` in `state.ts`; rule manual 8-3-2 (playing cards), 8-3-3 (Unison), 23 (Z cards), 22-45 ([Empower] markers on arrival); `docs/arena-workflow-spec.md` §4 for the refusal register.

**Problem.** Playing a card is the action with the most refusals (energy short, colour short, wrong phase, Unison area full, Z-Energy short, a prohibition in force) and the most side effects (arrival triggers, markers, [Permanent]s coming into force). It is where the `REFUSE` list and the cost machinery earn their keep.

**Build.**
1. `ACTION play`, `playUnison`, `playZ`, `growUnison`, `offering` in `actions.rules`, with `COST pay(costOf(card))` reading the derived attribute (so specified-cost and cost-modifier effects from Stage 2 apply through the layers, not through a second path) and `REFUSE` in the order the legacy `whyNotPlay` checks, so the *first* reason is the same on both engines — `rejectedActions` compares by first requirement.
2. `DO`: move to the zone, fire `played` (9-6-9-4's area-movement event), place arrival markers per 22-45, bring [Permanent]s into force (Stage 4's effects), pend the [Auto]s.
3. The payment prompt (which energy to rest) as the existing `Prompt` shape; `planPayment` is the next issue — until it lands, use the legacy planner through the shared state interface.

**Out of scope.** Keyword-gated plays ([Evolve], [Union], [Over Realm], [Swap] — Stage 7); costs beyond plain orbs (next issue).

**Acceptance.**
- Gate; `arena-fuzz 40 --engine rules` with plays, 0 crashes.
- `arena:diff` on the `harness.ts` play scenarios and `contract/fixtures/play.json`'s game: identical events and identical first-refusal per card.
- `scripts/verify/workflow.ts` on the rules engine: every play refusal wording matches legacy's for the same board.
