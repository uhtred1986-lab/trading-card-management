---
title: Arena: ruleset loader — rulesets/load.ts to GameDefinition and Vocabulary
issue: 132
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
