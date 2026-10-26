---
title: "Arena F1-11: the six flagged Fusion World starter rows — [Super Combo] from the hand, top of the deck, random bottom order"
issue: 1220
milestone: Arena F1 — Fusion World: the four launch starter decks
labels: backlog, ready-for-agent, area:arena-compiler, phase:fusion-world, model:sonnet-5
stage: fusion-world
priority: P2
status: closed
closed_at: 2026-10-26
touches: src/lib/arena/compile/effects.ts, src/lib/arena/compile/targets.ts, src/lib/arena/text/triggers.ts, src/lib/arena/vm/script.ts, src/lib/arena/vm/script-schema.ts, src/lib/arena/glossary.ts, scripts/verify/arena-fusion-world.mts
---
Tracking: Arena F1 (#1193). Found by the rules review of 26 Oct 2026 (receipt
`docs/arena-backlog/evidence/rules-review-2026-10-26/fusion-starters.md`, #1218). Priority P2, size M, Sonnet, with a
`/code-review` pass on Opus before merge (compiler).

## Why

Six of the 61 reviewed Fusion World starter rows were flagged because the stored program does not do what the card
prints. They are the only rows keeping the four starter decks from being fully `done`.

1. **[Super Combo] "from your hand"** — FS01-05 Shin, FS02-10 Videl, FS03-12 King Vegeta, FS04-09 Cheelai: BR, front
   skill 10: `[Auto][Opponent's Turn] When you use this card in a combo from your hand, this card gets +10000 combo
   power.` The stored typed combo record (`combo` column, `vm/combo-qualification.ts`) has `origins: null`, so the
   [Auto] also fires when the card joins a combo from the Battle Area. It must store `origins: ["hand"]`. Check how
   the original game's "when you combo with this card from your hand" wordings set `origins` and reuse that reader.
2. **"Add 1 card from the top of your deck to your energy"** — FS03-16 Destructive Strength, front 0. Stored as
   `choose 1 card in your deck` (any card, the player picks). The top card must be taken with no choice; reuse the
   op the original game uses for "place the top card of your deck in your Energy Area".
3. **"Place the rest at the bottom of your deck in a random order"** — FS03-13 Moah, front 0. #1208 read "in a
   random order" like "in any order", so the rest go to the bottom in the looked-at order. They must go in a random
   order drawn from the game's seeded RNG (reproducible from seed + actions; `vm/rng.ts`). Check whether an op for a
   random bottom order exists already; if not, the smallest change is a shuffle of the moved group before placing.

## Build

- Fix each reading in the compiler (shared readers, not Fusion-only paths). Glossary entries in the same commit.
- `scripts/verify/arena-fusion-world.mts`: one scenario per gap on the real starter cards (a Super Combo from the
  field does not get +10000; FS03-16 takes the top card; FS03-13's bottom order differs across seeds and is the same
  for the same seed).
- `npm run arena:readings` / `arena:tally` on main vs the branch: list every original-game reading that changes, card
  by card, with a verdict.

## Out of scope

Re-drafting or confirming the stored rows: the coordinator re-drafts the six rows in the database after merge (the
`draft.ts` path rewrites only compiler-owned draft rows; flagged rows are still `draft`) and re-reviews them.

## Acceptance

- `npm run checks`, `npm test`, `npm run arena:fuzz -- 200 --game fusion` (200 completed, 0 interrupted).
- The three scenarios above in the Fusion World suite.
- The dbs readings diff listed and judged in the PR body.
