---
title: [Tracking] Arena O1 — Developer efficiency and offline foundations
issue: 633
milestone: Arena O1 — Developer efficiency and offline foundations
labels: backlog, epic, area:arena-contract, phase:arena-home, model:opus-5
stage: offline-o1
tracking: true
---
**Source:** `docs/arena-offline-plan.md` §O1; user-provided `create-offline-milestones.py`; `docs/agent-brief.md`.

**Intended milestone:** Arena O1 — Developer efficiency and offline foundations. Creation/assignment remains pending because the environment blocks api.github.com before authentication; the available GH_TOKEN is already used by the CLI.

## Outcome

Prerequisite foundation for offline Masters play. Correct stale agent/MCP guidance; verify TypeScript definitions/references/diagnostics and browser offline/network/worker tooling; extract portable replay-bundle logic from persistence and runtime lookup; provide a browser-safe rules-only engine entry point with import-boundary checks; add focused deterministic scenarios and compact structured evidence. Exit: browser execution and Node/browser replay/hash parity demonstrated, existing behavior preserved, tooling checks documented. Measure task time/tool calls/context where available; do not promise token savings. Broad file splitting, legacy retirement and a custom MCP server are not prerequisites.

## Agent-sized implementation issues

- [ ] #639 — O1-01: Refresh agent guidance and verify available navigation/browser tooling
- [ ] #640 — O1-02: Extract portable replay serialization and hashing from server persistence
- [ ] #641 — O1-03: Expose a browser-safe rules engine and snapshot entry point
- [ ] #642 — O1-04: Add focused deterministic scenario execution and compact evidence output
- [ ] #643 — O1-05: Measure browser worker latency, responsiveness and memory budgets

## Order and hot files

- **O1-01 / #639:** ready now; primary ownership: `docs/arena-agent-tools.md`.
- **O1-02 / #640:** ready now; primary ownership: `src/lib/arena/replay-core.ts`.
- **O1-03 / #641:** after #640; primary ownership: `src/lib/arena/browser.ts`, `scripts/verify/arena-browser-boundary.mts`.
- **O1-04 / #642:** after #641; primary ownership: `scripts/arena-scenario.mts`.
- **O1-05 / #643:** after #642; primary ownership: `docs/arena-offline-budgets.md`.

Dependencies are acceptance/merge gates, not just recommended reading. Remove `blocked` and apply `ready-for-agent` only after predecessors are delivered and current hot-file conflicts checked. Shared replay/snapshot/engine entry points, policy contract, board stage, service worker and scenario harness require one writer at a time. O4's deck audit starts early; it does not wait for O3. #648 waits for the active #564 board work. Existing correctness owners in #581/#577/#539 retain their scope; completed #547 replay work is extended, not reopened.

## Acceptance

- [ ] Every child acceptance has reviewed evidence and canonical backlog status matches delivered state.
- [ ] The phase outcome above is demonstrated, with unperformed physical-device/live-data/paid checks explicitly open.
- [ ] Required predecessor phases and pack-specific correctness blockers are resolved before release. O5 is post-MVP; its MCP item is an evidence-based go/no-go evaluation, not an implementation prerequisite.

A tracker is not an implementation assignment; pick one child issue and follow `docs/agent-brief.md`.
