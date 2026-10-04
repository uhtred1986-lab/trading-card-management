CREATE TABLE "join_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_join_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sl_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"owner" text NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sl_accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "player_devices" ADD CONSTRAINT "player_devices_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_join_codes" ADD CONSTRAINT "player_join_codes_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "join_attempts_key_idx" ON "join_attempts" USING btree ("key_hash","created_at");--> statement-breakpoint
CREATE INDEX "player_devices_player_idx" ON "player_devices" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "player_join_codes_hash_unique" ON "player_join_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "player_join_codes_player_idx" ON "player_join_codes" USING btree ("player_id");--> statement-breakpoint
-- Every existing password login becomes a player under the same owner name, so their cards and decks stay theirs (docs/architecture/auth.md).
INSERT INTO "players" ("name", "owner", "created_by") SELECT "username", "owner", 'migration 0042' FROM "app_users" ORDER BY "username";
