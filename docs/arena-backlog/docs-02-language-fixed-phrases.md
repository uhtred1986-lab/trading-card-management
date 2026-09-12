---
title: Arena docs: one worked example per §20 fixed phrase in the language doc
milestone: Arena M14 — Rules language and ruleset documentation
labels: backlog, ready-for-agent, documentation, area:arena-docs, phase:rules-docs, model:sonnet-5
stage: docs
---
**Source:** the plan's Docs section ("one example per §20 phrase"); rule manual `docs/rules/rulemanual.txt` §20 Fixed Phrases; `npm run arena:tally -- --show "<wording>"` to find a real card per phrase.

**Problem.** The person fixing a card in the text view has the printed text in one hand and needs, in the other, "this is how that phrase is written in the language". §20 is the manual's own list of the phrases cards use; a table with one real card and its rule per phrase is the reference that turns a correction from guesswork into lookup.

**Build.** A §4b table in `docs/arena-rules-language.md`: §20 number, the phrase, a card that prints it, the record as text (from `printRule` of the card's confirmed or drafted rule), and "unreadable — see issue #…" where the language cannot yet say it. Generate the printed rules with a small script so they cannot drift (`scripts/arena-readings.mts` already prints a rule beside its text; reuse it), and check them in `npm test` the way the §4 examples are.

**Acceptance.** Every §20 phrase has a row; every rule in the table parses; the unreadable rows each name an open issue.

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

**Steps in order (this issue).** Sonnet-sized, mostly mechanical.
1. The phrase list is `docs/rules/rulemanual.txt` lines 2132–2320: §20-1 … §20-21 (headings start `20-N.`). Copy the 21 headings into a table skeleton in a new §4b of `docs/arena-rules-language.md`.
2. For each phrase find one card: `npm run arena:tally -- --show "<wording>"` (needs network; ~11 s; a ~14-line result is a failed fetch — re-run). Prefer a card that appears in `scripts/verify/harness.ts` or `verify/wordings.ts` so the record is stable.
3. Generate the rule text: `scripts/arena-readings.mts` already prints a program beside its text; add a `--print-rule <cardId>` flag that outputs `printRule` of the drafted record, or write a 20-line `scripts/arena-print-rule.mts` using `compileCard` (`src/lib/arena/engine/compile/index.ts` line 276) → `printRule` (`src/lib/arena/lang`). Paste the output; never hand-type a rule.
4. Where the language cannot say the phrase (20-4 immunity → #128, 20-5 X → #122, 20-9/20-13 → #126, 20-18 → #123, 20-19 → #127, 9-10 instead → #125/#107), the row says `unreadable — #NNN`.
5. Test: extend the §4 example check in `scripts/verify/lang.ts` (line 327 region) to parse every fenced rule under §4b — parse the doc file, take fenced blocks after the `## 4b` heading, `parseRule` each.
