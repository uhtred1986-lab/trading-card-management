CREATE TABLE "arena_ai_usage" (
	"game_id" integer NOT NULL,
	"call_id" text NOT NULL,
	"revision" integer NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"billed" boolean NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_tokens" integer NOT NULL,
	"cache_creation_tokens" integer NOT NULL,
	"cost_micros" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arena_ai_usage" ADD CONSTRAINT "arena_ai_usage_game_id_arena_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."arena_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "arena_ai_usage_call_idx" ON "arena_ai_usage" USING btree ("game_id","call_id");--> statement-breakpoint
CREATE INDEX "arena_ai_usage_revision_idx" ON "arena_ai_usage" USING btree ("game_id","revision");