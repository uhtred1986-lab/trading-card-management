---
title: Arena: DBS declarations — triggers.rules as event patterns
milestone: Arena M6 — Definitions in the language (Stage 3)
labels: backlog, ready-for-agent, enhancement, area:arena-rulesets, phase:rules-stage3, model:opus-5
stage: 3
---
**Source:** plan Stage 3; the `Trigger` union in `src/lib/arena/engine/types.ts` (~41 names) and `pendTriggers`/`skillAnswersTo` in `engine/triggers.ts`; rule manual 9-6 ([Auto] timing) and 9-6-9 (area-movement triggers); `docs/arena-rules-language.md` §7.

**Problem.** A trigger is a name today, matched by TypeScript against the event log. The rules engine will match **event patterns**: "played" is *a card moves from a non-in-play area to battle or unison* (9-6-9-4), "attacks" is *an attack event whose attacker is the subject*. Writing the 41 names as patterns is what lets a new game declare its own moments without code — and what shows whether the engine's current moments are the manual's.

**Build.**
1. `src/lib/arena/rulesets/dbs/triggers.rules`: one `DEFINE TRIGGER name ON <event pattern> [WHERE cond] BIND subject` per `Trigger` name, with the manual section as a comment. The counter windows (attack declared, blocker declared, skill activated — 9-8) are declared here too, as the moments a `[Counter:…]` answers to.
2. Where a legacy trigger name turns out to bundle two moments, or two names one moment, record it in `docs/arena-history-lessons.md` and in `docs/arena-ruleset-spec.md`; do not change the legacy engine.
3. Keyword-timing triggers from the Stage 2 issue (Evolve used, Union activated …) are declared alongside so the record's WHEN vocabulary is the same list on both engines.

**Out of scope.** Firing anything (Stage 4's event-pattern matcher).

**Acceptance.**
- Gate; the file loads; `verify/rulesets.ts` finds every `Trigger` name declared.
- `validateRule`'s trigger list is the same set as the file's names (a test that diffs them, so the record's WHEN cannot name a moment the definition lacks).

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

**Steps in order (this issue).** Depends on #131 and #132.
1. The list to cover is the `Trigger` union in `src/lib/arena/engine/types.ts` lines 468–590 — **53 names** today (the older text above says ~41; #129 added `evolveFromHandActivated`, `unionAbsorbActivated`, `counterFreeFromHand` and friends). The same 53 are keyed in `TRIGGER_IN_WORDS` (`src/lib/arena/gaps.ts` line 78), whose values are the plain-words description to copy into each declaration's comment.
2. Where each is fired: grep `pendTriggers(` in `src/lib/arena/engine/engine.ts` and `state.ts` — every call site is one moment, and the arguments (`trigger, card, subject`) tell you what the event pattern must bind. Write one `DEFINE TRIGGER <name> ON <event> [WHERE …] BIND <subject>` per name in `src/lib/arena/rulesets/dbs/triggers.rules`, with the manual section from the type's doc comment (`9-6-9-4` for `played`, `21-14` for the KO pair, `22-5` for the Evolve moments, and so on).
3. The counter windows (`CounterWindow` in `types.ts`, grep it: attack, blocker, skill) go in the same file as the moments a `[Counter:…]` answers to.
4. Where a name bundles two moments or two names share one, do not touch the legacy engine: write it into `docs/arena-history-lessons.md` and into the "The definition files" section of `docs/arena-ruleset-spec.md`.
5. Test in `scripts/verify/rulesets.ts`: `new Set(TRIGGERS)` from `src/lib/arena/gaps.ts` equals the set of `TRIGGER` names the loader returns; report both directions by name. This is the assertion that keeps the record's WHEN (validated by `lang/validate.ts` against `TRIGGERS`) and the definition the same list.

**Done when** the file has 53 declarations, the set-equality test is in `npm test`, and `npm run arena:readings` is byte-identical before and after (this issue writes data only).


---

## What was built (12 Sep 2026)

`src/lib/arena/rulesets/dbs/triggers.rules` — **58 declarations**: the 53 names of the `Trigger`
union, each with its manual section as a `--` comment and `text:` carrying the record's WHEN in the
very words `describeTrigger` prints, plus the five counter windows as `"counter:play"`,
`"counter:attack"`, `"counter:battleCardAttack"`, `"counter:counter"`, `"counter:skill"` (4-3, 9-7).
`dbs/files.ts` regenerated by `npm run arena:rulesets`.

The file's four conventions are in its own header and in `docs/arena-ruleset-spec.md` §3 ("What a
trigger declaration says"): the event pattern and which of its arguments are zones, `watcher:` for
whose cards in play are asked, `WHERE isTurnPlayer(who: …)` for a condition on the answering side,
and `BIND "self" | "subject"` for what the event's card is called in the program.

`scripts/verify/rulesets.ts` carries the set-equality test — `TRIGGERS` (`src/lib/arena/gaps.ts`,
which `lang/validate.ts` validates a record's WHEN against) against the loaded `TRIGGER` names,
reported by name in both directions — and the matching check that each declaration's `text:` is the
sentence the record already prints, so #137 can make `TRIGGER_IN_WORDS` a re-export.

**#133 landed first, as planned.** The declarations name nine zones (`battle`, `combo`, `drop`,
`energy`, `hand`, `leader`, `life`, `unison`, `zEnergy`), and the loader checks a trigger pattern's
`from`/`to`/`in`/`area`/`zone` arguments against declared `ZONE`s — so the DBS set only resolves
once `zones.rules` declares them, which it now does. `main` was merged in, the transitional zone
stub deleted, and the suite asserts the nine directly: `loadDbs()` is `ok` and each of those zones
is in `def.zones`.

What writing the 53 out found — one name pended from several moments, several names from one, and
two names (`energyToDrop`, `damageStart`) with no call site at all — is in
`docs/arena-history-lessons.md`, "What 53 trigger names turned out to be". The legacy engine is
**not** touched.
