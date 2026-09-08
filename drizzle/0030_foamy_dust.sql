ALTER TABLE "card_rules" ADD COLUMN "brief" text;--> statement-breakpoint
ALTER TABLE "card_rules" ADD COLUMN "times_seen" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "card_rules" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
-- What card_text_notes still held that card_rules did not: the brief for teaching the
-- compiler a wording, what the owner said a card means, and how often it has come up in
-- a game. The measurement it was built for — which clauses the compiler cannot read —
-- has lived on card_rules.unread since migration 0027, one row per skill.
--
-- Copied before the drop, per the order migration 0028 established. Notes carry no side,
-- so they land on the front face they were always filed against; the newest brief and the
-- newest explanation win, and an explanation already on the rule row is never overwritten,
-- because that one is the person's or Claude's own words about the program.
UPDATE "card_rules" r SET
  "brief" = n."brief",
  "explanation" = coalesce(r."explanation", n."explanation"),
  "times_seen" = n."times_seen",
  "last_seen_at" = n."last_seen_at"
FROM (
  SELECT "card_id", "skill_index",
         (array_agg("brief" ORDER BY "explained_at" DESC NULLS LAST, "id" DESC) FILTER (WHERE "brief" IS NOT NULL))[1] AS "brief",
         (array_agg("explanation" ORDER BY "explained_at" DESC NULLS LAST, "id" DESC) FILTER (WHERE "explanation" IS NOT NULL))[1] AS "explanation",
         coalesce(sum("times_seen"), 0)::int AS "times_seen",
         max("last_seen_at") AS "last_seen_at"
  FROM "card_text_notes"
  GROUP BY "card_id", "skill_index"
) n
WHERE r."card_id" = n."card_id" AND r."skill_index" = n."skill_index" AND r."side" = 'front';--> statement-breakpoint
DROP TABLE "card_text_notes" CASCADE;
