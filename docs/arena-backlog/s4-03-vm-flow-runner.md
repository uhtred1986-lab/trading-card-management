---
title: Arena: vm flow runner over STEP programs — turn.rules and the bounded End Phase loop
milestone: Arena M7 — Rules engine core (Stage 4)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, area:arena-rulesets, phase:rules-stage4, model:opus-5
stage: 4
---
**Source:** plan Stage 4 ("the flow runner over `STEP` programs (`turn.rules`, the End-Phase repeat as a bounded loop)"); `exec()` in `src/lib/arena/engine/engine.ts` (~lines 219–443, the phase/step switch) and `state.flow` (the data step list the legacy engine already has); rule manual §7 (turn structure), §8 (phases).

**Problem.** The turn is a TypeScript `switch` over `Phase`. In the rules engine it is a program: `DEFINE PHASE`/`DEFINE STEP` in `rulesets/dbs/turn.rules`, run by an interpreter that knows only *steps*, *prompts* and *events*. Getting this right is what makes a second game a set of files.

**Build.**
1. `turn.rules`: Charge (draw except first turn of P1, charge prompt or skip), Main (loop until `endMain`), End (hand size, the "at end of turn" repeat until nothing pends — a **bounded** loop with a ceiling the definition states, so a mis-declared trigger cannot hang a game), Setup, Over; each step names the prompts it may raise and the events it fires.
2. `vm/flow.ts`: `run(state)` advances `state.flow` (a data program counter, as today) until the next prompt or the game's end; suspension and resumption are the frame, so a game is storable mid-decision and reproducible from seed + actions — the legacy guarantee, kept.
3. `apply(ctx, state, action)` for `pass`, `endMain`, `concede` only; `legalActions` returns exactly those; `rejectedActions` empty.
4. `boardView` and `toBeats` for what exists (phase beats, draw, turn change) so the web board renders a `rules` game.

**Out of scope.** Charging, playing, attacking (Stage 5); battle (Stage 6).

**Acceptance.**
- Gate; `arena-fuzz 40 --engine rules` plays 40 games to the end by passing, 0 crashes.
- `arena:diff` on a pass-only scripted game: identical events on both engines (the phase and draw beats, turn changes, deck-out loss).
- Scenario proof: create a `rules` game from `/arena`, pass through three turns on the board; the beats play back.

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

**Steps in order (this issue).** Depends on #139.
1. Read the legacy flow before writing the program: `exec()` in `src/lib/arena/engine/engine.ts` line 222 onward is the step switch; `state.flow` (initialised at line 173) is the data step list; `Phase` is `setup | charge | main | mainEnd | end | over` (`types.ts` line 249). Write down, per phase, which prompts it raises (`Prompt` kinds, `types.ts` line 590) and which events it emits — that list is the content of `turn.rules`.
2. `src/lib/arena/rulesets/dbs/turn.rules`: `DEFINE PHASE` / `DEFINE STEP` per the manual §7–§8, with the End Phase "repeat while something pends" written as a `STEP` with a `LIMIT n` field (the grammar from #131 must have it; if it does not, add the field to `DEFINE_SCHEMA` in the same PR and extend `verify/lang.ts`).
3. `vm/flow.ts`: `run(ctx, state): void` advances `state.flow` (same shape idea as legacy: a stack of `{ step, index }` frames) until a prompt is set or the game is over. Suspension is the frame; nothing is held in closures.
4. `apply` for `pass`, `endMain`, `concede` only; `legalActions` returns exactly those for the acting player; `rejectedActions` returns `[]`.
5. `boardView` and `toBeats` for what exists: build the `BoardView` the contract needs (`docs/arena-client-contract.md`, `src/lib/arena/view.ts` line 593 is the legacy shape to match field for field) and `phase`, `move` (draw) and turn-change beats (`src/lib/arena/beats.ts` line 137 for the shapes).

**Done when** `npx tsx --env-file-if-exists=.env.local scripts/arena-fuzz.mts 40 --engine rules` finishes 40 pass-only games, `npm run arena:diff` on a scripted pass-only game gives identical events on both engines, and a `rules` game created from `/arena` renders and plays three turns on the board.
