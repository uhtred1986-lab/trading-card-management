---
title: Arena: bind X across cost and effect, and grow amounts into expressions (20-5)
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-compiler, area:arena-engine, area:arena-lang, phase:rules-stage2, model:opus-5
stage: 2
---
**Source:** plan Stage 2 (`docs/arena-backlog.md` §1): `bindX` + `X`, `Amount → expr`; the comment on `EXPR_SCHEMA` in `src/lib/arena/lang/ast.ts` names this work; rule manual 20-5 and the X-cost rules; `docs/arena-next-stage-spec.md` §6.7.

**Problem.** `Amount` is a closed union (number, variable, `count(SEL) * n`, `sumPower`, `handUpTo`, `markers`). The cards print amounts it cannot say: "for each marker on this card", "X" chosen when paying and used again in the effect ("pay X energy: … X cards"), "equal to the number of cards in your Drop Area", "power equal to that card's energy cost × 1000". Every one is unread today, and X-cost cards get an empty specified-cost baseline (#96).

**Build.**
1. Replace `Amount` with an expression tree: `number | X | $var | count(SEL) | markers(REF) | life(side) | attr(REF, name) | sumOf(SEL, attr) | expr * number | expr + number`. Keep every current spelling valid so no stored `card_rules.ops` changes meaning; write a migration only if a shape must change (`scripts/arena-migrate-scripts.mts` is the precedent).
2. `bindX`: a cost item or a `choose` step may bind `X`; the interpreter carries it on the script frame, and `planPayment` (`engine/state.ts`) accepts an X cost paid at a chosen value. A program with an unbound `X` fails `validateProgram`.
3. `EXPR_SCHEMA` becomes the source of the printer/parser cases (`lang/print.ts`, `lang/parse.ts`); `scripts/verify/lang.ts` round-trips every expression kind.
4. Compile patterns for the motivating wordings (`npm run arena:tally -- --show "for each"`), `sentence` wording, glossary entry.

**Out of scope.** The specified-cost baseline (#96); the `DEFINE` grammar (Stage 3).

**Acceptance.**
- Gate + `contract:emit` reviewed (`effect-language.txt` moves: expected).
- `scripts/verify/lang.ts` covers every expression kind, minimal and maximal; `verify/compiler.ts` has one assertion per motivating wording.
- Tally delta recorded in the history archive naming the wordings unlocked; readings diff signed off.
- Scenario proof: a harness card "pay X energy: draw X cards" prompts for X, charges it and draws that many.
- `docs/arena-rules-language.md` §3 grammar updated in the same PR.
