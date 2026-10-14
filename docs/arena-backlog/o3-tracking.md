---
title: [Tracking] Arena O3 — Offline match runtime
issue: 635
milestone: Arena O3 — Offline match runtime
labels: backlog, epic, area:arena-contract, phase:arena-home, model:opus-5
stage: offline-o3
tracking: true
status: closed
---
**Source:** `docs/arena-offline-plan.md` §O3; user-provided `create-offline-milestones.py`; `docs/agent-brief.md`.

**Intended milestone:** Arena O3 — Offline match runtime. Creation/assignment remains pending because the environment blocks api.github.com before authentication; the available GH_TOKEN is already used by the CLI.

## Outcome

Separate board presentation from session transport while preserving online behavior; implement a Web Worker session with revision validation, bounded work and cancellation; persist pinned inputs/state/actions/policy version/randomness in IndexedDB; connect the existing board to local play. Depends on O1 browser engine and O2 policy. Exit: start, play, save, reload and finish local matches; recovery during choices or AI turns, stale responses, storage failure and multiple-tab ownership verified without duplicate moves.

## Agent-sized implementation issues

- [ ] #648 — O3-01: Separate ArenaStage presentation from online session transport
- [ ] #652 — O3-02: Implement a revisioned local match worker protocol
- [ ] #653 — O3-03: Persist versioned local matches transactionally in IndexedDB
- [ ] #654 — O3-04: Recover interrupted workers and enforce one writer per local match
- [ ] #656 — O3-05: Connect the existing board to local start, resume and finish flows
- [ ] #657 — O3-06: Verify local session recovery across browser failure cases

## Order and hot files

- **O3-01 / #648:** after #564; primary ownership: `src/components/arena/session/contract.ts`, `src/components/arena/session/online.ts`.
- **O3-02 / #652:** after #641, #651; primary ownership: `src/lib/arena/local/protocol.ts`, `src/lib/arena/local/worker.ts`.
- **O3-03 / #653:** after #652; primary ownership: `src/lib/arena/local/storage.ts`.
- **O3-04 / #654:** after #653; primary ownership: `src/lib/arena/local/ownership.ts`, `src/lib/arena/local/recovery.ts`.
- **O3-05 / #656:** after #648, #654, #655; primary ownership: `src/components/arena/session/local.ts`.
- **O3-06 / #657:** after #656; primary ownership: `scripts/verify/arena-local-browser.mts`.

Dependencies are acceptance/merge gates, not just recommended reading. Remove `blocked` and apply `ready-for-agent` only after predecessors are delivered and current hot-file conflicts checked. Shared replay/snapshot/engine entry points, policy contract, board stage, service worker and scenario harness require one writer at a time. O4's deck audit starts early; it does not wait for O3. #648 waits for the active #564 board work. Existing correctness owners in #581/#577/#539 retain their scope; completed #547 replay work is extended, not reopened.

## Acceptance

- [ ] Every child acceptance has reviewed evidence and canonical backlog status matches delivered state.
- [ ] The phase outcome above is demonstrated, with unperformed physical-device/live-data/paid checks explicitly open.
- [ ] Required predecessor phases and pack-specific correctness blockers are resolved before release. O5 is post-MVP; its MCP item is an evidence-based go/no-go evaluation, not an implementation prerequisite.

A tracker is not an implementation assignment; pick one child issue and follow `docs/agent-brief.md`.
