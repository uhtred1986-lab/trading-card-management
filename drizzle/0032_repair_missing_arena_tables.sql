CREATE TABLE IF NOT EXISTS "card_text_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" text NOT NULL,
	"skill_index" integer NOT NULL,
	"clause" text NOT NULL,
	"pattern" text NOT NULL,
	"skill_text" text NOT NULL,
	"times_seen" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"last_ruling" jsonb,
	"last_ruling_why" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "card_text_notes_clause_key" UNIQUE("card_id","skill_index","clause")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_scripts" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" text NOT NULL,
	"skill_index" integer NOT NULL,
	"side" text DEFAULT 'front' NOT NULL,
	"ops" jsonb NOT NULL,
	"source" text DEFAULT 'claude' NOT NULL,
	"explanation" text,
	"meaning" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_scripts_skill_key" UNIQUE("card_id","skill_index","side")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arena_bug_reports" (
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
ALTER TABLE "card_text_notes" ADD COLUMN IF NOT EXISTS "explanation" text;--> statement-breakpoint
ALTER TABLE "card_text_notes" ADD COLUMN IF NOT EXISTS "explained_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "card_text_notes" ADD COLUMN IF NOT EXISTS "brief" text;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'card_text_notes_card_id_cards_id_fk') THEN ALTER TABLE "card_text_notes" ADD CONSTRAINT "card_text_notes_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'card_scripts_card_id_cards_id_fk') THEN ALTER TABLE "card_scripts" ADD CONSTRAINT "card_scripts_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action; END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arena_bug_reports_game_id_arena_games_id_fk') THEN ALTER TABLE "arena_bug_reports" ADD CONSTRAINT "arena_bug_reports_game_id_arena_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."arena_games"("id") ON DELETE set null ON UPDATE no action; END IF; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_text_notes_pattern_idx" ON "card_text_notes" USING btree ("pattern");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_scripts_card_idx" ON "card_scripts" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "arena_bug_reports_status_idx" ON "arena_bug_reports" USING btree ("status","created_at");
