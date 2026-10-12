# #557 game-over screen evidence

These eight full-page captures show the real `GameOver` component at 390 × 844 (`phone`) and 1440 × 900 (`desk`), in anime and night skins. Each size/skin has a fresh-zero and an old-unavailable image.

- `*-fresh-zero.jpg`: `damageTaken` was called on a newly created rules-engine VM state for both players. The result card displays the genuine initial `0 / 0`.
- `*-old-unavailable.jpg`: `damageTaken` was called on the same VM shape after removing `damageTotals` to model a saved game from before #557. The result card displays `Unavailable`, legibly within the phone stat tile.

The board and concession outcome are the existing `over` contract fixture, not the fresh or old VM game. A temporary dev-only preview route option supplied the computed values to `GameOver` for these captures; it was removed before commit. These screenshots prove the rendering and sizing of the actual component. The engine scenarios in `scripts/verify/damage-statistics-557.mts` prove cost versus damage event accounting, reload, replay and interruption; `scripts/verify/arena-damage-statistics-db.mts` proves saved rows, stale CAS, duplicate requests and both viewers' projections. No live database or card-catalog fuzz run is claimed.
