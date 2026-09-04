CREATE TABLE "arena_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"seq" integer NOT NULL,
	"turn" integer NOT NULL,
	"phase" text NOT NULL,
	"prompt_kind" text NOT NULL,
	"player" text NOT NULL,
	"kind" text DEFAULT 'move' NOT NULL,
	"decided_by" text NOT NULL,
	"how" text NOT NULL,
	"model" text,
	"menu" jsonb,
	"chosen_index" integer,
	"chosen_label" text,
	"say" text,
	"prompt_text" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_text_notes" (
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
ALTER TABLE "arena_decisions" ADD CONSTRAINT "arena_decisions_game_id_arena_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."arena_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_text_notes" ADD CONSTRAINT "card_text_notes_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arena_decisions_game_idx" ON "arena_decisions" USING btree ("game_id","seq");--> statement-breakpoint
CREATE INDEX "card_text_notes_pattern_idx" ON "card_text_notes" USING btree ("pattern");