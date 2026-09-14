ALTER TABLE "decks" ADD COLUMN "owner" text;--> statement-breakpoint
CREATE INDEX "decks_owner_idx" ON "decks" USING btree ("owner");