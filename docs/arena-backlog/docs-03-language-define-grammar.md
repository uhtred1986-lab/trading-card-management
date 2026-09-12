---
title: Arena docs: the DEFINE grammar section of arena-rules-language.md
milestone: Arena M14 — Rules language and ruleset documentation
labels: done, documentation, area:arena-docs, area:arena-lang, phase:rules-docs, model:opus-5
stage: docs
status: closed
closed_at: 2026-09-12
---
**Source:** the Stage 3 `DEFINE` grammar issue; `docs/arena-rules-language.md` (which says in §1 that a game's definition is the second of the language's three uses).

**Build.** A §3b: the `DEFINE` productions (GAME, ATTRIBUTE, ZONE, PHASE, STEP, ACTION, TRIGGER, KEYWORD, COST, WIN, OP), one short real example each taken from `rulesets/dbs/*.rules`, the hook-body form, the macro form, and what the loader refuses. The round-trip section (§2) extended to whole files. A test that every `DEFINE_SCHEMA` row is named in the doc, as the op schema is checked against the effect-language legend.

**Acceptance.** Ships with or immediately after the Stage 3 grammar; the examples parse in `scripts/verify/lang.ts`.

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

**Steps in order (this issue).** Ships in the same PR as #131, whose steps already name it; if picked up separately after #131 lands:
1. Read `DEFINE_SCHEMA` in `src/lib/arena/lang/ast.ts` (added by #131) and copy each kind's field list into a production line in a new **§3b** of `docs/arena-rules-language.md`, right after §3.
2. One short example per kind, copied from `src/lib/arena/rulesets/dbs/*.rules` once #133–#135 exist; until then, from `scripts/verify/lang.ts`'s minimal instances (print them with `printDefinitions`).
3. Extend §2 (the round-trip promise) with one paragraph: whole files round-trip through `printDefinitions(parseDefinitions(text))`, and `--` comments are dropped on the way, as for a rule.
4. A "what the loader refuses" list: dangling reference, duplicate name, unknown hook, missing required field — the four `LangError`s #132 produces.
5. Test: in `scripts/verify/lang.ts`, assert every `DefineKind` and every schema field name occurs in the doc text (same pattern as the op-list check in `scripts/verify/language.ts`, grep `readFileSync` there).

---

## Built 12 Sep 2026 — §3b exists

Shipped with #131. `docs/arena-rules-language.md` §3b holds the productions, what each of the
eleven kinds is for, and one example per kind, printed by `printDefinitions` so it cannot drift;
§2 says the promise covers a whole file and that `--` comments are dropped; the intro says two of
the three uses now exist. Two tests in `scripts/verify/lang.ts` read the doc: every `DEFINE`
example parses and prints back byte-identically, and every `DEFINE_SCHEMA` kind, field label and
row description is named in §3b.

Steps 2 and 4 of the plan above are only partly done, on purpose. The examples come from the
grammar rather than from `rulesets/dbs/*.rules`, which do not exist yet — #133–#135 should replace
them with real ones. And "what the loader refuses" lists the four refusals but names the parser as
the source of the last one only; the dangling reference, the duplicate name and the unknown hook
are the loader's (#132) and the section says so.
