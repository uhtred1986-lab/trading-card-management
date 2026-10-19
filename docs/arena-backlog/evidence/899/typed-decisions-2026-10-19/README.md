# Typed defensive decisions — #899

This bounded delivery-plan step 4 increment follows the actual #897 selected-pair
qualification and Testing & stats import. It replaces the combat policy's second
reading of displayed card text with optional version-1 decision facts derived
from the exact executable offered skill. No compiler, stored-record or database
migration is involved.

`battleActivation` binds `skillIndex` and Battle timing to `power.battle`, the
total currently applicable boost, `power.turn`, its lasting subset, and leading
draws. Never add those power fields. `counterResponse` binds the selected default
or explicit Counter skill to its kind, true/false/unknown attack negation and
the existing resolver's alternative route (`none`, `free`, `other`). Display
captions cannot establish free payment or negate an attack.

The projector accepts a bounded path of public conditions, own public selectors,
fixed power/draw effects, the known Leader/Battle domain mode, own-energy readying
and normalized negation. It reuses existing VM selection/condition readers and
payment helpers. Any unknown harmful tail, dynamic amount or hidden-dependent
predicate invalidates the effect summary. Operations/depth are capped. Current
battle power includes turn effects once; policy ranking weights are unchanged.

Continuation `battlePowerTarget` facts allow only a legal own current battler.
Modes are annotated only when their executable branch supplies that boost.
Choice facts require a bounded original script and fresh visible-choice bindings;
captured variable IDs do not supply provenance. The contract aliases all IDs
through the existing masking boundary. Generic unrelated choices retain their
existing heuristics. This prevents choosing a stronger unrelated own card after
valuing a boost for the defender.

Evidence checks exact skill binding, stored-program/display mutations, route
classification, unknown tails, public conditions, hidden twins with a genuinely
changing predicate truth, work refusal, JSON replay and read-only projection.
The six defensive variants and four tactical scenarios retain their original
acceptable actions. A fixture repair includes compiled back faces for flipped
Leaders, required by the current typed payment loader.

Focused final validation and source links are recorded below when complete.
Strategic holdouts, intervals, per-archetype evaluation and any policy promotion
remain open. No paid comparison, holdout consumption or general strength claim
is part of this increment. The owner requested essential checks only, grouped in
one application PR/build.


## Integrated focused results

- [Six defensive variants](defense-preservation.json): 18/18 acceptable decisions,
  60 privacy positions; original oracle and acceptable actions preserved.
- [Four tactical cases](tactics-preservation.json): 12/12 acceptable decisions,
  36 privacy positions; original expectations preserved.
- [Combat gate](combat-check.txt): 422 positions, 844 hidden-state permutations,
  all legal/deterministic, maximum 296/4096 work units.
- [Choice gate](choices-check.txt): 2,337 positions, 708 hidden-state permutations,
  all legal/deterministic with no fallback, maximum 9/4096 choice work units.
- Existing contract gate: 420 positions across two seats, 1,056 hidden-state
  permutations and 1,409 menu/24 compound round trips; malformed/stale/foreign
  responses refused. Exact-skill projection proof passes 42 focused checks.
- [Repository lint](lint-check.txt) passes with five existing prototype warnings.

Performance was recorded on the shared host rather than used as a strict timing
benchmark. Observed combat p95/max: 0.28/17.3 ms; choices: 0.82/16.9 ms. Functional,
privacy, deterministic work bounds and fallback assertions remained enabled.
Synthetic historical strength controls in these checks are regression gates,
not fresh #899 strategic holdouts or grounds for promotion.


Final merged-state typecheck passes. The six/four scenario receipts above were
rerun on the final integrated source after the combat3/choices2 version bump
and mixed-duration subset fix: 18/18 and 12/12 still pass. The typed reader
separately proves total 10000 / lasting subset 3000 is not double counted.
Three actual mode/target continuations pass with JSON replay and cosmetic twins:
White's activation is selected by the policy; Niagara's exact legal activation
is declared to isolate followthrough, while the six-case proof covers valuation.
The stronger competing target is actually offered in both Battle-target cases.

[Validation receipt](validation-receipt.json) pins final production-source hashes,
scope and checks. [Official online evidence](online-sources.md) records current
card pages and the same-day manual/FAQ/errata checks. The new focused proofs are
registered in the normal test chain for future runs. No full suite, local
production build, schema migration or #899 database write was performed.
