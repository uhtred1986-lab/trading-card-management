# Arena current state (short)

Last updated: 12 Oct 2026

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

The integrity prerequisites and #558–#562 are merged. Effective-colour payment #626 is merged in
PR #629, but its main Vercel deployment currently reports failure; wait for a successful deployment
before the next merge. Revive ordering #624 is reviewed and locally validated in PR #630, awaiting
that gate. Phone board #563 is reviewed in PR #631 after browser and local acceptance; desktop #564 waits for its
merge. #549 and #595 remain partial, and #550 remains blocked on #549's acceptance. Use the
canonical issue records and milestone checklists for delivered state and exact dependencies.
#575 inventory and #459 fixed expectations must precede legacy retirement; #105/#106 wait on web contracts.

## Reconciliation and evidence

#539 is parent of #571–#574. #540–#542 remain distinct; #542 waits for shared cost binding #550.
#381's cheaper-model ruling is already given. #518's route #531 is implemented; owner-run production
Test connection and latency evidence remain. Do not duplicate either route or ask the same ruling again.

Stage 3 #170 was a stale tracker with #135/#137 unchecked despite both closed; it is now closed after
declaration checks passed. ops.rules documents native mill as its binding exception. These are
language/declaration results, not runtime proof.

The DB-free, source-checked [capability inventory](arena-capability-inventory.md) is #575's current
runtime evidence. Main records 25 narrow capability rows, four named rules-engine gaps with stable IDs
and live owners, and 27 VM source sites, including the identity-less granted-Heroic guard owned by
#602. It records merged #548 zero-power processing, #551 combo-to-Z-Energy, #553 static layers,
#554 printed Heroic, #555 Aegis, #556 face-up Life events, and #601 fixed AI expectations from current
runtime evidence. It keeps the native `mill` macro exception and #459 oracle migration gate separate
from runtime support. The ALTC Counter alternative-price scenario actively asserts the chosen
payment, resulting zones and unaffordable case.

#170's closure and green declaration checks do not prove complete rules coverage. The inventory
keeps behavior-level runtime assertions separate from hook contracts and declaration checks. Fuzz-40
needs database-backed card fixtures and remains owner-run. No implementation ticket is marked fixed
by planning work.

## Working and maintenance

Read CLAUDE.md, docs/agent-brief.md, issue comments, tracker, arena-work skill and cited docs.
One issue/branch/draft PR; no nested agents. Up to three disjoint worktrees can be coordinated,
but flow/costs/snapshot/actions/page/sheets/glossary/fixtures/schema have one writer at a time.

Use local fixtures and PGlite. This environment's DATABASE_URL belongs to another app.
The plan authorizes no live data writes, paid calls, new dependency or production configuration.
Additive migration proposals are local; owner-only/live acceptance stays explicitly unverified.

Completing PRs set canonical backlog status closed and attach acceptance evidence; maintain the
current queue/tracker. Do not bulk-sync older files over newer issue bodies/comments.
