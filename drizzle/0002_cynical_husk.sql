CREATE TABLE "scan_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mode" text DEFAULT 'single' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"added_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scan_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"photo_id" integer NOT NULL,
	"idx" integer DEFAULT 0 NOT NULL,
	"detection" jsonb NOT NULL,
	"chosen" jsonb,
	"manual" boolean DEFAULT false NOT NULL,
	"print_id" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"condition" text DEFAULT 'NM' NOT NULL,
	"finish" text DEFAULT 'normal' NOT NULL,
	"include" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"data" "bytea",
	"width" integer DEFAULT 0 NOT NULL,
	"height" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'reading' NOT NULL,
	"error" text,
	"found" integer,
	"unreadable" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scan_items" ADD CONSTRAINT "scan_items_batch_id_scan_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."scan_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_items" ADD CONSTRAINT "scan_items_photo_id_scan_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."scan_photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_items" ADD CONSTRAINT "scan_items_print_id_card_prints_id_fk" FOREIGN KEY ("print_id") REFERENCES "public"."card_prints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_photos" ADD CONSTRAINT "scan_photos_batch_id_scan_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."scan_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scan_items_batch_idx" ON "scan_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "scan_items_photo_idx" ON "scan_items" USING btree ("photo_id");--> statement-breakpoint
CREATE INDEX "scan_photos_batch_idx" ON "scan_photos" USING btree ("batch_id");