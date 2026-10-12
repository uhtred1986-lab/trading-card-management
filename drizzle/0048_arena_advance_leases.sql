CREATE TABLE "arena_advance_calls" (
	"game_id" integer NOT NULL,
	"revision" integer NOT NULL,
	"call_id" text NOT NULL,
	"phase" text NOT NULL,
	"owner" text,
	"lease_until" timestamp with time zone,
	"checkpoint" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arena_advance_calls_pk" PRIMARY KEY("game_id","revision")
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "arena_call_id" text;--> statement-breakpoint
ALTER TABLE "arena_decisions" ADD COLUMN "arena_call_id" text;--> statement-breakpoint
ALTER TABLE "arena_advance_calls" ADD CONSTRAINT "arena_advance_calls_game_id_arena_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."arena_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "arena_advance_calls_call_idx" ON "arena_advance_calls" USING btree ("game_id","call_id");--> statement-breakpoint
CREATE INDEX "arena_advance_calls_lease_idx" ON "arena_advance_calls" USING btree ("phase","lease_until");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_runs_arena_call_idx" ON "ai_runs" USING btree ("arena_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "arena_decisions_arena_call_idx" ON "arena_decisions" USING btree ("game_id","arena_call_id");