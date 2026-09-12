---
title: Arena: vm event log and event-pattern trigger matching (pendTriggers as data)
milestone: Arena M7 — Rules engine core (Stage 4)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:rules-stage4, model:opus-5
stage: 4
---
**Source:** plan Stage 4 ("`pendTriggers` as event-pattern matching"); `triggers.rules` from Stage 3; `src/lib/arena/engine/triggers.ts` (`pendTriggers`, `skillAnswersTo`, `PendingAuto`, checkpoints); rule manual 9-6 and 9-6-9; `docs/arena-rules-language.md` §7.

**Problem.** The legacy engine matches an [Auto]'s moment by trigger *name*, and the names are fired from hand-placed calls inside the engine. The rules engine fires **events** from the generic operations (move, attack, mode change, damage…) and matches the definition's `TRIGGER` patterns against them — so a moment is declared once, and the record's WHEN (which already reads `card_rules.trigger`) means the same thing on both engines.

**Build.**
1. `vm/events.ts`: the append-only event log with the shapes the definition's patterns can name (`moved{card, from, to}`, `attacked`, `modeChanged`, `damaged`, `koed`, `skillResolved`, `phaseEntered`…); `toBeats` reads it.
2. `vm/triggers.ts`: match every `TRIGGER` pattern against each new event, bind the subject, and pend the [Auto]s whose `Script.trigger` names it — with the legacy ordering rules (turn player first, then the other; 9-6-6) and checkpoints so a pended skill resolves at the same points as today.
3. Counter windows from `triggers.rules` open the same prompts the legacy engine opens (the window itself is Stage 6; here it is only the event and the pend).
4. Keyword moments (§22) are **not** read off the row on either engine; they arrive with Stage 7's hooks. Say so in `docs/arena-ruleset-spec.md`.

**Out of scope.** Resolving a skill's program (next issue); battle.

**Acceptance.**
- Gate; `npm test`: a harness card "when played, draw 1" pends and fires on the `rules` engine from a `moved` event into battle (9-6-9-4) and not from a move into energy; two [Auto]s on both sides fire in the legacy order.
- `arena:diff` on a scripted game with one triggered draw: identical events on both engines.

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

**Steps in order (this issue).** Depends on #140 and Stage 3's #134 (`triggers.rules`).
1. Event shapes: read `GameEvent` in `src/lib/arena/engine/types.ts` (grep `export type GameEvent`) — the rules engine's log should carry the same field names where the event is the same thing, because `toBeats` and `arena:diff` compare events. Add `vm/events.ts` with the union and an `emit(state, event)` that appends and returns the index.
2. `vm/triggers.ts`: `matchTriggers(def, event, state): { trigger: string; subject?: string }[]` evaluating every `TRIGGER` pattern against the event; then `pendAutos(...)` collects the [Auto]s whose `Script.trigger` (from `card_rules.trigger`, carried by `rulesFor` in `src/lib/arena/rules-store.ts` line 67) contains the trigger name. Ordering: turn player's first, then the opponent's (9-6-6) — copy the ordering logic from `pendTriggers` in `engine/triggers.ts` line 287 rather than re-deriving it.
3. Checkpoints: the legacy engine resolves pended [Auto]s at fixed points (grep `checkpoint` in `engine/engine.ts`); the flow runner from #140 gets a `checkpoint` step kind that drains the pend list.
4. Counter windows: emit the `attackDeclared` / `blockerDeclared` / `skillActivated` events with the pattern names from `triggers.rules`; opening the prompt is #150.
5. Keyword moments (§22) are not read off the row: say so in `docs/arena-ruleset-spec.md` under the hook contract heading (owned by #153).

**Done when** the two `npm test` scenarios in the acceptance above pass on the `rules` engine and `arena:diff` matches on a scripted game with one triggered draw.
