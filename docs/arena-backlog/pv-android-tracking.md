---
title: [P2] Arena delivery: Android after web contract
milestone: Arena M4 — Android client enablement
labels: backlog, epic, area:arena-android
stage: ui
issue: 580
priority: P2/P3
touches:
tracking: true
status: closed
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-delivery-plan.md`; `docs/agent-brief.md`.

**Priority:** P2/P3. **Existing milestone:** Arena M4 — Android client enablement (GitHub milestone 4). This is a new delivery increment; completed historical issues remain closed.

**Exit:** #105 and #106 consume the settled auth/snapshot/ability contract with polling and playback parity.

## Issues


- [ ] #105 — existing issue; preserve original acceptance and latest rulings
- [ ] #106 — existing issue; preserve original acceptance and latest rulings

## Order and hot files

#105 waits for #545/#546/#558; #106 waits for #105.

Dependencies in each issue are merge gates; sequence above also serializes shared files. Never run two writers on the same engine flow, costs, snapshot/actions, stage/page, shared sheet, glossary, verify fixture or schema migration. Use at most three separate worktrees/branches after checking full touch sets; workers do not spawn nested agents. Engine/compiler workers also coordinate glossary and named scenario files even when not listed explicitly.

## Acceptance

- [ ] All child acceptance has reviewed evidence, rather than a closed label alone.
- [ ] Contract/privacy, stale/reload cases and cross-feature interactions pass.
- [ ] Applicable before/after screenshots and local checks are attached; production/paid evidence is identified as owner-run.
- [ ] Milestone checklist and canonical backlog files match delivered state.
