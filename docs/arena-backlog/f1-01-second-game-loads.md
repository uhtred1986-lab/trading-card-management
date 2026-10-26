---
title: "Arena F1-01: a second game loads — rulesetFor(\"fusion\"), the state's game from the deck, per-game verifier expectations"
issue: 1184
status: closed
closed_at: 2026-10-26
milestone: Arena F1 — Fusion World: the four launch starter decks
labels: backlog, ready-for-agent, area:arena-rulesets, area:arena-vm, phase:fusion-world, model:sonnet-5
stage: fusion-world
priority: P2
touches: src/lib/arena/rulesets/index.ts, src/lib/arena/vm/index.ts, scripts/verify/rulesets.ts, scripts/arena-rulesets-emit.mts, src/lib/arena/rulesets/fusion/index.ts
---
Tracking: Arena F1. Plan: `docs/arena-fusion-world-plan.md` §3, §4. Priority P2, size S, Sonnet.

## Why

The ruleset layer was built so that a second game is "a directory, a regenerated `files.ts` and a row"
(`src/lib/arena/rulesets/index.ts`, the comment on `rulesetFor`). Three places still assume there is
only `dbs`: `rulesetFor` refuses any other id, `src/lib/arena/vm/index.ts` fixes the state's game with
`const ARENA_GAME: Game = "dbs"`, and `scripts/verify/rulesets.ts` asserts the one loaded definition
declares exactly the 15 dbs zones, the 39 dbs keywords and the dbs `GAME` numbers. This issue opens
those three doors so F1-02 can put a `fusion` directory behind them. It ships **with a placeholder
`fusion` ruleset that is a byte-for-byte copy of `dbs`**, so every check stays green and F1-02 only
has to cut.

## Build

1. **`src/lib/arena/rulesets/fusion/`**: copy every `.rules` file from `rulesets/dbs/` unchanged, add
   `index.ts` mirroring `dbs/index.ts` (`FUSION_FILES`, `loadFusion()` calling
   `loadRuleset(FUSION_FILES, "fusion")`), and extend `scripts/arena-rulesets-emit.mts` so it writes
   `fusion/files.ts` (and `fusion/board-words.ts`, the same way it writes `dbs/board-words.ts`) — one
   loop over the game directories instead of the dbs-only paths. Run `npm run arena:rulesets`; the
   generated files are checked in. `--check` must stay green.
2. **`src/lib/arena/rulesets/index.ts`**: `rulesetFor(game)` returns `loadFusion()` for `"fusion"`;
   export `FUSION_FILES`/`loadFusion` beside the dbs pair. Keep the `RulesetError` for an unknown id.
3. **`src/lib/arena/vm/index.ts`**: delete `ARENA_GAME`. The game a state is created with comes from
   the deck input: add `game: Game` to the engine's create input (the type `deckInputFor` already
   returns `game` beside `input` — thread it through `createGame`'s callers in `games.ts`,
   `session.ts`, `browser.ts`, the fuzz and verify scripts; default `"dbs"` where a caller has no deck,
   so nothing else changes). `state.game` (`vm/state.ts`) is the only place the id is stored, and
   `definitionFor(state.game, ctx)` already reads it. Update the comment block above the deleted
   constant to say where the game now comes from.
4. **`scripts/verify/rulesets.ts`**: the dbs assertions stay exactly as they are for the dbs
   definition. Add a second load of `loadFusion()` that asserts only what is true of both games: it
   loads (`ok === true`), `players === 2`, `hand === 6`, `life === 8`, `mulligan === true`, every zone
   a trigger or action names is declared, `vocab.areas` equals the declared zones, and
   `keywords.rules` names a **subset** of `KEYWORD_NAMES` (not the full set — that assertion is
   dbs-only). Put the per-game expectations in a small table at the top of the file so F1-02 edits one
   row when it cuts the zones to 9 and the keywords to 6.
5. Nothing in `vm/` is changed beyond step 3. The `game.id === "dbs"` guards in `vm/battle.ts`,
   `vm/flow.ts`, `vm/unique.ts`, `vm/unison-zero.ts` stay.

## Out of scope

Any content difference between the two rulesets (F1-02); the gates that stop a `fusion` deck reaching
the engine (F1-05) — after this issue a Fusion World deck is still refused by `deckInputFor`.

## Acceptance

- `npm run checks`, `npm test`, `npm run arena:rulesets -- --check`, `npm run arena:fuzz -- 40`.
- `npx tsx scripts/verify/rulesets.ts` passes with both definitions loaded; a one-line scratch
  `rulesetFor("fusion").ok === true` printed in the PR body.
- Scenario proof: `npm run arena:fuzz -- 40` output unchanged in shape; a saved-game replay
  (`scripts/verify/arena-replay*.mts` or the fixtures `verify-arena.ts` already plays) produces the
  same event log before and after, which the existing suites prove.
- `npm run contract:emit` shows no `Snapshot` diff (the state keeps its `game` field; only its source
  changes).
