---
title: Arena: replace(event) primitive for 'instead' clauses that redirect more than the card (9-10)
milestone: Arena M1 — Rules correctness and parser coverage
labels: done, enhancement, area:arena-compiler, area:arena-engine, phase:rules-stage2, model:opus-5
stage: 2
status: closed
closed_at: 2026-09-12
---
**Source:** plan Stage 2 gap table, rows "remove it from the game instead" (18 clauses) and BT3-051 ("all cards under it to the Drop instead"); rule manual 9-10; `docs/arena-next-stage-spec.md` §6.4; `docs/arena-move-replacement-scope.md` §1.5.

**Problem.** `replaceLeave` redirects *the card itself* to another area and nothing else; `resolvingPlay` is a second special case. Clauses that replace a different event (the pile under a card, a KO by damage becoming a removal, "instead of drawing") have no primitive. The 13 "you may … instead" cards that need a *prompt* are blocked on the `move()` refactor (#107) and stay correctly refused; this issue is the deterministic majority.

**Build.**
1. New op `replace(event: leave | ko | draw | …, with: { ops })`, registered in the same `replacementFor` table `replaceLeave` uses today; re-express `replaceLeave` and `resolvingPlay` as instances (keep the old spellings parseable — Stage 3's macro rule decides what the printer emits).
2. A replacement whose `with` block would need a prompt is **refused at validation** (`validateProgram`) with a message naming #107, so no prompt is silently lost inside `move()`.
3. Compile patterns for the deterministic wordings only; glossary entry stating exactly which events can be replaced.

**Out of scope.** Prompting inside a replacement (#107); "if declared" (20-15).

**Acceptance.**
- Gate + `contract:emit` reviewed.
- `verify/keywords.ts` / `verify/compiler.ts`: a BT3-051-shaped harness card sends the pile to the Drop instead of under the new card; a KO-to-removed replacement leaves the card in `removed`.
- `npm run arena:reprobe` = 0 moved for every rule that used `replaceLeave` before.
- Tally and readings deltas recorded; language doc example added.

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

**Steps in order (this issue).** Not started: `replaceLeave` (`src/lib/arena/engine/script-schema.ts` line 233) and `resolvingPlay` (line 268) are the only replacement ops. #107 (the prompting half) is open again — it had been auto-closed by PR #182 without being built.
1. Read `replacementFor` in `src/lib/arena/engine/state.ts` (grep) and `docs/arena-move-replacement-scope.md` §1.5 before anything — it explains why a prompt inside `move()` is lost (the point of no return is `detach(s, id)`).
2. Type + row: `{ op: "replace"; event: "leave" | "ko" | "draw" | "pileToUnder"; when?: Cond; with: Op[] }` in the `Op` union (`script.ts` line 207) and `OP_SCHEMA`; `with` is an `ops` field so the language prints it as a block.
3. Register it in the same table `replaceLeave` uses (`replacementFor`); the interpreter's `case "replace"` installs a `ContinuousEffect` of kind `"replacement"` — check whether `types.ts` line 376's `kind` union already has one for `replaceLeave` and reuse it.
4. Validation: `validateProgram` (`script-schema.ts`, grep) refuses a `with` block containing any prompting op (`choose`, `chooseMode`, `may`, `look`, `optionalCost`-shaped costs) with the message `"a replacement cannot ask a question yet — see #107"`.
5. Keep `replaceLeave`/`resolvingPlay` parseable and printed as today; #130/#137 decide their macro form.
6. Compile the deterministic wordings only (`compile/effects.ts`, grep `instead`); glossary; `contract:emit`; `npm run arena:reprobe` must report 0 moved for rules that used `replaceLeave`.
