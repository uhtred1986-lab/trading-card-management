# Selected BT6 pair: current stored inputs

This is the same public prepared Gogeta / Br Fusion versus Paragus / Broly
recovery pair selected in the [baseline](../baseline-2026-10-19/pair-selection.md).
Its [exact lists](../baseline-2026-10-19/additional-pair.json) have not changed.
No additional deck, private owner list or replay was accessed.

The [input receipt](input-receipt.json) pins a targeted read of all 28 catalog
cards and 67 physical stored rows. [catalog.json](catalog.json) and
[stored-rules.json](stored-rules.json) are inputs to the existing corpus runner.
The latter retains the actual executable/source/review fields; operational
probe/history metadata is omitted. No row was written, created or confirmed.
The 61 drafts, four corrected rows and two open rows are distinct states; the
corrected rows remain protected. A corrected status cannot substitute for a
current executable format or complete per-skill proof.

All expected physical rows are present. Obsolete payment metadata can fail
export normalization and subsequently appear as a missing *admitted* record;
that does not mean the database row is absent. Other old null-cost records are
present but unsupported by the typed loader. Rebuilding compiler drafts must
use guarded tooling; the four corrected rows need an individual protected-record
migration, never a compiler overwrite.

Current compilation still leaves four records unread: BT6-001 back #10's turn
condition, BT6-015 front #20's color restriction, and BT6-053 front #10/back #0's
Life-to-hand prohibition. The old recipe's BT6-012/013 gap list is historical:
those rows now compile without unread clauses. That is parser evidence, not
runtime verification or permission to rebaseline the recipe.

A bounded following #907 task is typed combo-trigger qualification/binding for
BT6-006 front #10, BT6-010 front #0, BT6-066 front #0 and BT6-070 front #0. These
four selected-pair Autos currently derive self/from-hand/turn/battle-end facts
from runtime text. Preserve their independently tested behavior and the frozen
starter controls while carrying those facts through the executable record.
Other use-limit, sparking, evolution, source/prohibition and migration blockers
remain explicit. This follows the delivery plan's trigger-qualification stage;
it does not broaden the queue to every Union support card.

Admission evidence and its tested revision will be added after integration.
No qualification matches have been run for this pair. #897 remains open.
