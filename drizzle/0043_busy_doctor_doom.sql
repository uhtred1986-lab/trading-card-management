DROP INDEX "want_list_card_unique";--> statement-breakpoint
ALTER TABLE "want_list" ADD COLUMN "owner" text;--> statement-breakpoint
ALTER TABLE "want_list" ADD CONSTRAINT "want_list_owner_card_unique" UNIQUE NULLS NOT DISTINCT("owner","card_id");