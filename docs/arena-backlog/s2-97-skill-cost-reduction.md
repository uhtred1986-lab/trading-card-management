---
title: Arena: implement skill-cost reduction family (orbTotals + scope safety)
milestone: Arena M1 — Rules correctness and parser coverage
labels: done, enhancement, area:arena-engine, area:arena-compiler, phase:rules-stage2, model:opus-5
stage: 2
status: closed
closed_at: 2026-09-10
---
**Source:** `docs/arena-next-session-prompt.md` §4(c), third bullet; `docs/arena-next-stage-spec.md` §6.6; plan Stage 2 row `costModifier(target, costKind, delta, until)`; `orbTotals` in `src/lib/arena/engine/engine.ts` (~line 904, eleven call sites).

**Problem.** Cost-reduction sub-family A — 71 clauses, "reduce the **skill** cost by {o}" — stays unread for two reasons. `orbTotals` is a pure function of the parsed skill with eleven call sites, so a discount has nowhere to apply; and the **scoping** half of those sentences ("of your ≪Saiyan≫ cards", "of [Counter] skills", "while this card is in play") is itself unread, 45 clauses over 40 shapes. Compile the discount without the scope and every skill on the board gets a permanent, unlimited, untargeted discount — the wrong-reading trap in its purest form.

**Build.**
1. Introduce `costModifier(target, costKind: energy | skill | evolve | combo, delta, until)` as the primitive (subsuming `costReduction`, which stays parseable — see the primitive-or-macro issue), and give `orbTotals` a context argument so every call site reads the modifiers in force for *that* skill on *that* card. Eleven call sites is the audit; list them in the commit.
2. Read the **scope** first: the 40 shapes are a selector plus a duration, both already in the language; a skill-cost clause whose scope the compiler cannot read is **refused whole**, never compiled unscoped. Assert that in `scripts/verify/compiler.ts`.
3. The price shown in `wording.ts`/the card sheet and the price charged are the same number (`Script.price` and `orbTotals` agree).
4. Glossary entry; tally delta naming the 71 clauses' fate (read or refused).

**Out of scope.** [Evolve] cost statics (EX03-16) beyond wiring the `evolve` cost kind; specified-cost (#96).

**Acceptance.**
- Gate + `contract:emit` reviewed.
- `verify/keywords.ts`: a [Counter] priced {r}{r} under a −{r} modifier scoped to red cards costs {r} on a red card and {r}{r} on a blue one; the discount ends at `until`.
- `arena:reprobe` = 0 moved for every rule that used `costReduction` before; readings diff signed off.
