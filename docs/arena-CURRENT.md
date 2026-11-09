# Arena current state

Last updated: 19 October 2026

## Current work

**Offline opponent, 8 Nov 2026 (PR #1250).**

- **Strength gate.** It is now the SPRT (`docs/arena-policy-sprt.md`).
- **Normal and Hard.** The offline match setup has a "Computer's skill" choice: Normal and Hard, a
  real-engine lookahead (`docs/arena-lookahead.md`).
- **Hard and Normal v2 pass the gate.** They score lines by a win probability fitted from self-play.
  Fresh seeds, PASS for both, 0 integrity failures:
  - Hard (gate 2): +101 Elo (+43 to +166) over the heuristic.
  - Normal (gate 3): +129 Elo (+59 to +211).
- **v3 passed both gates.** Combo-lethal attacks are shortlisted, and all five strategy subcases pass.
  - Hard (gate 4): +126 Elo (+58 to +205).
  - Normal (gate 5): +147 Elo (+73 to +237).
- **v4, shipped, fixes the SD15 mirror.** Margin 3, and sure wins are always taken.
  - Hard (gate 6): +104 Elo (+45 to +170).
  - Normal (gate 7): +77 Elo (+27 to +131); the mirror +137.
  - Every matchup is zero or positive.
- **v5 adds the defensive search** (combo, block or counter in the other seat's turn).
  - +137 over v4 itself on development seeds.
  - Hard (gate 8): +115 Elo over the heuristic (+50 to +188).
  - Normal (gate 9): +168 Elo (+86 to +271).
- **All 12 strategy benchmark families are built** (9 Nov 2026): 70 engine-solved cases in
  `npm test`, with a pass ratchet. Heuristic 30, Normal 62, Hard 62. Still failing: AI-07 (Evolve and
  Fusion materials for the next turn) and three AI-11 risk cases.
  (`docs/arena-strategy-validation.md`).
- **v7, shipped, is what the benchmarks taught the search.**
  - Card choices are searched (v6).
  - A Main-Phase decision with the next turn's defence at stake is scored after that turn.
  - No sure loss is kept.
  - Attacking combos are searched.
  - **Combat v5** keeps a Negate for the bigger attack still to come.
  - Gates against the heuristic: Hard (gate 10) +152 Elo (+74 to +248); Normal (gate 11) +123 Elo
    (+56 to +201).
  - Against v5's search on development seeds: −7 (−76 to +62), no measured difference.
  - Normal's SD15 mirror cell is −27 (−121 to +64): the one to watch.
- **v8, shipped** (9 Nov 2026).
  - Plans through the next turn (AI-07 3/6), a survival trigger, and a horizon bug fix.
  - Heuristic main v3 (an Evolve is a play) and combat v6 (plan cards kept out of combos).
  - Hard v8 passes gate 12: +251 Elo (+136 to +456).
  - Normal v8 has no gate of its own (the owner stopped after gate 12; Normal v7 passed gate 11).
  - Benchmarks 64 of 70 for both difficulties.
- **Latest releases** (BT27–BT31, `scripts/arena-latest-decks.mts`).
  - White Cell, Gogeta and Cooler play to the end; five decks stop at unread clauses.
  - Hard v8 beat the heuristic 17–1 there, and Normal v8 15–3.
  - Engine caches made searches on these cards about 5× faster.
- **Combat v4** stops unaffordable-defense combo waste; the heuristic now passes AI-02.
- **Not done.** The paid Claude pilot was skipped by the owner; its script stays available.

Follow the [rules delivery plan](arena-rules-delivery.md) and #907. The bounded
#897 corpus qualification is complete; persisted executable rules remain the
authority. PR #1083's typed Absorb contract is deployed; its separately approved
one-record update is applied and verified. PR #1084 adds distinct typed Potara
identity/materials for BT2-012/front/0 through the existing Union machinery.
Its separately approved rule10297 v1→v2 update is applied, with 76 actual-record
scenarios passing on the deployed source. Deployed PR #1085 implements the
shared EX23-36/P-519 conditioned Fusion Drop-to-bottom permission, retaining
materials-before-remaining-price and private bottom order. Its four-record
program repair is separately approved and applied; full-field readback matches
the approved plan and 116 actual-record scenarios pass.

#897 is closed after deployed #1071 and guarded record application. The actual
stored BT6 Gogeta / Br Fusion versus Paragus / Broly pair completed 16/16 frozen
games, with 316 targeted scenarios passing. The exact pair, application,
protected-record preservation and Testing & stats import are recorded in the
[qualification receipt](arena-backlog/evidence/907/typed-use-validity-2026-10-19/README.md).
This qualifies that pair and those pinned inputs; it does not qualify every deck
or every current starter record. The earlier [baseline](arena-backlog/evidence/897/baseline-2026-10-19/README.md)
and [selected inputs](arena-backlog/evidence/897/selected-pair-inputs-2026-10-19/README.md)
remain dated evidence of the blockers and sources used before application.

#1073's [typed defensive decision facts](arena-backlog/evidence/899/typed-decisions-2026-10-19/README.md)
are deployed. #899's fresh, fixed comparison is complete: **162 wins / 158 losses**
over 320 completed games. Its 14 won-both / 12 lost-both decisive pairs give a
95% interval of **35.5–71.2%**, so the strength gate is not passed.
[Full paired results](arena-backlog/evidence/899/fresh-holdouts-2026-10-19/RESULTS.md)
retain the original source pins, all consumed seeds and zero integrity failures.
All eight cells remain underpowered. No new difficulty/default promotion is made;
Worker performance remains unmeasured and known unaffordable-defense combo waste
is unchanged. #899 closes as an inconclusive completed experiment.

Combat policy v4 (8 November 2026, `src/lib/arena/policy/combat.ts`) addresses
that named combo-waste limitation: a defensive cover is paid for only if the seat
could still hold the target through the opponent's other active attackers this
turn, read from the public board and its own hand; otherwise the cheapest cover
that does hold is taken, or the hit is taken and the cards kept (AI-02's "allow
the first hit, survive the Double Strike"). The six #899 defensive variants stay
18/18 (both unaffordable variants now keep the card), the four tactical cases
12/12, and `arena-policy-combat.mts` gains a combo-waste reproducer with controls.
The strategy proof still pins the heuristic as failing AI-02, which v4 now passes;
that pin awaits review. Strength is **not measured**: no gain is claimed until a
paired comparison runs. `LOCAL_POLICY_VERSION` is now `main2+combat4+choices2`, so
offline matches saved under `main2+combat3+choices2` are refused on resume.
#929/#930 have implementations and #932 is closed after final integrated validation;
their issue bodies retain their separate scope.

The owner separately approved and applied 19 metadata-only updates: eight #825
records and eleven #923 reference records. Actual readbacks preserve their
programs, prices, statuses and review fields, including the two confirmed Ape
records. The [#825 application receipt](arena-backlog/evidence/825/metadata-2026-10-19/application-receipt.json)
and [#923 application receipt](arena-backlog/evidence/923/metadata-2026-10-19/application-receipt.json)
record the distinct approvals and exact snapshots. #825's bounded reconciliation
is complete, with its final actual-record evidence recorded. #923 remains open:
BT3-070 front #0 is now v10 with recorded Absorb identity. Its
[separate application](arena-backlog/evidence/907/absorb-identity-2026-10-19/application-receipt.json)
preserves all original bodies and private review fields; the exact actual record
passes 66 scenarios on the deployed engine. The earlier eleven-row metadata
application is complete and must not be repeated.

The [bounded Potara proposal](arena-backlog/evidence/907/potara-identity-2026-10-19/README.md)
adds only identity/material and admission metadata to rule10297, BT2-012/front/0,
v1→v2. Its 76 actual-record scenarios pass, including ordinary seven-energy
play alongside native five-energy Potara. The other two stored Vegito records
are excluded. Original #925/#927/#929/#930 controls pass. The historical #926
refusal-category failure is repaired by the bounded
[unread Fusion diagnostic fix](arena-backlog/evidence/907/unread-fusion-diagnostic-2026-10-19/README.md):
the unchanged original verifier now passes. This is
not a whole-card, whole-deck or complete Union certification. Its production
deployment is READY and the separately approved
[actual application](arena-backlog/evidence/907/potara-identity-2026-10-19/application-receipt.json)
is verified. The
[Drop-to-bottom batch](arena-backlog/evidence/907/fusion-drop-bottom-2026-10-19/README.md)
is applied and verified for its two activation/support pairs; both support
records are now draft with empty unread clauses. Other indexed #923/#930
acceptance remains open.

Earlier #1066–#1068 deliveries are historical checkpoints, not pending drafts:
[typed activated payment](arena-backlog/evidence/907/typed-payment-2026-10-19/README.md),
[Fusion's material-before-cost checkpoint](arena-backlog/evidence/907/fusion-checkpoint-2026-10-19/README.md)
and [stored Fusion material authority](arena-backlog/evidence/907/fusion-materials-2026-10-19/README.md).
The [combo qualification receipt](arena-backlog/evidence/907/combo-qualifications-2026-10-19/README.md)
records the deployed #1070 slice; #1071's combined qualification supersedes its
old pending migration/application queue. Other obsolete records still require
separate reconciliation and authorization.

#827 holds later recipe/scenario expansion. #900 owns computer-play acceptance
(#898 is closed). #906 owns the separate API campaign, still gated on a qualified
corpus and preflight; the approved $20 pilot / $100 inclusive total is unchanged.
The original backlog reconciliation made no paid calls or database accesses;
subsequent scoped reads/applications are recorded in the receipts above.

The [15 October audit](rules-audit-2026-10-15/README.md) and later #907 comments are
dated evidence, not today's live counts. Readability, execution, semantic proof,
current stored programs, human confirmation and AI strength are separate measures.

The original delivery programme #581 is complete. All eight child trackers are closed;
#518 and provider tracker #511 were accepted after the owner confirmed production testing works.
The continuing programme is [O5, #637](arena-backlog/o5-tracking.md), which links the
single owners above rather than dispatching another overlapping queue.

- The rules VM is the only engine; #118 retired the legacy engine.
- Arena plays Masters (`dbs`) and Fusion World (`fusion`), each by its own ruleset. Current work:
  the [Arena F1 milestone](arena-fusion-world-plan.md), the four launch starter decks; it is done when
  they play each other, hot-seat and against the local policy, in `npm test` and `arena:fuzz --game fusion`.
  Open: the owner's data tasks (#1191) and the last starter gaps (#1208).
- Player-selected automatic offline deck qualification is delivered in #793. The owner waived
  its remaining production phone test; do not reopen that test as a delivery requirement.
- The approved phone design is delivered in #808. Prototype #788 and superseded draft PRs
  #789/#807 are closed; their unmerged source branches are retained.
- Native Android development was cancelled by the owner. Its closed tickets do not claim a client.
- World Peace and bounded Life choices shipped in #823. The owner-approved live refresh updated
  26 stored rules and the World Peace catalog erratum; 46 untargeted records stayed unchanged.
  [Refresh receipt](arena-backlog/evidence/backlog-completion/rule-refresh.json).

## Reliability and scope

A readable compiler result is not proof of correct play. Qualification checks missing records,
unread effects, known runtime gaps and missing inputs before offline deck preparation; real
match runs and card-specific scenarios remain necessary to find interactions it cannot predict.
The current coverage work records typed interruption causes and reproducible private replay
artifacts, and can repeat a captured real-deck corpus without further database reads.

PR #824's optional exact-count fixes and application are historical delivery evidence;
do not repeat a refresh from this handoff. For any new application, reconcile current
source/program versions with the receipt and preserve corrected/confirmed user rules.

Opponent search must use only the restricted observation, keep its RNG separate, return legal
engine actions, respect work budgets, and fall back to the existing heuristic. Difficulty labels
require measured gains; tactical success alone does not establish stronger general play.

## Coverage plan and progress

The persisted page **Arena → Testing & stats** (`/arena/testing`, admin access) tracks
64 recipes, 55 scenarios, progress/evidence and separate manual/server match statistics.
Actual decks can be marked testing and are hidden by default in online and local
new-game selectors; players can opt in. Downloaded decks need Update after a flag change.
Local match results remain device-only until manually recorded.

[Testing progress](arena-testing-progress.md) retains recipe/scenario and strategic
evidence. Expansion beyond the selected pair is backlog, not a prerequisite of
the current increment. Candidate lists, exercised skills, qualified decks and
paired strength results each retain their own status.

## Entry points

Read [agent-brief.md](agent-brief.md), the arena-work skill, and [arena-tooling.md](arena-tooling.md).
[Capability inventory](arena-capability-inventory.md) records narrow evidence, not full-catalog
support. [Tooling evaluation](arena-agent-tools-evaluation.md) assesses MCP specifically for
agent development/testing: existing native commands suffice; compact replay output addresses
the measured context cost.

Older dated queues in delivery plans and handovers are history. Current GitHub issue state and
this short handoff supersede their stale dependency, network-access and device-test claims.
