---
title: [P0] Arena delivery: Match integrity and recovery
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, epic, area:arena-contract
stage: ui
issue: 576
priority: P0
touches:
tracking: true
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-delivery-plan.md`; `docs/agent-brief.md`.

**Priority:** P0. **Existing milestone:** Arena M17 — Arena home: Play and Rules Workbench (GitHub milestone 16). This is a new delivery increment; completed historical issues remain closed.

**Exit:** Missing/unsupported skills cannot look verified; interrupted games never look drawn; clients converge after stale or disconnected requests.

## Issues

- [ ] #543 **P0** — Verify deck readiness per printed skill and runtime capability
- [ ] #544 **P0** — Stop unsupported resolution with a typed interrupted outcome
- [ ] #545 **P0** — Use monotonic game revision and action identity across clients
- [ ] #546 **P1** — Make reconnection visible and cancel abandoned polling
- [ ] #547 **P1** — Pin immutable match rules and export reproducible replay bundles


## Order and hot files

#543 → #544 → #545 → #546 → #547

Dependencies in each issue are merge gates; sequence above also serializes shared files. Never run two writers on the same engine flow, costs, snapshot/actions, stage/page, shared sheet, glossary, verify fixture or schema migration. Use at most three separate worktrees/branches after checking full touch sets; workers do not spawn nested agents. Engine/compiler workers also coordinate glossary and named scenario files even when not listed explicitly.

## Acceptance

- [ ] All child acceptance has reviewed evidence, rather than a closed label alone.
- [ ] Contract/privacy, stale/reload cases and cross-feature interactions pass.
- [ ] Applicable before/after screenshots and local checks are attached; production/paid evidence is identified as owner-run.
- [ ] Milestone checklist and canonical backlog files match delivered state.
