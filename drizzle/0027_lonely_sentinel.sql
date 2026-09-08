CREATE TABLE "card_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" text NOT NULL,
	"side" text NOT NULL,
	"skill_index" integer NOT NULL,
	"printed" text NOT NULL,
	"kind" text NOT NULL,
	"trigger" jsonb,
	"cost" jsonb,
	"cond" jsonb,
	"ops" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"unread" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pattern" text,
	"explanation" text,
	"reads" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"compiler_diff" jsonb,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_rules" ADD CONSTRAINT "card_rules_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_rules_skill" ON "card_rules" USING btree ("card_id","side","skill_index");--> statement-breakpoint
CREATE INDEX "card_rules_status" ON "card_rules" USING btree ("status");