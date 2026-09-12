---
title: Arena: control and skip primitives — gain control of a card, skip a phase or step (20-9, 20-13)
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-compiler, area:arena-engine, phase:rules-stage2, model:opus-5
stage: 2
---
**Source:** plan Stage 2 gap table, rows "gain control" (20-9) and "skip a phase" (20-13); rule manual §20.

**Problem.** Neither mechanism exists in the language: a card that takes control of an opponent's Battle Card, or that makes a player skip their next Charge Phase or Main Phase, is unread. Both are small in card count and large in engine reach — control touches every `owner`/`master` read in `engine/engine.ts`, and skip touches the flow step list in `state.flow`.

**Build.**
1. `control(target, to: side, until)`: the card's *master* changes while its *owner* does not (the manual distinguishes them; cite the rule). Audit every site in `engine.ts` and `state.ts` that reads ownership to decide which one it means — the audit itself is a deliverable, written into the glossary entry — and make legality, attacks, KO-to-Drop ("its owner's Drop Area") and end-of-effect return follow the manual.
2. `skip(what: phase | step, side, when: next | this)`: a flag consumed by the flow runner (`exec()` in `engine.ts`) when the step would begin; the `phase` beat should say the phase was skipped so the board and narration can show it.
3. Compile patterns for the wordings `npm run arena:tally -- --show "gain control"` and `--show "skip"` list; `sentence`, `effects.ts` label ("controlled by you until end of turn"), glossary entries.

**Out of scope.** Control of Leader or Unison cards (refuse with a note); "if declared" (20-15).

**Acceptance.**
- Gate + `contract:emit` reviewed.
- `verify/keywords.ts`: a controlled card attacks for its new master and returns at `until`; a KO sends it to its *owner's* Drop. A skipped Charge Phase produces no charge prompt and the `phase` beat says so.
- `arena:reprobe` = 0 moved; tally and readings deltas recorded; language doc examples added.

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

**Steps in order (this issue).** Not started.
1. Audit first, as its own commit with no behaviour change: grep `owner` and `master` across `src/lib/arena/engine/engine.ts`, `state.ts`, `triggers.ts`, `rejections.ts` and `src/lib/arena/view.ts`; list every read in a table (file:line, which of *owner* or *controller* it means per the manual — cite 1-8 for owner/master) in the glossary entry text. Fix any site that reads the wrong one today only if the manual is unambiguous.
2. `control(target, to: side, until)`: `CardInstance` (grep in `types.ts`) gets `controller?: PlayerId`; every site from the audit that means *controller* reads it. Legality (`legalActions`, `rejections.ts`), attacks and end-of-effect return follow; a KO sends the card to its **owner's** Drop.
3. `skip(what: "phase" | "step", side, when: "next" | "this")`: a `skips: { phase, side }[]` list on `PlayerState`; `exec()` in `engine.ts` line 222 consumes one entry when that phase would begin and emits the `phase` event with `skipped: true`; `src/lib/arena/narration.ts` says "skips the Charge Phase".
4. Compile the wordings (`npm run arena:tally -- --show "gain control"` and `--show "skip"`); `effects.ts` labels; glossary; `contract:emit`; `scripts/verify/keywords.ts` scenarios from the acceptance above.
