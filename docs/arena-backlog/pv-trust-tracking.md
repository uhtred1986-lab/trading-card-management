---
title: [P0] Arena delivery: Match integrity and recovery
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, epic, area:arena-contract
stage: ui
issue: 576
priority: P0
status: closed
touches:
tracking: true
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-delivery-plan.md`; `docs/agent-brief.md`.

**Priority:** P0. **Existing milestone:** Arena M17 — Arena home: Play and Rules Workbench (GitHub milestone 16). This is a new delivery increment; completed historical issues remain closed.

**Exit:** Missing/unsupported skills cannot look verified; interrupted games never look drawn; clients converge after stale or disconnected requests.

## Issues

- [x] #543 **P0** — Verify deck readiness per printed skill and runtime capability
- [x] #544 **P0** — Stop unsupported resolution with a typed interrupted outcome
- [x] #545 **P0** — Use monotonic game revision and action identity across clients
- [x] #546 **P1** — Make reconnection visible and cancel abandoned polling
- [x] #547 **P1** — Pin immutable match rules and export reproducible replay bundles


## Order and hot files

All five implementation children are merged. Verify the epic acceptance against their combined evidence and retain owner-only limits; do not assign completed children again. Authoritative ability availability (#558) now has its #544/#545 prerequisites.

Dependencies in each issue are merge gates; sequence above also serializes shared files. Never run two writers on the same engine flow, costs, snapshot/actions, stage/page, shared sheet, glossary, verify fixture or schema migration. Use at most three separate worktrees/branches after checking full touch sets; workers do not spawn nested agents. Engine/compiler workers also coordinate glossary and named scenario files even when not listed explicitly.

## Acceptance

- [x] All child acceptance has reviewed evidence, rather than a closed label alone. Readiness, typed interruption, revisions, reconnection and immutable replay have explicit source and verification evidence in the five closed canonical child records.
- [x] Contract/privacy, stale/reload cases and cross-feature interactions pass. Combined checks cover per-viewer interruption/replay privacy, revision reconciliation and retries, polling recovery, pinned match inputs and archived corrections.
- [x] Applicable before/after screenshots and local checks are attached; production/paid evidence is identified as owner-run. Child evidence directories contain applicable screenshots and gate results; Android Gradle decoding remains explicitly unverified in pv-t03.md.
- [x] Milestone checklist and canonical backlog files match delivered state. All five canonical children are closed and the programme/delivery records identify completed implementation. Closing this tracker does not claim that the external GitHub milestone object has been closed.

## Combined acceptance close-out — 12 Oct 2026

Reviewed against main `2e95855`: `scripts/verify-readiness.mts`, `scripts/verify/outcomes.ts`, `scripts/verify/arena-revision.mts`, `scripts/verify/arena-live-polling.mts` and `scripts/verify/arena-replay.ts`, with the corresponding implementation and committed child evidence. This completes the scoped integrity/recovery increment; it does not establish exhaustive card or rule support. Real-deck/catalog, paid-provider, physical-device and Android Gradle checks remain unclaimed where documented. GitHub milestone-state mutation is unavailable through the connector and direct API is blocked; external milestone closure remains pending. Offline work is separate.
