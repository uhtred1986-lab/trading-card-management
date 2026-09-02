CREATE TABLE "ct_blueprints" (
	"id" integer PRIMARY KEY NOT NULL,
	"expansion_id" integer,
	"name" text NOT NULL,
	"version" text,
	"image_url" text,
	"tcg_player_id" integer,
	"card_market_ids" jsonb,
	"fixed_properties" jsonb,
	"card_id" text,
	"print_id" text,
	"matched_by" text
);
--> statement-breakpoint
CREATE TABLE "ct_expansions" (
	"id" integer PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"code" text,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ct_listings" (
	"id" integer PRIMARY KEY NOT NULL,
	"blueprint_id" integer NOT NULL,
	"card_id" text,
	"seller_id" integer NOT NULL,
	"seller" text NOT NULL,
	"country_code" text,
	"can_sell_via_hub" boolean DEFAULT false NOT NULL,
	"on_vacation" boolean DEFAULT false NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"quantity" integer NOT NULL,
	"condition" text,
	"language" text,
	"foil" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ct_blueprints" ADD CONSTRAINT "ct_blueprints_expansion_id_ct_expansions_id_fk" FOREIGN KEY ("expansion_id") REFERENCES "public"."ct_expansions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ct_blueprints" ADD CONSTRAINT "ct_blueprints_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ct_blueprints" ADD CONSTRAINT "ct_blueprints_print_id_card_prints_id_fk" FOREIGN KEY ("print_id") REFERENCES "public"."card_prints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ct_listings" ADD CONSTRAINT "ct_listings_blueprint_id_ct_blueprints_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."ct_blueprints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ct_listings" ADD CONSTRAINT "ct_listings_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ct_blueprints_card_idx" ON "ct_blueprints" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "ct_blueprints_tcg_idx" ON "ct_blueprints" USING btree ("tcg_player_id");--> statement-breakpoint
CREATE INDEX "ct_listings_card_idx" ON "ct_listings" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "ct_listings_blueprint_idx" ON "ct_listings" USING btree ("blueprint_id");