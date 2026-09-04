CREATE TABLE "card_scripts" (
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
ALTER TABLE "card_text_notes" ADD COLUMN "explanation" text;--> statement-breakpoint
ALTER TABLE "card_text_notes" ADD COLUMN "explained_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "card_text_notes" ADD COLUMN "brief" text;--> statement-breakpoint
ALTER TABLE "card_scripts" ADD CONSTRAINT "card_scripts_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_scripts_card_idx" ON "card_scripts" USING btree ("card_id");