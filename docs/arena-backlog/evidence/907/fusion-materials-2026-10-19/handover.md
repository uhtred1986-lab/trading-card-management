# Handover task: typed combo-trigger qualifications under #907

Continue the rules-engine work in `/workspace/trading-card-management`. Start
from current `origin/main`, inspect changes since PR #1068, and read repository
instructions before assigning work. Implement the next bounded slice; do not
stop at another general audit or plan.

## Delivered baseline

PR #1068 merged as `ec22e4236fe6315d5fcdac969748efbd6511a1b0`. It makes Fusion
material records authoritative through compile/store/load/offers/payment/replay,
including granted Fusion. It restores two #1067 regressions: all-outside material
payment and stale material-answer rejection. Preserve the original #541/#925
assertions and distinct Potara/Absorb procedures. Existing Union grants require
typed variant identity; obsolete records/saves require rebuilding, with no text
fallback. Native keyword identity/timing and use limits remain explicit residuals.

Read these current sources and corresponding live issues/receipts:

- `docs/arena-rules-delivery.md`, `docs/arena-CURRENT.md`.
- `docs/arena-backlog/{897,907,923,929,930}.md`; #932 remains completed.
- `docs/arena-backlog/evidence/907/fusion-materials-2026-10-19/README.md`,
  its application receipt/reference export and online sources.
- `docs/arena-backlog/evidence/923/typed-payment-907.md`.
- `docs/arena-backlog/evidence/897/selected-pair-inputs-2026-10-19/README.md`,
  catalog, actual stored rows, physical manifest and stored admission report.

The existing two starter controls complete all 16 games with unchanged full
traces and 75 programs. The engine/loader/provenance revisions are recorded
separately. No full suite/build was run, at the owner's request. Historical
census, recipe gap lists and old handoffs are evidence, not the queue.

The post-deployment reference application refreshed exactly BT11-013/front/10
and P-360/back/0 from version 3 to 4. The other nine reference rows are unchanged;
all eleven remain unconfirmed. Actual-export material and payment replay proofs
pass. This did not refresh any selected-pair row.

## Implement this single task

Carry the selected pair's **combo-trigger qualifications and bindings** through
compilation, persistence, match loading, trigger evaluation/offers and replay:

| Exact skill | Qualification that must become typed |
| --- | --- |
| BT6-006 front #10 | This card used in a combo; preserve red-Leader/life condition and draw. |
| BT6-010 front #0 | Battle-end binding to this card's combo from hand during the opponent's turn; preserve red-Leader condition and Rest Mode play. |
| BT6-066 front #0 | This card used in a combo; preserve green-Leader condition and optional exact-two hand payment/shuffle/draw. |
| BT6-070 front #0 | This card used in a combo during its controller's turn; preserve the Broly: Br target and turn-long power effect. |

Reuse the existing trigger language, VM and qualified-combo/battle-end scenarios.
Do not build a second interpreter or broaden this into every trigger or Union
support card. Inspect actual current programs and delivered scenarios first.
Consult current official Masters manual/cardlist/FAQ/errata and public forums;
prefer official authority, record source dates/hashes and access limits. Ask the
owner only if online research leaves semantics or priorities unresolved for this
slice, and continue independent work while awaiting the answer.

Prove positive/negative self, origin, turn and battle-end binding cases as
applicable, both seats, saved continuations and deterministic replay. Deliberately
change a stored qualification and prove that actual stored data controls execution;
display wording must not override it. Missing/malformed or unimplemented metadata
must be explicit blockers. A completed match does not establish per-skill coverage.

Use the frozen inputs and preserve verified gameplay expectations. BT6-010 is
also in a starter control: an intentional program-metadata migration may change
its program hash, but must not silently change expected game traces. Classify
losses as true regressions, exposed old misreads, or source/application drift.
Report parsed, executable, reviewed, verified, exercised and qualified separately.

## Data, scope and completion

Exactly one additional pair remains selected: the existing public BT6 Gogeta /
Br Fusion versus BT6 Paragus / Broly recovery recipes. Its 28 catalog cards and
67 physical rows are now frozen, but both decks fail stored admission and no pair
match has been attempted. Do not select another pair or claim qualification.
Four corrected user rows are protected: BT6-001 back #10, BT6-012 front #30,
BT6-013 front #20 and BT6-015 front #20. Never replace them with compiler drafts.
Unread clauses, usage/sparking/native-identity metadata and record migrations
remain explicit blockers outside this trigger slice. Keep #897 open.

Database fixes are authorized, through guarded repository tools only. Reconcile
current row/source/version and prior receipts; do not repeat a refresh merely
because it appears here. The shared environment's `DATABASE_URL` is another app:
use the repository's Vercel lookup and verify the trading app database before any
read/write. Keep credentials, private lists and private replays private. Record
compiler delivery, deployed revision, actual application and human review separately.

Use cheaper subagents where appropriate, at most three active, separate worktrees
and no overlapping edits or nested delegation. Run essential focused checks,
typecheck/lint and frozen starter controls; **no full npm test, verify-arena or
build**, including workers. No legacy support or AI-strength work. Follow repository
review/merge requirements, merge the reviewed PR, wait for deployment, update the
existing live issues/local backlog with exact evidence and the next single action,
then leave a concise handover.
