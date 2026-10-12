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

- **Completed P0 Match integrity and recovery:** tracker #576; #543, #544, #545, #546, #547.
- **P0/P1 Rule engine correctness:** tracker #577; #548, #549, #550, #551, #552, #553, #554, #555, #556, #557, #540, #541, #542.
- **Completed P1 Playable board and fullscreen cards:** tracker #578; #558, #559, #560, #561, #562, #563, #564.
- **P1/P2 Measured speed and gameplan:** tracker #579; #565, #566, #567, #568, #569, #570.
- **P1 Outstanding card readings:** tracker #539; #571, #572, #573, #574.
- **P2/P3 Independent coverage and retirement:** tracker #168; #575, #459, #118.
- **P2/P3 Android after web contract:** tracker #580; #105, #106.
- **P2 AI efficiency and live verification:** tracker #511; #381, #518.

Integrity #576 and UI #578 are closed against their completed implementation children.
Actual GitHub milestone closure remains pending API access: M16 (object 15) has no open
issues; M17 (object 16) contains the open cross-milestone umbrella #581, which must remain
open and should be moved out before M17 is treated as clear. The token exists, but this
execution environment blocks api.github.com; connector issue access is not milestone mutation.

The latest close-out wave merged #669 integrity bookkeeping, #670 hand-origin battle-end
Autos (#572), #671 pending-Auto selection (partial #549), #673 grouped readings,
#674 bounded gameplan preview (#570), and #675 current-DSL combo-entry timing (#672/#573).
#573 and #574 are complete at their scoped acceptance. PR #679 completes P1 #574 exact durations/Desire. PR #678 completed P2 #569
snapshot-derived reads. PR #681 delivered cost-free secret Auto declarations; this increment delivers priced-secret declarations before payment. PR #682 completed genuine damage statistics (#557), and PR #684 completed BT31-116 free Extra activation (#680). PR #688 delivered bounded #683 Villainous/Extra hooks with remaining cases explicit. PR #689 delivered a narrow Auto-price pruning improvement. #459 fixed expectations pass both arena lanes, the no-legacy full-test proof and root build; #609 delivers the bounded cleanup checkpoints and pause/reload proof; replacement combinations remain open.
#549 and #595 remain partial; #550 waits on complete #549 acceptance. #609's later cleanup
checkpoint issue remains open and distinct from the completed combo-entry correction.

Remaining original implementation queue (14) after #459 acceptance: M5 #549/#550/#552/#595/#609/#540/#541/#542;
M2 #566; M1 original reading children complete, parent #539 remains open for stored catalog/fuzz verification; M13 #118; M4 #105/#106; providers #381/#518.
Owner ruling/catalog/fuzz/device/paid verification gates remain explicit. Legacy retirement requires the remaining #118 prerequisites; #459 fixed-expectation acceptance passes. Offline work is a separate programme and is not
being implemented by this wave. The original dirty artwork prototype is preserved.

## Reconciliation and evidence

#539 is parent of #571–#574. #540–#542 remain distinct; #542 waits for shared cost binding #550.
#381's cheaper-model ruling is already given. #518's route #531 is implemented; owner-run production
Test connection and latency evidence remain. Do not duplicate either route or ask the same ruling again.

Stage 3 #170 was a stale tracker with #135/#137 unchecked despite both closed; it is now closed after
declaration checks passed. ops.rules documents native mill as its binding exception. These are
language/declaration results, not runtime proof.

The DB-free, source-checked [capability inventory](arena-capability-inventory.md) is #575's current
runtime evidence. The inventory records 35 narrow capability rows, three named rules-engine gaps with stable IDs
and live owners, and 34 VM source sites. Granted Heroic now carries individual timed/Permanent
identities; an older hook without identity still fails closed before drawing rather than being migrated. It records merged #548 zero-power processing, #551 combo-to-Z-Energy, #553 static layers,
#554 printed Heroic, #555 Aegis, #556 face-up Life events, and #601 fixed AI expectations from current
runtime evidence. It keeps the native `mill` macro exception and completed #459 fixed-expectation test evidence separate from gameplay runtime support. The ALTC Counter alternative-price scenario actively asserts the chosen
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

New review follow-up: [#677](https://github.com/uhtred1986-lab/trading-card-management/issues/677) (P1, M5) tracks external activateSkill taxes visible to typed effect readers; compiler/schema and activation payment still need support. It covers taxes on normal and effect-invoked activations. This is additional to the fourteen original remaining issues; #574 retains this explicit shared payment limitation.

Completed P1 reading follow-up [#680](https://github.com/uhtred1986-lab/trading-card-management/issues/680) (M1, PR #684) replaces BT31-116's incorrect free Extra play with a real nested Main/Battle activation. All four original reading children are complete at their stated scopes; parent #539 remains open for stored catalog redraft/signoff and fuzz proof.

Additional P1 follow-up [#683](https://github.com/uhtred1986-lab/trading-card-management/issues/683) (M5) covers missing Villainous self-negation and successful Extra activation hooks. Its implementation and unverified Auto/source-area/self-watcher boundaries remain open. Alongside #677, it is additional to the fifteen original implementation issues.
