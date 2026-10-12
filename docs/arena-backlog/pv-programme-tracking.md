---
title: [P0] Arena delivery programme — correctness, playability and measured speed
milestone: Arena M17 — Arena home: Play and Rules Workbench
labels: backlog, epic, area:arena-docs
stage: ui
issue: 581
priority: P0
touches:
tracking: true
---
**Source:** `docs/arena-playability-review.md`; `docs/arena-delivery-plan.md`; `docs/agent-brief.md`.

Arena delivery backlog reconciled 11 Oct 2026. Priorities: **P0** correctness/trust before verified competitive play; **P1** next core delivery; **P2** measured follow-up; **P3** retirement/native parity after prerequisites. Reuses eight existing GitHub milestones rather than duplicating their work.

## Milestones and tracking issues

- [ ] #576 **P0** — Match integrity and recovery (Arena M17 — Arena home: Play and Rules Workbench); exit: Missing/unsupported skills cannot look verified; interrupted games never look drawn; clients converge after stale or disconnected requests.
- [ ] #577 **P0/P1** — Rule engine correctness (Arena M5 — Engine capability gaps and advanced mechanics); exit: Each named mechanic has rule-grounded state, cost, timing and refusal assertions; no supported case silently disappears.
- [ ] #578 **P1** — Playable board and fullscreen cards (Arena M16 — Board redesign: play feel and card review); exit: Actor, window, stakes and resources are visible; tap/swipe fullscreen review and timely abilities work with real artwork on phone and desktop.
- [ ] #579 **P1/P2** — Measured speed and gameplan (Arena M2 — Gameplay UX/HUD completion); exit: Measured acknowledgement, polling and rendering improve without changing legal outcomes or leaking hidden information.
- [ ] #539 **P1** — Outstanding card readings (Arena M1 — Rules correctness and parser coverage); exit: Every #539 bullet and existing card-specific capability ticket has a bounded owner and deterministic reading proof.
- [ ] #168 **P2/P3** — Independent coverage and retirement (Arena M13 — Retire the legacy engine (Stage 10)); exit: #459 provides fixed rule expectations; saved-game migration and support evidence pass before #118 removes legacy.
- [ ] #580 **P2/P3** — Android after web contract (Arena M4 — Android client enablement); exit: #105 and #106 consume the settled auth/snapshot/ability contract with polling and playback parity.
- [ ] #511 **P2** — AI efficiency and live verification (AI providers — one contract, API or subscription, any vendor); exit: #381 implements the recorded cost ruling; #518 completes owner-run verification of already-built route; #511 records the result.

## Delivery progress — 12 Oct 2026

Previously delivered: #543 in PR #585, #545 in PR #586, and owner-requested duplicate GitHub-check removal #583 in PR #584. Android Gradle and owner real-deck/paid-provider checks remain unclaimed.

The merge campaign resumed after the owner confirmed the prior production deployment finished. Sixteen reviewed PRs merged to main, in sequence:

| PR | Issue | Delivered change |
| --- | --- | --- |
| #587 | #548 | Zero-power checkpoint processing and frozen replacement continuation |
| #590 | #567 | Atomic independent AI usage accounting |
| #589 | #559 | Accessible card/action sheets |
| #604 | #554 | Printed Heroic identity and checkpoint ordering; granted identity remains #602 |
| #599 | #553 | Static/timed identity and named keyword layers |
| #610 | #560 | Explicit fullscreen card inspection, swipe paging and selection-safe review |
| #605 | #547 | Immutable match inputs and private replay export |
| #591 | #546 | Recoverable polling, deadlines and reconnect feedback |
| #608 | #551 | Ordered combo-to-Z-Energy choices and 8-5-4 checkpoint; later ordering remains #609 |
| #592 | #565 | Reproducible local performance baseline |
| #612 | #607 | Bounded checkpoint read cache; clean-stack p50/p95 628.709/791.338 ms to 72.133/80.835 ms with identical recorded state/event/action/view hashes |
| #598 | #544 | Typed interrupted outcomes, privacy and archive/review guards |
| #596 | #555 | Incremental mandatory Aegis choices; cost order/original colors remain #595/#597 |
| #600 | #556 | Face-up Life moments, subject binding and watchers |
| #603 | #601 | Fixed AI request/action-menu expectations; broader VM oracle retirement remains #459/#118 |
| #611 | #566 (partial) | Durable human acknowledgement and saved-result AI recovery; unknown provider outcome is attention-required, never automatically resent |

