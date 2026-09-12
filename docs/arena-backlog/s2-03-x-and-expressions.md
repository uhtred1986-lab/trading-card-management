---
title: Arena: bind X across cost and effect, and grow amounts into expressions (20-5)
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-compiler, area:arena-engine, area:arena-lang, phase:rules-stage2, model:opus-5
stage: 2
---
**Source:** plan Stage 2 (`docs/arena-backlog.md` §1): `bindX` + `X`, `Amount → expr`; the comment on `EXPR_SCHEMA` in `src/lib/arena/lang/ast.ts` names this work; rule manual 20-5 and the X-cost rules; `docs/arena-next-stage-spec.md` §6.7.

**Problem.** `Amount` is a closed union (number, variable, `count(SEL) * n`, `sumPower`, `handUpTo`, `markers`). The cards print amounts it cannot say: "for each marker on this card", "X" chosen when paying and used again in the effect ("pay X energy: … X cards"), "equal to the number of cards in your Drop Area", "power equal to that card's energy cost × 1000". Every one is unread today, and X-cost cards get an empty specified-cost baseline (#96).

**Build.**
1. Replace `Amount` with an expression tree: `number | X | $var | count(SEL) | markers(REF) | life(side) | attr(REF, name) | sumOf(SEL, attr) | expr * number | expr + number`. Keep every current spelling valid so no stored `card_rules.ops` changes meaning; write a migration only if a shape must change (`scripts/arena-migrate-scripts.mts` is the precedent).
2. `bindX`: a cost item or a `choose` step may bind `X`; the interpreter carries it on the script frame, and `planPayment` (`engine/state.ts`) accepts an X cost paid at a chosen value. A program with an unbound `X` fails `validateProgram`.
3. `EXPR_SCHEMA` becomes the source of the printer/parser cases (`lang/print.ts`, `lang/parse.ts`); `scripts/verify/lang.ts` round-trips every expression kind.
4. Compile patterns for the motivating wordings (`npm run arena:tally -- --show "for each"`), `sentence` wording, glossary entry.

**Out of scope.** The specified-cost baseline (#96); the `DEFINE` grammar (Stage 3).

**Acceptance.**
- Gate + `contract:emit` reviewed (`effect-language.txt` moves: expected).
- `scripts/verify/lang.ts` covers every expression kind, minimal and maximal; `verify/compiler.ts` has one assertion per motivating wording.
- Tally delta recorded in the history archive naming the wordings unlocked; readings diff signed off.
- Scenario proof: a harness card "pay X energy: draw X cards" prompts for X, charges it and draws that many.
- `docs/arena-rules-language.md` §3 grammar updated in the same PR.

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

**Steps in order (this issue).** Not started: `Amount` (`src/lib/arena/engine/script.ts` line 129) is still the closed union `number | {var} | {count, times?} | {sumPower} | {handUpTo} | {markers, times?}`, and `EXPR_SCHEMA` in `lang/ast.ts` (line 124) lists the same eight spellings.
1. Baselines: `npm run arena:tally -- --misses 100000 > gap-before.txt` and `npm run arena:readings > read-before.txt` (see `docs/arena-tooling.md` §1).
2. Grow the type, keeping every old shape valid: add `{ x: true }` (X), `{ life: Side }`, `{ attr: Ref; name: "energyCost" | "power" | "comboCost" }`, `{ sumOf: Selector; attr }`, `{ plus: [Amount, number] }`, and generalise `times` onto every count-like shape. Do not rename existing keys — stored `card_rules.ops` rows carry them.
3. The interpreter reads amounts in one place: grep `function amountOf` (or `resolveAmount`) in `script.ts` — add a case per new shape there and nowhere else. `X` is read from `frame.x` (add to `ScriptFrame`, line 523); unbound X throws, and `validateProgram` (`script-schema.ts`, grep) refuses a program using `X` without a binder.
4. Binding: a `CostRecord` (line 452) gets `x?: { min?: number; max?: number }`; `planPayment` in `engine/state.ts` (grep) enumerates X values and the `payCost` prompt's `options` carry them; a `choose` step gets `bindX?: true` to bind X to the number chosen.
5. `EXPR_SCHEMA` becomes the printer/parser table: `printAmount` (`lang/print.ts` line 82) and the amount branch of `parse.ts` (grep `parseAmount`) iterate it. `scripts/verify/lang.ts` must round-trip every shape minimal and maximal — `lang.ts` **samples rather than enumerates**, so add each new shape explicitly (see `docs/arena-tooling.md` §2 "two things that will bite you").
6. Compile patterns under `src/lib/arena/engine/compile/` — amounts are read in `effects.ts` (grep `for each`) and `shared.ts`; add the motivating wordings, and one `scripts/verify/compiler.ts` assertion per wording.
7. Glossary entry (`src/lib/arena/glossary.ts`, `READING_RULES` at line 644); `docs/arena-rules-language.md` §3 `expr` production and a §4 example; `npm run contract:emit` (expect `effect-language.txt` to move).

**Done when** the harness card "pay X energy: draw X cards" prompts for X, charges it and draws that many (assert in `verify/compiler.ts`), and the readings diff is signed off by card in a history entry.
