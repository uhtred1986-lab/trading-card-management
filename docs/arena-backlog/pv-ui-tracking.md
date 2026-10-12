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

- [x] #558 **P1** — Expose authoritative ability availability and decision data
- [x] #559 **P1** — Make card sheets and action controls accessible
- [x] #560 **P1** — Extend the existing phone pager to tap-open fullscreen review
- [x] #561 **P1** — Show Abilities now and collapse wrong-timing abilities
- [x] #562 **P1** — Make battle stakes resources and pass consequences explicit
- [x] #563 **P1** — Fit the phone board and crowded hand around the current decision
- [ ] #564 **P1** — Consolidate desktop board status and contextual decision panel


## Order and hot files

#559 accessible shared sheet → #560 fullscreen review; after #544/#545, #558 ability contract → #561 timely abilities and #562 battle stakes → #563 phone board → #564 desktop. Review/contract tracks can start separately only with disjoint files.

Dependencies in each issue are merge gates; sequence above also serializes shared files. Never run two writers on the same engine flow, costs, snapshot/actions, stage/page, shared sheet, glossary, verify fixture or schema migration. Use at most three separate worktrees/branches after checking full touch sets; workers do not spawn nested agents. Engine/compiler workers also coordinate glossary and named scenario files even when not listed explicitly.

**Current delivery:** #558–#562 are merged. PR #621 displays timely, server-priced abilities in shared card review, collapses wrong timing and structural refusals, and preserves fullscreen paging. PR #627 adds conditional battle outcomes, actor/window, Pass consequences, public resources and exact payment previews. Reviewed EngineAPI-backed real-artwork evidence covers both skins, phone/desktop, same-view revisions, keyboard access and 200% touch scrolling. Its phone overlap correction compacts only empty lifted rows and keeps actual hand-combo taps plus Pass reachable; occupied rows retain their footprint and inspection access. Broader phone/crowded-hand and desktop consolidation remain #563/#564. Kotlin offline decoding remains unverified because the required plugin is absent from the existing cache.

## Acceptance

- [ ] All child acceptance has reviewed evidence, rather than a closed label alone.
- [ ] Contract/privacy, stale/reload cases and cross-feature interactions pass.
- [ ] Applicable before/after screenshots and local checks are attached; production/paid evidence is identified as owner-run.
- [ ] Milestone checklist and canonical backlog files match delivered state.

**Phone handoff — 12 Oct 2026:** PR #631 is reviewed and locally validated at `c49db4a`; #563 is merged in PR #631. The compact phone board and scrollable/expanded hand preserve tap/swipe fullscreen review and engine-derived abilities. On-demand zone inspection uses additive, viewer-readable server projections with independent both-engine/both-viewer privacy proofs. Actual-artwork before/after evidence covers both skins, desktop, normal/short/small phones, landscape, real Charge/Play drags, 200% touch scrolling, and full consequences/assumptions. Safe insets and keyboard viewport are simulated; physical-device and Kotlin decoding are unverified. Tests/build/typecheck and 45/45 both-engine contract emission pass; five prototype lint warnings remain. PR #629's unchanged rerun and PR #630 deployed successfully. PR #631 deployed successfully at `36a8953` (Vercel `8U6Cmh2msBLuS29KAzb1hLGvgjrJ`). #564's prerequisites are now merged and its separate desktop implementation is active.
