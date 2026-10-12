---
title: "[P1] Arena: Invoke BT31-116's free hand Extra skill instead of playing it"
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, bug, area:arena-compiler, phase:rules-stage2, model:opus-5
stage: 2
issue: 680
priority: P1
touches: src/lib/arena/compile/effects.ts, src/lib/arena/vm/script.ts, src/lib/arena/vm/script-schema.ts, src/lib/arena/vm/activate.ts, src/lib/arena/vm/host.ts, src/lib/arena/engine/engine.ts
---
**Source:** [#680](https://github.com/uhtred1986-lab/trading-card-management/issues/680), the remaining BT31-116 effect in parent [#539](https://github.com/uhtred1986-lab/trading-card-management/issues/539), and Rule Manual v4.00 §12-2-4. [#571](https://github.com/uhtred1986-lab/trading-card-management/issues/571) delivered the qualifying trigger and subject filter; its scoped issue remains closed.

**Defect.** The current BT31-116 effect chooses an up-to-one mono-white energy-cost-2 Extra from hand, then compiles `play(target: chosen)`. `play` waives a play price and sends an Extra to the Battle Area. The printed effect instead activates one of that Extra's [Activate: Main/Battle] skills for free, with the Extra moving to Drop before its skill resolves. The existing static #571 assertion inspects only the outer condition and cannot catch the wrong nested operation. The owner's free-activation ruling is already recorded; no new ruling is required.

**Build.** Reuse #574's saved nested-activation continuation where it fits, while supporting the printed Main/Battle alternative and the *up to one* decline. Keep the existing exact hand, mono-white, cost-2 and white Cell/Cell Jr. cost-at-least-3 qualifications. Waive the chosen Extra's original energy and skill costs, preserve legality conditions, once limits and prohibitions, and keep the Auto's own Hidden Mode energy action price separate. External activation taxes are owned by [#677](https://github.com/uhtred1986-lab/trading-card-management/issues/677); do not treat that gap as a free-tax ruling.

**Acceptance.**
- [ ] Real qualified play and Auto payment/decision activate the selected hand Extra's genuine Main/Battle line exactly once. Its skill and Drop events occur before the parent resumes; it never stays in Battle as a free play.
- [ ] Optional decline, multiple cards/lines, wrong colour/multicolour/cost/zone or actor, unmet condition, spent once use, stale answer and source movement have exact state, cost and event assertions.
- [ ] JSON reload, saved-session CAS/idempotency and both viewer projections preserve the same decision and private information. The original-cost waiver remains distinct from #677's external-tax gap.
- [ ] A static assertion inspects the nested compiled operation and a registered runtime scenario proves its behavior. Glossary, capability metadata and parent #539 are reconciled; typecheck, lint, full local tests and build pass without changing frozen legacy/probe baselines unless a bounded difference is reviewed.
- [ ] Catalog reading diff/fuzz and production/device/paid limits are reported honestly. No live DB writes, new dependency or production-setting change.

**Implementation boundary to confirm before editing.** A read-only compile of the exact #571 BT31-116 wording produces an Auto action price of `choose` one of your Revealed Mode energy (`hidden: false`) followed by `hidden(target: chosen, hidden: true)`, with no unsupported price clause. The VM #549 planner whitelists both operations and verifies the mode switch on a clone, but a real BT31 play/pay/decline proof is still missing. The legacy `resolveAuto` checks orb, marker and keyword costs only, then resolves without reading the compiled action price; its `canPayCostProgram` also lacks `hidden`. This is a separate, observed legacy gate on the same card and must be fixed or explicitly scoped before claiming cross-engine acceptance. Serialize compiler, script, activation, host, glossary and fixture writers with #549/#550/#557/#677; #557's host addition is independent and must finish its writer window first.
