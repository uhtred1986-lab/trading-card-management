---
title: Arena: player attributes in the rules language — growUnison (13-3) and the charge's one turn as one row
milestone: Arena M8 — Rules engine actions and costs (Stage 5)
labels: backlog, ready-for-agent, enhancement, area:arena-lang, area:arena-vm, area:arena-rulesets, phase:rules-stage5, model:opus-5
stage: 5
issue: 269
touches: src/lib/arena/rulesets/dbs/attributes.rules, src/lib/arena/engine/script-schema.ts, src/lib/arena/vm/program.ts, src/lib/arena/rulesets/dbs/actions.rules, scripts/verify/vm.ts, scripts/verify/lang.ts, docs/arena-rules-language.md, docs/arena-ruleset-spec.md
---
**Source:** #146 (owner's decision of 13 Sep 2026: "add player attributes now"); `src/lib/arena/rulesets/dbs/actions.rules` (the charge's header note on the "honest long-run shape", and the `growUnison` gap written beside the play family); `src/lib/arena/rulesets/dbs/attributes.rules` (the player's energy markers — the one player attribute declared today); `src/lib/arena/vm/program.ts` (`condHolds`, `amount`); `src/lib/arena/engine/script-schema.ts` (`COND_SCHEMA`, `OP_SCHEMA`); the legacy `growUnison` handler and `whyNotGrowUnison` in `src/lib/arena/engine/engine.ts`; `scripts/verify/vm.ts` §16 and §18; rule manual 13-3, 7-2-11.

**Problem.** Two gates in the DBS definition are facts about a *player*, and the language has no word for one. 13-3's `growUnison` ("you have not already grown a Unison this turn") is therefore not declared and is refused `NotYet` on the rules engine; 7-2-11's one charge per turn is declared as `REFUSE oncePerTurn(what: "charge") UNLESS asking(prompt: charge)` — which question is on the table standing in for the fact. The owner chose to add the attribute rather than wait for a second consumer.

**Build.**
1. `DEFINE ATTRIBUTE` on a player in `attributes.rules`: a declaration whose subject is the player (`of: player`, or whatever `docs/arena-rules-language.md` §3b's shape allows), typed boolean or counter, with a declared reset (`reset: turnStart` on the step, so the ceiling is in the declaration). First two: `charged` and `grewUnison`, both per turn.
2. One `Cond` row to read it and one op row to set it, in `COND_SCHEMA`/`OP_SCHEMA` so the printer, the parser, the chip editor and the referee's legend follow (`parse(print(x))` over the new rows in `scripts/verify/lang.ts`). The legacy evaluator cases in `engine/script.ts` are refactor-grade: read off the `PlayerState` field that already holds the fact where one exists, otherwise inert and saying so.
3. `vm/program.ts` reads the attribute through its declared layers; `VmState`'s player record carries it (state version bump); the reset happens where the declaration says, not in `endTurn` by name.
4. Declare `growUnison` in `actions.rules` with the gates in `whyNotGrowUnison`'s order, so the first refusal is the same on both engines (`verify/vm.ts` §18 compares it card for card).
5. Rewrite the charge's once-per-turn `REFUSE` as one row over `charged`, keeping the same first refusal and wording (`verify/vm.ts` §16 asserts it).
6. `docs/arena-rules-language.md` §3b and `docs/arena-ruleset-spec.md` §3 (the attributes row) gain the shape; the glossary only if what the engine does with card text changes.

**Out of scope.** The X answer on `DEFINE ACTION` (its own issue, split from the same decision); `offering` (22-33) and [Empower]'s arrival carry (#157).

**Acceptance.**
- Gate; `npm run arena:fuzz -- 40 --engine rules` 0 crashes.
- `scripts/verify/vm.ts` §18: growing a Unison logs the same events on both engines and the first refusal per card is the same; §16 unchanged.
- `scripts/verify/lang.ts` round-trips the new rows; `scripts/verify/rulesets.ts` refuses a condition naming a player attribute no declaration made.
- `npm run contract:emit` no change expected; if a `Prompt` or `Snapshot` field moved, `android:test`.
- `npm run arena:readings` diff empty — no card program changes.
