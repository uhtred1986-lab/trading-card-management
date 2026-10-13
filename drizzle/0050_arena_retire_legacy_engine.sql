-- #118: the legacy arena engine is deleted (owner, 13 Oct 2026), and the owner
-- ruled that games saved on it are deleted with it.
--
-- A game was saved on the legacy engine when its `engine` column says anything
-- but `rules` AND its `state` is not the rules engine's shape (`VmState` carries
-- `engine: "rules"` at the top level; a legacy `GameState` never did). Both
-- tests must hold, so a rules game whose column kept the old default `legacy`
-- is never touched, and the app reads the state's shape either way.
--
-- What goes: those rows of `arena_games`, and the rows that hang off them:
--   arena_decisions, arena_ai_usage, arena_advance_calls, arena_flags
--     (ON DELETE CASCADE; deleted explicitly first as well, because
--     0032 shows these tables were once repaired by hand on some databases);
-- What stays: `arena_matches` (its `game_id` is set null, as the FK says),
--   `arena_feedback` and the obsolete `arena_bug_reports` that 0032 recreated
--   (reports keep their own copy of the state and actions; `game_id` is set
--   null), every `ai_runs` row (the billing
--   ledger has no foreign key to a game), `arena_rule_bundles` (immutable,
--   content-addressed) and every rules-engine game.
--
-- Additive-only otherwise: the two `engine` columns stay, their default becomes
-- `rules`.
DELETE FROM "arena_decisions" WHERE "game_id" IN (SELECT "id" FROM "arena_games" WHERE "engine" IS DISTINCT FROM 'rules' AND ("state"->>'engine') IS DISTINCT FROM 'rules');--> statement-breakpoint
DELETE FROM "arena_ai_usage" WHERE "game_id" IN (SELECT "id" FROM "arena_games" WHERE "engine" IS DISTINCT FROM 'rules' AND ("state"->>'engine') IS DISTINCT FROM 'rules');--> statement-breakpoint
DELETE FROM "arena_advance_calls" WHERE "game_id" IN (SELECT "id" FROM "arena_games" WHERE "engine" IS DISTINCT FROM 'rules' AND ("state"->>'engine') IS DISTINCT FROM 'rules');--> statement-breakpoint
DELETE FROM "arena_flags" WHERE "game_id" IN (SELECT "id" FROM "arena_games" WHERE "engine" IS DISTINCT FROM 'rules' AND ("state"->>'engine') IS DISTINCT FROM 'rules');--> statement-breakpoint
UPDATE "arena_matches" SET "game_id" = NULL WHERE "game_id" IN (SELECT "id" FROM "arena_games" WHERE "engine" IS DISTINCT FROM 'rules' AND ("state"->>'engine') IS DISTINCT FROM 'rules');--> statement-breakpoint
UPDATE "arena_feedback" SET "game_id" = NULL WHERE "game_id" IN (SELECT "id" FROM "arena_games" WHERE "engine" IS DISTINCT FROM 'rules' AND ("state"->>'engine') IS DISTINCT FROM 'rules');--> statement-breakpoint
UPDATE "arena_bug_reports" SET "game_id" = NULL WHERE "game_id" IN (SELECT "id" FROM "arena_games" WHERE "engine" IS DISTINCT FROM 'rules' AND ("state"->>'engine') IS DISTINCT FROM 'rules');--> statement-breakpoint
DELETE FROM "arena_games" WHERE "engine" IS DISTINCT FROM 'rules' AND ("state"->>'engine') IS DISTINCT FROM 'rules';--> statement-breakpoint
ALTER TABLE "arena_games" ALTER COLUMN "engine" SET DEFAULT 'rules';--> statement-breakpoint
ALTER TABLE "arena_matches" ALTER COLUMN "engine" SET DEFAULT 'rules';
