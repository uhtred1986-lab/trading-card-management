---
title: Arena: the immunity family — 'isn't affected by your opponent's skills' (20-4)
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-compiler, area:arena-engine, phase:rules-stage2, model:opus-5
stage: 2
---
**Source:** plan Stage 2 gap table, rows "isn't affected by your opponent's skills" (7) and "unaffected by skills"; rule manual 20-4; the `immune` op already in `OP_SCHEMA` and the `forbid beChosen / beMovedBySkill` prohibitions.

**Problem.** The language can say "can't be chosen by skills" and "can't be moved by skills" but not full immunity: a card that is unaffected by the opponent's skills must ignore *every* effect those skills would apply — power changes, KO, mode switches, keyword grants, continuous effects — and the effect still resolves for other targets. Today those cards are unread, or read as a narrower prohibition than printed.

**Build.**
1. Measure first: `npm run arena:tally -- --show "affected by"` and `--show "unaffected"` list the real cards. Decide, and write into the glossary, which effects immunity blocks (20-4) and which it does not (costs paid by the opponent, game rules such as damage).
2. Extend the `immune` op with `from: pred` (whose skills: `opponent`, `any`, a filter on the source card) and make `stepScript`'s target application consult it at the one place effects land on a card, so a new op inherits the check automatically. Record that place in `docs/arena-ruleset-spec.md` when it exists.
3. `effects.ts` label ("unaffected by your opponent's skills") and `whyNot*` wording when a target is refused for immunity.

**Out of scope.** Immunity to *keywords* ([Critical], damage) — refuse with a note if the text says so.

**Acceptance.**
- Gate + `contract:emit` reviewed.
- `verify/keywords.ts`: an immune card is not KO'd, not powered down and not chosen by the opponent's skill, while the same skill still hits a non-immune card on the same board; the card's own side's skills still apply.
- `arena:reprobe` = 0 moved; tally and readings deltas recorded; language doc example added.

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

**Steps in order (this issue).** The `immune` op exists (`src/lib/arena/engine/script-schema.ts` line 309, `doc` says 9-1-4; fields `target`, `from`, `fromFilter`) — measure how far it already goes before extending it.
1. `npm run arena:tally -- --show "affected by"` and `--show "unaffected"`; `npm run arena:readings | grep -B2 -A2 "immune"` for what is read today.
2. Find the one place effects land on a card: grep `function applyTo` / `targetsOf` / `resolveSelector` in `script.ts` (line 573 is `resolveSelector`'s export) and the `immune` checks already there (grep `immune` in `script.ts` and `state.ts`). The rule to enforce: the immunity check sits in the shared target-resolution path so every op inherits it, not in per-op cases.
3. Extend `from` to `"opponent" | "any" | "you"` if not already, decide which effects immunity blocks (20-4 says skills; costs and game rules are not skills) and write that into the glossary entry.
4. `src/lib/arena/effects.ts` label; `whyNot*` wording in `src/lib/arena/wording.ts` (`Requirement` kind `target` with a reason, `types.ts` line 863).
5. `scripts/verify/keywords.ts` scenario from the acceptance; `arena:reprobe` 0 moved; `contract:emit`; readings diff signed off.