Production deployments through #603 reported Vercel success before each subsequent merge. Main `65367783708e261eb5742320afdc503db177a048` (#611) reports a failed Vercel deployment: https://vercel.com/gullet-cove/trading-card-management/bgBPdmTokcfWcAY99FyysyDW6P3N. Its final-main local production build and focused face-up Life check pass. This workspace cannot read Vercel logs because its enforced network policy excludes the Vercel API; the first deployment error has been requested from the owner. Do not guess the failure or run the unrelated configured database. Further main merges are held until this deployment failure is resolved.

### Remaining reviewed work

- PR #594 / #571: five official trigger/filter readings; a branch merge briefly lost #556 behavior, caught before merge and restored with focused #556/#571 and full rules checks. Current reviewed candidate: `50113da`.
- PR #606 / #540: timed hand-return replacement, variable-bound lifetime and opponent-turn duration; current reviewed candidate: `0b63263`. The attack-return fixture is synthetic; owner real-deck fuzz remains unrun.
- PR #588 / #581: this delivery progress and milestone reconciliation; ready after final documentation validation.
- PR #593 / #575 remains draft while capability/test metadata is reconciled with the actual merged runtime. Its narrow evidence must not be promoted as exhaustive rules coverage.

The nineteen-source review combination passed full tests, typecheck, lint and build; actual final main is being checked separately. The lone rules-only VM oracle exclusion remains explicit. Local lint warnings, hosted/device timing limits and owner real-deck checks stay recorded. No claim of universal exactly-once provider calls is made.

### Follow-ups and scope boundaries

P1 #595 owns Aegis cost ordering; #597 original-color payment eligibility; #602 granted Heroic identity; #609 later Combo-to-Drop/end-of-battle Auto grouping. #607 is the bounded measured child of broader cache-sharing #569, independent of polling #568. #541 waits for the recorded Union scope ruling. Remaining board gameplan and ability-contract work follows the original dependencies.

## Reconciliation decisions

- Extend completed #348 pager and completed #352/#366 design/home programmes; do not reopen finished issues merely for new scope.
- Split #539 into #571–#574, keeping #539 as the card-ruling/acceptance parent. Do not duplicate #540/#541/#542 or combine distinct mechanics into one PR.
- Shared cost binding is #550; #542 waits for it. Fixed rule expectations #459 precede deletion #118; #575 audits skips/capabilities and #547 provides reproducible old-game handling.
- #105 waits for #545/#546/#558 and current auth contract; #106 is blocked on #105. Contradictory ready/blocked labels removed.
- #381 already has a model-cost ruling; #518 route is already built (#531) and waits for owner-run live verification, not fresh implementation. #511 remains its provider tracker.
- Closed stale #170 after repairing #135/#137 checklist and verifying declaration exit locally (`verify-rules` passed; `verify-arena` 28/28 including lang/rulesets/primer/board-words). Native mill exception is explicitly documented; runtime gaps remain #575.

## Order and hot files

Start P0 #543 readiness, #545 revision and #544 explicit interruption (serialize shared contract edits). #548 zero-power and #549 Auto costs serialize VM flow. Independent accessible review primitive #559 can run with disjoint files; #575 capability inventory provides evidence. Then #558 authoritative ability contract, #560 fullscreen review, #561 abilities, #562 stakes and #563/#564 layouts.

Use child dependencies, one issue/branch/draft PR, at most three disjoint worktrees. Shared flow/costs/snapshot/actions/page/hand/sheets/glossary/fixtures/schema are single-writer files. Do not select three ready issues without checking these overlaps. Worker agents never spawn nested agents. Owner live data/paid/config steps remain explicit; do not block independent local work on them.

Full issue table, dependency references, acceptance and repository filenames are in `docs/arena-delivery-plan.md` and `docs/arena-backlog/pv-*.md`.
