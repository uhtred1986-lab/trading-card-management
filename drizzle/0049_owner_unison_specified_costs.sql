-- The owner's ruling of 13 Oct 2026 (offline deck audit U7, #649/#655): both
-- red Unison cards print "Energy (Color Cost): X(RR)", so their specified cost
-- is two red. Entered here as BT19-039 was in 0034; the catalog upsert
-- coalesces the column, so a later sync keeps it. A database without these
-- rows yet updates nothing.
UPDATE "cards" SET "specified_cost" = '{r}{r}' WHERE "id" IN ('SD15-02', 'DB3-001') AND "specified_cost" IS NULL;
