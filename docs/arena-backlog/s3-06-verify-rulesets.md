---
title: Arena: verify/rulesets.ts — the DBS definition is complete against the legacy engine
milestone: Arena M6 — Definitions in the language (Stage 3)
labels: done, enhancement, area:arena-rulesets, phase:rules-stage3, model:sonnet-5
stage: 3
status: closed
closed_at: 2026-09-12
---
**Source:** plan Stage 3 ("completeness against the old engine's unions"); `scripts/verify-arena.ts` and `scripts/verify/*.ts` (the twelve suites `docs/arena-tooling.md` §2 explains); `src/lib/arena/engine/types.ts` (`Area`, `Phase`, `Trigger`, `Prompt`), `script.ts` (`AREAS`, `KEYWORD_NAMES`).

**Problem.** Nothing would notice a zone, a trigger or a keyword the definition forgot until Stage 4 fails to play a card that uses it. The legacy engine's unions are the ground truth for what the game *has*; the definition must declare all of it and nothing else.

**Build.**
1. `scripts/verify/rulesets.ts`, wired into `scripts/verify-arena.ts` (part of `npm test`, DB-free): load the DBS ruleset and assert set equality with `AREAS`/`Area`, `Phase`, `Trigger`, `KEYWORD_NAMES`, `Prompt["kind"]`, and every `CardDef` attribute; report the difference in both directions by name.
2. Assert the loader's own guarantees on fixtures (dangling reference, duplicate, unknown hook) and that `printDefinitions(loadRuleset(files))` re-parses equal — the round-trip promise for whole files.
3. Add the suite to `docs/arena-tooling.md` §2's list with one line on what a failure means.

**Out of scope.** Semantics.

**Acceptance.**
- `npm test` runs the suite; removing one `ZONE` from `zones.rules` makes it fail naming the zone.
- `docs/arena-tooling.md` §2 updated.

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

**Steps in order (this issue).** Depends on #132; the assertions light up as #133–#135 land — write them all now and skip (with a printed `skipped: <file> not yet written`) the ones whose file is missing.
1. Create `scripts/verify/rulesets.ts` (if #132 already created it, extend it) and add `import "./verify/rulesets";` to `scripts/verify-arena.ts` after `"./verify/lang"` — the order is the contract, later suites may rely on earlier ones.
2. Set equality, both directions, reported by name. Left-hand sides and where they live: `AREAS` (`engine/script-schema.ts` line 67) and the `Area` union (`engine/types.ts` line 154 — there is no runtime array; add `AREA_NAMES` beside `AREAS` with a `never`-check, or derive from `AREAS` minus `under`/`play`), `Phase` (`types.ts` line 249, add `PHASES` the same way), `TRIGGERS` (`src/lib/arena/gaps.ts` line 133), `KEYWORD_NAMES` (`script-schema.ts` line 72), `Prompt["kind"]` (`PROMPT_KINDS` from #135), `CardDef` attribute keys (grep `export interface CardDef` in `types.ts`; list them in a `CARD_ATTRIBUTES` array with a `never`-check).
3. Loader guarantees on in-test fixtures: dangling reference, duplicate declaration, unknown hook — each a pointed `LangError`.
4. Whole-file round trip: `printDefinitions(parseDefinitions(text))` re-parses `deepEqual`, for every DBS file.
5. `docs/arena-tooling.md` §2: add a `rulesets.ts` bullet to the twelve-suite list (it becomes thirteen — fix the count in the two sentences that say "twelve") with one line on what a failure means.

**Done when** deleting one `ZONE` line from `zones.rules` makes `npm test` fail naming that zone, and the tooling doc lists the suite.
