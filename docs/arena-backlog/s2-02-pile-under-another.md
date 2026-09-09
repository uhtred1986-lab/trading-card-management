---
title: Arena: refuse, then read, the pile under another card (23-2)
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, bug, area:arena-compiler, phase:rules-stage2, model:opus-5
stage: 2
---
**Source:** `docs/arena-rules-worklist.md`, "The card on top of this card — Stage 2, third increment" (section *Measured, ready, and deliberately not shipped*) and the fourth increment; rule manual 23-2; `docs/arena-next-stage-spec.md` §6.8.

**Problem.** "From under your <Kefla> Battle Card", "from under your Leader Card", "cards under {King Kai's Planet}" — some sixty clause shapes naming a pile that is **not this card's** — are read into the *host* today, because `AREA_WORDS` takes the "battle" out of "your <Kefla> Battle Card" and the description off the host. EX25-39 combos the <Kefla> itself rather than a card beneath it; EX23-27's "place it under a <Super 17> card on top of this card" puts the card under *this* one. A refusing commit was written and measured (−38 fully compiled cards, −40 wrong readings) but not shipped, because three cards read *worse* after it: a refused clause left the clauses after it pointing at nothing. **That precondition has since been paid** by the fourth increment (a refusal now marks the antecedent and governs "if you do").

**Build.**
1. Re-apply the refusal: a pile named by another card's description or by "your Leader Card" is not `under` of this card. Measure again; the three earlier regressions (P-645, EX24-32, P-396) must now read as refused rather than wrong.
2. Then read it: extend the `under` area with a *host* selector (the card whose pile it is), reusing the `onTop`/`hostOf` machinery from the third increment. `Selector` gains whatever field names the host; `SELECTOR_FIELDS` in `src/lib/arena/lang/ast.ts` and the printer/parser follow, so the round-trip test in `scripts/verify/lang.ts` is extended in the same commit.
3. Glossary entry for the reading rule; `describeSelector` words it ("a card under your <Kefla> Battle Card").

**Out of scope.** Piles as a zone in the rules engine (Stage 4 declares `under` in `zones.rules` from what this issue settles).

**Acceptance.**
- Gate: `typecheck`, `lint`, `test`, `build`, `arena-fuzz 40` = 0 crashes; `npm run contract:emit` diff reviewed.
- Gap-set diff shows the ~60 shapes leaving (step 2) with none entering; readings diff signed off by card.
- Scenario proof: `npm run arena:readings` shows EX25-39 choosing a card *beneath* the <Kefla>; `npm run arena:probe -- --card EX25-39` reports the combo from the pile.
