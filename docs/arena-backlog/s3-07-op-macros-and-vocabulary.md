---
title: Arena: DEFINE OP macros for the non-primitive ops, and the Vocabulary as the one word list
milestone: Arena M6 — Definitions in the language (Stage 3)
labels: backlog, ready-for-agent, enhancement, area:arena-lang, area:arena-rulesets, area:arena-workbench, phase:rules-stage3, model:opus-5
stage: 3
---
**Source:** plan Stage 3 and decision 2 ("new game = `.rules` files + drafter; new mechanism = one primitive, then every game has it"); Stage 2's primitive-or-macro table; `src/lib/arena/lang/validate.ts`, `src/components/arena/rules/*` (the chip editor), `src/lib/arena/ai/opponent.ts` (the referee prompt reads `OP_SCHEMA`).

**Problem.** Two halves. (1) The ops the Stage 2 table marked *macro* — `power`, `comboPower`, `gains`, `costReduction`, `ko`, `mill`, `discard`, `replaceLeave` … — are still interpreter cases; for the rules engine to be one interpreter over primitives they must become `DEFINE OP name` / `TAKES (param: type, …)` / `DO { primitive… }` in `rulesets/dbs/ops.rules`, expanded by the loader. (2) The language, the chip editor and the referee prompt each carry their own closed word lists (`AREAS`, `KEYWORD_NAMES`, durations, the trigger list in `validateRule`); once the definition exists there must be one.

**Build.**
1. `ops.rules` with one macro per non-primitive op, parameters matching the `OP_SCHEMA` row so **every stored `card_rules.ops` keeps parsing unchanged** and the printer keeps emitting the short form (the round-trip promise is over the macro *name*, not its expansion).
2. A macro expander in the loader that lowers a program to primitives — used by Stage 4's interpreter and, until then, checked only by a test that expanding every harness program yields primitives that `validateProgram` accepts.
3. Replace the hard-coded word lists in `lang/`, `validate.ts`, the chip editor's option lists and the referee's prompt (`EFFECT_LANGUAGE`) with re-exports from the DBS `Vocabulary`; the legacy engine keeps its own unions and the completeness suite proves they agree.

**Out of scope.** Interpreting macros in the legacy engine (it keeps its cases).

**Acceptance.**
- Gate; `npm run contract:emit` diff reviewed (`effect-language.txt` may re-order, must not lose an op).
- `verify/lang.ts`: every macro round-trips by name; `verify/language.ts`: every harness program expands to primitives only.
- Deleting a word from the definition breaks `validateRule`, the chip editor's options and the referee prompt in one place — shown by a test on the vocabulary, not three.

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

**Steps in order (this issue).** Depends on #130 (the primitive-or-macro table) and #132. Do the two halves as two PRs.

*Half 1 — `ops.rules` and the expander.*
1. Take the table from #130 (`docs/arena-ruleset-spec.md`, section "The primitives"). For every op it marks *macro*, write `DEFINE OP <name>(<params>) { <primitive steps> }` in `src/lib/arena/rulesets/dbs/ops.rules`, parameters named exactly as the `OP_SCHEMA` row's fields so a stored `card_rules.ops` step is a call to the macro unchanged.
2. `expandMacros(program: Op[], def: GameDefinition): Op[]` in `rulesets/expand.ts`: substitute parameters, recurse into `ops`/`then`/`else`/`modes` fields (the nested-program field types in `OP_SCHEMA`: `ops`, `modes`), leave primitives alone. Pure.
3. Test: in `scripts/verify/language.ts`, expand every harness program (`skillRecords`/`rulesFromCompiler` from `harness.ts`) and assert `validateProgram` accepts the result and that no op in it is a macro name. The printer is untouched: `scripts/verify/lang.ts` must still round-trip every macro **by name**.

*Half 2 — one vocabulary.*
4. Replace the imports of `AREAS`, `DURATIONS`, `SIDES`, `KEYWORD_NAMES`, `SPECIAL_TARGETS` in `src/lib/arena/lang/parse.ts` (line 18), `src/components/arena/rules/OpEditor.tsx` (lines 5, 227, 252, 419) and `src/lib/arena/ai/opponent.ts` (lines 25, 294–295) with the DBS `Vocabulary` (`vocabularyOf(DBS)` from `rulesets/dbs`), and `TRIGGERS` in `lang/validate.ts` likewise. Keep `script-schema.ts`'s arrays as the **legacy engine's** lists; the completeness suite (#136) proves the two agree, so nothing changes at runtime.
5. `OpEditor.tsx` is a client component: `rulesets/` must stay client-safe (no `fs`, no db) — that is why #132 loads from string constants.
6. Test: one assertion that removing a word from the vocabulary (a mutated copy) is refused by `validateRule`, absent from the editor's option list (call the same helper the component uses) and absent from `EFFECT_LANGUAGE` — three readers, one source.
7. `npm run contract:emit` and review `contract/fixtures/effect-language.txt`: order may change, no op may vanish.

**Done when** `grep -rn "from \"@/lib/arena/engine/script\"" src/components/arena/rules/OpEditor.tsx` no longer imports a word list, and both tests above are in `npm test`.

## Where half 2 got to, 12 Sep 2026

`src/lib/arena/rulesets/words.ts` is the one source, and the parser, the chip editor
(`optionsFor`) and the referee's prompt (`effectLanguage`) read **areas, durations, sides and
keyword names** from it — proved in `scripts/verify/rulesets.ts` by deleting one word and asking
the three readers. It also removed a fourth hand-written copy of the areas, inside the prompt's own
`SELECTOR:` line.

One of the five lists the issue names is still the engine's, with a tripwire in that suite:

- **the trigger list `lang/validate.ts` reads** is not the vocabulary's, because `triggers.rules`
  declares 58 moments and five of them are the counter windows — a `CounterWindow`, not a `Trigger`
  the engine ever fires. Pointing `validateRule` at it would let a rule carry a WHEN that never
  happens, which is the one thing that check exists to stop. #136 has to make the two one list.

`SPECIAL_TARGETS` has no `Vocabulary` field and no `DEFINE` kind that could declare one; it stays
the engine's.

One structural note for whoever finishes it: `lang/` now reads `rulesets/`, and `rulesets/` is
built on `lang/`. The cycle is broken at the barrel — `lang/index.ts` binds `parseRule`'s default
vocabulary, and `rulesets/load.ts` imports `lang/parse` and `lang/ast` directly, because the loader
is the one caller that must not ask for the words it is producing.
