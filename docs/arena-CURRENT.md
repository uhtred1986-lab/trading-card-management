# Arena current state

Last updated: 15 October 2026

## Current work

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

The three historical optional exact-count drafts remain held in production until their corrected
compiler behavior is reviewed and explicitly approved for refresh. They are BT3-109/front/20,
BT6-062/front/10 and SD8-03/front/10. Do not overwrite corrected or confirmed user rules.

Opponent search must use only the restricted observation, keep its RNG separate, return legal
engine actions, respect work budgets, and fall back to the existing heuristic. Difficulty labels
require measured gains; tactical success alone does not establish stronger general play.

## Entry points

Read [agent-brief.md](agent-brief.md), the arena-work skill, and [arena-tooling.md](arena-tooling.md).
[Capability inventory](arena-capability-inventory.md) records narrow evidence, not full-catalog
support. [Tooling evaluation](arena-agent-tools-evaluation.md) assesses MCP specifically for
agent development/testing: existing native commands suffice; compact replay output addresses
the measured context cost.

Older dated queues in delivery plans and handovers are history. Current GitHub issue state and
this short handoff supersede their stale dependency, network-access and device-test claims.
