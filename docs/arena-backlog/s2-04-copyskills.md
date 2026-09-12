---
title: Arena: copySkills primitive — 'gains that skill' and 'gains all of the chosen card's skills' (20-18)
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-compiler, area:arena-engine, phase:rules-stage2, model:opus-5
stage: 2
---
**Source:** plan Stage 2 gap table, row "gains that skill" / BT3-049; rule manual 20-18; `docs/arena-next-stage-spec.md` §6.11.

**Problem.** `grant` takes keyword skills only. A card that copies a *printed* skill from another card ("choose 1 skill of a Battle Card and this card gains that skill", "gains all of the chosen card's skills until end of turn") cannot be said in the language, so every such card is unread.

**Build.**
1. New op `copySkills(target, from: REF, which?: index | all, until)`: one interpreter case in `stepScript` (`src/lib/arena/engine/script.ts`) that attaches the source card's `Script`s (from `rulesFor` — never recompiled at game time) to the target as a `ContinuousEffect` with the given duration, plus one `OP_SCHEMA` row with a `sentence`. The engine's skill enumeration (`legalActions`, `pendTriggers`) must see copied skills as the target's own; a copied [Auto] answers to the *target's* moments.
2. `grant` may also take `"quoted skill text"` where a card prints in full the skill it grants. Decide whether that is `copySkills` with an inline `Script` or a `grantText` field, and record the decision in the glossary.
3. Compile patterns for the wordings `npm run arena:tally -- --show "gains that skill"` and `--show "all of the chosen card's skills"` list; `sentence` wording; glossary entry.
4. Probe family: `familyOf` in `src/lib/arena/probe.ts` stages a board with a source card whose skill is visible on the target after the copy.

**Out of scope.** Copying a skill of a card that has left play — cite 20-18 on which snapshot applies in the commit.

**Acceptance.**
- Gate + `contract:emit` reviewed (new op → `effect-language.txt` moves, expected).
- `verify/keywords.ts` or `verify/compiler.ts`: a harness card copies a [Permanent] and an [Auto]; the [Auto] fires on the target's moment; the copy expires with `until`.
- Tally and readings deltas recorded; `docs/arena-rules-language.md` gains the example.

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

**Steps in order (this issue).** Not started: no `copySkills` row in `OP_SCHEMA` (`src/lib/arena/engine/script-schema.ts` line 120); `grant` (line 167) takes keyword skills only.
1. Baselines (tally + readings, `docs/arena-tooling.md` §1); `npm run arena:tally -- --show "gains that skill"` and `--show "all of the chosen card's skills"` to list the cards.
2. Type: add `{ op: "copySkills"; target?: Ref; from: Ref; which?: number | "all"; until: Duration }` to the `Op` union (`script.ts` line 207). Row: `copySkills: { fields: [SELF, { name: "from", type: "ref", required: true }, { name: "which", … }, UNTIL], sentence: "…", doc: "20-18" }` in `OP_SCHEMA` (the `SELF`/`UNTIL` field constants are at `script-schema.ts` lines 108–110).
3. Interpreter: one `case "copySkills"` in `stepScript` (`script.ts` line 629). The copied scripts come from `ctx.scripts[sourceCard]` (the per-game map `rulesFor` fills; grep `scripts` on `GameContext` in `types.ts`) — never from `compileCard`. Store as a `ContinuousEffect` of a new kind `"copiedSkills"` (the `ContinuousEffect.kind` union is `types.ts` line 376) holding the `Script[]` and the source id.
4. Where skills are enumerated: grep `skillsOf(` and `programsOf(` (exported from `engine/index.ts`) — they are the two readers `legalActions`, `pendTriggers` and `beats.ts` use; make both append copied scripts for a card while the effect is in force. That is the whole engine reach; do not touch call sites.
5. `src/lib/arena/effects.ts` label ("has the skills of <card> until end of turn"); glossary entry; compile patterns in `compile/effects.ts`; `contract:emit`.
6. Probe family: `familyOf` in `src/lib/arena/probe.ts` line 160 — add a `copy` family whose board stages a source card with a [Permanent] and an [Auto].

**Done when** `scripts/verify/keywords.ts` shows the copied [Auto] firing on the target's own `played`/`attacks` moment and expiring at `until`, and the readings diff is signed off.
