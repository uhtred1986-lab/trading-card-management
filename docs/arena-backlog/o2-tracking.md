---
title: [Tracking] Arena O2 — Local heuristic opponent
issue: 634
milestone: Arena O2 — Local heuristic opponent
labels: backlog, epic, area:arena-contract, phase:arena-home, model:opus-5
status: closed
stage: offline-o2
tracking: true
---
**Source:** `docs/arena-offline-plan.md` §O2; user-provided `create-offline-milestones.py`; `docs/agent-brief.md`.

**Intended milestone:** Arena O2 — Local heuristic opponent. Creation/assignment remains pending because the environment blocks api.github.com before authentication; the available GH_TOKEN is already used by the CLI.

## Outcome

Define a provider-independent policy and restricted observation contract; extract existing shortcuts; implement heuristic choices for all decision types reachable in the MVP decks; add tactical, full-match, both-seat and hidden-information invariance evaluation. Depends on O1 scenario tooling and portable boundaries. Exit: deterministic legal decisions and complete supported matches without model/provider calls, hidden-state access or unbounded decision loops. Keep policy randomness separate from game randomness. Establish strength baselines before setting improvement targets.

## Agent-sized implementation issues

- [ ] #644 — O2-01: Define a restricted policy observation and legal-decision contract
- [ ] #645 — O2-02: Extract existing free-choice heuristics into the pure policy module
- [ ] #646 — O2-03: Implement bounded main-phase local play and attack selection
- [ ] #647 — O2-04: Implement local combat responses and resource-aware combos
- [ ] #650 — O2-05: Complete constrained choices, payments and policy decision coverage
- [ ] #651 — O2-06: Evaluate the complete heuristic across seeds, seats and hidden states

## Order and hot files

- **O2-01 / #644:** after #641; primary ownership: `src/lib/arena/policy/contract.ts`, `src/lib/arena/policy/observation.ts`.
- **O2-02 / #645:** after #644; primary ownership: `src/lib/arena/policy/shortcuts.ts`.
- **O2-03 / #646:** after #645, #642; primary ownership: `src/lib/arena/policy/main.ts`.
- **O2-04 / #647:** after #646; primary ownership: `src/lib/arena/policy/combat.ts`.
- **O2-05 / #650:** after #647, #649; primary ownership: `src/lib/arena/policy/choices.ts`.
- **O2-06 / #651:** after #650, #642; primary ownership: `scripts/arena-policy-eval.mts`.

Dependencies are acceptance/merge gates, not just recommended reading. Remove `blocked` and apply `ready-for-agent` only after predecessors are delivered and current hot-file conflicts checked. Shared replay/snapshot/engine entry points, policy contract, board stage, service worker and scenario harness require one writer at a time. O4's deck audit starts early; it does not wait for O3. #648 waits for the active #564 board work. Existing correctness owners in #581/#577/#539 retain their scope; completed #547 replay work is extended, not reopened.

## Acceptance

- [ ] Every child acceptance has reviewed evidence and canonical backlog status matches delivered state.
- [ ] The phase outcome above is demonstrated, with unperformed physical-device/live-data/paid checks explicitly open.
- [ ] Required predecessor phases and pack-specific correctness blockers are resolved before release. O5 is post-MVP; its MCP item is an evidence-based go/no-go evaluation, not an implementation prerequisite.

A tracker is not an implementation assignment; pick one child issue and follow `docs/agent-brief.md`.
