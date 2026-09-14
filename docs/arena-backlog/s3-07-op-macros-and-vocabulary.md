---
title: Arena: DEFINE OP macros for the non-primitive ops, and the Vocabulary as the one word list
issue: 137
milestone: Arena M6 — Definitions in the language (Stage 3)
labels: backlog, ready-for-agent, enhancement, area:arena-lang, area:arena-rulesets, area:arena-workbench, phase:rules-stage3, model:opus-5
stage: 3
---
**Source:** plan Stage 3 and decision 2 ("new game = `.rules` files + drafter; new mechanism = one primitive, then every game has it"); Stage 2's primitive-or-macro table; `src/lib/arena/lang/validate.ts`, `src/components/arena/rules/*` (the chip editor), `src/lib/arena/ai/opponent.ts` (the referee prompt reads `OP_SCHEMA`).

**Problem.** Two halves. (1) The ops the Stage 2 table marked *macro* — `power`, `comboPower`, `gains`, `costReduction`, `ko`, `mill`, `discard`, `replaceLeave` … — are still interpreter cases; for the rules engine to be one interpreter over primitives they must become `DEFINE OP name` / `TAKES (param: type, …)` / `DO { primitive… }` in `rulesets/dbs/ops.rules`, expanded by the loader. (2) The language, the chip editor and the referee prompt each carry their own closed word lists (`AREAS`, `KEYWORD_NAMES`, durations, the trigger list in `validateRule`); once the definition exists there must be one.

**Build.**
1. `ops.rules` with one macro per non-primitive op, parameters matching the `OP_SCHEMA` row so **every stored `card_rules.ops` keeps parsing unchanged** and the printer keeps emitting the short form (the round-trip promise is over the macro *name*, not its expansion).
2. A macro expander in the loader that lowers a program to primitives — used by Stage 4's interpreter and, until then, checked only by a test that expanding every harness program yields primitives that `validateProgram` accepts.
3. Replace the hard-coded word lists in `lang/`, `validate.ts`, the chip editor's option lists and the referee's prompt (`EFFECT_LANGUAGE`) with re-exports from the DBS `Vocabulary`; the legacy engine keeps its own unions and the completeness suite proves they agree.

**Out of scope.** Interpreting macros in the legacy engine (it keeps its cases).

**Acceptance.**
- Gate; `npm run contract:emit` diff reviewed (`effect-language.txt` may re-order, must not lose an op).
- `verify/lang.ts`: every macro round-trips by name; `verify/language.ts`: every harness program expands to primitives only.
- Deleting a word from the definition breaks `validateRule`, the chip editor's options and the referee prompt in one place — shown by a test on the vocabulary, not three.

---

## Where half 1 got to, 12 Sep 2026

The expander is built (`src/lib/arena/rulesets/expand.ts`, `expandMacros(program, def)`) and
`ops.rules` exists, and **not one of the thirty-one macros is declared in it**. The file's header
is the record of why, row by row; the two things that block them all:

1. **The grammar can write `$name` only where an `amount` or a `ref` is expected** (`lang/parse.ts`
   `typed()`). A body cannot say `$until`, `$side`, `$mode`, `$values` or `$ops`, so even `power` —
   the table's worked example — cannot be written, because its `until` is a `duration` parameter.
2. **The primitives the table names do not exist yet.** `move` carries no cause, `modifyAttr`
   reaches one card and six attributes, and `negate`, `replace` and `costModifier` are not ops at
   all. Those are §2.5's five requirements, none of which #130 built.

A macro written anyway — dropping the argument it cannot spell — would validate, expand and pass
the sweep while saying something the card does not. So half 1 ships the machinery and the record,
and the question is on the issue.

---

## Where half 2 got to, 12 Sep 2026

`src/lib/arena/rulesets/words.ts` is the one source, and the parser, the chip editor
(`optionsFor`), the referee's prompt (`effectLanguage`) and `validateRule` read **areas, durations,
sides, keyword names and the moments a WHEN may name** from it — proved in
`scripts/verify/rulesets.ts` by deleting one word and asking every reader of it. It also removed a
fourth hand-written copy of the areas, inside the prompt's own `SELECTOR:` line.

`validateRule` reads `whenMoments()` from the same source: the game's triggers less the five
counter windows. `triggers.rules` declares 58 moments and five of them are the windows a [Counter]
answers in (4-3, 9-7) — a `CounterWindow`, not a `Trigger` the engine fires, and the only names in
that file a record's WHEN never says (#136's suite is what holds the other 53 to the engine's union,
both directions). The `counter:` prefix is how the file spells the difference and no `Trigger`
carries a colon, so that is a reading of the declarations rather than a second list, and the suite
fails the moment the two diverge.

`SPECIAL_TARGETS` is the one list left with no `Vocabulary` field and no `DEFINE` kind that could
declare one; it stays the engine's.

One structural note for whoever finishes it: `lang/` now reads `rulesets/`, and `rulesets/` is
built on `lang/`. The cycle is broken at the barrel — `lang/index.ts` binds `parseRule`'s default
vocabulary, and `rulesets/load.ts` imports `lang/parse` and `lang/ast` directly, because the loader
is the one caller that must not ask for the words it is producing.
