---
title: Arena docs: 'Fixing a card in the text view' — the owner's guide
milestone: Arena M14 — Rules language and ruleset documentation
labels: backlog, ready-for-agent, documentation, area:arena-docs, area:arena-workbench, phase:rules-docs, model:sonnet-5
stage: docs
---
**Source:** the programme's aim ("fix each card by setting the right DSL statement"); `docs/arena-rules-workbench-spec.md`; `docs/arena-rules-language.md` §6–§7; the probe pane (`src/lib/arena/probe.ts`); `npm run arena:rule`.

**Problem.** Everything written so far is for the agent building the compiler. Nothing tells the owner, on a phone or at the PC, how to take a card that plays wrongly and fix it: open the record, read the probe, switch to text, change the WHEN or the price, save, re-probe, confirm — and when to use Explain to Claude instead, when to record a ruling, and what a refusal in the editor means.

**Build.** `docs/arena-fixing-a-card.md`, under 1,500 words, three worked corrections with screenshots: a wrong trigger (WHEN), a wrong price (COST), and an unread clause fixed by typing the program; a fourth showing "prefer unread to wrongly read" — deleting a wrong step and leaving the skill to the referee. Link it from `/arena/rules` and from `CLAUDE.md`'s workbench paragraph.

**Acceptance.** The four walkthroughs reproduce on `main`; the owner has read it.

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

**Steps in order (this issue).** Needs a running app with a database (`DATABASE_URL`) for screenshots; the text can be drafted without one.
1. Walk the real flow once and note the UI labels as they are: `/arena/rules` → a record (`src/components/arena/rules/RuleRecord.tsx`) → the probe pane (`ProbePane.tsx`) → *Show as text* → edit → Save (`saveRuleAction`, grep in `src/app/arena/rules/`) → re-probe → Confirm. The labels in the guide must match the components' strings exactly (grep the JSX).
2. Four walkthroughs, each: the card id, what it printed, what the probe said, the one line changed in the text view, what the probe says after, then Confirm. Pick cards from `scripts/verify/wordings.ts`'s cases so they exist on every database after `npm run arena:draft`.
3. When to use *Explain to Claude* (`src/lib/arena/ai/clarify.ts`) instead, and when to record a ruling (`npm run arena:rule -- <cardId> "<ruling>"`, `docs/arena-tooling.md` §5).
4. What each refusal in the editor means: the messages are in `src/lib/arena/lang/validate.ts` (six `Invalid` messages) and the parser's `expected[]` — quote them verbatim.
5. Link from `/arena/rules` header (`RulesHeader.tsx`) and from the workbench paragraph of `CLAUDE.md`. Under 1,500 words.
