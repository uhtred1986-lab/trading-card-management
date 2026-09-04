CREATE TABLE "arena_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"p1_deck_id" integer,
	"p2_deck_id" integer,
	"p1_name" text NOT NULL,
	"p2_name" text NOT NULL,
	"seed" integer NOT NULL,
	"mode" text DEFAULT 'hotseat' NOT NULL,
	"status" text DEFAULT 'playing' NOT NULL,
	"winner" text,
	"reason" text,
	"turn" integer DEFAULT 0 NOT NULL,
	"state" jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arena_games" ADD CONSTRAINT "arena_games_p1_deck_id_decks_id_fk" FOREIGN KEY ("p1_deck_id") REFERENCES "public"."decks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_games" ADD CONSTRAINT "arena_games_p2_deck_id_decks_id_fk" FOREIGN KEY ("p2_deck_id") REFERENCES "public"."decks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arena_games_status_idx" ON "arena_games" USING btree ("status");