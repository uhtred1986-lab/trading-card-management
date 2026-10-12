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

The merge campaign resumed after the owner confirmed the prior production deployment finished. Eighteen implementation PRs merged to main, in sequence:

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
| #606 | #540 (partial) | Timed hand-return replacement with bound-target lifetime; owner real-deck/catalog proof remains unclaimed |
| #594 | #571 | Five official trigger/filter readings, preserving face-up Life coverage |

Production deployments are checked one at a time before continuing. An initial #611 deployment failed; the owner reran the unchanged commit `6536778`, and Vercel reported success under deployment `APDCAPzRwZNfzngFGy6oTZLzxJGA`. No speculative code/environment fix was made. Its local full tests, typecheck, lint and build passed, and a read-only audit confirmed the 49-entry migration chain. The final runtime at `973c8e7` passes full tests, typecheck, lint (five existing warnings) and production build. The capability inventory is delivered in PR #593 on main `721ceb2`; its full tests, checker, typecheck, lint/build and generated-source checks pass. The lone rules-only VM oracle exclusion remains explicit.

### Final inventory and progress delivery

PR #593 / #575 is merged and reconciles narrow capability/test metadata against actual merged runtime: 21 scenarios, 5 named runtime gaps and 21 guarded VM source sites. It does not claim exhaustive rules coverage. PR #588 records this programme, delivery state and completed child milestone checklists; it completes the current wave of eighteen implementation PRs plus inventory and progress documentation. Deployment gates are checked sequentially.

The remaining #459 VM oracle, real-deck fuzz, hosted/device timing, Android Gradle and live paid-provider checks remain unclaimed. #566 stays open for broader unknown-provider-outcome acceptance; #540 stays open for its owner verification. #602, #595, #597 and #609 are separate rule follow-ups. The user's original artwork draft is preserved.

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

## Next authorized wave

The owner authorized the next wave after the twenty-PR delivery batch. #549 owns engine Auto cost resolution; #558 owns authoritative ability/decision projection and a read-only availability adapter; #609 audits battle cleanup ordering without concurrent flow writes. Their merged prerequisites are verified. #595/#597/#568 also have merged prerequisites and their stale blocked labels are removed, but shared files remain serialized. #561 follows merged #558 and will hide wrong-window/phase/zone abilities by default while showing timely resource-blocked reasons. The original artwork draft remains untouched.

## Next-wave reviewed delivery

- #614 refreshes stale prerequisite blocks and trackers; #613 records the #609 cleanup audit only. #609 remains open for separate checkpoints and real-card fixture evidence.
- #615 delivers authoritative ability/decision projection (#558); #616 supplies actual cost-frame privacy and pending-state integration proof. #558 is complete at this scope.
- #616 also delivers supported Auto pay/decline/reload and legal replacement-failure behavior. #549 remains open for unsupported price instructions, the bounded search, simultaneous-Auto selection and cost-free secret-area declarations; broader bindings remain #550.
- #618 corrects mixed-window Counter availability and displays known native Counter payment costs without changing the legal action menu.
- #619 delivers revision-negotiated unchanged polling responses (#568), preserving authorization and legacy-tab behavior. Local measurements are explicitly modeled post-auth; hosted timing remains unclaimed.
- #620 delivers color-first Aegis payment and a live additional fee (#595). The issue stays open for action-price programs and optional/competing pooled replacements; original-color eligibility remains #597. The inventory now has 22 narrow scenarios, 4 named runtime gaps and 27 guarded VM sites.

The implementation merge #616 deployed successfully at `a7572e9145beb995dafe73a3377e50569d5ddeba` (Vercel `HyFfFSP1tVAuRgGvyroX9JynjDro`). No deployment configuration fix is claimed.

### Completed current wave and next priority

PR #621 completes #561: current abilities, exact known costs and Activate/Counter controls in shared review; wrong timing stays collapsed. It includes real Senzu/Whis artwork evidence in both skins, phone/desktop, same-view revision refresh, fullscreen paging, keyboard focus and 200% touch scrolling. HTTP transport is mocked; captured legal actions are applied by EngineAPI. The integrated runtime passes typecheck, lint (five existing warnings), full tests and production build; arena suites are 40/40 legacy and 39/40 rules-only with one named VM oracle excluded. #620 deployed successfully at `75a26fb` (Vercel `BkSXgPPvbn2Nvx3qv47jiL8ZbbqS`).

PR #623 records the read-only revision-cache audit for #569. It confirms one legal evaluation followed by two viewer projections and identifies a possible bounded immutable-query memo, with match/revision/engine/input keys and viewer-specific privacy. It implements no cache or measured speed improvement; #569 remains open. PR #625 completes #597 original-colour keyword eligibility and preserves ordinary effective-colour selectors. Both deployed successfully.

The original-colour review confirmed priced Revive pays its extra fee before the hand-colour choice; P1 #624 owns that separate ordering fix. The battle-resource review confirmed public gained energy colours do not affect the existing payment planner; P1 #626 owns that separate correction, preserving Hidden Mode. Both issues have independent current-behaviour boundary assertions and remain open. Serialize these cost writers. P1 #550 still depends on the explicitly partial #549 cost work: assess that prerequisite before assigning binding implementation. #549/#595/#609 remain open with their documented limits; this wave does not claim exhaustive rules or live-deck coverage.


### Battle information and next ready priorities

PR #627 completes #562 with conditional battle stakes, immediate Pass consequences, public life/energy and actor-only exact payment previews. Real-artwork EngineAPI fixtures cover both skins at desktop, phone and short-phone sizes, keyboard interaction, fullscreen inspection, reduced motion and 200% text. The review caught and corrected a hand-covering footer before merge: normal phones expose a real 44-pixel combo tap area, while short/zoomed screens prove actual touch-scroll access. Captured combos update hand, Combo Area and defence power through the engine; occupied board rows retain their footprint and inspection access. Mock HTTP transport and synthetic test Leaders are clearly identified. Kotlin offline decoding remains unverified.

The integrated runtime passes full tests, typecheck, lint (five existing prototype warnings), production build, generated-source and capability checks. Legacy arena suites: 42/42; rules-only: 41/42, with the named legacy-parity VM oracle excluded. The inventory has 25 narrow entries, four named runtime skips and 27 guarded VM sites; the confirmed #624/#626 limitations are active current-behaviour assertions, not fixes or skipped tests. No exhaustive rules, live-deck or hosted performance claim is made.

Next ready P1 work: #626 effective energy payment colours and #624 Revive cost ordering, serialized across shared cost/keyword files; #563 broader phone board/crowded hand can proceed with a separate UI writer now that #560/#561/#562 are merged. #569 remains an audit-only delivery and requires profiling against the new runtime plus invalidation/privacy proof before any cache implementation. Existing partial #549/#595/#609 and prerequisite assessment for #550 remain explicit. The original artwork draft is preserved.
