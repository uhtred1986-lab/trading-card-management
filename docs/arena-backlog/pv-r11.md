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

**Partial delivery in PR #620.** The VM paid the hand-color cost before rebuilding the live additional declared price. It delayed activation events, use limits, and effects until payment completed. A live hand-count discount fixture proved the rebuilt fee could differ from the initial offered fee; late unaffordability retained the performed hand payment and produced no activation or effect (5-8-4). Both saved payment stages rejected invalid/stale answers without charging twice. Actual cost-move Autos stayed pending until payment and effect completion. The additional action-price and optional/competing native pooled replacement boundaries remained for this follow-up.

**Further partial delivery (after #620).** The saved Aegis frame now walks each declared additional native cost in order and retains its cursor across replacement prompts. Selected pooled cards use the existing cost interpreter, so optional and competing replacement routes are offered to the affected card's master. A route that still reaches the specified area completes payment; a legal redirect performs its substitute and fails activation under 5-8-4, retaining earlier colors and any native resources actually paid. A two-card pool fixture reloads between its first and second departure, with no replay of the first move or energy fee; a control change within the same area and loss of the pool's required mode both reject the saved second payment. A separately captured old additional-payment prompt (fccead5 runtime with Aegis source identical to ed44cb0) resumes under this code without replaying its already-paid hand cards and activates once. Supported additional action-price programs then run through the shared strict cost host. A two-departure action price persists between the departures and activates once only after both finish. A price newly unaffordable after the color payment fails without a skill event, use, or effect; where the action price is known impossible before native payment, that native payment is not taken. Action-price instructions beyond the shared strict host remain explicit #595 interruptions; the broader Auto price scope stays with #549. The new pooled-cost and action-price fixtures are synthetic language/VM tests, not claims about a printed Aegis card. Original-color eligibility is covered separately by #597; the legacy oracle remains frozen.

**Current follow-up validation:** `DATABASE_URL='' node_modules/.bin/tsx scripts/verify/aegis-cost-order-595.ts`, `aegis-555.ts --engine rules`, `original-colors-597.ts`, `npm run typecheck`, targeted ESLint, and `git diff --check` passed. Root also passed full lint, `npm test` and the production build on the reviewed source; no live database or paid call was used.

**Acceptance.**
- [ ] Complete all required additional action-price programs. This increment delivers supported additional action-price programs and persisted optional/competing pooled replacement choices; preserve the delivered color-first payment order. Instructions beyond the shared strict price host remain explicit #595 interruptions.
- [x] In the delivered declared-cost scope, a priced Aegis emits colored-card moves before additional payment, with explicit state and event-order assertions.
- [x] Multicolor and two single-color payments, invalid/stale picks, both-stage reload, live discounts and late unaffordable fees have independent assertions. No payment repeats and no unpaid effect executes.
- [x] Unpriced Aegis and ordinary paid Activate scenarios pass; the glossary and capability inventory identify the delivered scope and remaining additional-cost boundaries.
- [x] Typecheck, lint, independent scenarios, npm test, build and generated-source checks pass. No live database or paid calls; owner readings failed on DNS and empty-database fuzz failed before any games.

**Files to verify:** `src/lib/arena/vm/activate.ts`, `src/lib/arena/vm/actions.ts`, `src/lib/arena/vm/costs.ts`, `src/lib/arena/vm/keyword-do.ts`, `src/lib/arena/rulesets/dbs/keywords.rules`. Verify symbols before editing. No production settings, new dependencies or unrelated Auto implementation.


**Status:** #595 remains open for additional-price instructions outside the validated shared host. This bounded increment completes the reviewed native replacement/reload and admitted action-price paths; it does not redefine full acceptance to hide unsupported payment instructions.
