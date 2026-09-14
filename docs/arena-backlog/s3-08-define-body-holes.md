---
title: Arena: $name in every field of a DEFINE body — template ops with holes, and the first macros (power, comboPower, may)
milestone: Arena M6 — Definitions in the language (Stage 3)
labels: done, enhancement, area:arena-lang, area:arena-rulesets, phase:rules-stage3, model:opus-5
stage: 3
issue: 273
status: closed
closed_at: 2026-09-14
---
**Source:** #137 (owner's decision of 13 Sep 2026: "yes, holes everywhere"); `typed()` in `src/lib/arena/lang/parse.ts` (reads `$name` only where an `amount` or a `ref` is expected); `src/lib/arena/lang/print.ts`; `src/lib/arena/rulesets/expand.ts` (`expandMacros`, built and fixture-tested); `src/lib/arena/rulesets/dbs/ops.rules` (the header's row-by-row table — `param` is the gap that blocks every row); `docs/arena-ruleset-spec.md` §2.5 (the sixth requirement); `docs/arena-rules-language.md` §3b; #131 (the `DEFINE` grammar).

**Problem.** A macro body can name a parameter only where the grammar lets a `$name` stand — an `amount` or a `ref` — so `power`'s `until: $until` (a duration), `draw`'s `TOP $n IN you.deck`, any `$side`, `$mode`, `$area`, a list or a nested program `$ops` are all unwritable. Not one of the thirty-one macros can be declared, the spec's own worked example included.

**Build.**
1. Inside a `DEFINE OP` body — and only there — `$name` is accepted in **every** field position: durations, sides, modes, areas, every enum field, lists, and nested programs. The AST gets a `Hole` allowed only under a definition; `Op` stays a closed union for card programs, and only the *expansion* is a real `Op`. `PARAM_TYPES` gains what the rows declare (`strings` for `gains`'s traits/characters/names, `ops`, `side`, `duration`, `mode`, `area`, the enums), and the loader checks each hole against the type of the field it sits in.
2. The printer prints a hole back as `$name`, so `parse(print(x))` holds over every `DEFINE` in the DBS set (`scripts/verify/lang.ts`, `scripts/verify/rulesets.ts`); the printer for card programs is untouched.
3. `expandMacros` substitutes a hole of any type and refuses a type mismatch or an unbound name by name.
4. Declare in `ops.rules` the rows that waited on `param` alone — `power`, `comboPower`, `may` — and update the header table; the lowering sweep in `scripts/verify/language.ts` now sees those three lower to primitives.
5. `docs/arena-rules-language.md` §3b and `docs/arena-ruleset-spec.md` §2.5 record the shape.

**Out of scope.** Rows that also wait on `cause`, `subject`, `negate`, `replace`, `cost`, `audience` or `maths` — each primitive is its own issue and declares its macros when it lands.

**Acceptance.**
- Gate; `npm run contract:emit` no change (`effect-language.txt` must not lose an op).
- `scripts/verify/lang.ts` round-trips `DEFINE` bodies with holes in every field type; `scripts/verify/rulesets.ts` refuses a hole whose declared type does not match the field.
- `scripts/verify/language.ts`: every harness program using `power`, `comboPower` or `may` expands to primitives only, and `validateProgram` accepts the result.
- `npm run arena:readings` diff empty.
