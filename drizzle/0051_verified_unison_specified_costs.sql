-- SD13-02, Frieza : Xeno, Darkness Overflowing: the printed X cost has two
-- green specified-cost circles. Verified against the catalog's card image:
-- https://tcgplayer-cdn.tcgplayer.com/product/213785_in_1000x1000.jpg
-- Only fill a missing baseline; preserve any owner-entered value.
UPDATE "cards" SET "specified_cost" = '{g}{g}' WHERE "id" = 'SD13-02' AND "specified_cost" IS NULL;
--> statement-breakpoint
-- BT31-087, Chronoa, God's Power Stolen: one black specified-cost circle
-- beside X (the separate Z-Energy cost is 1 and is not an energy orb).
-- https://tcgplayer-cdn.tcgplayer.com/product/701167_in_1000x1000.jpg
UPDATE "cards" SET "specified_cost" = '{k}' WHERE "id" = 'BT31-087' AND "specified_cost" IS NULL;
