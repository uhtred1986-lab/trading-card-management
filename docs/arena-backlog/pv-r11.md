---
title: [P1] Arena: Pay Aegis additional skill costs after the colored-card cost
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 595
priority: P1
touches: src/lib/arena/vm/activate.ts, src/lib/arena/vm/actions.ts, src/lib/arena/vm/costs.ts, src/lib/arena/vm/keyword-do.ts, src/lib/arena/rulesets/dbs/keywords.rules
---
**Source:** `docs/rules/rulemanual.txt` §22-30-3 (Rule Manual v4.00); `src/lib/arena/vm/activate.ts` payment-before-resolution path; #555's local priced-Aegis scenario.

**Priority:** P1. **Plan key:** R11. **Milestone:** Arena M5 — Engine capability gaps and advanced mechanics. **Depends on:** #555; serialize VM action/cost/keyword writers. This is distinct from #549 automatic-skill costs.

**Problem.** Activating an Aegis with a printed {r} cost currently rests energy before the hand-color payment prompt, while no hand-to-Drop cost event has occurred. The local fixture changes from 2 Rest/1 Active energy to 3 Rest/0 Active at that prompt. Rule 22-30-3 says to place the matching original-color cards from hand in Drop as the skill cost, then: “if there is an additional skill cost, determine that cost and pay it.” The choice-eligibility fix in #555 does not correct this order.

**Build.** Determine and pay additional Aegis skill costs after its required colored-card payment. Persist the full continuation across reload and refuse stale/invalid payment without charging again. Reuse the shared cost planner and declared keyword body; preserve other activation ordering and the frozen legacy oracle. Specify rule-grounded behavior if the additional cost becomes unaffordable at that point.

**Acceptance.**
- [ ] A priced Aegis emits colored-card cost moves before additional energy/cost payment, with explicit state and event-order assertions.
- [ ] Single multicolor and two single-color payments, invalid/stale picks, reload at both payment stages and unaffordable additional cost have deterministic assertions; no resource is paid twice and no unpaid effect executes.
- [ ] Unpriced Aegis and ordinary paid Activate behavior remain correct; glossary and capability evidence describe only tested support.
- [ ] Typecheck, lint, relevant independent rules scenarios, npm test and build pass. No live database or paid calls; owner-only checks are recorded accurately.

**Files to verify:** `src/lib/arena/vm/activate.ts`, `src/lib/arena/vm/actions.ts`, `src/lib/arena/vm/costs.ts`, `src/lib/arena/vm/keyword-do.ts`, `src/lib/arena/rulesets/dbs/keywords.rules`. Verify symbols before editing. No production settings, new dependencies or unrelated Auto implementation.

