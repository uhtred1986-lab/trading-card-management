CREATE TABLE "meta_events" (
	"id" text PRIMARY KEY NOT NULL,
	"game" text DEFAULT 'dbs' NOT NULL,
	"name" text NOT NULL,
	"occurred_on" date,
	"official" boolean DEFAULT true NOT NULL,
	"source_url" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_result_cards" (
	"result_id" integer NOT NULL,
	"card_id" text,
	"card_number_raw" text NOT NULL,
	"zone" text DEFAULT 'main' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "meta_result_cards_result_id_card_number_raw_pk" PRIMARY KEY("result_id","card_number_raw")
);
--> statement-breakpoint
CREATE TABLE "meta_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"placement" integer NOT NULL,
	"leader_card_id" text,
	"leader_number_raw" text NOT NULL,
	"deck_source_id" text NOT NULL,
	"source_url" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "meta_result_cards" ADD CONSTRAINT "meta_result_cards_result_id_meta_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."meta_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_result_cards" ADD CONSTRAINT "meta_result_cards_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_results" ADD CONSTRAINT "meta_results_event_id_meta_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."meta_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_results" ADD CONSTRAINT "meta_results_leader_card_id_cards_id_fk" FOREIGN KEY ("leader_card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meta_result_cards_card_idx" ON "meta_result_cards" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "meta_results_event_idx" ON "meta_results" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "meta_results_leader_idx" ON "meta_results" USING btree ("leader_card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_results_deck_unique" ON "meta_results" USING btree ("event_id","deck_source_id");--> statement-breakpoint
CREATE INDEX "cards_first_seen_idx" ON "cards" USING btree ("first_seen_at");