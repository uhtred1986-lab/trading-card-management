---
title: Arena: DBS declarations — game.rules, attributes.rules and zones.rules
milestone: Arena M6 — Definitions in the language (Stage 3)
labels: done, enhancement, area:arena-rulesets, phase:rules-stage3, model:opus-5
stage: 3
status: closed
closed_at: 2026-09-12
---
**Source:** plan Stage 3; rule manual `docs/rules/rulemanual.txt` (setup §5, areas §3, card information §4); `src/lib/arena/engine/types.ts` (`PlayerState`, `Area`, `CardDef`), `state.ts` (`playCost`, `specifiedCostOf`).

**Problem.** The game's shape lives in TypeScript types and in the phase switch. Stage 4's engine needs it as data, and the only honest way to find out whether the language can say a whole game is to write one.

**Build — `src/lib/arena/rulesets/dbs/`, declarations only, the legacy engine untouched.**
- `game.rules`: `DEFINE GAME dbs` — setup (deck sizes, 6-card opening hand, 8 life, the +1 marker rule, mulligan), turn order, `WIN`/lose conditions (life 0, deck out, concede), the manual section cited on each line as a `--` comment.
- `attributes.rules`: `DEFINE ATTRIBUTE` for colors, energyCost | X, specifiedCost orbs, power, comboCost, comboPower, characters, traits, type, zEnergyCost; **derived** attributes `power`, `costOf`, `comboCostOf` as expressions (the ones the engine computes with layers today — say which layer order applies).
- `zones.rules`: `DEFINE ZONE` for hand, deck, life, leader{single}, battle{inPlay, modes}, combo, energy{markers}, unison{single}, warp, zDeck, zEnergy, removed, under{host} — visibility per side, ordered or not, what "in play" means (§9-1-3 of the manual).

Write the three files so that `loadRuleset` accepts them and `verify/rulesets.ts` (its own issue) can compare them with the engine's unions. Where the language cannot say something the manual needs, **do not stretch the file**: record the gap in a history entry and open a `DEFINE` grammar follow-up.

**Out of scope.** Triggers, keywords, words, prompts (separate issues); any interpreter.

**Acceptance.**
- Gate; `npm test` loads the three files without error.
- Every `Area` in `types.ts` appears as a `ZONE`; every `CardDef` field as an `ATTRIBUTE` (asserted by the completeness issue — this one must leave nothing for it to report).
- The history entry lists what the manual says that the files could not, if anything.

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
1. Ground truth to copy from, with line numbers: `Area` in `engine/types.ts` line 154 (`deck, hand, drop, leader, battle, combo, energy, life, warp, unison, zDeck, zEnergy, removed`) plus the two script-only areas in `AREAS` (`script-schema.ts` line 67: `under`, `play`); `PlayerState` (grep `export interface PlayerState` in `types.ts`) for which are ordered piles and which are single slots; `CardDef` (grep `export interface CardDef`) for the attribute list (`colors, energyCost, specifiedCost, power, comboCost, comboPower, characters, traits, type, zEnergyCost, keywords…`); `playCost` and `specifiedCostOf` in `engine/state.ts` (grep) for the derived costs; the layer order for power is in `powerOf` (grep in `state.ts`).
2. Write `src/lib/arena/rulesets/dbs/game.rules`, `attributes.rules`, `zones.rules`. Every declaration line carries `-- §N-N` citing `docs/rules/rulemanual.txt` (setup §5, areas §3, card information §4, "in play" 9-1-3). Use only fields `DEFINE_SCHEMA` has; where the manual needs a field the grammar lacks, stop and write the gap into the history entry rather than inventing syntax.
3. Attribute types must be ones the loader can check against the catalog later (#139): `colors: list(color)`, `energyCost: number | X`, `power: number`, `characters: list(string)`, `type: enum(Leader, Battle, Extra, Unison, Z-Leader, Z-Battle, Z-Extra)` — take the exact enum from `CardDef["type"]`.
4. Test: in `scripts/verify/rulesets.ts`, load the three files and assert `ok`. The completeness assertions are #136's; this issue must leave nothing for it to report, so run its diff locally (every `Area` name appears as a `ZONE`, every `CardDef` key as an `ATTRIBUTE`).
5. History entry in `docs/arena-history-lessons.md`: what the manual says that the files could not, if anything.

**Done when** the three files load, `zones.rules` has 15 zones (13 from `Area` + `under` + `play`, or a note explaining why `play` is a pseudo-zone rather than a declaration), and the legacy engine diff is empty (`git diff --stat src/lib/arena/engine` shows nothing).

---

## Built — 12 Sep 2026

The three files are in `src/lib/arena/rulesets/dbs/` and the set loads: **69 declarations**, every
one carrying its `docs/rules/rulemanual.txt` section as a `--` comment.

- `zones.rules` — 15 `ZONE`s: the manual's twelve areas (§3) plus `removed` (20-10), `under`
  (23-2) and `play` (9-1-3-1, the word for the Leader, Battle and Unison Areas together). `play` is
  declared rather than left as a pseudo-zone, because the loader refuses any program naming a zone
  nothing declares and `AREAS` carries it.
- `attributes.rules` — 19 `ATTRIBUTE`s: every `CardDef` field, the three derived costs (`costOf`,
  `comboCostOf`, `zEnergyCostOf`) with their layer order, and the player's `energyMarkers`.
- `game.rules` — one `GAME`, six `PHASE`s (the four of a turn, plus `setup` and `over`), the 26
  `STEP`s of §6-2-1 and §7, and two `WIN`s.

`scripts/verify/rulesets.ts` loads the real set instead of asserting the directory is empty, and
round-trips the whole ruleset through `printDefinitions`. `docs/arena-ruleset-spec.md` §3 has the
file table and the conventions; `docs/arena-history-lessons.md` has the entry and the six gaps.

**Two notes for #136.** The completeness check over attributes must be **one-directional** — every
`CardDef` field has a card attribute, and the four beside them (three derived costs and
`energyMarkers`) have no printed counterpart — and `mainEnd` is a `PHASE` here where the manual
makes it a step of the Main Phase (7-3-5), which is the engine's shape and not an error.
