---
title: [P1] Arena delivery: Playable board and fullscreen cards
milestone: Arena M16 — Board redesign: play feel and card review
labels: backlog, epic, area:arena-ui
stage: ui
issue: 578
priority: P1
touches:
tracking: true
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-delivery-plan.md`; `docs/agent-brief.md`.

**Priority:** P1. **Existing milestone:** Arena M16 — Board redesign: play feel and card review (GitHub milestone 15). This is a new delivery increment; completed historical issues remain closed.

**Exit:** Actor, window, stakes and resources are visible; tap/swipe fullscreen review and timely abilities work with real artwork on phone and desktop.

## Issues

- [ ] #558 **P1** — Expose authoritative ability availability and decision data
- [ ] #559 **P1** — Make card sheets and action controls accessible
- [ ] #560 **P1** — Extend the existing phone pager to tap-open fullscreen review
- [ ] #561 **P1** — Show Abilities now and collapse wrong-timing abilities
- [ ] #562 **P1** — Make battle stakes resources and pass consequences explicit
- [ ] #563 **P1** — Fit the phone board and crowded hand around the current decision
- [ ] #564 **P1** — Consolidate desktop board status and contextual decision panel


## Order and hot files

#559 accessible shared sheet → #560 fullscreen review; after #544/#545, #558 ability contract → #561 timely abilities and #562 battle stakes → #563 phone board → #564 desktop. Review/contract tracks can start separately only with disjoint files.

Dependencies in each issue are merge gates; sequence above also serializes shared files. Never run two writers on the same engine flow, costs, snapshot/actions, stage/page, shared sheet, glossary, verify fixture or schema migration. Use at most three separate worktrees/branches after checking full touch sets; workers do not spawn nested agents. Engine/compiler workers also coordinate glossary and named scenario files even when not listed explicitly.

## Acceptance

- [ ] All child acceptance has reviewed evidence, rather than a closed label alone.
- [ ] Contract/privacy, stale/reload cases and cross-feature interactions pass.
- [ ] Applicable before/after screenshots and local checks are attached; production/paid evidence is identified as owner-run.
- [ ] Milestone checklist and canonical backlog files match delivered state.
