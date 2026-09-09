---
title: Arena: decide primitive or macro for every op — modifyAttr under power, comboPower and gains
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-lang, area:arena-engine, phase:rules-stage2, model:opus-5
stage: 2
---
**Source:** plan Stage 2 rule: *a primitive "says something no combination of others can"; otherwise it is re-declared as a macro in Stage 3*; the plan's `modifyAttr(target, attr, delta|value, until, scope?)` and `costModifier` rows; `OP_SCHEMA` in `src/lib/arena/engine/script.ts` (44 op kinds today).

**Problem.** Stage 3 will write the DBS game as configuration, and Stage 4's engine will interpret *primitives*. Today's 44 ops are DBS-shaped: `power`, `comboPower` and `gains` are three spellings of "change an attribute", `costReduction`/`altCost` two of "change a cost". Without a written decision per op, Stage 3 cannot write `DEFINE OP` macros and Stage 4 will re-implement every DBS op by hand — the outcome the owner rejected.

**Build.**
1. A table in `docs/arena-ruleset-spec.md` (create the section if the doc does not exist yet): every op and condition kind → *primitive* or *macro over …*, with the reason. Expect roughly: `modifyAttr` (power, comboPower, gains, "in all areas"), `costModifier` (costReduction, skill and evolve costs — see #96, #97), `move` (moveTo, ko, play, mill, discard, draw …), `choose`, `prompt`, `effect(layer)`, `forbid`, `immune`, `replace`, `control`, `skip`, `copySkills`, `token`, `marker`, flow ops (`if`, `chooseMode`, `may`, `delay`).
2. Introduce `modifyAttr` in `stepScript` and `OP_SCHEMA`, with `power`/`comboPower`/`gains` **kept as parseable spellings** that lower to it (the printer keeps printing the short forms until Stage 3 decides — the round-trip promise must hold either way, so `scripts/verify/lang.ts` is extended).
3. No card's reading may move: `npm run arena:readings` diff empty, `arena:reprobe` = 0 moved.

**Out of scope.** Writing the macros in the `DEFINE` grammar (Stage 3); removing any op spelling.

**Acceptance.**
- The table exists and names every row of `OP_SCHEMA` and `COND_SCHEMA`; `npm test` fails if a schema row is added without a table entry (a small check in `scripts/verify/language.ts` reading the doc, or a typed list beside the schema).
- Gate + `contract:emit` reviewed; readings diff empty; reprobe 0 moved.
