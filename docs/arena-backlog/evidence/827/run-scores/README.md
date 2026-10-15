# Imported policy/deck scores

The run detail page computes descriptive policy-version and deck-composition
scores from the entire immutable manifest. Paging and outcome filters affect the
case table only. Policy version + source digest and exact deck composition hashes
keep revisions apart; absent composition hashes stay fixture/seat-specific.

The frozen 320-game artifact produces candidate 142–178 and baseline 178–142.
Deck mirrors expose distinct games separately from seat appearances. Draws,
interruptions, limits and illegal outcomes never enter W/(W+L).

Validation: `scripts/verify/arena-testing-run-stats.mts` checks the retained real
320-game artifact, mirrors, opposite seats, missing hashes, version collisions
and unfinished outcomes. `arena-testing-data.mts` proves persisted lookup and
filter-independent totals on PGlite.

Before/after browser captures use the same local-only imported artifact at
390 and 1440 pixels. No viewport overflow; both policy and both deck rows are
present, and page 2 filtered to wins retains all 320 games in the scoreboard.
Mobile scores use readable cards; desktop uses tables. Browser and dev servers
were stopped. No production data was written by this proof.
