ALTER TABLE "owned_cards" ADD COLUMN "owner" text;--> statement-breakpoint
CREATE INDEX "owned_cards_owner_idx" ON "owned_cards" USING btree ("owner");