CREATE TABLE "ai_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"provider" text,
	"fallback_provider" text,
	"fallback_on_unavailable" boolean DEFAULT false NOT NULL,
	"task_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"models" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
