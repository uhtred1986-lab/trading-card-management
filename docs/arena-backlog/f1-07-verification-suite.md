---
title: "Arena F1-07: verification — a Fusion World suite in npm test and fuzz on the four starters"
issue: 1190
milestone: Arena F1 — Fusion World: the four launch starter decks
labels: backlog, ready-for-agent, area:arena-vm, phase:fusion-world, model:sonnet-5
stage: fusion-world
priority: P2
touches: scripts/verify/arena-fusion-world.mts, scripts/verify-arena.ts, scripts/arena-fuzz.mts, scripts/verify/fixtures/arena-fusion-world/
---
Tracking: Arena F1. Depends on F1-02, F1-03, F1-04 (ruleset, engine differences, compiler). Plan:
`docs/arena-fusion-world-plan.md` §4, §5. Priority P2, size M, Sonnet, `/code-review` on Opus before
merge. Card text: `docs/arena-fusion-world-starters.md`.

## Why

Nothing in `npm test` plays a Fusion World game. The milestone's exit criterion is a game that plays
to life-out on the rules engine; this suite is the proof that survives the owner's next change.

## Build

1. **Fixtures** `scripts/verify/fixtures/arena-fusion-world/`: the four starter decklists as JSON
   (leader + 50 main with quantities, from the starters doc: FS01 and FS03 quantities are in the doc's
   deck sections; FS02 and FS04 are 4× of every Common and 2× of every SR unless the doc says
   otherwise — say in the fixture header where each count came from), and the 64 card definitions as
   `CardDef`s built the way `scripts/verify/arena-policy-choices.mts` builds synthetic cards, with
   `game: "fusion"`, `comboCost: null`, `specifiedCost` unset (F1-08 is the owner's data task; the
   suite pays colourless until then and says so).
2. **Compiled programs**: compile every definition's skills with `compileCardCached` and fail the suite
   on any `unread` (F1-04's table, now as a gate).
3. **Scripted scenarios** in `scripts/verify/arena-fusion-world.mts` (F1-03 started it), each a game
   created with `game: "fusion"` from two fixtures, driven by `legalActions`/`apply` with a fixed seed:
   - setup: 6-card hands, 8 life each, second player has one energy marker, no Z-Deck zone in the
     state, first player cannot attack on turn 1;
   - charge and play: a 1-cost card paid by resting one energy; a marker paying a cost;
   - attack and damage: leader attack → one life card to the defender's hand; a rested battle card
     attacked and KO'd; ties go to the attacker;
   - combo: a card from hand and an active battle card from the field, no payment prompt, both in the
     Drop at battle end (F1-03 a);
   - [Blocker] redirect; [Critical] sends the life card to the Drop; [Double Strike] takes two;
   - `[On Play]`, `[When Attacking]`, `[When KO'd]`, `[End of Your Turn]` each fire once at the right
     moment on one starter card each (FS01-03, FS01-01 front, a `[When KO'd]` card, the
     `[End of Your Turn]` card — ids from the doc's tally);
   - [Awaken] at life ≤ 4: offered in the Main Phase, draws, flips;
   - a card at power 0 goes to the Drop without a `koed` event (F1-03 b);
   - life-out ends the game with `WIN lifeOut`; deck-out with `deckOut`.
4. **Full games**: `scripts/arena-fuzz.mts` gains `--game fusion` that draws the two decks from the
   fixtures; 40 random complete games in the suite, 200 locally (`npm run arena:fuzz -- 200 --game
   fusion`), reporting crashes and any prompt the engine could not answer.
5. **Local policy**: one game per starter pair where seat 2 is `localPolicy` (`policy/boundary.ts`),
   run to completion or `interrupted`; an interruption is a failure that names the decision kind.
6. Add `import "./verify/arena-fusion-world"` to `scripts/verify-arena.ts`.

## Out of scope

Policy strength evaluation; browser runs; offline packs; the real catalog rows (F1-08).

## Acceptance

- `npm run checks`, `npm test` (the new suite in the chain), `npm run arena:fuzz -- 200 --game fusion`
  clean, `npm run arena:fuzz -- 40` (dbs) unchanged.
- PR body: the scenario list with pass marks, the fuzz summary, and the policy games' outcomes.
