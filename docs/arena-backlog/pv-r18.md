---
title: "[P1] Arena: Charge recognised activateSkill taxes on normal and invoked activations"
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, bug, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 677
priority: P1
touches: src/lib/arena/vm/activate.ts, src/lib/arena/vm/actions.ts, src/lib/arena/vm/program.ts, src/lib/arena/vm/host.ts, src/lib/arena/engine/engine.ts, src/lib/arena/engine/state.ts, src/lib/arena/rulesets/dbs/actions.rules
---
**Source:** [Issue #677](https://github.com/uhtred1986-lab/trading-card-management/issues/677); Rule Manual v4.00 §20-14 and §12-2-4. This is the external-tax gap found while implementing SD7-01 under #574, separate from its original-cost waiver.

**Current boundary.** The compiled `forbid`/`unlessPay` tax is found by `taxesOn(..., "activateSkill", ...)` in both engines. Neither the ordinary activation path nor SD7-01's nested Extra activation pays it: the former does not consult activation taxes and the latter waives the Extra's original price without an external-tax payment path. `scripts/verify/duration-shuffle-574.ts` actively asserts the typed tax is visible to both readers and that only the Extra's own hand-to-Drop move occurs. That assertion records missing behavior; it is not a rule-correct outcome or evidence that the tax may be waived.

**Build.** Charge each applicable external tax once on normal Main/Battle and effect-invoked activations. Reuse the supported native payment, decline, affordability and binding flows; preserve the invoking effect's nested continuation. Check acting player/source and the live state after each tax. Original-cost waiver must not silently waive external taxes. Interrupt an unmodelled due price visibly before treating the effect as resolved.

**Acceptance.**
- [ ] Payable, unpayable and declined normal and invoked activations have exact state/cost/event assertions, with original-cost waiver controls.
- [ ] Multiple/live taxes, actor/source conditions, counted-use limits and source departure are tested with deterministic stale and JSON-reloaded choices.
- [ ] Both viewer projections, saved-session revision/CAS/idempotency and parent continuation remain correct without private cost/source disclosure.
- [ ] Typecheck, lint, focused scenarios, full local tests/build and capability metadata pass; preserve frozen legacy oracle digests or review any bounded parity change explicitly.
- [ ] No paid provider, live database, new dependency or production-setting change. Catalog/fuzz/device limits are stated honestly.

Coordinate price-frame and schema ownership with #549/#550. This ticket does not own Counter:Counter recursion (#552) or #574's printed Charge/Desire reading.
