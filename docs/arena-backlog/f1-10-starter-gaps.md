---
title: "Arena F1-10: the last Fusion World starter gaps — FS02-03 and FS03-13 effects, and skill-driven combos without a printed combo cost"
issue: 1208
milestone: Arena F1 — Fusion World: the four launch starter decks
labels: backlog, ready-for-agent, area:arena-compiler, area:arena-vm, phase:fusion-world, model:sonnet-5
stage: fusion-world
priority: P2
touches: src/lib/arena/compile/effects.ts, src/lib/arena/compile/targets.ts, src/lib/arena/vm/activate.ts, src/lib/arena/vm/auto-costs.ts, src/lib/arena/vm/script.ts, src/lib/arena/glossary.ts, scripts/verify/arena-fusion-world.mts
---
Tracking: Arena F1 (#1193). Found by F1-04 (#1196) and F1-07 (#1205). Priority P2, size M, Sonnet, with a
`/code-review` pass on Opus before merge (compiler and engine).

## Why

Two of the 64 starter cards still compile with unread text, and they are the only cards that interrupt
Fusion World play: in `npm run arena:fuzz -- 200 --game fusion` (#1205) all 49 interrupted games, and all 5
interrupted local-policy games in `scripts/verify/arena-fusion-world.mts`, stop on one of them. Both are
gaps in the shared effect readers, not in Fusion World spelling: they stay unread when written the dbs way.

- **FS02-03 Gotenks (SR)**: `[On Play] If you have 7 or fewer cards in your hand, add up to 1 <Son Goten>
  and up to 1 <Trunks : Youth> —both with a cost of 2 or less— from your Drop to your hand.` Two named
  picks under one shared aside ("—both with a cost of 2 or less—").
- **FS03-13 Moah**: `[On Play] Look at 5 cards from the top of your deck, reveal up to 1 <Paragus> or up to 1
  Extra and add it to your hand. Place the rest at the bottom of your deck in a random order.` A look-at-N
  search whose filter is "a name OR a card type".

A third gap of the same family: F1-07 made `canCombo(def, free)` allow a combo with no printed combo cost
when the game declares no combo price, but three skill-driven paths still call `canCombo(def)` without the
flag — `vm/activate.ts` (activation costs that use a card in a combo), `vm/auto-costs.ts` (an [Auto]'s
combo-cost price) and `vm/script.ts` (the program op that puts a card into a combo). No starter card uses
them; any Fusion World card that does would be refused.

## Build

1. The FS02-03 reader: two (or more) "up to 1 <Name>" picks sharing one trailing aside, each pick its own
   selector with the aside's filter applied to both. Search `compile/effects.ts` and `compile/targets.ts` for
   the existing "add up to 1 <X> … from your Drop to your hand" reader and extend it; do not add a
   Fusion-only path.
2. The FS03-13 reader: "reveal up to 1 <Name> or up to 1 <Type>" as one pick over the union filter; the
   look-at-N, add-to-hand and rest-to-bottom-at-random parts already read on dbs cards (grep a dbs card with
   "Look at 5 cards from the top of your deck" for the existing op).
3. Pass `comboPriceOf(game) === null` to `canCombo` at the three call sites above (`comboPriceOf` is exported
   from `vm/battle.ts`), so a Fusion World skill-driven combo is allowed exactly as the battle combo is.
4. Glossary entries for both readings in the same commit (`CLAUDE.md` hard rule).
5. `scripts/verify/arena-fusion-world.mts`: remove the two cards from the known-unread list; the fuzz and
   policy games must then complete with zero interruptions.

## Out of scope

Any other Fusion World set; energy-icon prices; [Barrier]/[Counter]/[Rush].

## Acceptance

- `npm run checks`, `npm test` (the Fusion World suite with no known-unread cards and zero interrupted games).
- `npm run arena:fuzz -- 200 --game fusion`: 200 completed, 0 interrupted, 0 crashes.
- `npm run arena:readings` and `npm run arena:tally` on main vs the branch: the dbs diff is reviewed and
  listed in the PR card by card (new readings are expected only where a dbs card prints the same shapes).
- One scenario per card in the Fusion World suite: FS02-03 adds both named cards from the Drop under the
  hand-size condition; FS03-13 reveals a <Paragus> or an Extra and the rest go to the bottom.
