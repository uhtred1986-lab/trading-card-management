---
title: "Arena F1-05: gates — one list of the games the arena plays replaces every game === \"dbs\""
issue: 1188
milestone: Arena F1 — Fusion World: the four launch starter decks
labels: backlog, ready-for-agent, area:arena-ui, area:arena-vm, phase:fusion-world, model:haiku-4-5
stage: fusion-world
priority: P2
touches: src/lib/catalog/games.ts, src/lib/arena/load.ts, src/lib/arena/deck-api.ts, src/lib/arena/offline-decks.ts, src/lib/arena/matches.ts, src/lib/arena/rules-store.ts, src/lib/arena/rules-progress.ts, src/lib/arena/local/pack.ts, src/app/arena/page.tsx, src/app/arena/match/[id]/page.tsx, src/app/arena/rules/sandbox-actions.ts
---
Tracking: Arena F1. Depends on F1-01 (the engine accepts a `game` from the deck). Plan:
`docs/arena-fusion-world-plan.md` §3. Priority P2, size S, Haiku: a mechanical replacement with a
clear list.

## Why

Every place the arena decides whether a deck or card may enter it says `game === "dbs"` or
`eq(decks.game, "dbs")`. That was the owner's 4 Sep 2026 scope rule written 30 times. It becomes one
list, so turning Fusion World on is one edit and turning it off again is the same edit.

## Build

1. **`src/lib/catalog/games.ts`**: add `arena: boolean` to `GameInfo` ("whether the arena plays this
   game") — `dbs: true`, `fusion: true` once this issue lands; export
   `ARENA_GAMES = GAMES.filter((g) => GAME_INFO[g].arena)` and `arenaPlays(game: unknown): boolean`.
   Rewrite the file's header comment ("The arena engine is deliberately **not** parameterised…") to
   say the arena plays the games flagged `arena`, by their own ruleset directory.
2. Replace each site, keeping the surrounding behaviour and error text:
   - `src/lib/arena/load.ts` `deckInputFor`: `if (!arenaPlays(deck.game)) return null;` and the comment.
   - `src/lib/arena/deck-api.ts`: the "decks are not played in the arena" reason uses `arenaPlays`.
   - `src/lib/arena/offline-decks.ts`, `src/lib/arena/matches.ts` (the shareable-deck query:
     `inArray(decksTable.game, ARENA_GAMES)`), `src/lib/arena/rules-store.ts` (the drafter's card
     query: `inArray(cards.game, ARENA_GAMES)`), `src/lib/arena/rules-progress.ts` (the eligible-deck
     rule and its header comment).
   - `src/app/arena/page.tsx`, `src/app/arena/match/[id]/page.tsx`: `listDecks(db, { game: … })` is
     called per arena game (or `listDecks` grows a `games` option — pick the smaller diff and say which
     in the PR); the deck pickers show a game badge (`GAME_INFO[g].short`) when more than one arena game
     has decks.
   - `src/app/arena/rules/sandbox-actions.ts`: the card search and the `dbsIds` set use `ARENA_GAMES`.
   - `src/lib/arena/local/pack.ts`: `game: "dbs"` as a literal type stays `"dbs"` — offline packs are
     dbs-only in this milestone (plan §1); add a comment saying so and why.
   - `src/lib/catalog/deckplanet.ts` `draftTouched`: leave for F1-08.
3. `grep -rn '"dbs"' src/lib/arena src/app/arena src/components/arena` after the change: every
   remaining hit is one of the `vm/` engine guards (`battle.ts`, `flow.ts`, `unique.ts`,
   `unison-zero.ts`, `capability-inventory.ts`), `local/pack.ts`, `replay-core.ts`,
   `probe-report.ts` or `rulesets/`; list the remaining hits in the PR body with a one-line reason each.
4. `scripts/verify/guards.ts` must still pass: no guard (`requireSl`/`currentScope`) is touched.

## Out of scope

Board rendering for a Fusion World game (F1-06); offline packs; the drafter (F1-08).

## Acceptance

- `npm run checks`, `npm test`, `npm run build`.
- `npm run shots:compare -- /arena /decks` (skill `screen-proof`): `/arena` lists a `fusion` deck when
  one exists; with none, the page is pixel-identical.
- Scenario proof: with a local PGlite-seeded or dev database holding one Fusion World deck with a
  leader and 50 main cards, `deckInputFor` returns an input with `game: "fusion"` (a scratch `tsx`
  call pasted in the PR), and the match page offers it. If no local database is available, say so and
  name it as the owner's check.
