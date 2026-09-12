---
title: Arena: vm attributes and zones from the definition — CardDef.attrs, predicate filters, zones as data
milestone: Arena M7 — Rules engine core (Stage 4)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, phase:rules-stage4, model:opus-5
stage: 4
---
**Source:** plan Stage 4 ("`CardDef.attrs` + predicate filters (adapter from `CardFilter`); `zones: Record<string, string[]>`"); `attributes.rules` and `zones.rules` from Stage 3; `src/lib/arena/engine/filters.ts` and `types.ts` (`CardFilter`, `PlayerState`); `src/lib/arena/load.ts` (`defsForCards`).

**Problem.** The legacy engine has `colors`, `energyCost`, `power`, `comboCost`, `characters`, `traits` as fields on every type, and one `PlayerState` with a named field per area. A configuration-driven engine cannot know those names: a card is a bag of **declared attributes** and a side is a map of **declared zones**.

**Build.**
1. `vm/cards.ts`: `CardDef.attrs: Record<string, AttrValue>` filled by `load.ts` from the catalog against the `ATTRIBUTE` schema (refuse a card whose value is not of the declared type; list them once at load, do not crash a game). Derived attributes (`power`, `costOf`) are expressions evaluated by the interpreter with the effect layers applied (next issue).
2. `vm/filters.ts`: a `CardFilter` (the compiler's shape, still what the drafter writes) becomes a **predicate** over `attrs` through one adapter, so the compiler and `card_rules` stay untouched; a filter naming an attribute the game lacks fails at load.
3. `vm/zones.ts`: `zones: Record<zoneName, cardId[]>` per side, built from `ZONE` declarations, with `single`, `ordered`, `markers`, `inPlay`, `modes`, `under{host}` honoured generically; `move` between zones is one function with the replacement hook point Stage 2's `replace(event)` needs.
4. `createGame` deals the setup from `game.rules` (deck, 6-card hand, 8 life, mulligan) into these zones using the same RNG (`engine/rng.ts`) and seed convention so a `rules` game's opening board equals a `legacy` game's from the same seed — assert it.

**Out of scope.** Flow, prompts, effects.

**Acceptance.**
- Gate; `npm test`: same seed → identical opening hands and life piles on both engines for the harness decks; a filter round-trips through the adapter for every `FILTER_FIELDS` entry.
- `arena-fuzz 40 --engine rules` creates 40 games without a crash (nothing plays yet).

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

**Steps in order (this issue).** Depends on #138 and on Stage 3's #133 (`attributes.rules`, `zones.rules`) and #132 (the loader).
1. `vm/cards.ts`: `attrsOf(def: CardDef, game: GameDefinition): Record<string, AttrValue>` mapping the legacy `CardDef` fields (see `engine/types.ts`, grep `export interface CardDef`) onto the declared attributes, checking each value's type against the `ATTRIBUTE` declaration; collect mismatches into a `load report` array returned beside the defs, never thrown. `src/lib/arena/load.ts` (`defsForCards`) is where the catalog becomes `CardDef` — call `attrsOf` from the rules engine's `createGame`, not from `load.ts`, so the legacy path is untouched.
2. `vm/filters.ts`: `predicateOf(filter: CardFilter, game): (attrs) => boolean`. `CardFilter`'s fields are enumerated in `FILTER_FIELDS` (`src/lib/arena/lang/ast.ts` line 84) — iterate that table so a new filter field fails typecheck here too. A field naming an attribute the game lacks throws at load with the field name.
3. `vm/zones.ts`: `type Zones = Record<string, string[]>` per side built from the `ZONE` declarations; `moveCard(state, card, to, opts)` is the one mover and carries a `replacement` hook parameter that #125/#142 will fill (leave it a no-op that records the intent in the event).
4. `createGame` in `vm/index.ts`: deal from `game.rules` using `seedFrom`/`rng.ts` **in the same call order** as the legacy `createGame` (read `engine/engine.ts` lines 150–220, the setup block, and mirror the shuffle/draw/life order exactly). Assert in the test that, for the harness decks and seed 7, the `rules` game's hand and life piles equal the legacy game's.
5. `arena-fuzz.mts --engine rules` must create 40 games without throwing: it already reads `--engine` (line 13) and calls `engineFor`, so nothing to change there beyond `createGame` working.

**Done when** the seed-equality test and the `FILTER_FIELDS` round-trip test are in `npm test`, and the legacy engine's fixtures are byte-identical.
