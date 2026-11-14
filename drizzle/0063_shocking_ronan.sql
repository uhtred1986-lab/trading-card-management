CREATE TABLE "card_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"print_id" text NOT NULL,
	"card_id" text NOT NULL,
	"owner" text,
	"data" "bytea" NOT NULL,
	"mime" text DEFAULT 'image/webp' NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_photos_owner_print_unique" UNIQUE NULLS NOT DISTINCT("owner","print_id")
);
--> statement-breakpoint
ALTER TABLE "card_prints" ADD COLUMN "ct_blueprint_id" integer;--> statement-breakpoint
ALTER TABLE "card_prints" ADD COLUMN "market_cents" integer;--> statement-breakpoint
ALTER TABLE "card_prints" ADD COLUMN "market_low_cents" integer;--> statement-breakpoint
ALTER TABLE "card_prints" ADD COLUMN "market_currency" text;--> statement-breakpoint
ALTER TABLE "card_prints" ADD COLUMN "market_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "format" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "home_game" text;--> statement-breakpoint
ALTER TABLE "card_photos" ADD CONSTRAINT "card_photos_print_id_card_prints_id_fk" FOREIGN KEY ("print_id") REFERENCES "public"."card_prints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_photos" ADD CONSTRAINT "card_photos_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_photos_card_idx" ON "card_photos" USING btree ("card_id");