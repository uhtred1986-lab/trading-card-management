---
title: Arena: the DEFINE grammar in the rules language, with round-trip tests
milestone: Arena M6 — Definitions in the language (Stage 3)
labels: backlog, ready-for-agent, enhancement, area:arena-lang, phase:rules-stage3, model:opus-5
stage: 3
---
**Source:** plan Stage 3 (`docs/arena-backlog.md` §1); `docs/arena-rules-language.md` §2 (the round-trip promise) and §8; `src/lib/arena/lang/{tokens,ast,parse,print}.ts`.

**Problem.** The language reads and writes a *card's* rule. A game's definition needs declarations the grammar does not have: `DEFINE GAME | ATTRIBUTE | ZONE | PHASE | STEP | ACTION | TRIGGER | KEYWORD | COST | WIN | OP`. The parser was written table-driven for exactly this, so the work is grammar and tests, not a rewrite.

**Build.**
1. Extend `lang/ast.ts` with a `Definition` AST — one node per `DEFINE` kind, each with the fields the plan lists (a `ZONE` has `owner`, `visibility`, `ordered`, `single`, `markers`, `inPlay`, `modes`; a `TRIGGER` has an event pattern and a subject binding; a `KEYWORD` has hook-point bodies; an `ACTION` has `WHEN / FOR / COST / DO / REFUSE`; an `OP` has parameters and a body). Fields are declared in a `DEFINE_SCHEMA` table, the way `OP_SCHEMA` declares statements, so the printer, parser and validator follow from the row.
2. `parseDefinitions(text)` / `printDefinitions(defs)` beside `parseRule` / `printRule`; same error shape (`{ line, col, clause, message, expected[] }`, first error wins); `--` comments; `clause` names the `DEFINE` kind.
3. `scripts/verify/lang.ts`: a minimal and a maximal instance of every `DEFINE` kind round-trips; idempotent printing; the doc's own examples parse (`docs/arena-rules-language.md` gets a §3b with the grammar, in the same PR — that is the language documentation issue's acceptance too).
4. Client-safe: no engine import beyond the schemas.

**Out of scope.** Interpreting any definition (Stage 4); the DBS files themselves (separate issues).

**Acceptance.**
- `npm run typecheck && npm run lint && npm test && npm run build`.
- `verify/lang.ts` grows one round-trip case per `DEFINE` kind and one error case per kind (a missing required field fails at the call, as §5 of the language doc promises).
- The grammar section in `docs/arena-rules-language.md` matches `DEFINE_SCHEMA` — checked by a test that prints every schema row and finds it in the doc, as the op list is checked today.
