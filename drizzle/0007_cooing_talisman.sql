-- One row per physical card.
--
-- Any lot that held more than one copy is fanned out into that many rows first,
-- copying every attribute, so nothing is lost when the count column goes away.
-- generate_series is an implicit LATERAL here: it sees each row's own quantity.
INSERT INTO "owned_cards" ("print_id", "card_id", "condition", "finish", "language", "acquired_on", "price_paid_cents", "currency", "notes", "owner", "created_at", "updated_at")
SELECT o."print_id", o."card_id", o."condition", o."finish", o."language", o."acquired_on", o."price_paid_cents", o."currency", o."notes", o."owner", o."created_at", now()
FROM "owned_cards" o, generate_series(2, o."quantity")
WHERE o."quantity" > 1;
--> statement-breakpoint
ALTER TABLE "owned_cards" DROP COLUMN "quantity";
