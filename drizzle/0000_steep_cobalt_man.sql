CREATE TABLE "ai_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"deck_id" integer,
	"model" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_prints" (
	"id" text PRIMARY KEY NOT NULL,
	"card_id" text NOT NULL,
	"suffix" text DEFAULT '' NOT NULL,
	"label" text NOT NULL,
	"rarity" text NOT NULL,
	"image_url" text,
	"is_base" boolean DEFAULT false NOT NULL,
	"deckplanet_id" integer
);
--> statement-breakpoint
CREATE TABLE "card_sets" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"line" text NOT NULL,
	"released_on" date,
	"sort_key" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" text PRIMARY KEY NOT NULL,
	"set_code" text NOT NULL,
	"name" text NOT NULL,
	"card_type" text NOT NULL,
	"colors" text[] DEFAULT '{}'::text[] NOT NULL,
	"energy_cost" text,
	"z_energy_cost" text,
	"power" integer,
	"combo_cost" integer,
	"combo_power" integer,
	"skill" text,
	"characters" text[] DEFAULT '{}'::text[] NOT NULL,
	"traits" text[] DEFAULT '{}'::text[] NOT NULL,
	"eras" text[] DEFAULT '{}'::text[] NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"rarity" text NOT NULL,
	"rarity_code" text NOT NULL,
	"limited_to" integer,
	"is_banned" boolean DEFAULT false NOT NULL,
	"is_limited" boolean DEFAULT false NOT NULL,
	"has_errata" boolean DEFAULT false NOT NULL,
	"is_horizontal" boolean DEFAULT false NOT NULL,
	"back_name" text,
	"back_skill" text,
	"back_power" integer,
	"image_url" text,
	"deckplanet_id" integer,
	"search_text" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deck_cards" (
	"deck_id" integer NOT NULL,
	"card_id" text NOT NULL,
	"zone" text DEFAULT 'main' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "deck_cards_deck_id_card_id_zone_pk" PRIMARY KEY("deck_id","card_id","zone")
);
--> statement-breakpoint
CREATE TABLE "decks" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"meta_notes" text,
	"is_built" boolean DEFAULT false NOT NULL,
	"built_at" timestamp with time zone,
	"ai_summary" text,
	"ai_summary_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"rate" real NOT NULL,
	"as_of" date NOT NULL,
	CONSTRAINT "fx_rates_base_quote_as_of_pk" PRIMARY KEY("base","quote","as_of")
);
--> statement-breakpoint
CREATE TABLE "owned_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"print_id" text NOT NULL,
	"card_id" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"condition" text DEFAULT 'NM' NOT NULL,
	"finish" text DEFAULT 'normal' NOT NULL,
	"language" text DEFAULT 'EN' NOT NULL,
	"acquired_on" date,
	"price_paid_cents" integer,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"summary" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "tcg_groups" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"abbreviation" text,
	"published_on" date,
	"modified_on" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tcg_prices" (
	"product_id" integer NOT NULL,
	"sub_type" text NOT NULL,
	"captured_on" date NOT NULL,
	"market_cents" integer,
	"low_cents" integer,
	"mid_cents" integer,
	"high_cents" integer,
	"direct_low_cents" integer,
	CONSTRAINT "tcg_prices_product_id_sub_type_captured_on_pk" PRIMARY KEY("product_id","sub_type","captured_on")
);
--> statement-breakpoint
CREATE TABLE "tcg_products" (
	"id" integer PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"name" text NOT NULL,
	"number" text,
	"rarity" text,
	"image_url" text,
	"url" text,
	"marker" text,
	"card_id" text,
	"print_id" text,
	"modified_on" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_prints" ADD CONSTRAINT "card_prints_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_set_code_card_sets_code_fk" FOREIGN KEY ("set_code") REFERENCES "public"."card_sets"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_cards" ADD CONSTRAINT "deck_cards_deck_id_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_cards" ADD CONSTRAINT "deck_cards_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owned_cards" ADD CONSTRAINT "owned_cards_print_id_card_prints_id_fk" FOREIGN KEY ("print_id") REFERENCES "public"."card_prints"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owned_cards" ADD CONSTRAINT "owned_cards_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_prices" ADD CONSTRAINT "tcg_prices_product_id_tcg_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."tcg_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_products" ADD CONSTRAINT "tcg_products_group_id_tcg_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."tcg_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_products" ADD CONSTRAINT "tcg_products_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcg_products" ADD CONSTRAINT "tcg_products_print_id_card_prints_id_fk" FOREIGN KEY ("print_id") REFERENCES "public"."card_prints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_deck_idx" ON "ai_runs" USING btree ("deck_id");--> statement-breakpoint
CREATE INDEX "card_prints_card_idx" ON "card_prints" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "cards_set_idx" ON "cards" USING btree ("set_code");--> statement-breakpoint
CREATE INDEX "cards_name_idx" ON "cards" USING btree ("name");--> statement-breakpoint
CREATE INDEX "cards_type_idx" ON "cards" USING btree ("card_type");--> statement-breakpoint
CREATE INDEX "deck_cards_card_idx" ON "deck_cards" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "owned_cards_card_idx" ON "owned_cards" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "owned_cards_print_idx" ON "owned_cards" USING btree ("print_id");--> statement-breakpoint
CREATE INDEX "tcg_prices_captured_idx" ON "tcg_prices" USING btree ("captured_on");--> statement-breakpoint
CREATE INDEX "tcg_products_card_idx" ON "tcg_products" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "tcg_products_print_idx" ON "tcg_products" USING btree ("print_id");--> statement-breakpoint
CREATE INDEX "tcg_products_number_idx" ON "tcg_products" USING btree ("number");