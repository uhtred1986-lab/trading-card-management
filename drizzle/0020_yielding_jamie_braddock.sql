CREATE TABLE "arena_bug_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"note" text NOT NULL,
	"card_id" text,
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
ALTER TABLE "arena_bug_reports" ADD CONSTRAINT "arena_bug_reports_game_id_arena_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."arena_games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arena_bug_reports_status_idx" ON "arena_bug_reports" USING btree ("status","created_at");