ALTER TABLE "arena_games" ADD COLUMN "ai_calls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "arena_games" ADD COLUMN "ai_input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "arena_games" ADD COLUMN "ai_output_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "arena_games" ADD COLUMN "ai_cached_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "arena_games" ADD COLUMN "ai_cost_micros" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "arena_games" ADD COLUMN "review" text;--> statement-breakpoint
ALTER TABLE "arena_games" ADD COLUMN "review_at" timestamp with time zone;