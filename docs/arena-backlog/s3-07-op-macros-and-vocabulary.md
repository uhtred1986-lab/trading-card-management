---
title: Arena: DEFINE OP macros for the non-primitive ops, and the Vocabulary as the one word list
milestone: Arena M6 — Definitions in the language (Stage 3)
labels: backlog, ready-for-agent, enhancement, area:arena-lang, area:arena-rulesets, area:arena-workbench, phase:rules-stage3, model:opus-5
stage: 3
---
**Source:** plan Stage 3 and decision 2 ("new game = `.rules` files + drafter; new mechanism = one primitive, then every game has it"); Stage 2's primitive-or-macro table; `src/lib/arena/lang/validate.ts`, `src/components/arena/rules/*` (the chip editor), `src/lib/arena/ai/opponent.ts` (the referee prompt reads `OP_SCHEMA`).

**Problem.** Two halves. (1) The ops the Stage 2 table marked *macro* — `power`, `comboPower`, `gains`, `costReduction`, `ko`, `mill`, `discard`, `replaceLeave` … — are still interpreter cases; for the rules engine to be one interpreter over primitives they must become `DEFINE OP name(params) { primitive… }` in `rulesets/dbs/ops.rules`, expanded by the loader. (2) The language, the chip editor and the referee prompt each carry their own closed word lists (`AREAS`, `KEYWORD_NAMES`, durations, the trigger list in `validateRule`); once the definition exists there must be one.

**Build.**
1. `ops.rules` with one macro per non-primitive op, parameters matching the `OP_SCHEMA` row so **every stored `card_rules.ops` keeps parsing unchanged** and the printer keeps emitting the short form (the round-trip promise is over the macro *name*, not its expansion).
2. A macro expander in the loader that lowers a program to primitives — used by Stage 4's interpreter and, until then, checked only by a test that expanding every harness program yields primitives that `validateProgram` accepts.
3. Replace the hard-coded word lists in `lang/`, `validate.ts`, the chip editor's option lists and the referee's prompt (`EFFECT_LANGUAGE`) with re-exports from the DBS `Vocabulary`; the legacy engine keeps its own unions and the completeness suite proves they agree.

**Out of scope.** Interpreting macros in the legacy engine (it keeps its cases).

**Acceptance.**
- Gate; `npm run contract:emit` diff reviewed (`effect-language.txt` may re-order, must not lose an op).
- `verify/lang.ts`: every macro round-trips by name; `verify/language.ts`: every harness program expands to primitives only.
- Deleting a word from the definition breaks `validateRule`, the chip editor's options and the referee prompt in one place — shown by a test on the vocabulary, not three.
