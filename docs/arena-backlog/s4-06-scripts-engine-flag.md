---
title: Arena: every arena script takes --engine (probe, reprobe, coverage, playthrough, vs) and verify-arena runs on both
milestone: Arena M7 — Rules engine core (Stage 4)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:rules-stage4, model:sonnet-5
stage: 4
---
**Source:** plan Stage 0/4 ("`arena:playthrough`/`arena:fuzz`/`arena:probe` take `--engine legacy|rules`"); today only `scripts/arena-diff.mts`, `arena-fuzz.mts` and `arena-playthrough.mts` read `--engine`; `scripts/arena-probe.mts`, `arena-coverage.mts`, `arena-vs-claude.mts`, `scripts/verify-arena.ts`; `docs/arena-tooling.md` §4.

**Problem.** The rules engine can only be proven by the instruments the legacy engine has, run on it. Half of them cannot be pointed at it.

**Build.**
1. `--engine legacy|rules` on `arena-probe.mts` (and so `arena:reprobe`), `arena-coverage.mts`, `arena-vs-claude.mts`; `src/lib/arena/probe.ts` takes the engine as an argument (it builds its own game with `createGame`, so this is the `engineFor` switch, not a rewrite).
2. `scripts/verify-arena.ts --engine` runs every suite that plays a game (`harness`, `keywords`, `battles`, `workflow`, `probe`, `contract`) on the chosen engine; `npm test` keeps running legacy; add `npm run test:rules` for the other until Stage 9 makes both the default.
3. `docs/arena-tooling.md` §4 documents the flag on each instrument and what "green on rules" means at each stage.

**Out of scope.** Making any suite pass on the rules engine.

**Acceptance.**
- Gate; every script above accepts the flag and refuses an unknown value with a message.
- `npm run test:rules` runs and reports which suites pass, fail, or are skipped with `NotYet`, per suite, rather than stopping at the first.

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

**Steps in order (this issue).** Depends on #138 (an engine object to hand over). Sonnet-sized.
1. Copy the argument parsing from `scripts/arena-fuzz.mts` lines 13–20 (it validates with `isEngineId` and errors on an unknown value) into `scripts/arena-probe.mts`, `scripts/arena-coverage.mts`, `scripts/arena-vs-claude.mts`. `arena-playthrough.mts` line 201 already has it; `arena-diff.mts` too.
2. `src/lib/arena/probe.ts`: `probe(rule, scenario, engine: EngineId = "legacy")` (signature at line 550; the `createGame` call at line 261 goes through `engineFor(engine)` — #138 does that part; here only thread the parameter from the script).
3. `scripts/verify-arena.ts`: read `--engine` from `process.argv`; export it from `scripts/verify/harness.ts` as `ENGINE` and make `harness.ts` line 198 (`createGame`) and its `apply`/`legalActions` re-exports go through `engineFor(ENGINE)`. Suites that cannot run on `rules` yet catch `NotYet` per suite and print `skipped (NotYet: #NNN)` instead of failing — wrap each `import "./verify/<suite>"` in a try that reports and continues (dynamic `await import`, which needs the barrel to become async; that is fine, `npm test` awaits it).
4. `package.json`: `"test:rules": "tsx scripts/verify-arena.ts --engine rules"`. Do not add it to `npm test` (Stage 9, #165).
5. `docs/arena-tooling.md` §4: one line per instrument saying it takes `--engine`, and a short table of what "green on rules" means per stage.

**Done when** every script above refuses `--engine nope` with a message, `npm run test:rules` prints a per-suite pass/fail/skipped line and exits non-zero only on a real failure.
