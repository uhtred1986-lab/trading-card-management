---
title: Arena docs: write docs/arena-ruleset-spec.md — the interpreter contract and the definition files
milestone: Arena M14 — Rules language and ruleset documentation
labels: done, documentation, area:arena-docs, area:arena-vm, area:arena-rulesets, phase:rules-docs, model:opus-5
stage: docs
status: closed
closed_at: 2026-09-12
---
**Source:** the plan's Docs section; `CLAUDE.md` already points at `docs/arena-ruleset-spec.md` as "to come"; `engines.ts`'s header comment refers to it.

**Problem.** The document that says what the rules engine *is* does not exist, and three stages already promise to write sections into it (the primitive-or-macro table, the hook inventory, the saved-games decision).

**Build — the document's sections, each owned by the stage that fills it.**
1. What is configuration and what is interpreter, and why (decision 2 of the plan) — written now, from the plan.
2. The primitives (the Stage 2 table) and the expression language.
3. The definition files: one section per `rulesets/dbs/*.rules` file, what it declares, its manual sections.
4. The hook contract (Stage 7's inventory) with one example body per hook.
5. How to add a primitive (interpreter case + schema row + doc row + tally) and how to add a game (files + drafter + vocabulary), with Fusion World as the worked hypothetical.
6. The oracle protocol: `arena:diff`, reprobe, fuzz, what "green" means per stage; the two-engines rule until Stage 10.
7. What stays code and why: the flow runner, event log, prompt mechanics, selector evaluation, payment search, RNG, the language, the drafter.

Write 1, 5 (skeleton), 6 and 7 now so the stage issues have a place to land their sections; the rest are filled by the stages and checked here.

**Acceptance.** The document exists with the seven sections, each either written or headed with the issue that fills it; `CLAUDE.md`'s pointer no longer says "to come".

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

**Steps in order (this issue).** Do this first among the docs issues — four open code issues (#130, #132, #134, #141) need somewhere to write.
1. Create `docs/arena-ruleset-spec.md` with exactly these seven `##` headings, in this order: 1 Configuration versus interpreter; 2 The primitives and the expression language; 3 The definition files; 4 The hook contract; 5 Adding a primitive, adding a game; 6 The oracle protocol; 7 What stays code and why.
2. Write 1, 5 (skeleton with the two checklists: *primitive* = interpreter case + `OP_SCHEMA` row + `OP_CLASS` row + doc row + glossary + `contract:emit`; *game* = `rulesets/<id>/*.rules` + drafter + vocabulary), 6 and 7 now, from `docs/arena-backlog.md` §1 (the four decisions) and `docs/arena-tooling.md` §4 (`arena:diff`, reprobe, fuzz). Under 2, 3 and 4 put one line each: `Filled by #130` / `#132, #133–#135` / `#153`.
3. Point the two existing references at it: `CLAUDE.md` says "specs to come in `docs/arena-rules-language.md` and `docs/arena-ruleset-spec.md`" in the *Two engines* paragraph — reword to "specified in"; `src/lib/arena/engines.ts` line 7 already names the file, leave it.
4. Add the file to `docs/arena-INDEX.md` under *Current docs* and one line to `docs/arena-CURRENT.md`.
5. Keep it under 300 lines at this stage; the stages fill it.
