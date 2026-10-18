CREATE TABLE "oauth_clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_ref" integer NOT NULL,
	"code_hash" text NOT NULL,
	"email" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"resource" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"family_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_ref" integer NOT NULL,
	"family_id" text NOT NULL,
	"email" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"resource" text NOT NULL,
	"access_hash" text NOT NULL,
	"refresh_hash" text NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"refresh_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_client_ref_oauth_clients_id_fk" FOREIGN KEY ("client_ref") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_client_ref_oauth_clients_id_fk" FOREIGN KEY ("client_ref") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_clients_client_id_idx" ON "oauth_clients" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_codes_code_hash_idx" ON "oauth_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_tokens_access_hash_idx" ON "oauth_tokens" USING btree ("access_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_tokens_refresh_hash_idx" ON "oauth_tokens" USING btree ("refresh_hash");--> statement-breakpoint
CREATE INDEX "oauth_tokens_family_idx" ON "oauth_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "oauth_tokens_client_idx" ON "oauth_tokens" USING btree ("client_ref");