---
title: [P1] Arena delivery: Measured speed and gameplan
milestone: Arena M2 — Gameplay UX/HUD completion
labels: backlog, epic, area:arena-ui
stage: ui
issue: 579
priority: P1/P2
touches:
tracking: true
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-delivery-plan.md`; `docs/agent-brief.md`.

**Priority:** P1/P2. **Existing milestone:** Arena M2 — Gameplay UX/HUD completion (GitHub milestone 2). This is a new delivery increment; completed historical issues remain closed.

**Exit:** Measured acknowledgement, polling and rendering improve without changing legal outcomes or leaking hidden information.

## Issues

- [x] #565 **P1** — Measure arena acknowledgement polling AI and rendering costs
- [ ] #566 **P1** — Acknowledge human actions before resumable AI advance
- [x] #567 **P1** — Record concurrent AI usage atomically
- [ ] #568 **P2** — Skip unchanged snapshot loads with revision-aware polling
- [ ] #569 **P2** — Share immutable derived evaluation by match revision
- [ ] #570 **P2** — Preview a gameplan without committing moves


## Order and hot files

#565 → #566 → #567 → #568 → #569 → #570

Dependencies in each issue are merge gates; sequence above also serializes shared files. Never run two writers on the same engine flow, costs, snapshot/actions, stage/page, shared sheet, glossary, verify fixture or schema migration. Use at most three separate worktrees/branches after checking full touch sets; workers do not spawn nested agents. Engine/compiler workers also coordinate glossary and named scenario files even when not listed explicitly.

## Acceptance

- [ ] All child acceptance has reviewed evidence, rather than a closed label alone.
- [ ] Contract/privacy, stale/reload cases and cross-feature interactions pass.
- [ ] Applicable before/after screenshots and local checks are attached; production/paid evidence is identified as owner-run.
- [ ] Milestone checklist and canonical backlog files match delivered state.

## Measured checkpoint follow-up

- [x] #607 **P1** — Profile and reduce repeated evaluation in corrected zero-power checkpoints (bounded child of #569; independent of polling #568). Isolated same-fixture apply improved from 656.847/887.796 ms to 83.144/95.482 ms p50/p95; state, event, legal/rejected-action and masked-view hashes match. Reports are [baseline](evidence/607/checkpoint-cache-baseline.json) and [optimized](evidence/607/checkpoint-cache-optimized.json); clean-stack PR #612 is reviewed-ready and awaiting merge, so this is not delivered. Preserve rule processing and verify invalidation/interaction outcomes.
