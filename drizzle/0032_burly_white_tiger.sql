ALTER TABLE "arena_games" ADD COLUMN "engine" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "arena_games" ADD COLUMN "game" text DEFAULT 'dbs' NOT NULL;--> statement-breakpoint
ALTER TABLE "arena_matches" ADD COLUMN "engine" text DEFAULT 'legacy' NOT NULL;