# Arena current state

Last updated: 15 October 2026

## Current work

New readiness planning (15 October): [execution plan](arena-readiness-plan-2026-10-15.md)
tracks built-in opponent discoverability/reliability (#896–#900), a prepared Claude API
campaign (#901–#906; owner-approved $20 pilot / $100 inclusive total), and the single
unread-rule repair queue (#907). The [live audit](rules-audit-2026-10-15/README.md)
found 1,714 affected cards / 1,985 skills; a guarded 22-skill refresh leaves 1,694
cards / 1,963 unread skills. The eight social-promo rulings are recorded; visible
compliment/acknowledgement implementation remains open. No paid calls ran.

The original delivery programme #581 is complete. All eight child trackers are closed;
#518 and provider tracker #511 were accepted after the owner confirmed production testing works.
The continuing programme is [O5, #637](arena-backlog/o5-tracking.md): reliable deck admission,
bounded opponent search, measured strength, and development tooling.

- The rules VM is the only engine; #118 retired the legacy engine.
- Arena plays Masters (`dbs`), not Fusion World.
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

PR #824 corrects optional exact-count behavior and includes the separately approved follow-up
refresh of eleven compiler records, SD13-05 condition metadata, and two verified specified costs.
The three formerly held records are BT3-109/front/20, BT6-062/front/10 and SD8-03/front/10.
Apply the rule refresh only after the matching production deployment is Ready; the PR closeout
records application and readback. Preserve corrected or confirmed user programs.

Opponent search must use only the restricted observation, keep its RNG separate, return legal
engine actions, respect work budgets, and fall back to the existing heuristic. Difficulty labels
require measured gains; tactical success alone does not establish stronger general play.

## Coverage plan and progress

The persisted page **Arena → Testing & stats** (`/arena/testing`, admin access) tracks
64 recipes, 55 scenarios, progress/evidence and separate manual/server match statistics.
Actual decks can be marked testing and are hidden by default in online and local
new-game selectors; players can opt in. Downloaded decks need Update after a flag change.
Local match results remain device-only until manually recorded.

[Testing progress](arena-testing-progress.md) is the planning index for the proposed
16-deck first wave, 62-deck booster expansion, small scenarios, [general strategic benchmarks](arena-strategy-validation.md), White Cell decision
benchmarks and bounded Opus budget. These are proposed recipes and explicit progress
states, not a claim that new lists or paid comparisons have already run.

## Entry points

Read [agent-brief.md](agent-brief.md), the arena-work skill, and [arena-tooling.md](arena-tooling.md).
[Capability inventory](arena-capability-inventory.md) records narrow evidence, not full-catalog
support. [Tooling evaluation](arena-agent-tools-evaluation.md) assesses MCP specifically for
agent development/testing: existing native commands suffice; compact replay output addresses
the measured context cost.

Older dated queues in delivery plans and handovers are history. Current GitHub issue state and
this short handoff supersede their stale dependency, network-access and device-test claims.
