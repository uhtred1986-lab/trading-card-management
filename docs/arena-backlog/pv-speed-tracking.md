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
- [x] #568 **P2** — Skip unchanged snapshot loads with revision-aware polling
- [ ] #569 **P2** — Share immutable derived evaluation by match revision
- [ ] #570 **P2** — Preview a gameplan without committing moves


## Order and hot files

#565/#567/#568/#607 are delivered; #566 is partial. PR #619 avoids unchanged projections with an explicitly negotiated 204 response after authorization, preserving old-tab JSON behavior and revision-check cadence. Local modeled post-auth evidence shows 19 → 18 SELECTs per 15 seconds; hosted timing remains unclaimed. #569 follows this delivered polling contract and #570 follows the ability/layout contracts.

Dependencies in each issue are merge gates; sequence above also serializes shared files. Never run two writers on the same engine flow, costs, snapshot/actions, stage/page, shared sheet, glossary, verify fixture or schema migration. Use at most three separate worktrees/branches after checking full touch sets; workers do not spawn nested agents. Engine/compiler workers also coordinate glossary and named scenario files even when not listed explicitly.

## Acceptance

- [ ] All child acceptance has reviewed evidence, rather than a closed label alone.
- [ ] Contract/privacy, stale/reload cases and cross-feature interactions pass.
- [ ] Applicable before/after screenshots and local checks are attached; production/paid evidence is identified as owner-run.
- [ ] Milestone checklist and canonical backlog files match delivered state.

## Measured checkpoint follow-up

- [x] #607 **P1** — Profile and reduce repeated evaluation in corrected zero-power checkpoints (bounded child of #569; independent of polling #568). Isolated same-fixture apply improved from 656.847/887.796 ms to 83.144/95.482 ms p50/p95; state, event, legal/rejected-action and masked-view hashes match. Reports are [baseline](evidence/607/checkpoint-cache-baseline.json) and [optimized](evidence/607/checkpoint-cache-optimized.json); PR #612 is merged and production-deployed; the separate clean-stack paired run measured 628.709/791.338 ms to 72.133/80.835 ms. Both are local fixture measurements, not hosted/device timing. Preserve rule processing and verify invalidation/interaction outcomes.
