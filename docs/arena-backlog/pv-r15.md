---
title: [P1] Arena: pay Revive hand colors before additional Auto cost
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, enhancement, area:arena-vm, phase:capability-gap, model:opus-5
stage: ui
issue: 624
priority: P1
status: closed
touches: src/lib/arena/vm/flow.ts, src/lib/arena/vm/keyword-do.ts, src/lib/arena/vm/revive-costs.ts, src/lib/arena/vm/replace.ts, src/lib/arena/vm/script.ts, src/lib/arena/rulesets/dbs/keywords.rules
---
**Source:** Rule manual §22-34-3; `scripts/verify/original-colors-597.ts` priced-Revive boundary fixture; `src/lib/arena/vm/flow.ts`, `auto-costs.ts` and the declared Revive body in `rulesets/dbs/keywords.rules`.

**Priority:** P1. **Delivery:** Rule engine correctness (Arena M5). Coordinate with #549/#595 and serialize Auto/cost/keyword writers. **Depends on:** #597's independent eligibility and priced-Revive boundary fixture merging. Original-color eligibility is tracked separately there.

**Confirmed problem:** A priced `[Revive red/blue] {r}` currently rests the additional Red energy before asking for its hand-color payment. Declining that later card selection leaves the card KO'd with the energy already paid. Rule 22-34-3 requires original-colored cards from hand to Drop first, then determining and paying any additional skill cost. The #597 fixture records this limitation without claiming a paid resolution.

**Build:** Persist Revive's color-first cost continuation and rebuild its supported additional price from the resulting board. Preserve the affected player's replacement choices, already-performed costs on failure, pending cost Autos and saved-frame bindings. Activate/announce/use/resolve only at the correct completed-payment point; preserve other Auto keywords. Unsupported price instruction shapes must interrupt explicitly.

**Acceptance:**
- [x] Original-colored hand moves precede live additional fee calculation/payment. Unpriced Revive and ordinary Auto cases remain correct.
- [x] Independent mono/multicolor, pay/decline, invalid/stale/reload, changed fee, late unaffordability, replacement failure and pending-Auto assertions prove state/cost/event order and no unpaid resurrection.
- [x] Both viewers retain hand/life and cost-frame privacy; Revive negation and counter-play continuation occur only at their correct stages.
- [x] Glossary and capability inventory describe the tested scope and remaining boundaries. Typecheck, lint, focused rules scenarios, full tests, build and generated-source checks pass. Frozen legacy expectations remain unchanged.

**Delivery evidence:** `scripts/verify/revive-cost-order-624.ts` independently
asserts actual battle-KO mono/multicolor payment, empty/incomplete coverage,
additional-fee decline, event order, invalid/stale answers and reload, live
hand-count modifiers and conditions, late unaffordability, mandatory/optional
replacement failure for selected hand routes and additional actions, partial
cost retention, deferred substitutes, an unrelated generic Auto hand price,
pending cost Autos, initial/per-turn Revive negation, accepted/replaced
Counter: Play and both viewers' hand/life/frame/candidate privacy. The old
`original-colors-597.ts` boundary now asserts the earned color-first behavior.

**Saved states:** the optional `ScriptFrame.reviveCost` is additive at VM state
version 10, following the existing optional Aegis/Auto continuations. New
frames retain the declared program, source/master/trigger/skill identity and
bindings. Older suspended generic Revive frames keep their exact stored
program and committed payment history; the compatibility fixture verifies no
repricing or double charge. The change cannot retroactively reorder a cost
already performed by an older game.

**Scope:** local synthetic records exercise the shared supported Auto prices,
including additional action instructions and their replacement choices. The
existing #549 unsupported instruction boundary still interrupts explicitly;
arbitrary price grammar/cost-effect bindings, exhaustive catalog/live-deck
verification and discovery of hand-departure replacement families beyond
explicitly selected registered routes remain separate work. No legacy expectations,
database, dependencies, settings, migrations or public DTO shape changed.

**Validation:** `npm run typecheck`, `npm run lint` (zero errors; five existing
prototype warnings), `npm test` (45/45 legacy suites, 44/45 rules-only suites
with the VM parity suite intentionally excluded), and `npm run build` exited
successfully. The rules-only lane names four unsupported mechanics and the
legacy save/replay exclusion; none is a Revive skip. Final `contract:emit`
passed 45/45 on both engines and left no tracked fixture diff; ruleset and
capability generated checks passed (25 narrow scenarios, four named runtime
gaps, 27 VM source sites). The frozen legacy/probe corpus did not change.

One bounded draft PR. No live database, paid calls, new dependencies, production settings or destructive migrations. Local synthetic fixtures are rule evidence; catalog/real-deck verification and DB-backed `arena:fuzz` remain unverified under the data restriction.

