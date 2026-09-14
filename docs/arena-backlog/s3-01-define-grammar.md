---
title: Arena: the DEFINE grammar in the rules language, with round-trip tests
issue: 131
milestone: Arena M6 — Definitions in the language (Stage 3)
labels: done, enhancement, area:arena-lang, phase:rules-stage3, model:opus-5
stage: 3
status: closed
closed_at: 2026-09-12
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

---

## Built 12 Sep 2026 — what the grammar actually says (read this before #132)

The grammar, the printer, the parser, the round trips and §3b of
`docs/arena-rules-language.md` all landed together. Three decisions the steps above
left open, settled here so the loader is written against the real shapes:

1. **Three new field types, not two.** `pattern` and `params` as the steps name, and a third,
   `hooks`: a keyword needs one body *per hook point*, and the alternative — reusing the `modes`
   type, whose shape (`{label, ops}`) is identical — would print hook points as quoted labels
   inside a list. `hooks` prints one `HOOK <point> { … }` line per body instead, so a ruleset diff
   shows the hook that changed.
2. **Every field is a line; a row says which of the two forms it is written in.** `DefineField` is
   `OpField` plus an optional `word`: with one the field is written as a clause (`ON …`, `DO { … }`,
   `REFUSE "…"`), without one as `name: value`. The colon tells them apart, so neither can be read
   as the other, and there is still only one table. A parameter list therefore reads `TAKES (target:
   ref)` on its own line rather than `DEFINE OP name(params)` as the Stage 3 sketch in
   `s3-07-op-macros-and-vocabulary.md` drew it — the shape there is illustrative, and the loader
   does not care.
3. **Eleven kinds, exactly the list #131 fixed.** `s3-05-dbs-keywords-words-prompts.md` also asks
   for `DEFINE WORDS` and `DEFINE PROMPT`, which are **not** in the eleven and so do not parse yet.
   Adding either is one `DEFINE_SCHEMA` row and one AST node now; it needs the owner's word on
   whether the words table and the prompt questions are declarations of their own or fields of
   `DEFINE GAME`.

Two smaller facts for #132: a `string` field prints quoted everywhere (`BIND "subject"`,
`phase: "main"`) because that is what the effect language does with a `string`; and the schema
carries no `default` values that the printer drops — a field left out of the text is `undefined`
and the loader is the one that applies a default, because a printer that dropped a value equal to
its default could not bring it back.
