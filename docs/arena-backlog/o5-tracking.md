---
title: [Tracking] Arena O5 — Expanded deck coverage and stronger play
issue: 637
milestone: Arena O5 — Expanded deck coverage and stronger play
labels: backlog, epic, area:arena-contract, phase:arena-home, model:opus-5
stage: offline-o5
tracking: true
---
**Source:** `docs/arena-offline-plan.md` §O5; user-provided `create-offline-milestones.py`; `docs/agent-brief.md`.

**Milestone:** Arena O5 — Expanded deck coverage and stronger play. GitHub access is available; historical network-access blockers are superseded.

## Outcome

After the offline MVP, admit more Masters decks through capability and cross-deck scenario verification; fix shared mechanics through existing backlog owners. Add optional bounded search/difficulty using sampled unknown information, strict device budgets and a heuristic fallback. Exit per increment: added decks pass compatibility gates and policy improvements demonstrate measured strength without privacy, rules or performance regressions. Full-catalog support is a continuing coverage goal. Consider a small arena MCP wrapper around proven inspect/scenario/replay commands only if measured agent workflows justify it.

## Agent-sized implementation issues

- [x] #662 — Superseded by owner-selected automatic deck qualification in #793.
- [x] #793 — Automatic deck qualification delivered; the owner waived the remaining production phone test.
- [x] #663 — O5-02: Prototype bounded search using sampled unknown information
- [x] #664 — O5-03: Evaluate search strength and expose evidence-backed difficulty levels
- [x] #665 — O5-04: Measure whether an arena MCP wrapper would improve agent workflows

## Continuing coverage work

- [ ] #825 — Restore the observed Cooler, Trunks and Great Ape rule gaps in current decks.
- [ ] #826 — Model combat resources and demonstrate a stronger opponent on fresh holdouts.
- [ ] #827 — Named release deck pairs, card-level scenarios, clearer deck naming and bounded Opus evaluation; proposed [coverage plan](../arena-deck-coverage-plan.md).

The initial search experiment is delivered with a negative strength result; no new difficulty
was enabled. The MCP development/testing evaluation concluded the existing tools suffice.
The programme remains open for the concrete coverage and strength work above.

## Order and hot files

- **O5-01 / #662:** after #661; primary ownership: `scripts/verify/arena-deck-admission.mts`.
- **O5-02 / #663:** after #661; primary ownership: `src/lib/arena/policy/search.ts`.
- **O5-03 / #664:** after #663, #651; primary ownership: `docs/arena-policy-strength.md`.
- **O5-04 / #665:** after #661, #639, #642; primary ownership: `docs/arena-agent-tools-evaluation.md`.

Dependencies are acceptance/merge gates, not just recommended reading. Remove `blocked` and apply `ready-for-agent` only after predecessors are delivered and current hot-file conflicts checked. Shared replay/snapshot/engine entry points, policy contract, board stage, service worker and scenario harness require one writer at a time. O4's deck audit starts early; it does not wait for O3. #648 waits for the active #564 board work. Existing correctness owners in #581/#577/#539 retain their scope; completed #547 replay work is extended, not reopened.

## Acceptance

- [ ] Every child acceptance has reviewed evidence and canonical backlog status matches delivered state.
- [ ] The phase outcome above is demonstrated, with unperformed physical-device/live-data/paid checks explicitly open.
- [ ] Required predecessor phases and pack-specific correctness blockers are resolved before release. O5 is post-MVP; its MCP item is an evidence-based go/no-go evaluation, not an implementation prerequisite.

A tracker is not an implementation assignment; pick one child issue and follow `docs/agent-brief.md`.
