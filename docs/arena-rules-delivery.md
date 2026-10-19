# Rules reliability and deck delivery

Reconciled 19 October 2026 against main `48dd48e3`, the open issues and their
delivery comments. This is the current rules/AI execution order under #907 and
#637. Older delivery plans and census rounds are evidence, not competing queues.
This change is planning and backlog reconciliation; the gates below still need
implementation. No engine improvement or production refresh is claimed here.

## Why work keeps returning

The compiler and VM have delivered substantial reusable behaviour. The recurring
problem is that "read", "implemented", "reviewed", "stored", "exercised" and
"qualified" have been used as if they meant the same thing.

- [17 October triage](https://github.com/uhtred1986-lab/trading-card-management/issues/907#issuecomment-6235968236)
  classified 78 rules that stopped reading: **75 exposed old misreads, three real
  regressions**. Losing a false positive is a correctness gain, but still a
  support gap. Report both facts.
- Later public compiler reports on a stated 13,556-skill denominator went from
  1,774 unread to 1,604. These are reported snapshots, not a controlled comparison
  of identical catalog bytes, and not production stored-rule counts.
  [Latest round](https://github.com/uhtred1986-lab/trading-card-management/issues/907#issuecomment-6253050352)
  reports 1,426 normalized first-clause wordings with no bucket above four:
  another frequency-led wording sweep has diminishing returns.
- #907's old body still dispatched completed work and said every agent was
  paused. #929, #930, #932 and #899 described missing implementations that are
  now in main. Code delivery and unresolved acceptance must be stated separately.
- Stored costs are not fully authoritative: `rules-store.ts`'s `priceOfRow`
  retains condition/program/X/payment sources but drops other cost fields;
  activation/payment and trigger qualification still consult parsed printed
  skills. A reviewed program can therefore have another source of meaning.
- `compile/effects.ts`'s connective handling can consume prohibitions without
  executable behaviour. An empty unread list is not a semantic proof.
- `rules-progress.ts` counts existing rows; it cannot establish that every
  expected front/back skill exists and matches current source text.
- `scripts/arena-corpus-freeze.mts` already pins compiler-based starter packs.
  Its named-gap gate equates non-open/non-draft status with a refreshed row;
  `bundleFor` executes fresh compilation, even when stored rows were supplied.
  A refreshed compiler draft can be rejected, while a stale confirmed row is
  insufficiently checked. That cannot certify the deployed stored program.

The architectural response is to finish the existing declarative rule boundary,
not replace the VM with SQL or another engine. SQL-like selection and reusable
operations are useful; timing, payment, choices, replacements and persistence
need explicit game semantics.

## One owner for each outcome

| Owner | Remaining outcome | Scheduling |
| --- | --- | --- |
| #907 | Rules correctness, regression ledger, canonical executable records, bounded shared-mechanic fixes | Primary rules queue |
| #897 | Exact frozen inputs/programs, honest admission, two controls plus one additional deck pair | Immediate baseline work; extend existing #1030 tooling |
| #923 | Union inventory and evidence matrix | Audit/reconcile existing children; not a second implementation queue |
| #929 / #930 | Residual Union Counter and support acceptance after #1017 / #1019 | Reproduce only unproved cases before writing code |
| #932 | #989, recorded 25-row refresh and final integrated validation | Completed 19 October; issue closed |
| #825 | Reconcile eight named targets with later application receipts and remaining deck evidence | Code already delivered in #834; no blanket repeat refresh |
| #899 | Fresh strategic holdouts after the delivered #1026 defensive fix | After a reliable corpus; no renewed White Kamehameha implementation |
| #827 | Additional candidate recipes/scenarios | Expansion backlog; next pair belongs to #897 |
| #906, #901–#905 | Paid comparison runner, budget, protocol, execution | Outside this rules increment; execution after #897 and $0 preflight |
| #637 / #900 | Programme/navigation and visible computer-play acceptance | Link owners; do not duplicate their assignments |

#826 remains closed with a valid negative strength result. #898 remains closed.
The owner-waived #793 phone test stays waived. Paid caps remain **$20 pilot /
$100 inclusive total**; no new budget decision is needed within those limits.
This reconciliation does not dispatch a paid run or change unrelated UI work.

## Sequence and bounded exits

#897 remains open across steps 1–3. Freeze and classify failures first, repair the
shared record/runtime boundary in #907, then rerun qualification. Closing #897 is
not a prerequisite for starting the scoped #907 repair; that would create a
dependency cycle. Policy holdouts wait for the completed qualification exit.

### 1. Freeze evidence and make the gate honest — #897, reporting in #907

Reuse the starter pack and corpus command delivered by #1030. Freeze one catalog
snapshot, expected card/face/skill manifest, errata revision, ruleset, engine,
policy, seeds, move limit and exact program hashes. Record compiler-generated
and stored-program runs as different modes.

For stored-program qualification, load the complete exported rows through the
same loader used for matches. Validate all expected skills on both faces,
printed-source hashes and required cost/trigger fields. Missing/stale records
remain explicit. A draft can be current without being human-confirmed; neither
a status nor a historical refresh receipt alone establishes current semantics.

Use the two existing starter controls first, then name exactly one additional
pair from the existing prepared recipes/current-deck priority. Record its exact
lists and blockers before repair begins. Keep private owner lists/replays private.
Do not add all 16 recipes, booster expansion or every discovered gap to this exit.

**Exit:** reproducible baseline, explicit compiler-versus-stored provenance,
honest missing/stale/review states, and a reviewed fixed scope for the next pair.
A deliberately refused deck is an accurate baseline, not a successful release.

### 2. Make one executable record authoritative — #907

**First reference family: Union**, following the owner's 19 October feedback.
Reuse the delivered Fusion/Potara/Absorb code and tests. Establish one explicit
contract per variant, with shared selection, payment, Counter/replacement and
persistence machinery. Support cards modify typed source permissions, costs,
material constraints and triggers. Preserve variant-specific payment order,
source transfer, stack/carryover and failed-entry rules; normal play remains a
separate legal route. #923 owns one matrix with positive/negative modifier cases
and unaffected-variant controls. This is not a mandate to reimplement closed
Union fixes or certify all 229 cards in the first slice.

Migrate incrementally within the existing language, loader and VM:

1. Preserve complete typed costs, activation areas, limits, trigger predicates
   and bindings in a versioned executable rule. First vertical slice: an
   activated skill's full payment contract through draft, persisted row, loader,
   legal offer, payment and replay. Follow with trigger qualification.
2. Make every consumed meaningful clause emit a supported effect, predicate,
   timing/cost/restriction component, or an explicit unsupported diagnostic.
   Exempt verified reminder text narrowly. Include a prohibition that currently
   disappears as a negative regression fixture.
3. Make review progress use the expected skill/face manifest and current source
   identity, so one confirmed row cannot certify a multi-skill card.
4. Keep timing-sensitive domain operations explicit, and lower reusable surface
   syntax/macros once before execution into the same typed program. Extend the
   existing operation schema as the shared contract for validation, execution
   and policy-visible summaries. Retire alternate interpretation paths as their
   equivalents pass the frozen cases; avoid a wholesale interpreter rewrite.

Do not rewrite every card at once. Preserve old pinned saves with explicit
format/version compatibility; migrate compiler-owned rows through existing
guarded tooling and keep owner/Claude corrections protected.

**Exit of each slice:** full printed text → persisted/reloaded record → real VM
proof, plus positive, negative, payment-failure and save/reload cases. Mutating
the recorded cost must change payment; changing display wording alone must not.
No unexplained failures in previously verified cases. Update the glossary.

### 3. Deliver the selected pair — #897 with repairs owned by #907

Fix only blockers of the frozen pair (or a demonstrated regression of a verified
case), one shared semantic family per batch. Reconcile #825 and Union receipts
before doing already-delivered work again. Other discoveries enter the existing
card index with a reproducer and owner; they do not enlarge the current batch.

**Exit:** complete inputs and current programs, targeted skill/interaction proofs,
both-seat deterministic games and saved-state replay. Report completed, illegal,
interrupted, limited and crashed outcomes separately. Move-limited games cannot
be counted as completed qualification. A completed game does not prove every
skill fired. Store actual execution coverage separately from deck membership.

Compiler delivery, deployed engine revision and stored-row application each get
their own receipt. Applying a new compiler program does not confirm it on the
owner's behalf. Updating Testing & stats uses the existing supported import path.

### 4. Improve decisions using the same semantics — #899 / #637

Expose typed costs, targets, duration, timing and effect summaries from the
executable program through the masked policy observation. The policy should not
re-read English to rediscover them. Reuse the current legal-action boundary and
privacy/work-budget proofs.

Start with the six existing defensive variants and four real-card tactical
scenarios. Then run fresh paired holdouts with predeclared promotion criteria.
Keep the current heuristic unless measured gains pass. Later bounded search can
simulate the real transition engine under sampled information sets; it must not
see the opponent's actual hidden cards. Full simulation is a later experiment,
not a prerequisite for delivering the selected decks.

**Exit:** measured tactical and holdout improvement with no per-archetype,
privacy, legality or budget regression. Negative results close an experiment;
they do not reopen a completed implementation or justify a difficulty label.

## What a batch must report

Use one keyed ledger over identical frozen input bytes. Keep the old and new
program hash, source hash, rule version, engine revision, scenario expectation,
result and issue/PR for each affected card/face/skill.

| Classification | Meaning and action |
| --- | --- |
| Newly verified | New behaviour has independent expected-result evidence |
| Preserved | Previously verified behaviour still passes |
| True regression | A previously correct case now fails; block the batch |
| Exposed old misread | Old program was already wrong; retain a counterexample, remove the false support claim, track the remaining gap |
| Source/application drift | Catalog/errata/expected-skill set or stored program changed; report separately from compiler behaviour |

Do not enforce monotonically increasing parse percentages. Require preservation
of verified correctness. If an old expected result was wrong, retire it explicitly
with printed/manual evidence and the counterexample; never silently rebaseline
it. Diagnose losses before deciding whether a fix or an evidence correction is needed.

Publish separate measures: fully parsed skills; executable skills; verified
semantic cases; exercised skills in pinned matches; current deployed/stored
programs; qualified decks; human review status; and measured AI strength.
Every percentage names its denominator and input/version. Keep Energy Marker
exclusion consistent, and show raw counts separately.

## Completion and reopening

Before starting, record the issue, frozen scope, missing acceptance and finish
condition. Before ending, record code evidence, application state, deferred
cases and the next single action in the same issue body/local copy.

Close a bounded issue when its acceptance is delivered. A later different card
or interaction is a linked new case under the existing shared queue, not automatic
reopening of every historical issue in that family. Reopen for an actual failure
of the issue's accepted scope, with a reproducer and last passing revision.
Incomplete application or validation remains labelled as such; it is not a new
compiler assignment.

Required implementation checks remain those in `docs/agent-brief.md` and
`docs/arena-tooling.md`: focused scenario proof, full local code gates, applicable
readings/gap and contract review, and authorized cached/live fuzz evidence.
Planning-only reconciliation checks metadata, sources and links; it does not
claim engine acceptance.

## Evidence retained

[Reconciliation and validation receipt](arena-backlog/evidence/rules-reliability-2026-10-19/README.md)
records the full passing local gate and #932's closure. No application code changed.

The [pre-reconciliation issue snapshot](arena-backlog/evidence/rules-reliability-2026-10-19/issues-before.json)
preserves the original requirements, old dispatch text and status for the
rewritten issues. The [15 October census](rules-audit-2026-10-15/README.md) and
[Union inventory](arena-backlog/evidence/923/README.md) remain dated baselines.
GitHub delivery comments/PRs retain application receipts; no live database read
or write was performed for this reconciliation.
