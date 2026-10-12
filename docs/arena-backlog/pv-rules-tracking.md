---
title: [P0] Arena delivery: Rule engine correctness
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, epic, area:arena-vm
stage: ui
issue: 577
priority: P0/P1
touches:
tracking: true
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-delivery-plan.md`; `docs/agent-brief.md`.

**Priority:** P0/P1. **Existing milestone:** Arena M5 — Engine capability gaps and advanced mechanics (GitHub milestone 5). This is a new delivery increment; completed historical issues remain closed.

**Exit:** Each named mechanic has rule-grounded state, cost, timing and refusal assertions; no supported case silently disappears.

## Issues

- [ ] #548 **P0** — Apply zero-power Battle Card rule processing at checkpoints
- [ ] #549 **P0** — Resolve Auto skill costs with pay and decline decisions
- [ ] #550 **P1** — Carry chosen cost values and targets into skill effects
- [ ] #551 **P1** — Offer eligible spent combo cards as Z-Energy
- [ ] #552 **P1** — Implement Counter Counter response chains
- [ ] #553 **P1** — Resolve static identity keyword and negation layers
- [ ] #554 **P1** — Enforce Heroic once-per-turn use
- [ ] #555 **P1** — Keep Aegis payment choices eligible after each selection
- [ ] #556 **P1** — Emit face-up life trigger events
- [ ] #557 **P2** — Report genuine damage statistics for rules-engine games
- [ ] #595 **P1** — Pay Aegis additional skill costs after the colored-card cost (depends on #555; locally reproduced against 22-30-3)
- [ ] #597 **P1** — Use original colors for keyword payment eligibility (depends on #553/#555; preserve effective-color selectors)
- [ ] #602 **P1** — Preserve granted Heroic individual skill identity (depends on #554; printed/copied behavior remains #554)
- [ ] #540 — existing issue; preserve original acceptance and latest rulings
- [ ] #541 — existing issue; preserve original acceptance and latest rulings
- [ ] #542 — existing issue; preserve original acceptance and latest rulings

## Order and hot files

#548 → #549 → #550 → #551 → #552 → #553 → #554 → #555 → #556 → #557

Dependencies in each issue are merge gates; sequence above also serializes shared files. Never run two writers on the same engine flow, costs, snapshot/actions, stage/page, shared sheet, glossary, verify fixture or schema migration. Use at most three separate worktrees/branches after checking full touch sets; workers do not spawn nested agents. Engine/compiler workers also coordinate glossary and named scenario files even when not listed explicitly.

## Acceptance

- [ ] All child acceptance has reviewed evidence, rather than a closed label alone.
- [ ] Contract/privacy, stale/reload cases and cross-feature interactions pass.
- [ ] Applicable before/after screenshots and local checks are attached; production/paid evidence is identified as owner-run.
- [ ] Milestone checklist and canonical backlog files match delivered state.
