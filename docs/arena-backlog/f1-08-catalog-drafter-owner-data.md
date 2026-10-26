---
title: "Arena F1-08: catalog and drafter — draft the Fusion World cards; the owner's data tasks"
issue: 1191
milestone: Arena F1 — Fusion World: the four launch starter decks
labels: backlog, needs-owner-ruling, area:arena-compiler, phase:fusion-world, model:sonnet-5
stage: fusion-world
priority: P2
touches: src/lib/catalog/deckplanet.ts, src/lib/arena/draft.ts, src/db/schema.ts, drizzle/
---
Tracking: Arena F1. Depends on F1-04 (the compiler reads Fusion World text) and F1-05 (the rules
queue lists Fusion World cards). Plan: `docs/arena-fusion-world-plan.md` §4, §6. Priority P2, size S
for the agent plus the owner's data tasks. `needs-owner-ruling` for the three rulings below; the code
part is ready.

## Why

The drafter never runs over Fusion World cards (`draftTouched` in `src/lib/catalog/deckplanet.ts`
returns early for `fusion`), and the Fusion World catalog rows have no specified costs: the deckplanet
feed carries no cost orbs for either game, and the dbs ones were hand-entered (migration 0034 and the
workbench). Without a rule row a card is `text-only` by rule health and the deck is `open` by
readiness, so nothing plays.

## Build (agent)

1. `src/lib/catalog/deckplanet.ts` `draftTouched`: run for every game in `ARENA_GAMES` (F1-05), not
   `dbs` alone; the Claude review step keeps its budget and its default.
2. `src/lib/arena/draft.ts`: confirm `draftCards` reads `cards.game` into the `CardDef` (`cardDefFrom`
   in `load.ts`) so `compileCardCached` sees `game: "fusion"`; nothing else should be game-specific.
3. `npm run arena:draft -- FS01-01 … FS04-16` is the owner's to run (Neon); the PR names the exact
   command and the 64 ids.

## Owner data tasks (recorded here so the milestone lists them; the owner runs each)

- **Confirm the catalog**: `select id, skill, back_skill from cards where id like 'FS0_-%' order by id`
  returns 64 rows with skill text matching `docs/arena-fusion-world-starters.md`. Differences go to
  `errata.ts` (never an `UPDATE`), and the starters doc is corrected in the same PR.
- **Specified costs** for the 60 non-leader starter cards, read from the physical cards (the card site
  lists none): entered through the workbench or seeded by one migration on the owner's ruling, as 0034
  did — never by hand-written SQL.
- **Ruling 1** (plan §6.1): power reduced to 0 in the original game — stored with `npm run arena:rule`.
- **Ruling 2** (plan §6.2): the FS03-01 Broly back face — does it print `[When Attacking] Draw 1 card`?
- **Ruling 3**: `firstPlayerDraws` — the manual v1.10 says the first player skips the draw; the
  1 Jul 2024 change lets them draw. Which does the arena play? One line in `fusion/game.rules`.
- **Rule review**: the 64 cards on `/arena/rules` to `done` (skill `rules-review-batch`).
- **Decks**: the four starters built as owner decks with `game = "fusion"`.

## Out of scope

Any Neon write by an agent; images (the fusion sync already takes Bandai's art).

## Acceptance

- Agent: `npm run checks`, `npm test`; the drafter's unit path over a synthetic `fusion` card writes a
  `card_rules` row on PGlite (extend the existing drafter test if one exists, else a scratch proof in
  the PR).
- Owner: the 64 rules `done`, the four decks `ready` by readiness, the three rulings stored and filed.
