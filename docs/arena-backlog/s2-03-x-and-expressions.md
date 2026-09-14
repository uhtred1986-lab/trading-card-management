---
title: Arena: bind X across cost and effect, and grow amounts into expressions (20-5)
issue: 122
milestone: Arena M1 — Rules correctness and parser coverage
labels: done, enhancement, area:arena-compiler, area:arena-engine, area:arena-lang, phase:rules-stage2, model:opus-5
stage: 2
status: closed
closed_at: 2026-09-12
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

---

## Built (12 Sep 2026)

`Amount` is an expression tree. Every shape that was there before is spelled exactly as it was —
stored `card_rules.ops` rows carry those keys — and four are new: `X` (`{x:true}`), `life(side)`,
`attr(REF, name)` and `sumOf(SEL, attr)`, plus the `+ n` operator and `* n` on every shape that
reads a number off the board. `EXPR_SCHEMA` (`lang/ast.ts`) is now a real table of call name,
arguments and multiplier, and `printAmount` and the parser's `amount()` both walk it; `§3` of
`docs/arena-rules-language.md` shows the production and a check asserts the doc names every row.
An amount is read in one place in the engine (`amount()` in `engine/state.ts`).

**X.** `CostRecord.x` / `SkillPrice.x` say a price charges one; the compiler reads `{X}` and
"Pay X energy" (`priceX`); the engine offers the skill **once per payable value of X** — the shape
it already used for playing an X-cost card — charges it beside the skill's orbs, and carries it onto
the frame, where `{x:true}` reads it. A `choose` may carry `bindX` instead. `validateProgram` /
`validateRule` refuse a program that says `X` with nothing to bind it, checked in step order.

`bindX` on a price that is a *choice* crosses into the effect on a key of its own beside the names
the price bound (`savedXKey`), and `validateRule` counts a top-level `bindX` in the price program as
a binder. BugBot caught that half missing on the PR: it bound X on the price's frame and threw when
the effect read it.

**Wordings unlocked** (one `verify/compiler.ts` assertion each): "for each marker on **it**"
(P-377, P-378, DB3-144), "for each **1 energy you have**" (TB1-038, BT1-030 ×2, BT4-030),
and the X price/effect pair. Tally: fully compiled 4,690 → 4,693; unread clauses 3,418 → 3,415, over 2,391 → 2,389 shapes.

**Two wrong readings refused rather than kept.** DB3-138 prints its price as `{u}(X)`, a notation
this compiler does not read, so the `X` reading is gated on the price actually charging one — a
program with an unbound `X` throws where it resolves, which is worse than the gap. And
"up to **X** of your opponent's Battle Cards" was reading as *all* of them, chosen outright: a
`Selector.count` is a number and not an expression, so that phrase is refused until a selector can
carry an amount. That refusal costs one reading and is the point of it — BT11-154's "you may place
X cards from your energy in their owners' Drop Areas" read as *every* card in the energy area.

**Deliberately not done.** `life`, `attr` and `sumOf` are the language's — usable from the text
view, the chip editor and the referee — but no printed wording compiles into them yet. The nearest
one, "power equal to the total combo power of the cards discarded by this skill" (BT20-090/107/108/109),
needs the price's bindings to survive the effect's own `c0`, which is a separate change to how a
price and its effect share variable names. A `Selector.count` that is an expression is likewise its
own piece of work, and #96's specified-cost baseline stays out of scope.
