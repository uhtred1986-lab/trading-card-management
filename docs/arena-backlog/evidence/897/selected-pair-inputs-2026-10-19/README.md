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

[Stored admission](stored-admission.json), evaluated on integrated code
`c3ba274d06f72174a3533c4b02ecb8bfa6cd1d24`, refuses both decks: 0 admitted,
0 qualified, 0 games. All 67 required skills have blockers; six native entries
remain separately identified. Seventeen obsolete exports fail normalization;
the physical expected manifest still matches exactly. Both lists pass the
captured application's legality check, which is not an independent certification
against the current official restricted list. No pair match was attempted and
no result was imported into Testing & stats. #897 remains open.

Reproduce the admission-only report (no database/network):

```sh
env -u DATABASE_URL npx tsx scripts/arena-corpus-freeze.mts --mode stored --catalog docs/arena-backlog/evidence/897/selected-pair-inputs-2026-10-19/catalog.json --stored-rules docs/arena-backlog/evidence/897/selected-pair-inputs-2026-10-19/stored-rules.json --decks docs/arena-backlog/evidence/897/baseline-2026-10-19/additional-pair.json --starters=false --pairs 0 --max-moves 3000 --seed-base 897000 --out /tmp/bt6-stored-admission.json
```
