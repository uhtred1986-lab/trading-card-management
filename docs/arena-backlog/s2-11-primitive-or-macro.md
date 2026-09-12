---
title: Arena: decide primitive or macro for every op — modifyAttr under power, comboPower and gains
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-lang, area:arena-engine, phase:rules-stage2, model:opus-5
stage: 2
---
**Source:** plan Stage 2 rule: *a primitive "says something no combination of others can"; otherwise it is re-declared as a macro in Stage 3*; the plan's `modifyAttr(target, attr, delta|value, until, scope?)` and `costModifier` rows; `OP_SCHEMA` in `src/lib/arena/engine/script.ts` (44 op kinds today).

**Problem.** Stage 3 will write the DBS game as configuration, and Stage 4's engine will interpret *primitives*. Today's 44 ops are DBS-shaped: `power`, `comboPower` and `gains` are three spellings of "change an attribute", `costReduction`/`altCost` two of "change a cost". Without a written decision per op, Stage 3 cannot write `DEFINE OP` macros and Stage 4 will re-implement every DBS op by hand — the outcome the owner rejected.

**Build.**
1. A table in `docs/arena-ruleset-spec.md` (create the section if the doc does not exist yet): every op and condition kind → *primitive* or *macro over …*, with the reason. Expect roughly: `modifyAttr` (power, comboPower, gains, "in all areas"), `costModifier` (costReduction, skill and evolve costs — see #96, #97), `move` (moveTo, ko, play, mill, discard, draw …), `choose`, `prompt`, `effect(layer)`, `forbid`, `immune`, `replace`, `control`, `skip`, `copySkills`, `token`, `marker`, flow ops (`if`, `chooseMode`, `may`, `delay`).
2. Introduce `modifyAttr` in `stepScript` and `OP_SCHEMA`, with `power`/`comboPower`/`gains` **kept as parseable spellings** that lower to it (the printer keeps printing the short forms until Stage 3 decides — the round-trip promise must hold either way, so `scripts/verify/lang.ts` is extended).
3. No card's reading may move: `npm run arena:readings` diff empty, `arena:reprobe` = 0 moved.

**Out of scope.** Writing the macros in the `DEFINE` grammar (Stage 3); removing any op spelling.

**Acceptance.**
- The table exists and names every row of `OP_SCHEMA` and `COND_SCHEMA`; `npm test` fails if a schema row is added without a table entry (a small check in `scripts/verify/language.ts` reading the doc, or a typed list beside the schema).
- Gate + `contract:emit` reviewed; readings diff empty; reprobe 0 moved.

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

**Steps in order (this issue).** Not started; it is the gate for Stage 3's #137 and Stage 4's #142, so do it before either.
1. The row list to classify is exactly the keys of `OP_SCHEMA` (45) and `COND_SCHEMA` (18) in `src/lib/arena/engine/script-schema.ts` lines 120–520: `draw discard damage mill addLife lifeDownTo shuffle energyMarker choose look reveal ko moveTo play switchMode power comboPower grant negateSkills negateSkillsOfKind hidden redirectAttack comboFrom flip faceUp addMarker removeMarker token costReduction negateKeyword gains replaceLeave altCost resolvingPlay negateAttack negateCounter negateOwnSkill forbid immune permit if chooseMode may delay note` and `count life lifeVsOpponent leaderColor leaderMatches markers inBattle battled every any all leaderFlipped power did not chose varMatches isTurnPlayer`.
2. Create `docs/arena-ruleset-spec.md` if absent (see #114 for the seven section headings) and write section 2, "The primitives", as a table: name → *primitive* | *macro over <primitive>* → reason, one row per name above.
3. Make the table checkable: add `export const OP_CLASS: Record<Op["op"], "primitive" | "macro">` and `COND_CLASS` beside the schemas in `script-schema.ts` (the `Record` type forces a row per op, so a new op without a decision fails `npm run typecheck`), and a test in `scripts/verify/language.ts` that every name in the table in the doc appears in `OP_CLASS` and vice versa.
4. Introduce `modifyAttr(target, attr: "power" | "comboPower" | "colors" | "characters" | "traits", delta | value, until)` as a primitive: `Op` union (`script.ts` line 207), `OP_SCHEMA` row, one `case` in `stepScript` (line 629) that lowers to the same `ContinuousEffect` kinds `power`/`comboPower`/`gains` produce today (`types.ts` line 376). Keep `power`, `comboPower`, `gains` as rows and printed forms; the language changes nothing (`scripts/verify/lang.ts` stays green).
5. Prove nothing moved: `npm run arena:readings` diff empty; `npm run arena:reprobe` 0 moved; `contract:emit` reviewed (a new row moves `effect-language.txt`, expected).
