-- The owner's go-ahead of 26 Oct 2026 (#1191, Arena F1-08): the specified costs (the coloured orbs
-- printed beside the cost) of the 60 non-leader cards of the Fusion World starters FS01-FS04, read off
-- Bandai's official card list (dbs-cardgame.com/fw/en/cardlist/detail.php?card_no=…, "Specified cost").
-- Entered here as 0034 and 0049 did for the original game; the catalog upsert coalesces the column,
-- so a later sync keeps them, and a value already entered on the workbench is never overwritten.
-- A database without these rows yet updates nothing.
UPDATE "cards" SET "specified_cost" = '{g}' WHERE "id" IN ('FS03-02', 'FS03-03', 'FS03-05', 'FS03-06', 'FS03-07', 'FS03-08', 'FS03-09', 'FS03-11', 'FS03-12', 'FS03-13', 'FS03-14', 'FS03-15') AND "specified_cost" IS NULL;--> statement-breakpoint
UPDATE "cards" SET "specified_cost" = '{r}' WHERE "id" IN ('FS01-02', 'FS01-03', 'FS01-04', 'FS01-05', 'FS01-06', 'FS01-07', 'FS01-10', 'FS01-11', 'FS01-12', 'FS01-13', 'FS01-14', 'FS01-15', 'FS01-16') AND "specified_cost" IS NULL;--> statement-breakpoint
UPDATE "cards" SET "specified_cost" = '{u}' WHERE "id" IN ('FS02-02', 'FS02-04', 'FS02-05', 'FS02-06', 'FS02-07', 'FS02-08', 'FS02-09', 'FS02-10', 'FS02-11', 'FS02-12', 'FS02-14', 'FS02-15', 'FS02-16') AND "specified_cost" IS NULL;--> statement-breakpoint
UPDATE "cards" SET "specified_cost" = '{y}' WHERE "id" IN ('FS04-02', 'FS04-05', 'FS04-06', 'FS04-07', 'FS04-08', 'FS04-09', 'FS04-10', 'FS04-11', 'FS04-12', 'FS04-13', 'FS04-14', 'FS04-15', 'FS04-16') AND "specified_cost" IS NULL;--> statement-breakpoint
UPDATE "cards" SET "specified_cost" = '{r}{r}' WHERE "id" IN ('FS01-08', 'FS01-09') AND "specified_cost" IS NULL;--> statement-breakpoint
UPDATE "cards" SET "specified_cost" = '{u}{u}' WHERE "id" IN ('FS02-03', 'FS02-13') AND "specified_cost" IS NULL;--> statement-breakpoint
UPDATE "cards" SET "specified_cost" = '{y}{y}' WHERE "id" IN ('FS04-03', 'FS04-04') AND "specified_cost" IS NULL;--> statement-breakpoint
UPDATE "cards" SET "specified_cost" = '{g}{g}{g}' WHERE "id" IN ('FS03-04', 'FS03-16') AND "specified_cost" IS NULL;--> statement-breakpoint
UPDATE "cards" SET "specified_cost" = '{g}{g}{g}{g}' WHERE "id" IN ('FS03-10') AND "specified_cost" IS NULL;
