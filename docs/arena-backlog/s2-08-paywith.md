---
title: Arena: payWith — use a card as energy, and other alternative payments (20-19)
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-compiler, area:arena-engine, phase:rules-stage2, model:opus-5
stage: 2
---
**Source:** plan Stage 2 gap table, row "you can use this card as energy" (BT3-039, 20-19); `docs/arena-next-stage-spec.md` §6.13; worklist entry "paying for a [Counter] with something other than energy (5 Sep 2026)" for the precedent.

**Problem.** `planPayment` (`src/lib/arena/engine/state.ts`) reads the Energy Area only. A card that may be used as energy from another area, or a cost paid by placing a card from hand in the Drop, cannot be planned or charged, so the whole skill is unread or its price unknown.

**Build.**
1. `payWith(sel, as: energy | orb(colour))` as a **cost item** (extend `CostRecord` in `engine/script.ts` and the `item` grammar in `lang/`), and a [Permanent] form ("you can use this card as energy") that registers the card as an eligible payer while in play.
2. `planPayment` takes the eligible payers into its search; the payment prompt (`view.ts`'s question) lists them beside the energy cards; the `pay` beat names what was used.
3. Compile patterns; glossary entry; `wording.ts` price sentence ("pay 2 energy or use <card> as energy").

**Out of scope.** X costs (the X and expressions issue); alt costs already handled by `altCost`.

**Acceptance.**
- Gate + `contract:emit` reviewed (a cost item changes `effect-language.txt`).
- `scripts/verify/lang.ts` round-trips the new cost item; `verify/keywords.ts` pays a skill with the card and charges nothing from energy.
- Tally and readings deltas recorded; language doc §3 `item` grammar and example updated.
