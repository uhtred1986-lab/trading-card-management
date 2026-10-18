CREATE TABLE "rules_progress_snapshots" (
	"snapshot_date" date PRIMARY KEY NOT NULL,
	"confirmed_cards" integer NOT NULL,
	"total_cards" integer NOT NULL,
	"read_skills" integer NOT NULL,
	"unread_skills" integer NOT NULL,
	"flagged" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_rules" ADD COLUMN "review_flag" text;