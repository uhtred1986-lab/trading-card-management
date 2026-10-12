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

## Delivery progress — 11 Oct 2026

- #543 delivered in PR #585: per-printed-skill readiness distinguishes missing readings and runtime support.
- #545 delivered in PR #586: authoritative revision, durable action identity and stale-request recovery; Android Gradle validation remains blocked by repository connectivity.
- Owner-requested repository maintenance #583 delivered in PR #584: duplicate GitHub test, BugBot and acceptance workflows removed. Local verification and production deployment remain.

### Reviewed work awaiting merge

- #548 / PR #587: zero-power rule processing, replacement choices and reload continuation.
- #559 / PR #589: accessible card sheets with keyboard navigation and explicit close controls.
- #567 / PR #590: independent atomic AI usage ledger, duplicate-call protection and concurrent accounting.
- #546 / PR #591: recoverable polling, request deadlines, Offline/Reconnecting status and Retry.
- #565 / PR #592: reproducible engine and persisted-acknowledgement performance baseline.
- #571 / PR #594: exact card trigger/filter readings, including real Awaken exceptions.
- #544 / PR #598: typed interrupted outcomes, public privacy, archive and review guards.
- #553 / PR #599: static/timed identity layers and named keyword negation, with stale all-area rows blocked.
- #555 / PR #596: incremental mandatory Aegis choices and persisted payment continuation.
- #556 / PR #600: matching face-up Life Autos and watchers with exact event-subject binding.

These PRs have local verification and orchestrator review; they are not delivered yet. Main commit
`74701713` (PR #586) currently has no reported Vercel status. The required deployment ordering in
`docs/agent-brief.md` holds the next merge while independent implementation continues.
The #575 capability inventory (PR #593) remains a draft: its runtime evidence must be reconciled
with the implementation PRs that merge before it. The eleven-PR review combination passed local tests,
typecheck, lint and build. Active isolated work covers #554 Heroic and #547 immutable rules/replay;
#601 is implementing the bounded AI-oracle migration under #459, whose larger VM migration remains open. The locally reproduced additional
Aegis cost-ordering defect is a separate P1 follow-up, #595, in M5; it depends on #555.
P1 #597 separately owns original-color keyword payment eligibility after #553/#555.

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
