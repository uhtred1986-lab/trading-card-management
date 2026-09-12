---
title: Arena: the DEFINE grammar in the rules language, with round-trip tests
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

## Review of 12 Sep 2026 — where the code stands, and the steps in order

*Written for an agent that has read `CLAUDE.md` and this issue and nothing else. Line numbers are from `main` at commit `77cf236`; grep for the symbol if they have moved.*

**Code map (verified against the tree, not the older issue text above).**
- The effect language's tables are in `src/lib/arena/engine/script-schema.ts` (split out of `script.ts` by PR #203): `OP_SCHEMA` at line 120 (45 ops), `COND_SCHEMA` at line 384 (18 conditions), and the closed word lists `SIDES`, `SPECIAL_TARGETS`, `AREAS` (15), `DURATIONS` (6), `KEYWORD_NAMES` (39) at lines 65–76. `script.ts` re-exports all of it (`export * from "./script-schema"`, line 1436), so imports from `engine/script` still work. The types stay in `script.ts`: `Selector` (72), `Amount` (129), `Ref` (144), `Cond` (147), `Op` (207), `CostRecord` (452), `ScriptFrame` (523), `stepScript` (629).
- The engine's unions are in `src/lib/arena/engine/types.ts`: `Area` line 154 (13 names), `Phase` line 249 (6), `Trigger` line 468 (**53 names** — the keyword-timing moments from #129 are in), `Prompt` line 590 (17 kinds).
- The trigger vocabulary the language validates against is **not** in the schema file: `TRIGGER_IN_WORDS` in `src/lib/arena/gaps.ts` line 78, exported as `TRIGGERS` (line 133) and imported by `src/lib/arena/lang/validate.ts`.
- The language: `src/lib/arena/lang/` — `ast.ts` (156 lines: `Rule`, `LangError`, `SELECTOR_FIELDS`, `FILTER_FIELDS`, `EXPR_SCHEMA`, `RESERVED`), `tokens.ts` (125: `lex`, `--` comments already dropped here), `parse.ts` (708: `class Parser`, `parseRule` at 688, `parseCond` at 702), `print.ts` (328: `printRule` at 322, `printOp` 272, `printCond` 204, `printSelector` 108, `printFilter` 162, `printAmount` 82, `canonical`/`deepEqual` 40–74), `validate.ts` (63), `index.ts` (the public barrel). There is **no** `DEFINE` grammar, no `Definition` AST and no `DEFINE_SCHEMA` yet.
- Consumers of the hard-coded word lists today: `lang/parse.ts` line 18, `src/components/arena/rules/OpEditor.tsx` lines 5, 227, 252, 419, and `src/lib/arena/ai/opponent.ts` lines 25 and 294–295 (inside `EFFECT_LANGUAGE`, line 275).
- Tests: `scripts/verify-arena.ts` imports twelve suites in a fixed order (`text, setup, battles, compiler, keywords, readings, wordings, workflow, contract, language, lang, probe`); a new suite is one `import "./verify/<name>"` line there. `scripts/verify/lang.ts` is the round-trip suite, `scripts/verify/language.ts` the schema/legend suite; both build on `scripts/verify/harness.ts`.
- The engine switch: `src/lib/arena/engines.ts` — `Engine` has four calls (`createGame`, `apply`, `legalActions`, `rejectedActions`); `engineFor("rules")` throws `EngineNotBuilt`; `ENGINE_INFO.rules.available` is `false`. `snapshot.ts` line 143 goes through `engineFor` for `rejectedActions` only and calls the legacy `boardView` directly at line 164; `probe.ts` line 261 and `scripts/verify/harness.ts` line 198 call the legacy `createGame` directly; `beats.ts` line 137 (`toBeats`) reads the legacy `GameState`.
- The legacy flow runner is `exec()` in `src/lib/arena/engine/engine.ts` line 222 over `state.flow`; triggers are `pendTriggers` in `engine/triggers.ts` line 287.
- **Absent from the tree**, so do not look for them: `src/lib/arena/rulesets/`, `src/lib/arena/vm/`, `docs/arena-ruleset-spec.md`, `scripts/verify/rulesets.ts`, an `npm run test:rules` script. `--engine` is read only by `scripts/arena-fuzz.mts` (line 13), `scripts/arena-playthrough.mts` (line 201) and `scripts/arena-diff.mts`.
- The compiler is a directory now (PR #201): `src/lib/arena/engine/compile/{clauses,conditions,effects,index,prices,shared,targets}.ts`; `engine/compile.ts` is a 5-line barrel. Any `compile.ts` line number in the text above is stale — grep the symbol under `compile/`.

**The gate, every commit** (unchanged): `npm run typecheck && npm run lint && npm test && npm run build`, then `npx tsx --env-file-if-exists=.env.local scripts/arena-fuzz.mts 40` (0 crashes). A change to a schema row, a harness card or what the referee is told also needs `npm run contract:emit` and a reviewed diff of `contract/fixtures/` (CRLF noise: confirm with `git diff --stat`, then `git checkout -- contract/`). Touching what the engine understands means `src/lib/arena/glossary.ts` in the same commit.

**Steps in order (this issue).**
1. Read `src/lib/arena/lang/ast.ts` whole and the `Parser` class in `parse.ts` up to `parseRule` (lines 38–700). Note how `printValue`/`parseValue` dispatch on `FieldType` (`"amount" | "ref" | "selector" | "side" | "area" | "duration" | "cond" | "ops" | "string" | "number" | "boolean" | "keyword" | "filter" | "modes" | {enum} | {list}`) — a `DEFINE` field should reuse exactly these types plus at most two new ones (`pattern` for a trigger's event pattern, `params` for an op's parameter list).
2. Add to `ast.ts`: `export type DefineKind = "GAME" | "ATTRIBUTE" | "ZONE" | "PHASE" | "STEP" | "ACTION" | "TRIGGER" | "KEYWORD" | "COST" | "WIN" | "OP"`, a `Definition` discriminated union (`{ define: DefineKind; name: string; …fields }`), and `DEFINE_SCHEMA: Record<DefineKind, { fields: OpField[] }>` written the way `OP_SCHEMA` rows are (reuse `OpField` from `engine/script`). Add the same `never`-check pattern `ast.ts` already uses for `SELECTOR_FIELDS` so a field added to a `Definition` without a schema row fails `npm run typecheck`.
3. Add `parseDefinitions(src): Parsed<Definition[]>` to `parse.ts` and `printDefinitions(defs): string` to `print.ts`, export both from `lang/index.ts`. Set `this.clause` to the `DEFINE` kind before parsing its body so `LangError.clause` names it. Put the new words (`DEFINE`, every kind name, `HOOK`, `ON`, `WHERE`, `BIND`, `FOR`, `REFUSE`) into `RESERVED`.
4. Printing rules to keep: one form per object (no sugar), fields in schema order, defaults omitted, nested programs printed with `printOps` at indent + 1, exactly as `printOp` does. A hook body (`KEYWORD`) and an `OP` body are `ops` fields, so they get the block form `{ … }` for free.
5. Tests in `scripts/verify/lang.ts`, after the existing op/cond block: for each `DefineKind`, build a minimal instance (required fields only) and a maximal one (every field), then `printDefinitions` → `parseDefinitions` → `deepEqual`, and `printDefinitions(parsed)` equals the first text. Add one error case per kind (drop a required field, assert `ok === false` and `error.clause === kind`). Reuse the file's `sample(t, wide)` helper for field values.
6. Doc: add **§3b The definition grammar** to `docs/arena-rules-language.md` with the productions and one example per kind, and a test that every `DEFINE_SCHEMA` kind and every field name appears in the doc text (`fs.readFileSync("docs/arena-rules-language.md")` — the pattern `verify/language.ts` uses for the op list).

**Done when** `npm test` passes with the new round trips, `docs/arena-rules-language.md` §3b exists and the doc test reads it, and nothing under `src/lib/arena/engine/` changed.

**Traps.** `tokens.ts` lexes `-` and `>` separately; an event pattern like `moved from:hand to:battle` should use `field: value` pairs, not arrows. Do not import anything from `engine/` beyond types and the schema tables — `lang/` ships to the browser (the text view).

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
