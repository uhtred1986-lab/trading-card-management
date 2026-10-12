---
title: [P1] Arena: Pay Aegis additional skill costs after the colored-card cost
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 595
priority: P1
touches: src/lib/arena/vm/activate.ts, src/lib/arena/vm/actions.ts, src/lib/arena/vm/costs.ts, src/lib/arena/vm/keyword-do.ts, src/lib/arena/vm/aegis-costs.ts, src/lib/arena/vm/flow.ts, src/lib/arena/vm/script.ts, src/lib/arena/rulesets/dbs/keywords.rules
---
**Source:** `docs/rules/rulemanual.txt` §22-30-3 (Rule Manual v4.00); `src/lib/arena/vm/activate.ts` payment-before-resolution path; #555's local priced-Aegis scenario.

**Priority:** P1. **Plan key:** R11. **Milestone:** Arena M5 — Engine capability gaps and advanced mechanics. **Depends on:** #555; serialize VM action/cost/keyword writers. This is distinct from #549 automatic-skill costs.

**Problem.** Activating an Aegis with a printed {r} cost currently rests energy before the hand-color payment prompt, while no hand-to-Drop cost event has occurred. The local fixture changes from 2 Rest/1 Active energy to 3 Rest/0 Active at that prompt. Rule 22-30-3 says to place the matching original-color cards from hand in Drop as the skill cost, then: “if there is an additional skill cost, determine that cost and pay it.” The choice-eligibility fix in #555 does not correct this order.

**Build.** Determine and pay additional Aegis skill costs after its required colored-card payment. Persist the full continuation across reload and refuse stale/invalid payment without charging again. Reuse the shared cost planner and declared keyword body; preserve other activation ordering and the frozen legacy oracle. Specify rule-grounded behavior if the additional cost becomes unaffordable at that point.

**Partial delivery in PR #620; issue remains open.** The VM now pays the hand-color cost before rebuilding the live additional declared price. It delays activation events, use limits, and effects until payment completes. A live hand-count discount fixture proves the rebuilt fee can differ from the initial offered fee; late unaffordability retains the performed hand payment and produces no activation or effect (5-8-4). Both saved payment stages reject invalid/stale answers without charging twice. Actual cost-move Autos remain pending until payment and the effect finish. Additional action-price programs interrupt before any payment; optional or competing replacements of additional native pooled moves also interrupt explicitly rather than silently choosing for the affected owner. These two boundaries remain owned by #595. Original-color eligibility remains #597; the frozen legacy oracle is unchanged.

**Acceptance.**
- [x] In the delivered declared-cost scope, a priced Aegis emits colored-card moves before additional payment, with explicit state and event-order assertions.
- [x] Multicolor and two single-color payments, invalid/stale picks, both-stage reload, live discounts and late unaffordable fees have independent assertions. No payment repeats and no unpaid effect executes.
- [x] Unpriced Aegis and ordinary paid Activate scenarios pass; the glossary and capability inventory identify the delivered scope and remaining additional-cost boundaries.
- [x] Typecheck, lint, independent scenarios, npm test, build and generated-source checks pass. No live database or paid calls; owner readings failed on DNS and empty-database fuzz failed before any games.

**Files to verify:** `src/lib/arena/vm/activate.ts`, `src/lib/arena/vm/actions.ts`, `src/lib/arena/vm/costs.ts`, `src/lib/arena/vm/keyword-do.ts`, `src/lib/arena/rulesets/dbs/keywords.rules`. Verify symbols before editing. No production settings, new dependencies or unrelated Auto implementation.

