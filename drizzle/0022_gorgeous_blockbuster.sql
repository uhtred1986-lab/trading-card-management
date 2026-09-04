CREATE TABLE "arena_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'bug' NOT NULL,
	"note" text NOT NULL,
	"card_id" text,
	"skill_index" integer,
	"note_id" integer,
	"game_id" integer,
	"turn" integer DEFAULT 0 NOT NULL,
	"phase" text,
	"prompt" text,
	"state" jsonb,
	"actions" jsonb,
	"log" jsonb,
	"legal" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "arena_feedback" ADD CONSTRAINT "arena_feedback_game_id_arena_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."arena_games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arena_feedback_status_idx" ON "arena_feedback" USING btree ("status","created_at");