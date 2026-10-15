# Local opponent strategy validation

The target is sound local-opponent play across all supported decks. White Cell is
one resource-engine example, alongside aggro, control, fusion/evolution, recursion,
multicolor and Unison strategies. Deck qualification proves that required rules
are available; a completed or winning game does not prove that the opponent used
those rules well. This plan adds twelve general strategy benchmarks to #827 and
supports the stronger-opponent work in #826. Five tactical subcases now have executable evidence in
[resource-aware search](arena-resource-search-826.md); the twelve benchmark families
are not yet fully covered. No paid comparison runs have started.

The [testing catalog](../src/lib/arena/testing/catalog.ts) has 64 proposed decks
(16 first-wave) and 55 planned scenarios: 24 rule/interaction families, 12 general
strategy benchmarks, 12 White Cell rule cases and seven White Cell decision cases.
The [release proposals](arena-proposed-decks.md) still require assembled quantities,
legality and pinned rules. The [White Cell checklist](arena-white-cell-validation.md)
is a concrete specialization, not a substitute for the other archetypes.

## Separate rule correctness from decision quality

A rule fixture asserts exact printed/manual/ruling behavior through the real engine.
A strategic fixture asserts an acceptable **set** of decisions, with an objective,
horizon and declared legal opposing responses. Build that set before evaluating a
candidate. Replay alternative legal lines to substantiate survival, damage and
resource results; do not use the current policy's preference as the answer key.
Equivalent orders/payments can all pass. A hard position without a defensible
answer set stays a diagnostic position until reviewed; do not manufacture an
optimal action from a card's cost or an Opus explanation.

For each variant record: benchmark ID, named fixture ID/revision, exact deck/card
and face/skill IDs, catalog/erratum and engine revision, policy commit/configuration,
permitted observation, policy RNG, objective/horizon, legal response assumptions,
acceptable first actions and continuations, resulting board/Life/card/energy
assertions, replay/evidence link and reviewer. Private snapshots containing hidden
hands, Life or personal deck lists stay in admin artifacts; public summaries can
name printed cards and aggregate errors. Portal progress links this evidence; it
must not infer a pass from the presence of a skill or a whole-game win.

## Twelve general benchmarks

“Partial” below names existing generic evidence, not a completed benchmark or a
pass for an entire deck. Each benchmark needs success, an adverse boundary, and
an opportunity-cost/decline variant where relevant, from both seats. Apply it to
at least two different qualified archetypes before describing it as cross-deck
coverage; retain separate per-deck variants as the release corpus grows.

### AI-01

**Proven lethal and Life-to-hand replenishment.** Accept first moves of legal lines
that win against every response in the fixture's declared response set when such
a line exists. Count bounded multiple attacks and own combos; ordinary Life damage
can replenish the defender's combo hand. Test Dual/Triple Attack, Critical pressure
and a wide small-attacker board, plus a position without forced lethal. Existing
combat threshold/Strike evidence and one search two-attacker lethal are partial;
the historical three-attacker failure remains a regression control. Resource-aware
search now models sampled Life-to-hand replenishment and passes a paid-combo lethal
subcase; that does not prove complete multiattack planning.

### AI-02

**Avoidable loss and efficient defense.** Accept legal lines that survive the full
declared attack sequence when survival is possible, minimizing necessary resources
among equivalent surviving lines. Include blocker, counter, combo and activation
alternatives; saving one battle while losing the next is insufficient. Variants:
low-Life aggro, multiple-counter control and protection of a development base.
Partial: generic lethal blocking, sufficient cheap combo and nonredundant counter.
Missing: named real-deck, multi-attack defensive continuations.

### AI-03

**Energy, colors and future payments.** Accept development/payment orders preserving
the specified follow-up or defensive cost, unless immediate survival or proven
lethal dominates it. Equivalent active colored sources may all qualify. Variants:
mono-color, multicolor/Energy-Exhaust and White Hidden/Revealed resources. Partial:
synthetic color-preserving play and payment. Missing: printed multicolor/White
chains and explicit future-turn objectives.

### AI-04

**Card advantage and combo opportunity costs.** Accept cheapest sufficient,
outcome-equivalent battle/development lines, retaining required material/counter
cards when expendable equivalents exist. Count actual printed draw/recovery effects
rather than treat every card as equal. Variants: hand-pressure aggro, draw/control
and material decks. Partial: efficient synthetic combos and least-value discards.
Missing: effect-aware printed card and material opportunity costs.

