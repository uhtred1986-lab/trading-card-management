CREATE TABLE "arena_rule_bundles" (
	"hash" text PRIMARY KEY NOT NULL,
	"format" integer NOT NULL,
	"ruleset_hash" text NOT NULL,
	"catalog_hash" text NOT NULL,
	"programs_hash" text NOT NULL,
	"runtime_revision" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arena_games" ADD COLUMN "rules_bundle_hash" text;--> statement-breakpoint
ALTER TABLE "arena_games" ADD COLUMN "replay_decks" jsonb;