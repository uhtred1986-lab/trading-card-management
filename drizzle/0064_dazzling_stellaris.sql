ALTER TABLE "scan_batches" ADD COLUMN "game" text DEFAULT 'dbs' NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_items" ADD COLUMN "variant" text;--> statement-breakpoint
ALTER TABLE "scan_items" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "scan_items" ADD COLUMN "saved_at" timestamp with time zone;