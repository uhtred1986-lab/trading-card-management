CREATE TABLE "storage_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"is_archived" boolean DEFAULT false NOT NULL,
	"sort_key" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owned_cards" ADD COLUMN "location_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "storage_locations_name_unique" ON "storage_locations" USING btree ("name");--> statement-breakpoint
ALTER TABLE "owned_cards" ADD CONSTRAINT "owned_cards_location_id_storage_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."storage_locations"("id") ON DELETE set null ON UPDATE no action;