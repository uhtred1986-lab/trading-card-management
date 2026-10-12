---
title: [P1] Arena: pay Revive hand colors before additional Auto cost
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 624
priority: P1
touches: src/lib/arena/vm/flow.ts, src/lib/arena/vm/auto-costs.ts, src/lib/arena/vm/keyword-do.ts, src/lib/arena/rulesets/dbs/keywords.rules
---
**Source:** Rule manual §22-34-3; `scripts/verify/original-colors-597.ts` priced-Revive boundary fixture; `src/lib/arena/vm/flow.ts`, `auto-costs.ts` and the declared Revive body in `rulesets/dbs/keywords.rules`.

**Priority:** P1. **Delivery:** Rule engine correctness (Arena M5). Coordinate with #549/#595 and serialize Auto/cost/keyword writers. **Depends on:** #597's independent eligibility and priced-Revive boundary fixture merging. Original-color eligibility is tracked separately there.

**Confirmed problem:** A priced `[Revive red/blue] {r}` currently rests the additional Red energy before asking for its hand-color payment. Declining that later card selection leaves the card KO'd with the energy already paid. Rule 22-34-3 requires original-colored cards from hand to Drop first, then determining and paying any additional skill cost. The #597 fixture records this limitation without claiming a paid resolution.

**Build:** Persist Revive's color-first cost continuation and rebuild its supported additional price from the resulting board. Preserve the affected player's replacement choices, already-performed costs on failure, pending cost Autos and saved-frame bindings. Activate/announce/use/resolve only at the correct completed-payment point; preserve other Auto keywords. Unsupported price instruction shapes must interrupt explicitly.

**Acceptance:**
- [ ] Original-colored hand moves precede live additional fee calculation/payment. Unpriced Revive and ordinary Auto cases remain correct.
- [ ] Independent mono/multicolor, pay/decline, invalid/stale/reload, changed fee, late unaffordability, replacement failure and pending-Auto assertions prove state/cost/event order and no unpaid resurrection.
- [ ] Both viewers retain hand/life and cost-frame privacy; Revive negation and counter-play continuation occur only at their correct stages.
- [ ] Glossary and capability inventory describe the tested scope and remaining boundaries. Typecheck, lint, focused rules scenarios, full tests, build and generated-source checks pass. Frozen legacy expectations remain unchanged.

One bounded draft PR. No live database, paid calls, new dependencies, production settings or destructive migrations. Local synthetic fixtures are rule evidence; catalog/real-deck verification remains separately identified.

