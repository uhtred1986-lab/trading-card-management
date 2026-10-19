# #907 typed Fusion materials

Starting main: `7b5b515edb2319b90c4414829fa88f829fa0d06f` (#1067).

This increment carries Fusion's material-selection contract through compilation,
storage, loading, legal offers, payment and replay, including granted Fusion.
It preserves the material-before-additional-cost checkpoint and the distinct
Potara/Absorb procedures. Runtime printed text must not override a stored material
contract. Missing or obsolete contracts require explicit rebuilding.

Implementation and validation are in progress. This draft is not a delivery or
application receipt. The live #897/#907/#923/#929/#930 issues were reconciled
before assignment; #929/#930 implementations are preservation controls. The
three reference cards still have the eleven unconfirmed compiler drafts recorded
by #1067. No new database write has occurred.

The owner requested essential checks only, no legacy compatibility and online
rules/errata/forum research. #897 remains open; the selected BT6 Gogeta / Br Fusion
versus BT6 Paragus / Broly recovery pair remains unqualified. No AI-strength work
or additional deck pair is included.

## Application boundary

The former loader accepts an extra material field but drops it, continuing to
interpret printed material text. New records will therefore be applied only
after the typed implementation deploys. The reference application will use the
supported guarded refresh command for exact changed keys, followed by readback
and offline replay proof. It will not confirm drafts or refresh unrelated rows.
The refresh tool's focused exclusion/atomic-apply/recheck proof passed on the
starting tree. Application is pending, not implied by this draft.
