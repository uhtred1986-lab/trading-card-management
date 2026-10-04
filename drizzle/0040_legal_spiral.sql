ALTER TABLE "ai_runs" ADD COLUMN "provider" text DEFAULT 'anthropic-api' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "billed" boolean DEFAULT true NOT NULL;