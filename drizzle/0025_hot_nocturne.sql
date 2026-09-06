ALTER TABLE "owned_cards" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "owned_cards_archived_idx" ON "owned_cards" USING btree ("archived_at");