CREATE TABLE "arena_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_user" text NOT NULL,
	"host_deck_id" integer,
	"guest_user" text,
	"guest_deck_id" integer,
	"debug" boolean DEFAULT true NOT NULL,
	"game_id" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arena_feedback" ADD COLUMN "reported_by" text;--> statement-breakpoint
ALTER TABLE "arena_games" ADD COLUMN "p1_user" text;--> statement-breakpoint
ALTER TABLE "arena_games" ADD COLUMN "p2_user" text;--> statement-breakpoint
ALTER TABLE "arena_games" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "arena_matches" ADD CONSTRAINT "arena_matches_host_deck_id_decks_id_fk" FOREIGN KEY ("host_deck_id") REFERENCES "public"."decks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_matches" ADD CONSTRAINT "arena_matches_guest_deck_id_decks_id_fk" FOREIGN KEY ("guest_deck_id") REFERENCES "public"."decks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_matches" ADD CONSTRAINT "arena_matches_game_id_arena_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."arena_games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arena_matches_status_idx" ON "arena_matches" USING btree ("status","created_at");