### AI-05

**Critical versus ordinary attack order.** Accept orders attaining the fixture's
proven damage/lethal objective against its legal defenses, with Critical Life going
to Drop and ordinary Life entering hand. Critical-first is not a universal rule.
Variants: mixed attackers, multiple attacks and blockers/Strike damage. Partial:
combat values Critical/Double Strike. Missing: exact real-deck attack-order cases;
resource-aware search now passes declared Critical-first and normal-first synthetic
subcases, while real-deck coverage remains open.

### AI-06

**Development sequencing and curve.** Accept feasible turn sequences reaching the
specified board/resource milestone while preserving necessary defense. A more
expensive play is not automatically better. Variants: low-curve aggro, Unison marker
development and resource-dependent control, including a justified end-turn.
Partial: affordable play, favorable attack, endMain and free-activation termination.
Missing: printed multi-effect development sequences and their resource tradeoffs.

### AI-07

**Fusion and evolution material planning.** Accept lines preserving/finding/developing
exact printed eligible materials or bases for the specified next Fusion/Evolve
play, unless immediate survival/proven lethal dominates. Compare resulting boards
and retained resources for alternate legal ingredients. Variants: Union-Fusion,
Union-Potara and Evolve/EX-Evolve. Existing ingredient/stack rule proofs are reusable
legality evidence; strategic material and base-selection cases are missing.

### AI-08

**Removal and control targets.** Accept removal/disable targets that change the
specified survival/board objective, obeying protection and effect scope. A smaller
engine or blocker can matter more than the highest-power card; allow decline when
removal has no benefit. Variants: aggro clearing blockers, control breaking engines
and protected/unprotected targets. Partial: useful synthetic optional/required
picks and modes. Missing: printed effect-aware target comparisons.

### AI-09

**Recursion and finite resource loops.** Accept eligible recovered/replayed cards
that enable the specified defense/development, with limits and net costs included.
A beneficial bounded cycle may qualify; unproductive repetition must terminate.
Variants: Desire recovery, Revive/Swap and Extra/Drop recursion. Partial: generic
paid Auto/mode/replacement choices and cycle guards. Missing: real recursive-engine
value, recovery timing and resource-loop benchmarks.

### AI-10

**Optional payment and deliberate decline.** Accept full payment only when the
specified benefit justifies losing the resources needed by the other objective;
otherwise decline without spending. Allow equivalent full payments, never partial
exact-count payment. Variants: hand/Warp prices, Life choices and energy-mode costs.
Partial: synthetic paid Auto, optional Life pick and Offering decisions; exact
payment rule proofs establish legality. Missing: real-card value/decline comparisons.

### AI-11

**Robust hidden-information choices.** Require identical answers for identical
permitted observations/policy RNG under hidden permutations. Within those answers,
score a predeclared public-information risk objective under an explicit response
distribution; do not reward knowing an unseen counter or combo card. Variants:
unknown combo/counter hands and deck/Life order across aggro/control/material decks.
Existing generic hidden-twin suites are partial privacy proof. Missing: calibrated
archetype-specific risk objectives and response assumptions.

### AI-12

**Adapt pressure, control and long-game plans.** Accept reviewed finite continuations
that pressure when delay loses the race, stabilize when racing loses, or conserve/
recur when that enables the declared later result. Pin the horizon and response
assumptions; ambiguous plans remain diagnostic. Variants: aggro mirror, aggro versus
control and recursion/material versus resource denial. Generic development/battle
proofs do not establish adaptation; named cross-archetype cases are missing.

## Existing evidence and its scope

- [Main policy suite](../scripts/verify/arena-policy-main.mts): affordable development,
  color-preserving order/payment, favorable attacks, useful end-turn and bounded
  activations on named synthetic real-engine states. Deterministic legal choices,
  hidden permutations and work bounds are separately checked.
- [Combat suite](../scripts/verify/arena-policy-combat.mts): block/counter/combos,
  exact thresholds, Critical/Double Strike valuation and cheaper battle activations
  on synthetic battles, including actual cards, energy and Life spent.
- [Choices suite](../scripts/verify/arena-policy-choices.mts): optional/required picks,
  discard, priced Autos, modes, Offering, Auto order, markers and replacements.
  These are useful decision-window proofs, not recursive-deck strategic evaluations.
