# Arena current state (short)

Last updated: 11 Oct 2026

Keep this file under 200 lines; update it when priorities or entry documentation changes.

## Start here

The authoritative work queue is [arena-delivery-plan.md](arena-delivery-plan.md), tracked by
[GitHub #581](https://github.com/uhtred1986-lab/trading-card-management/issues/581).
It lists every active milestone, issue priority, dependency and hot-file constraint.
[arena-playability-review.md](arena-playability-review.md) records evidence and the grounded design.
Older handovers explain architecture/history; their dated queues do not override this plan.

## What exists

- Arena plays Dragon Ball Super Masters (`dbs`), not Fusion World.
- Default engine is `rules`; `legacy` remains until #118's coverage/replay/correctness gates pass.
  Rules-engine 1v1 and privacy masking already exist.
- Language, loader, phases/actions/battles and keyword hook contracts are implemented.
  A completed stage does not establish support for every runtime mechanic.
- Drag/charge, targeting, playback, inspection and phone pager #348 already exist.
  New fullscreen review extends the pager; completed #352/#366 programmes remain closed.
- Dev-only grounded preview uses real artwork and both skins. Its simulated ability timing
  is design data; the live board must consume engine-derived availability.

## Current milestones and priorities

- **P0 Match integrity and recovery:** tracker #576; #543, #544, #545, #546, #547.
- **P0/P1 Rule engine correctness:** tracker #577; #548, #549, #550, #551, #552, #553, #554, #555, #556, #557, #540, #541, #542.
- **P1 Playable board and fullscreen cards:** tracker #578; #558, #559, #560, #561, #562, #563, #564.
- **P1/P2 Measured speed and gameplan:** tracker #579; #565, #566, #567, #568, #569, #570.
- **P1 Outstanding card readings:** tracker #539; #571, #572, #573, #574.
- **P2/P3 Independent coverage and retirement:** tracker #168; #575, #459, #118.
- **P2/P3 Android after web contract:** tracker #580; #105, #106.
- **P2 AI efficiency and live verification:** tracker #511; #381, #518.

Start P0 #543 readiness, #545 revision and #544 explicit interruption, then #548 zero-power/#549 Auto costs.
Independent #559 accessible review can start on disjoint files. #558 contracts → #560/#561 review/abilities
and #562 stakes → #563 phone → #564 desktop. Use exact dependencies in the delivery plan.
#575 inventory and #459 fixed expectations must precede legacy retirement; #105/#106 wait on web contracts.

## Reconciliation and evidence

#539 is parent of #571–#574. #540–#542 remain distinct; #542 waits for shared cost binding #550.
#381's cheaper-model ruling is already given. #518's route #531 is implemented; owner-run production
Test connection and latency evidence remain. Do not duplicate either route or ask the same ruling again.

Stage 3 #170 was a stale tracker with #135/#137 unchecked despite both closed; it is now closed after
declaration checks passed. ops.rules documents native mill as its binding exception.
Runtime support and named skipped/deferred cases remain #575.

This reconciliation ran verify-rules successfully and verify-arena 28/28 in the legacy harness,
including language/rulesets/words/primer/VM. Earlier npm test passed; earlier rules-only review was
26/28 with two comparisons not run and 18 named skips. These do not prove complete rules coverage.
Old support assertions about KO/tokens/skip/Counter: Play can be stale; verify source and #575.
No implementation ticket is marked fixed by planning work.

## Working and maintenance

Read CLAUDE.md, docs/agent-brief.md, issue comments, tracker, arena-work skill and cited docs.
One issue/branch/draft PR; no nested agents. Up to three disjoint worktrees can be coordinated,
but flow/costs/snapshot/actions/page/sheets/glossary/fixtures/schema have one writer at a time.

Use local fixtures and PGlite. This environment's DATABASE_URL belongs to another app.
The plan authorizes no live data writes, paid calls, new dependency or production configuration.
Additive migration proposals are local; owner-only/live acceptance stays explicitly unverified.

Completing PRs set canonical backlog status closed and attach acceptance evidence; maintain the
current queue/tracker. Do not bulk-sync older files over newer issue bodies/comments.
