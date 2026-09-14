ALTER TABLE "cards" ADD COLUMN "specified_cost" text;--> statement-breakpoint
-- The owner's ruling of 9 Sep 2026 on BT19-039 (issue #255): its printed
-- specified cost is two blue. Entered here rather than by hand so the deploy
-- that adds the column also carries the one baseline already ruled on; the
-- catalog upsert coalesces the column, so a later sync keeps it. A database
-- that has no BT19-039 row yet (a fresh one, synced after this migration)
-- updates nothing and the card stays "unknown" until entered on the workbench.
UPDATE "cards" SET "specified_cost" = '{u}{u}' WHERE "id" = 'BT19-039' AND "specified_cost" IS NULL;
