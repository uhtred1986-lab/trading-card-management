-- Anything not yet carried over by scripts/arena-migrate-scripts.mts lands as Claude's
-- corrected row, so it shows up for review rather than being lost; the script's precise
-- classification wins where it has already run (ON CONFLICT DO NOTHING).
INSERT INTO "card_rules" ("card_id", "side", "skill_index", "printed", "kind", "ops", "status", "source", "explanation", "reads", "created_at", "updated_at")
SELECT s."card_id", s."side", s."skill_index", coalesce(s."explanation", ''), 'auto', s."ops", 'corrected', 'claude', s."explanation", coalesce(s."meaning", ''), s."created_at", s."updated_at"
FROM "card_scripts" s
ON CONFLICT ("card_id", "side", "skill_index") DO NOTHING;--> statement-breakpoint
DROP TABLE "card_scripts" CASCADE;
