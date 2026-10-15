CREATE TABLE "arena_testing_run_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"result_key" text NOT NULL,
	"kind" text NOT NULL,
	"fixture_key" text NOT NULL,
	"source_scenario_id" text,
	"portal_scenario_id" text,
	"outcome" text NOT NULL,
	"seed" integer,
	"seat" text,
	"payload" jsonb NOT NULL,
	CONSTRAINT "arena_testing_run_results_kind_check" CHECK ("arena_testing_run_results"."kind" in ('scenario_case','decision_case','policy_game')),
	CONSTRAINT "arena_testing_run_results_outcome_check" CHECK ("arena_testing_run_results"."outcome" in ('pass','fail','interrupted','error','win','loss','draw','limit','illegal')),
	CONSTRAINT "arena_testing_run_results_seat_check" CHECK ("arena_testing_run_results"."seat" is null or "arena_testing_run_results"."seat" in ('p1','p2'))
);
--> statement-breakpoint
CREATE TABLE "arena_testing_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"source" text NOT NULL,
	"runner_id" text NOT NULL,
	"runner_version" text NOT NULL,
	"git_commit" text NOT NULL,
	"dirty_tree_sha256" text,
	"protocol_id" text NOT NULL,
	"protocol_revision" text NOT NULL,
	"seed_set" text,
	"result_count" integer NOT NULL,
	"manifest" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arena_testing_runs_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "arena_testing_runs_source_check" CHECK ("arena_testing_runs"."source" in ('scenario','decision_cases','policy_eval')),
	CONSTRAINT "arena_testing_runs_fingerprint_check" CHECK ("arena_testing_runs"."fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "arena_testing_runs_git_commit_check" CHECK ("arena_testing_runs"."git_commit" ~ '^[a-fA-F0-9]{40}$'),
	CONSTRAINT "arena_testing_runs_dirty_hash_check" CHECK ("arena_testing_runs"."dirty_tree_sha256" is null or "arena_testing_runs"."dirty_tree_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "arena_testing_runs_result_count_check" CHECK ("arena_testing_runs"."result_count" between 1 and 5000)
);
--> statement-breakpoint
ALTER TABLE "arena_testing_run_results" ADD CONSTRAINT "arena_testing_run_results_run_id_arena_testing_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."arena_testing_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "arena_testing_run_results_key_unique" ON "arena_testing_run_results" USING btree ("run_id","result_key");--> statement-breakpoint
CREATE INDEX "arena_testing_run_results_scenario_idx" ON "arena_testing_run_results" USING btree ("portal_scenario_id","outcome");--> statement-breakpoint
CREATE INDEX "arena_testing_run_results_fixture_idx" ON "arena_testing_run_results" USING btree ("fixture_key","kind");--> statement-breakpoint
CREATE INDEX "arena_testing_runs_recorded_idx" ON "arena_testing_runs" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "arena_testing_runs_source_idx" ON "arena_testing_runs" USING btree ("source","recorded_at");
--> statement-breakpoint
CREATE FUNCTION "reject_arena_testing_evidence_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'Arena evaluation evidence is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "arena_testing_runs_immutable" BEFORE UPDATE OR DELETE ON "arena_testing_runs" FOR EACH ROW EXECUTE FUNCTION "reject_arena_testing_evidence_mutation"();--> statement-breakpoint
CREATE TRIGGER "arena_testing_run_results_immutable" BEFORE UPDATE OR DELETE ON "arena_testing_run_results" FOR EACH ROW EXECUTE FUNCTION "reject_arena_testing_evidence_mutation"();
