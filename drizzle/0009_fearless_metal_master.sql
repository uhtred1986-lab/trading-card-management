CREATE TABLE "deck_swaps" (
	"id" serial PRIMARY KEY NOT NULL,
	"deck_id" integer NOT NULL,
	"out_card_id" text NOT NULL,
	"in_card_id" text NOT NULL,
	"out_quantity" integer DEFAULT 1 NOT NULL,
	"in_quantity" integer DEFAULT 1 NOT NULL,
	"rationale" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"context" text,
	"run_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "want_list" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"note" text,
	"deck_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deck_swaps" ADD CONSTRAINT "deck_swaps_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_swaps" ADD CONSTRAINT "deck_swaps_out_card_id_cards_id_fk" FOREIGN KEY ("out_card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_swaps" ADD CONSTRAINT "deck_swaps_in_card_id_cards_id_fk" FOREIGN KEY ("in_card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_swaps" ADD CONSTRAINT "deck_swaps_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "want_list" ADD CONSTRAINT "want_list_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "want_list" ADD CONSTRAINT "want_list_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deck_swaps_deck_idx" ON "deck_swaps" USING btree ("deck_id");--> statement-breakpoint
CREATE INDEX "deck_swaps_out_idx" ON "deck_swaps" USING btree ("deck_id","out_card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deck_swaps_unique" ON "deck_swaps" USING btree ("deck_id","out_card_id","in_card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "want_list_card_unique" ON "want_list" USING btree ("card_id");