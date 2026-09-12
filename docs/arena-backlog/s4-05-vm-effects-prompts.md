---
title: Arena: vm effect layers, delayed effects, checkpoints and prompts — stepScript shared with the legacy engine
milestone: Arena M7 — Rules engine core (Stage 4)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:rules-stage4, model:opus-5
stage: 4
---
**Source:** plan Stage 4 ("effect layers, delayed effects, checkpoints, prompts; `stepScript` shared with the old engine where the op is generic"); `src/lib/arena/engine/script.ts` (`stepScript`, `ScriptFrame`, `OP_SCHEMA`), `state.ts` (`ContinuousEffect`, `DelayedEffect`, `staticEffects`); `src/lib/arena/effects.ts` (the one place a rule in force becomes a label).

**Problem.** A skill's program must run on the rules engine with the same semantics as on the legacy one — the same `Op` tree from the same `card_rules` row — or the record stops meaning one thing. The plan's answer is to **share** `stepScript` for every generic op and give it an abstract state interface, so the two engines diverge only where the game does.

**Build.**
1. Extract the state operations `stepScript` uses (find cards, move, change mode, add an effect, prompt, bind a variable, read an attribute) into an interface both `engine/state.ts` and `vm/state.ts` implement; `stepScript` takes it. The legacy behaviour must not move: `arena:reprobe` = 0 and every fixture unchanged.
2. `vm/effects.ts`: `ContinuousEffect` layers over declared attributes (the derived-attribute expressions from Stage 3 evaluate through them), `DelayedEffect` at the declared moments, `[Permanent]` statics while a card is in play, expiry at `until` — with `effectEnded` events so the board's surge/settle works unchanged.
3. Prompts (`choose`, `chooseMode`, `may`, `optionalCost`, the payment prompt) as the same `Prompt` shapes the contract carries, so `view.ts` and the board need no change.
4. Macros from Stage 3 expand at load; `stepScript` sees primitives only on the `rules` engine.

**Out of scope.** Legality of actions (Stage 5); keywords (Stage 7).

**Acceptance.**
- Gate; `contract:emit` no change; `arena:reprobe` = 0 moved on legacy.
- `npm test`: every harness program runs on the `rules` engine with the probe's fixed policy and yields the same **Result** digest as on legacy for the families that need no action beyond pass (`scripts/verify/probe.ts --engine rules`).
- `arena:diff` on a scripted game with a [Permanent] power boost and a delayed KO: identical events.

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

**Steps in order (this issue).** Depends on #141, and on #137 for macro expansion.
1. Extract the state interface first, as its own PR with **no behaviour change**: list every `s.`/`ctx.` access inside `stepScript` (`src/lib/arena/engine/script.ts` line 629 to the end of the function, ~700 lines) and group them: find/resolve cards (`resolveSelector`, line 573), move (`moveTo`/`detach` in `state.ts`), mode, effects (`addEffect`/`ContinuousEffect` in `state.ts`, grep), prompt (`s.prompt = …`), variables (`frame.vars`), attribute reads (`powerOf`, `costOf`). Define `interface ScriptHost` with those methods in `engine/script-host.ts`, implement it for the legacy `GameState` as a thin wrapper, and make `stepScript` take it. Prove nothing moved: `npm run arena:reprobe` = 0 moved, `contract:emit` no change, `npm test` green.
2. `vm/state.ts` implements `ScriptHost` over `VmState` (zones from #139, effects below).
3. `vm/effects.ts`: `ContinuousEffect` layers keyed by declared attribute; derived attributes from `attributes.rules` are evaluated through them; `DelayedEffect` drained at the `DELAY_TIMINGS` (`script-schema.ts` line 69); `[Permanent]` statics while in play; `effectEnded` events with the same shape `src/lib/arena/effects.ts` reads.
4. Prompts: emit the same `Prompt` shapes (`types.ts` line 590) so `view.ts`/the board need no change.
5. Macro expansion at load (`expandMacros` from #137) so `stepScript` on the rules engine sees primitives only; on legacy it keeps its cases.

**Done when** `scripts/verify/probe.ts --engine rules` (from #143) yields the same Result digest as legacy for every family that needs no action beyond pass, and `arena:diff` matches on the [Permanent]-plus-delayed-KO scripted game.
