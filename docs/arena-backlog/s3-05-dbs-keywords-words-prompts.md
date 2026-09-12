---
title: Arena: DBS declarations — keywords.rules, words.rules and prompts.rules (declarations only)
milestone: Arena M6 — Definitions in the language (Stage 3)
labels: backlog, ready-for-agent, enhancement, area:arena-rulesets, phase:rules-stage3, model:sonnet-5
stage: 3
---
**Source:** plan Stage 3; `KEYWORD_NAMES` (39) in `src/lib/arena/engine/script.ts` and `src/lib/arena/glossary.ts` (the written record of what each keyword means and what the engine does); `src/lib/arena/wording.ts`, `narration.ts`, `view.ts` (`questionFor`, `comboQuestion`), `ai/view.ts` (`RULES_PRIMER`); rule manual §22.

**Problem.** Three more things about the game are code today: the keyword list, the words the board uses, and the questions a prompt asks. Stage 7 fills keyword *bodies*; Stage 8 reads words and prompts from the definition. Stage 3 declares all three so their **names and parameters** are settled and complete before anything reads them.

**Build.**
- `keywords.rules`: `DEFINE KEYWORD name (params) { HOOK … }` for all 39, parameters typed (`[Strike x]`, `[Empower color, x]`), the manual §22 section on each, **bodies empty** with a `-- Stage 7` comment; the glossary's `meaning` line copied in as the description so `/arena/rules/keywords` can render from it later.
- `words.rules`: `DEFINE WORDS` — zone display names, colour names, mode names, the vocabulary `wording.ts`/`narration.ts` use for a `Requirement`, a beat and a rule in force. Declare only; the tables stay in TypeScript until Stage 8.
- `prompts.rules`: one `DEFINE PROMPT kind` per `Prompt` kind in `types.ts`, with the question template `questionFor` uses today.

**Out of scope.** Any keyword semantics; any consumer of the words.

**Acceptance.**
- Gate; the files load; `verify/rulesets.ts` finds every `KeywordSkill["name"]` and every `Prompt["kind"]` declared.
- A test that every `KEYWORD_NAMES` entry has a `keywords.rules` declaration with the same parameter arity as `keywordOf` reads (the same guard `npm test` has for the glossary today).

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

**Steps in order (this issue).** Depends on #131 and #132. Sonnet-sized: it is transcription against three existing tables.
1. `keywords.rules`: one `DEFINE KEYWORD` per entry of `KEYWORD_NAMES` (`src/lib/arena/engine/script-schema.ts` lines 72–76, 39 names). Parameter arity comes from `KeywordSkill` in `engine/types.ts` (grep `export type KeywordSkill`) — e.g. `Strike x`, `Empower color x`, `Blocker` none. The description line comes from `KEYWORDS[name].meaning` in `src/lib/arena/glossary.ts` (line 75 onward) and the manual section from the same entry. Bodies are empty with `-- Stage 7 (#153–#157)`.
2. `words.rules`: `DEFINE WORDS` with the zone display names, colour names and mode names. Sources: `src/lib/arena/wording.ts` (grep `AREA_IN_WORDS` or the equivalent record), `src/lib/arena/narration.ts`, `src/lib/arena/effects.ts` (`FORBIDDEN_IN_WORDS` is in `script-schema.ts` line 83). Declare only; leave every TypeScript table where it is (Stage 8, #159, swaps the readers).
3. `prompts.rules`: one `DEFINE PROMPT <kind>` per `Prompt["kind"]` in `engine/types.ts` lines 590–630 (17 kinds: `chooseFirst, mulligan, charge, main, combo, blocker, counter, orderPending, chooseCards, chooseMode, replaceMove, zEnergyFromCombo, optionalCost, payCost, offering, empowerCarry, referee, gameOver`), with the question template from `questionFor` in `src/lib/arena/view.ts` (grep it).
4. Tests in `scripts/verify/rulesets.ts`: every `KEYWORD_NAMES` entry is declared with the arity `keywordOf` (`engine/cards.ts`, grep) reads; every `Prompt["kind"]` is declared. The prompt-kind list has no runtime array today — add `PROMPT_KINDS` beside `KEYWORD_NAMES` in `script-schema.ts` with the same `never`-check so the union and the array cannot drift.

**Done when** the three files load, both set-equality tests pass, and `git diff --stat src/lib/arena/engine` shows only the new `PROMPT_KINDS` constant.
