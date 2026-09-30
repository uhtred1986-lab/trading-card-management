CREATE TABLE "arena_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"turn" integer NOT NULL,
	"beat_index" integer NOT NULL,
	"note" text,
	"flagged_by" text,
	"reviewer_note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arena_flags" ADD CONSTRAINT "arena_flags_game_id_arena_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."arena_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "arena_flags_game_turn_unique" ON "arena_flags" USING btree ("game_id","turn");