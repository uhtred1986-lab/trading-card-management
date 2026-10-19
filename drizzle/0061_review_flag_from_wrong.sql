-- One flag (rules PR 1): the phone review's "Wrong" used to be a text prefix at the start of
-- card_rules.explanation; it now lives in card_rules.review_flag, beside the flag claude.ai review
-- writes. Copy the old flags across (the first line is the flag; anything after the blank line is
-- the explanation it was prefixed to). Data only and additive: explanation is never edited, and a
-- row that already has a review_flag keeps it.
UPDATE "card_rules"
SET "review_flag" = split_part("explanation", E'\n', 1)
WHERE "review_flag" IS NULL
  AND "explanation" LIKE 'Wrong (phone review)%';
