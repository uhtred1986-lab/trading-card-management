# Arena current state (short)

Last updated: 13 Sep 2026

This file is the short, always-current arena state-of-the-world summary.
Keep it under 200 lines. Update it whenever arena scope, priorities, or the
"what to read first" order changes.

## Where the programme stands right now

- The arena is playable for **Dragon Ball Super (`dbs`) decks only**.
- The production flow is still: catalog sync drafts/updates `card_rules`,
  the engine plays from those rows, and unresolved wording is escalated via
  the referee workflow.
- Two engines exist (`legacy`, `rules`), but only `legacy` is playable today.
  `rules` is `src/lib/arena/vm/`: `engineFor("rules")` resolves it and it can
  **make a game and deal the opening board** — a side is a map of the zones
  `zones.rules` declares, a card is a bag of the attributes `attributes.rules`
  declares, and from the same seed the hands, life piles and decks are card for
  card the ones the legacy engine deals. Every other call throws `NotYet` naming
  the issue that builds it (#140 the flow, #141 the log, #142 effects and
  prompts), and `playableEngine("rules")` still throws `EngineNotBuilt` so no new
  game can be started on it.
- `npx tsx scripts/arena-fuzz.mts 40 --engine rules` is the dealing fuzz for that
  engine: forty real deck pairings created and the board checked, no moves.
- The immediate day-to-day work remains improving wording coverage and avoiding
  wrongly-read clauses (prefer unread over wrong reads).
- `docs/arena-ruleset-spec.md` is the interpreter contract for the `rules`
  engine: what is configuration and what is code, how a primitive or a game is
  added, and the oracle protocol that gates each stage. Sections 2–4 (the
  primitives table, the definition files, the hook contract) are headings the
  stage issues fill.

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
