---
title: Arena: ruleset loader — rulesets/load.ts to GameDefinition and Vocabulary
milestone: Arena M6 — Definitions in the language (Stage 3)
labels: backlog, ready-for-agent, enhancement, area:arena-rulesets, area:arena-lang, phase:rules-stage3, model:opus-5
stage: 3
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
