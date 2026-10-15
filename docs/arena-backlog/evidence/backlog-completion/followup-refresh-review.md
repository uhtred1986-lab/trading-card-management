# Reviewed deck-data follow-up

Prepared 15 October 2026. This is separate from the already-applied 26-rule refresh.
No writes below are authorized by that earlier approval. Apply only after owner acceptance
and deployment of the combined interpreter fixes. The plan command is read-only;
`arena-deck-rule-refresh.mts --apply FILE` compares the saved plan with current records
and compiler output, then uses locked compare-and-swap writes.

## Eleven compiler-owned records

| Record | Reviewed change and evidence |
|---|---|
| BT28-102/front/10 | Restore `allAreas` on its Heroic identity, as printed. |
| BT5-024/front/0 | Restore `allAreas` on its Desire identity, as printed. |
| BT10-091/front/0 | Restore `allAreas` on its Dark Dragon Ball identity, as printed. |
| BT5-119/front/0 | Restore `allAreas` on its Desire identity; separate from the already-refreshed World Peace play skill. |
| BT30-106/front/10 | Restore `allAreas` on its Maiden Squadron identity, as printed. |
| BT31-001/back/0 | Replace obsolete executable Permanent with the implemented `unionFusionAreas` permission. Owner's #541 ruling and `scripts/verify/union-areas-541.ts` cover mixed origin, printed-power equality, Warp destination and movement Autos. |
| BT29-040/front/0 | Replace the open draft with the implemented hand-return replacement. Existing `scripts/verify/readings.ts` scenarios check affected opponent cards, the skill's controller, original destination and duration. `bySide: opponent` is relative to the affected card, so it means the activating player's skill. |
| BT3-030/front/10 | Restore the missing `placed` trigger for “the Battle Area”; retain Dr. Myuu condition and one draw. The added spelling and existing arrival runtime proof cover one play/one arrival. |
| BT3-109/front/20 | Previously held: optional exactly five Warp cards or decline. |
| BT6-062/front/10 | Previously held: optional exactly two hand cards or decline. |
| SD8-03/front/10 | Previously held: optional exactly two hand cards or decline. |

The final three have complete printed-Auto runtime proofs in
`optional-exact-538.ts`: insufficient cards move nothing, decline, full selection,
no partial payment, correct payoff, JSON reload and private hand projections.
The 22-reading review is in `../538/README.md`. Every target's current printed text,
compiler ownership and readable fresh program is rechecked. Records remain drafts;
refresh is not confirmation of the entire catalog. Unrelated rows are not rewritten.

## One owner-corrected record: metadata only

SD13-05/front/0 already stores the owner's correct condition and effect. Its old null
cost metadata makes the current price classifier mistake the condition before the colon
for an unread price. Add only cost metadata whose `condition` is the **existing stored
condition**, with no energy or action price. Preserve the owner's program, condition,
trigger, source, corrected status and explanation. Increment version and updated time.
A dedicated compare-and-swap helper refuses a changed row; PGlite verifies preservation.

## Two missing specified costs

Migration `0051_verified_unison_specified_costs.sql` fills only null values:

- SD13-02, Frieza : Xeno, Darkness Overflowing: **two green**, `{g}{g}`. Personally
  inspected the two green circles beside X on the catalog card image:
  https://tcgplayer-cdn.tcgplayer.com/product/213785_in_1000x1000.jpg
- BT31-087, Chronoa, God's Power Stolen: **one black**, `{k}`. Personally inspected
  the single black circle beside X; the separate Z-Energy cost of 1 is not an energy orb:
  https://tcgplayer-cdn.tcgplayer.com/product/701167_in_1000x1000.jpg

PGlite verifies both values and repeat application preserves an owner-entered non-null
value. Catalog upserts already preserve specified costs. This migration runs on the
production deployment after merge; the 12 rule repairs run separately after that deploy.

## Authorization

The owner explicitly approved this second batch in chat: “Yes, apply these reviewed fixes.”
The migration may deploy with PR #824; apply the reviewed rule plan after the matching
production deployment is Ready, then read back the affected records and deck readiness.
