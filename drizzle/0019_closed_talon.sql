ALTER TABLE "card_sets" ADD COLUMN "game" text DEFAULT 'dbs' NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "game" text DEFAULT 'dbs' NOT NULL;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "game" text DEFAULT 'dbs' NOT NULL;--> statement-breakpoint
ALTER TABLE "tcg_groups" ADD COLUMN "category_id" integer DEFAULT 27 NOT NULL;--> statement-breakpoint
CREATE INDEX "cards_game_idx" ON "cards" USING btree ("game");