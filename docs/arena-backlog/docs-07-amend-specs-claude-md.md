---
title: Arena docs: amend the workbench spec, CLAUDE.md, the client contract and arena-tooling.md for the two engines and the language
milestone: Arena M14 — Rules language and ruleset documentation
labels: done, documentation, area:arena-docs, phase:rules-docs, model:sonnet-5
stage: docs
status: closed
closed_at: 2026-09-12
---
**Source:** the plan's Docs section: workbench spec §2.6/§3.6 (the DSL is a closed grammar isomorphic to the program, not a free-text page), `CLAUDE.md` (two engines and the selector, `lang/`, `rulesets/*.rules`, the glossary rule's scope now including `words.rules`, `Snapshot.engine/game`, the tally script), `docs/arena-client-contract.md`, the `games.ts` header comment, `docs/arena-tooling.md` (`--engine`, `arena:diff`, `verify/lang.ts`, `verify/rulesets.ts`).

**Build.** Go through each named place, check what has already been updated by the Stage 0–1 PRs (some of `CLAUDE.md` has), and finish the rest; the glossary rule in `CLAUDE.md` Conventions gains `words.rules` and `keywords.rules` as files in scope. Keep `docs/arena-next-session-prompt.md` the living handover: this issue does not rewrite it, but adds a pointer to the GitHub milestones as the place progress is tracked.

**Acceptance.** Each named document updated in one PR with a checklist in its description; `docs/arena-backlog.md` §4 (the filing rule) linked from `docs/arena-next-session-prompt.md`.

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

**Steps in order (this issue).** A checklist pass; verified state on 12 Sep 2026 so nothing is re-done:
- `CLAUDE.md`: already has the *Two engines* and *The rules language* paragraphs. Still to do: the `feature/arena` branch mention in the *Arena rules engine* paragraph is stale (there is no such branch; work is on `main`); the Conventions rule "Files in scope" lacks `src/lib/arena/lang/*.ts` and, once they exist, `rulesets/dbs/words.rules` and `keywords.rules`; the "specs to come" wording for `docs/arena-ruleset-spec.md` goes when #114 lands; `compile.ts` is described as a barrel (correct) but `script.ts` should say "`script.ts` + `script-schema.ts`".
- `docs/arena-rules-workbench-spec.md` §2.6/§3.6: state that the text view is a closed grammar isomorphic to the program (`docs/arena-rules-language.md` §2), not free text; grep `free-text` / `text view` there.
- `docs/arena-client-contract.md`: `Snapshot.game.engine` and `.game` are documented? grep `engine` — add the two fields if missing, with `engines.ts` as the source.
- `docs/arena-tooling.md`: §2 says "twelve suites" — true today; add `lang.ts` is listed (it is); add `--engine` to §4 for `arena-fuzz`, `arena-playthrough`, `arena-diff` (the three that take it now); leave the rest to #143.
- `src/lib/arena/games.ts` header comment: check it names `engineFor` as the one switch (line 17 imports it; the comment at lines 1–12 should say so).
- `docs/arena-next-session-prompt.md`: add one pointer to the GitHub milestones (`docs/arena-backlog.md` §2) as where progress is tracked, and link §5 of `docs/arena-backlog.md` (the filing rule). Do not rewrite it.
One PR, with this list as its description checklist.
