---
name: arena-work
description: Use before doing any work on the arena rules engine (src/lib/arena/, docs/arena-*.md) — the compiler, the two engines, the rules language, the workbench, or the UI. Points to the cheap entry docs and search patterns instead of reading engine source or every spec doc.
---

# Arena work — start here, not in the engine source

`src/lib/arena/` is ~23k lines and `docs/` has 20+ `arena-*.md` files (one is 2,465 lines). Reading
these cold burns most of a session's budget before any code changes. Do this instead:

## 1. Orient cheaply

Read, in this order, only as far as you need:

1. `docs/arena-next-session-prompt.md` — where the programme stands right now, priority order.
2. `docs/arena-tooling.md` — what `verify-arena`, `arena:probe`, `arena:tally`, `arena:readings`,
   `arena:diff` each prove, and which failing suite means what.
3. `src/lib/arena/glossary.ts` (rendered at `/arena/rules/keywords`) — what the engine understands
   about a keyword/skill type, before assuming it needs teaching.

The arena architecture notes (one paragraph per module: module, one rule, doc) live in
`docs/architecture/arena.md` since issue #382 — for the full narrative on how a module fits
together, read `docs/arena-code-map.md`. Do **not** open that, `arena-design-proposal.md`,
`arena-rules-worklist.md`, `arena-workflow-spec.md`, `arena-client-contract.md`, etc. unless the
task is specifically about that area. Large docs, **grep, don't read**: `arena-history-lessons.md`
(199 KB), `arena-rules-worklist.md` (158 KB), `arena-ruleset-spec.md` (100 KB),
`arena-code-map.md` (69 KB), `arena-rules-language.md` (64 KB), `arena-next-stage-spec.md` (60 KB).
Grep them for the term you need first:

```bash
grep -rln "keyword you're chasing" docs/arena-*.md
```

## 2. Find code by symbol, not by file

`compile/effects.ts` (2,775 lines), `engine/engine.ts` (3,293), `vm/script.ts` (2,223), `engine/state.ts` (2,451) are too
large to read whole. Grep for the function/type name, then Read with `offset`/`limit` around it.

## 3. Fast feedback loop

For pure rule-logic changes, skip the DB-backed suite:

```bash
npx tsx scripts/verify-rules.ts && npx tsx scripts/verify-arena.ts
```

Run the full `npm test` (adds `verify-db.mts`, which boots PGlite + migrations) only before
finalizing. Never run `npm run sync:catalog` or `sync:prices` just to inspect state — they hit
real network endpoints (~30-50s).

## 4. If the change touches what the compiler understands

Update `src/lib/arena/glossary.ts` in the same commit (required by CLAUDE.md's Conventions
section) — this is a doc-as-code file, not a separate documentation task.
