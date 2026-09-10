# Arena current state (short)

Last updated: 10 Sep 2026

This file is the short, always-current arena state-of-the-world summary.
Keep it under 200 lines. Update it whenever arena scope, priorities, or the
"what to read first" order changes.

## Where the programme stands right now

- The arena is playable for **Dragon Ball Super (`dbs`) decks only**.
- The production flow is still: catalog sync drafts/updates `card_rules`,
  the engine plays from those rows, and unresolved wording is escalated via
  the referee workflow.
- Two engines exist (`legacy`, `rules`), but only `legacy` is playable today;
  `rules` is scaffolded and intentionally throws `EngineNotBuilt` when selected.
- The immediate day-to-day work remains improving wording coverage and avoiding
  wrongly-read clauses (prefer unread over wrong reads).

## Current priority order (session start)

1. Read `docs/arena-next-session-prompt.md` for the detailed hand-off and
   priority queue.
2. Read `docs/arena-tooling.md` for validation discipline and script meaning.
3. Use `docs/arena-INDEX.md` to choose whether a spec is current authority or
   historical background before deep reading.

## Which docs are authoritative vs superseded

- **Authoritative list:** `docs/arena-INDEX.md` is the single maintained map of
  each `docs/arena-*.md` file's status (`Current`, `Current (planned)`,
  historical/review background).
- **Detailed current hand-off:** `docs/arena-next-session-prompt.md` remains the
  canonical long-form "what next" document.
- **Superseded/historical docs:** treat any file marked historical in
  `docs/arena-INDEX.md` as background context, not the current source of truth.

## Maintenance convention

- Keep this file short and high-signal; link out instead of duplicating long
  specs.
- When updating statuses, update `docs/arena-INDEX.md` in the same change.
- When priorities move, update this file and
  `docs/arena-next-session-prompt.md` together.
