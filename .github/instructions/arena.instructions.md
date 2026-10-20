---
applyTo: "src/lib/arena/**,src/components/arena/**,docs/arena-*.md,scripts/arena-*.mts,scripts/verify-arena.ts"
---

# Arena work

`src/lib/arena/` is ~23k lines and `docs/` has 20+ `arena-*.md` files (one is 2,465 lines).
Reading these cold burns most of a task's budget before any code changes. Do this instead:

## 1. Orient cheaply

Read, in this order, only as far as needed:

1. `docs/arena-next-session-prompt.md` — where the programme stands right now, priority order.
2. `docs/arena-tooling.md` — what `verify-arena`, `arena:probe`, `arena:tally`, `arena:readings`,
   `arena:diff` each prove, and which failing suite means what.
3. `src/lib/arena/glossary.ts` (rendered at `/arena/rules/keywords`) — what the engine already
   understands about a keyword/skill type, before assuming it needs teaching.

Do not open `arena-design-proposal.md`, `arena-rules-worklist.md`, `arena-workflow-spec.md`,
`arena-client-contract.md`, etc. unless the task is specifically about that area — search them for
the term you need first instead of reading each in full.

## 2. Find code by symbol, not by file

The compiler implementation now lives under `src/lib/arena/compile/`; `compile.ts` is the
stable public barrel. `vm/script.ts` (2,223, the record interpreter) and the legacy
`engine/engine.ts` (3,293) and `engine/state.ts` (2,451) are still too large to read whole. Search for the function/type name, then view only the surrounding lines.

## 3. Fast feedback loop

`npm run checks` after each commit; the full policy is `docs/agent-brief.md` → "Checking a change".
`verify-arena.ts` alone takes about 7 minutes. Never run `npm run sync:catalog` or `sync:prices` just to
inspect state: they hit real network endpoints.

## 4. If the change touches what the compiler understands

Update `src/lib/arena/glossary.ts` in the same change (a hard rule in CLAUDE.md) — this is a doc-as-code file, not a separate documentation task.
