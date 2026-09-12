---
title: Arena: vm/ skeleton behind the Engine interface, and what snapshot needs from an engine
milestone: Arena M7 — Rules engine core (Stage 4)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, area:arena-contract, phase:rules-stage4, model:opus-5
stage: 4
---
**Source:** `src/lib/arena/engines.ts` (`Engine` has four calls: `createGame`, `apply`, `legalActions`, `rejectedActions`; `engineFor("rules")` throws `EngineNotBuilt`); plan Stage 0 (the interface was to carry `boardView` and `toBeats` too); `src/lib/arena/{games,session,snapshot,view,beats,probe}.ts` and `scripts/verify/harness.ts` — the four places an `EngineContext` is built.

**Problem.** The rules engine has nowhere to stand. `Engine` says four calls, but `snapshot.ts` also needs a board view and a beat stream from a state it treats as opaque, and today both read the legacy `GameState` shape directly. The first `vm/` commit must settle what an engine *is* to the app, without changing what the legacy one does.

**Build.**
1. Widen `Engine` to what `snapshot.ts`, `session.ts`, `probe.ts` and the AI actually call: `boardView(ctx, state, viewer)`, `toBeats(events, …)`, `stateText` if the debug page needs it. Implement them for `legacy` as an **adapter only** (`git mv` nothing; the legacy engine's own functions are called through it). `arena:diff` and every fixture must be byte-identical afterwards.
2. `src/lib/arena/vm/index.ts` exporting a `rules` `Engine` whose `createGame` loads the DBS `GameDefinition` and returns a `VmState` (its own shape, stored as JSON like the legacy state), and whose other calls throw a pointed `NotYet(step)` until the later issues fill them. `engineFor("rules")` returns it; `ENGINE_INFO.rules.available` stays `false`.
3. `VmState` carries `engine: "rules"` and the definition's game id, so a row can never be replayed on the wrong interpreter; `games.ts` already refuses a mismatched engine — add the test.

**Out of scope.** Playing anything; any change to the `Snapshot` shape beyond what Stage 0 added.

**Acceptance.**
- Gate; `npm run contract:emit` produces no change; `npm run arena:diff -- --all` on the legacy engine unchanged.
- `npm test`: a `rules` game can be created and its state round-trips through JSON; every other call throws `NotYet` naming the issue that builds it.

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

**Steps in order (this issue).**
1. Inventory the direct legacy calls that a second engine breaks (all verified 12 Sep): `src/lib/arena/snapshot.ts` line 164 `boardView(...)` (from `./view`), `src/lib/arena/beats.ts` line 137 `toBeats(ctx, state, events, after)`, `src/lib/arena/probe.ts` line 261 `createGame(...)`, `src/lib/arena/session.ts` (grep `toBeats`/`boardView`), `src/lib/arena/ai/view.ts` `stateText` (grep), `scripts/verify/harness.ts` lines 198 and 329–405 (it re-exports `boardView`, `createGame`, `toBeats`).
2. Widen `Engine` in `src/lib/arena/engines.ts` with `boardView(ctx, state, viewer, images)` and `toBeats(ctx, state, events, after)` (and `stateText` only if `ai/view.ts` needs it through the switch). `LEGACY` gets them by pointing at the existing functions from `./view` and `./beats` — watch the import cycle: `view.ts` imports from `./engine`, `engines.ts` imports from `./engine`; `engines.ts` importing `./view` and `./beats` is fine as long as neither imports `./engines` (they do not today; check with grep).
3. Change `snapshot.ts` line 164 and `probe.ts` line 261 to go through `engineFor(...)`. `probe.ts` gets an `engine: EngineId = "legacy"` parameter on `probe()` (its signature is at line 550). Leave `harness.ts` on the legacy functions — the suites are legacy-only until #143.
4. Create `src/lib/arena/vm/index.ts` exporting `RULES: Engine` with `id: "rules"`; `createGame` returns `{ state: { engine: "rules", game: "dbs", seed, version: 1 } as VmState, events: [] }`; every other call throws `class NotYet extends Error` with the message naming the issue that builds it (`"legalActions: #140"` etc.). Make `engineFor("rules")` return it; keep `ENGINE_INFO.rules.available = false` so the form stays greyed.
5. `VmState` type in `vm/state.ts` with `engine: "rules"` and `game: string`. `games.ts` line 197 already resolves the engine from the row; add a test in `scripts/verify/contract.ts` (or a new `verify/vm.ts` — if new, import it last in `verify-arena.ts`) that a `rules` game is created, `JSON.parse(JSON.stringify(state))` deep-equals it, and `legalActions` throws `NotYet`.

**Done when** `npm run contract:emit` changes no fixture, `npm run arena:diff -- --all` (needs `DATABASE_URL`; skip with a note if the sandbox has none) is unchanged, and `grep -rn "createGame\|boardView\|toBeats" src/lib/arena/snapshot.ts src/lib/arena/probe.ts` shows only calls through `engineFor`.