- [Frozen search experiment](arena-policy-strength.md): one real-engine tactical
  win and a known Life-to-hand failure. Its held-out 80 games produced 41 wins,
  39 losses; 95% Wilson interval 40.49–61.91%. Only five decisive seat-swapped
  pairs remained, below the twenty required. It was **not promoted**.

Link the exact fixture and replay/revision when reusing any proof. A generic pass
must never automatically pass AI-01 through AI-12 for every proposed deck.

## Frozen comparison and promotion

1. **Qualify the measurement.** Assemble legal pinned deck lists; repair rule faults
   before grading strategy. Replay each acceptable-action fixture through the engine
   and review its printed basis. An engine interruption is an unresolved rule case,
   not a strategic loss. Track unsupported/unfinished runs in the denominator.
2. **Freeze before holdout.** Record baseline/candidate commits, policy configuration,
   observation contract, seeds, deck/rules revisions, matchup allocation, objectives,
   sample size, stopping rules and promotion thresholds. Separate development and
   holdout seed ranges. Keep engine and policy RNG distinct. Retire a holdout after
   inspecting it; repairs require fresh seeds, not repeated tuning on its answers.
3. **Pair deals and seats.** Use the same pinned deal with baseline/candidate seats
   swapped, and record seat-specific results. Use mirrors plus cross-archetype
   matchups: aggro/control, aggro/material, control/recursion, material/recursion,
   and resource-specific opponents. Explicitly include first-wave release pairs,
   SD5/SD15 controls and White as one cell in this matrix. Twenty games for a deck
   are diagnostic; even forty heterogeneous games do not prove universal strength.
4. **Promote in layers.** First pass exact rule, legality/privacy/replay and applicable
   deterministic decision cases, with no known avoidable lethal/defense regressions.
   Next measure each affected archetype/matchup, then the aggregate. Reuse the
   predeclared search gate in `arena-policy-strength.md` for that experiment (at
   least 40 paired deals, 20 decisive pairs and a 95% lower bound above 50%); it
   is not a blanket guarantee for all archetypes. Predeclare a tolerable per-archetype
   regression margin and a powered sample size before a broader comparison. If an
   archetype's interval is too wide to exclude that margin, mark its promotion
   inconclusive and gather new held-out deals. Strong aggregate wins cannot hide
   an observed tactic failure or a substantiated archetype regression.
5. **Report uncertainty and costs.** Report wins/losses/draws, all attempts/completions,
   interruptions, acceptable-action rates by benchmark and deck, forced-lethal
   misses, avoidable losses, resources wasted, and browser decision-time/fallback
   limits. For independent deal-pair outcomes use the existing paired gate; for
   other rates show 95% intervals with explicit denominators. Do not treat the two
   seat-swapped games or many decisions in one game as independent evidence;
   confidence for differences should account for clustering by deal. Record
   per-archetype and per-seat results, not only a pooled win percentage.

Passing a fixture permits a narrow “passed at these revisions/variants” statement.
A general stronger-difficulty claim requires the frozen held-out game gate and
archetype guardrails. Unmeasured releases and unsupported mechanisms stay pending.

## Targeted Opus comparison

Opus is a comparison opponent/reviewer, never a rule oracle or automatic strategic
answer key. Use the same restricted observation and legal action IDs as the local
policy; neither gets opponent hand, face-down Life, deck order or private decklist.
Review claimed mistakes against printed rules and reproducible alternative lines.
Keep hypothetical private continuations in admin evidence, never in model prompts.

Run free deterministic cases and paired local games first. Spend proposed credits
on disputed hard choices: attack order with replenishment, multi-attack defense,
material sacrifices, effect-aware recovery and late-game plan changes. Execute
forced choices freely; prioritize meaningful branches over asking for commentary
on every move. Measure acceptable actions, survival/lethal mistakes and resource
outcomes alongside paired wins. Pin exact model, prompt/rates and candidate policy;
record model decisions, menu validation, retries, latency and costs. Failed or
budget-ended games remain failed/limited attempts, never wins or draws.

