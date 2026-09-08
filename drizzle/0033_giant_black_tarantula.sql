ALTER TABLE "arena_games" ADD COLUMN IF NOT EXISTS "engine" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "arena_games" ADD COLUMN IF NOT EXISTS "game" text DEFAULT 'dbs' NOT NULL;--> statement-breakpoint
ALTER TABLE "arena_matches" ADD COLUMN IF NOT EXISTS "engine" text DEFAULT 'legacy' NOT NULL;
