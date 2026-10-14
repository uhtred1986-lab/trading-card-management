---
title: [P0] Arena delivery: Rule engine correctness
milestone: Arena M5 — Engine capability gaps and advanced mechanics
labels: backlog, epic, area:arena-vm
stage: ui
issue: 577
priority: P0/P1
touches:
tracking: true
status: closed
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-delivery-plan.md`; `docs/agent-brief.md`.

**Priority:** P0/P1. **Existing milestone:** Arena M5 — Engine capability gaps and advanced mechanics (GitHub milestone 5). This is a new delivery increment; completed historical issues remain closed.

**Exit:** Each named mechanic has rule-grounded state, cost, timing and refusal assertions; no supported case silently disappears.

## Issues

- [x] #548 **P0** — Apply zero-power Battle Card rule processing at checkpoints
- [x] #549 **P0** — Resolve Auto skill costs with pay and decline decisions
- [x] #550 **P1** — Carry chosen cost values and targets into skill effects
- [x] #551 **P1** — Offer eligible spent combo cards as Z-Energy
- [x] #609 **P1** — Reconcile remaining Combo-to-Drop versus end-of-battle Auto checkpoint grouping; #551 implements the preceding choices/8-5-4 and explicitly leaves this prior grouping for follow-up.
- [x] #672 **P0** — Resolve card-specific combo Autos at the combo-entry checkpoint; #609 retains the later cleanup grouping.
- [x] #552 **P1** — Implement Counter Counter response chains
- [x] #553 **P1** — Resolve static identity keyword and negation layers
- [x] #554 **P1** — Enforce Heroic once-per-turn use
- [x] #555 **P1** — Keep Aegis payment choices eligible after each selection
- [x] #556 **P1** — Emit face-up life trigger events
- [x] #557 **P2** — Report genuine damage statistics for rules-engine games
- [x] #595 **P1** — Pay Aegis additional skill costs after the colored-card cost (depends on #555; locally reproduced against 22-30-3)
- [x] #597 **P1** — Use original colors for keyword payment eligibility (depends on #553/#555; preserve effective-color selectors)
- [x] #626 **P1** — Apply effective colours to payment planning, preserving Hidden Mode (PR #629; production rerun succeeded)
- [x] #624 **P1** — Pay Revive hand colors before its additional Auto cost (confirmed boundary in #597; distinct from eligibility)
- [x] #602 **P1** — Preserve granted Heroic individual skill identity (depends on #554; printed/copied behavior remains #554)
- [x] #677 **P1** — Charge recognised external activateSkill taxes on normal and invoked activations; PR #769 completes the catalog-card follow-up.
- [x] #683 **P1** — Villainous individual negation and successful Main/invoked/Counter/Auto Extra hooks, with timed/standing grant identity, proven per engine including a saved-session PGlite scenario; source-self and parent continuation proofs are recorded in the child; catalog coverage is bounded to the cited evidence.
- [x] #540 — existing issue; preserve original acceptance and latest rulings
- [x] #541 — existing issue; preserve original acceptance and latest rulings
- [x] #542 — existing issue; preserve original acceptance and latest rulings

## Order and hot files

All listed children are delivered. The earlier partial-delivery notes below each child remain historical evidence; their canonical status is closed. The completion review includes the later #729/#731 Swap price work (PR #740), #730 Unique choice (PR #747), and #804 Auto readiness gate (PR #805).

Future engine gaps need their own issue and bounded evidence; closure does not assert that every possible card or affordability search is supported. Distinct-card Auto price searches retain their documented typed interruption beyond 2,000 visited states.

## Acceptance

- [x] All child acceptance has reviewed evidence, rather than a closed label alone.
- [x] Contract/privacy, stale/reload cases and cross-feature interactions pass.
- [x] Applicable before/after screenshots and local checks are attached; production/paid evidence is identified as owner-run.
- [x] Milestone checklist and canonical backlog files match delivered state.

#557 damage statistics are complete: event-adjacent totals, genuine zero, old/interrupted unavailable, registered PGlite CAS/idempotency and both-skin phone/desktop rendering evidence. The named life-cost runtime gap is removed; later real-deck fuzz evidence is recorded below.

## Completion evidence — 14 October 2026

- Auto price planning: #549 / PRs #706, #708, #735; the stored-row readiness gate was subsequently corrected by #804 / PR #805. The live 41-card comparison admits BT9-031 and DB2-004, with the existing planner refusal guard retained.
- Chosen targets and X across payment/effects: #550 / PR #752. Counter response chains: #552 / PR #756.
- Combo-to-Drop and battle-end checkpoints: #609 / PRs #691, #696, #705; ordinary combo-entry Autos remain #672 / PR #675.
- Aegis cost order and alternatives: #595 / PRs #693, #703, #708, with #762 / PR #767 for printed alternative payments. Activation taxes: #677 / PRs #701 and #769.
- Villainous individual identity, successful Extra hooks and saved-session CAS/idempotency: #683 / PRs #694, #698, #707. Existing legacy limitations are historical after the legacy engine was retired by #118 / PR #754.
- #540, #541 and #542 closed after the owner's 200-game run on `01071ad` reported zero crashes. Union-Fusion and skill-text-name/play-onto fixes are in PRs #755, #753 and #771. Typed interruption outcomes remain distinct from crashes.
- The coordinator gated PR #805 on main plus #803: typecheck, lint, Linux Node 24 full `npm test`, production build and contract emission passed; the 85/85 contract output was unchanged. The live 40-game fuzz run had zero crashes and eight typed interruptions. PR #805 is deployed at `526e55622e7f6c3da122f2c90b8e3c31eff88e85`.
- UI proofs remain with their implementing PRs. This tracker reconciliation changes no UI or runtime behavior. #539's stored catalog reading refresh, #793's real production deck download, and #511/#518's paid provider setup are separate acceptance work and are not claimed complete here.
