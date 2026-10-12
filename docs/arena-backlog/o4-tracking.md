---
title: [Tracking] Arena O4 — Verified offline MVP release
issue: 636
milestone: Arena O4 — Verified offline MVP release
labels: backlog, epic, area:arena-contract, phase:arena-home, model:opus-5
stage: offline-o4
tracking: true
---
**Source:** `docs/arena-offline-plan.md` §O4; user-provided `create-offline-milestones.py`; `docs/agent-brief.md`.

**Intended milestone:** Arena O4 — Verified offline MVP release. Creation/assignment remains pending because the environment blocks api.github.com before authentication; the available GH_TOKEN is already used by the CLI.

## Outcome

Audit two curated Masters decks early and package all required definitions, executable rules, generated-card dependencies and artwork. Reuse existing correctness issue owners for blockers. Deliver a dedicated cached offline shell, complete/versioned pack downloads, removal and local-data controls. Depends on O1-O3 for release; deck auditing can start during O1. Exit: prepared app cold-launches in airplane mode and completes supported matchups in both seats on desktop and a target phone, including reload/update/worker/storage failure cases. Measure latency, responsiveness and memory against spike-established budgets. Full-catalog support and Fusion World are outside MVP scope.

## Agent-sized implementation issues

- [ ] #649 — O4-01: Audit two curated Masters decks and map offline blockers
- [ ] #655 — O4-02: Build complete versioned offline deck packs
- [ ] #658 — O4-03: Install, verify and update offline packs atomically
- [ ] #659 — O4-04: Deliver a dedicated offline shell with safe service-worker updates
- [ ] #660 — O4-05: Add offline preparation, storage and local-data controls
- [ ] #661 — O4-06: Verify the airplane-mode MVP and publish the support matrix

## Order and hot files

- **O4-01 / #649:** ready now; primary ownership: `docs/arena-offline-deck-audit.md`.
- **O4-02 / #655:** after #649, #640; primary ownership: `scripts/build-arena-offline-pack.mts`, `src/lib/arena/local/pack.ts`.
- **O4-03 / #658:** after #655, #653; primary ownership: `src/lib/arena/local/pack-store.ts`.
- **O4-04 / #659:** after #648, #658; primary ownership: `src/app/arena/offline/page.tsx`.
- **O4-05 / #660:** after #656, #659; primary ownership: `src/components/arena/OfflinePreparation.tsx`.
- **O4-06 / #661:** after #660, #657, #651, #643; primary ownership: `docs/arena-offline-release.md`.

Dependencies are acceptance/merge gates, not just recommended reading. Remove `blocked` and apply `ready-for-agent` only after predecessors are delivered and current hot-file conflicts checked. Shared replay/snapshot/engine entry points, policy contract, board stage, service worker and scenario harness require one writer at a time. O4's deck audit starts early; it does not wait for O3. #648 waits for the active #564 board work. Existing correctness owners in #581/#577/#539 retain their scope; completed #547 replay work is extended, not reopened.

## Acceptance

- [ ] Every child acceptance has reviewed evidence and canonical backlog status matches delivered state.
- [ ] The phase outcome above is demonstrated, with unperformed physical-device/live-data/paid checks explicitly open.
- [ ] Required predecessor phases and pack-specific correctness blockers are resolved before release. O5 is post-MVP; its MCP item is an evidence-based go/no-go evaluation, not an implementation prerequisite.

A tracker is not an implementation assignment; pick one child issue and follow `docs/agent-brief.md`.