The [coverage programme](arena-deck-coverage-plan.md#proposed-first-budget-and-run-limits)
contains the proposed $20/8-game pilot, $100/40-game total first campaign and two
$50 reserves, plus per-game/decision/token limits and worst-next-call reservations.
Those are recommendations, not permission or verified credit/rate information.
No paid calls are authorized or made by this plan; the portal records actual
reported spend separately from estimates. Any strategy promotion still needs the
fresh, frozen protocol above rather than a small Opus match sample.

## Technical implementation sequence

The portal and tracking ship first; changing the default opponent is a separate,
measured delivery. The concrete code work for #826/#827 is:

1. **Executable decision fixtures.** Extend the existing real-engine scenario
   harness (`scripts/arena-scenario.mts` and `scripts/verify/arena-policy-*.mts`)
   with the reviewed AI-01..12 positions. Store acceptable action sets and
   continuation assertions separately from candidate policy scoring. Give every
   result its fixture, deck/rule and policy revisions, seed, seat and evidence link.
   Start with lethal, defense, energy preservation and attack ordering, then
   material, recursion and optional-payment cases.
2. **Repair the bounded search model.** In `src/lib/arena/policy/search.ts`,
   carry defender hand/combo resources forward when normal damage moves Life
   into hand; Critical must not replenish them. Include bounded attacker combo
   choices and their resource costs. The current sampled 0/5k hand prior is an
   explicit approximation: test sensitivity rather than pretending it knows
   unseen card identities. Unsupported triggers/counters must remain outside
   claimed coverage with a safe fallback until modelled and tested.
3. **Improve decision scoring by demonstrated error.** Refine `policy/main.ts`,
   `combat.ts` and `choices.ts` for affordable follow-up plays, survival through
   multiple attacks, material opportunity costs and useful recovery targets.
   Introduce reviewed effect features only where the engine's supported behavior
   and the permitted observation justify them; do not infer strategic value just
   from keyword presence or parse arbitrary printed text as a rules shortcut.
4. **Preserve the policy boundary.** The production policy continues to receive
   `PolicyInput` from `policy/boundary.ts` and choose legal menu answers. It must
   not import live engine state or inspect hidden hands/Life/deck order. Keep its
   RNG independent, work/memory caps and exact fallback. Any future real-engine
   rollout adapter requires a separately reviewed information-set design; passing
   the current full match to search would violate this contract.
5. **Automate evidence ingestion.** Extend the evaluation/scenario runners to
   emit a versioned run manifest and compact result artifact, then add an
   authenticated idempotent import into the testing store. This is future work:
   today's portal supports manual evidence/results and existing server-game stats,
   and does not silently upload device journals. Keep replay/private state in
   restricted artifacts and show aggregate metrics plus evidence links.
6. **Measure and enable.** Run `scripts/arena-policy-eval.mts` with frozen settings
   and fresh paired holdouts, retaining per-archetype uncertainty and known tactic
   failures. Measure browser Worker latency and fallback rates. Only a passing
   candidate changes the default selected by `src/lib/arena/local/worker.ts`;
   stamp the policy version in new runs and preserve reproducibility of old ones.

The paid Opus adapter comes after the free fixture baseline: restricted observation,
legal action IDs, exact model identity, per-request usage ledger, retry accounting
and a worst-next-call budget reservation. Review disputed lines by replaying
alternatives. It is a diagnostic comparison, not the implementation of the free
local opponent, and its explanation alone cannot mark a benchmark passed.

## Next technical improvement batch

Use development cases to improve useful search coverage before increasing depth.
Record searched/fallback decisions by window and unsupported reason; cache complete
resource-subset frontiers within each decision while preserving common samples,
deterministic ties, the 4096-node/256 KiB bounds and exact fallback behavior. Depth
three showed no development advantage, so deeper search alone is not the next step.

Use engine-offered combo costs and explicit energy-marker facts. Retain the
heuristic when its useful activation is outside the search model. Before modeling
Dual/Triple Attack, expose public keyword parameters and remaining-use facts,
keeping unknown values explicit. Add engine-checked cases for equivalent payments,
preserving defense against a second threat, activation versus combo, and multiple
attacks. Define objectives and acceptable lines before scoring a candidate.

Compare caching, resource corrections and their combination on development seeds;
retain every failed or unfinished attempt. Freeze the reviewed candidate, verify
browser budgets, and reserve new untouched seeds before another strength claim.
Continue named-deck rule/scenario qualification alongside this work. An Opus
adapter must use the same restricted observation/legal-action boundary, a pinned
model and verified token-category rates, request reservations and campaign caps;
paid execution awaits an agreed spend limit.
