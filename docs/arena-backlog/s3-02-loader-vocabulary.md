---
title: Arena: ruleset loader — rulesets/load.ts to GameDefinition and Vocabulary
milestone: Arena M6 — Definitions in the language (Stage 3)
labels: done, enhancement, area:arena-rulesets, area:arena-lang, phase:rules-stage3, model:opus-5
stage: 3
status: closed
closed_at: 2026-09-12
---
**Source:** plan Stage 3; the `DEFINE` grammar issue (this one depends on it); `src/lib/arena/engine/script.ts` (`AREAS`, `KEYWORD_NAMES`, the `Trigger` union in `types.ts`).

**Problem.** A parsed `DEFINE` list is text made into a tree; the engine, the editor and the referee need it as a typed **definition** with cross-references resolved (a trigger names a zone, a keyword names a hook, an action names a cost) and a **vocabulary** — the closed word lists the language is checked against today by hand-written constants.

**Build.**
1. `src/lib/arena/rulesets/load.ts`: `loadRuleset(files) → GameDefinition` — parse every `*.rules` file, resolve references, refuse duplicates and dangling names with the same error shape as the parser. Pure and synchronous; the files are read at build time (import them as raw text, as the docs are) so the app server and the scripts share one path and nothing touches the filesystem at request time.
2. `Vocabulary` from the definition: zones, durations, attribute values (colours, types), keyword names, trigger names, skill kinds, words. Export it with the same names the language uses now (`AREAS`, `KEYWORD_NAMES`, …) so the swap in the next issue is a re-export.
3. A `GameDefinition` is per game id (`dbs` now; the plan names Fusion World as the natural second, out of this effort) — the loader takes a directory, not a hard-coded list.
4. `scripts/verify/rulesets.ts` (its own issue) will consume this; give it the errors as data.

**Out of scope.** Any interpretation of the definition; the DBS files' content.

**Acceptance.**
- Gate.
- `npm test` loads the DBS ruleset and fails on a fixture with a dangling reference, a duplicate zone and a keyword body naming an unknown hook, each with a pointed error.
- `docs/arena-ruleset-spec.md` gains the section "the definition files" listing each file and what it declares.

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

**Steps in order (this issue).** Depends on #131 (the `DEFINE` grammar); start once `parseDefinitions` exists.
1. Create `src/lib/arena/rulesets/load.ts` exporting `loadRuleset(files: Record<string, string>): { ok: true; definition: GameDefinition; vocabulary: Vocabulary } | { ok: false; errors: LangError[] }`. Input is a map of file name → text so the loader never touches the filesystem; the DBS files are imported as raw text by a tiny `src/lib/arena/rulesets/dbs/index.ts` (Next.js: `import text from "./zones.rules?raw"` is not enabled here — the simplest working approach is a generated `dbs/files.ts` holding the file contents as string constants, regenerated by a `scripts/arena-rulesets-emit.mts`; say which you chose in the commit).
2. `GameDefinition` type in `rulesets/types.ts`: `{ id: "dbs"; game: GameDef; attributes: Record<string, AttributeDef>; zones: Record<string, ZoneDef>; phases: Record<string, PhaseDef>; steps; actions; triggers; keywords; costs; wins; ops }` — each built from the matching `Definition` node after cross-references are resolved. Resolve, and refuse with a `LangError` whose `clause` is the `DEFINE` kind and whose `message` names both ends: a `TRIGGER` naming an unknown zone, a `KEYWORD` hook naming an unknown hook point, an `ACTION` naming an unknown `COST`, two declarations with the same name.
3. `Vocabulary` type: `{ areas: string[]; durations: string[]; sides: string[]; keywordNames: string[]; triggers: string[]; skillKinds: string[]; promptKinds: string[]; words: Record<string,string> }`. Fill it from the definition and export `vocabularyOf(def)`. Do **not** change any consumer in this issue — that is #137.
4. Tests: new file `scripts/verify/rulesets.ts` (its own issue #136 grows it; here it only needs the loader's error cases) imported from `scripts/verify-arena.ts` **after** `"./verify/lang"`. Fixtures: three small in-test strings — a dangling zone reference, a duplicate zone, a keyword body naming an unknown hook — each asserting `ok === false` and the message contains the offending name.
5. Doc: create `docs/arena-ruleset-spec.md` if #114 has not, with only the section **"The definition files"** (one row per file: name, what it declares, manual sections). Leave the other sections as headings that name the issue that fills them.

**Done when** `loadRuleset` on the DBS files (from #133–#135, or an empty stub set until they land) returns `ok: true`, the three fixtures fail with pointed errors, and no request-time filesystem read exists (`grep -rn "readFileSync" src/lib/arena/rulesets` is empty).

---

## Built 12 Sep 2026 — what landed, and the four things the steps did not foresee

`src/lib/arena/rulesets/{load,types,hooks,index}.ts`, `dbs/{index,files}.ts`,
`scripts/arena-rulesets-emit.mts`, `scripts/verify/rulesets.ts` (imported after `./verify/lang`),
and §3 of `docs/arena-ruleset-spec.md`. Gate clean, `contract:emit` no change, fuzz 40 clean, no
consumer of the word lists touched (#137's).

1. **The text is a generated constant.** The step offered two ways; the generated `dbs/files.ts`
   is the one built, written by `npm run arena:rulesets` from the `.rules` files beside it
   (`--check` fails if one is stale). A `?raw` import rule would have to be agreed by all three
   places that load a ruleset — app server, browser, scripts — and the loader stays pure either way.
2. **The zone check is generic, not three places.** A trigger's pattern names zones (the arguments
   `from`, `to`, `in`, `area`, `zone`; the rest of an event pattern is open, as the grammar leaves
   it), and so does *any* selector or op field of type `area`, however deep — the walk reads
   `OP_SCHEMA`/`COND_SCHEMA` rows, so an op that grows an area field is checked the day its row says
   so. #133–#135 should expect this: a zone a program moves a card into has to be declared.
3. **`HOOK_POINTS` is provisional and lives in `rulesets/hooks.ts`.** The loader cannot refuse an
   unknown hook without a list of the known ones, and the inventory is #153's (§4 of the ruleset
   spec). Seventeen points are written from the categories that section names plus the two the
   language doc's examples use. It is a promise #153 has to keep or correct, not a decision about
   the engine.
4. **Four of the vocabulary's eight lists have nothing to come from yet** — `durations` and `sides`
   (the effect language's own words), `skillKinds` (a card's printed tag, held to
   `SkillKindPrefix` by the typecheck) and `promptKinds` (whatever the steps ask for, until the
   owner answers #131's `DEFINE PROMPT` question). They are filled from the engine's lists rather
   than left empty, so #137's swap is a re-export; the other four are the definition's and are
   empty until #133–#135 land.

Also: `game` on a `GameDefinition` is `GameDef | null`, because an empty set has to load — that is
the only claim an empty `dbs/` can carry, and the loader had to exist before its content. `Loaded`
errors carry `file` beside the parser's `LangError` fields, and point at the line **and column** of
the offending word; a duplicate points at the second declaration and names the file the first is in.
