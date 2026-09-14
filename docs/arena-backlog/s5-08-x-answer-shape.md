---
title: Arena: an X answer on DEFINE ACTION — X-cost cards offered on the rules engine (1-2-2-2)
milestone: Arena M8 — Rules engine actions and costs (Stage 5)
labels: backlog, ready-for-agent, enhancement, area:arena-lang, area:arena-vm, area:arena-rulesets, phase:rules-stage5, model:opus-5
stage: 5
issue: 270
---
**Source:** #146 (owner's decision of 13 Sep 2026: "add an X-answer shape"); `src/lib/arena/rulesets/dbs/actions.rules` (the X-cost note above the play family, and the same note on `activate`); `src/lib/arena/vm/costs.ts` (`planCost`, `priceFor`, the `unread` refusal for an absent `costOf`); `src/lib/arena/vm/actions.ts`; the legacy `playCost`/`planPayment` in `src/lib/arena/engine/state.ts` and the X menu rows in `legalActions` (one row per value of X, floored at the specified orbs); `scripts/verify/vm.ts` §18 (the X divergence assertion, "1-2-2-2: an X cost"); `docs/arena-workflow-spec.md` (`prompt.min/max/step`); `docs/arena-client-contract.md`.

**Problem.** 1-2-2-2 makes X the answer to a question, and a `DEFINE ACTION` candidate is a card and nothing else, so an X-cost card has no `costOf` and is refused `unread` on the rules engine. The legacy engine offers it once per legal value of X. §18 records the divergence; the owner chose to close it by giving the declaration a way to carry X.

**Build.**
1. `DEFINE ACTION` gains an X line (a `BIND` of the answer, or an `asks:` field — pick the one `docs/arena-rules-language.md` §3b's grammar takes with the smallest change), resolved by the loader and round-tripped by the printer.
2. For a candidate whose price is X, the interpreter enumerates the legal values the way the legacy engine does — floor at the coloured requirement (`specifiedCost` from #96/#255), ceiling at the energy that can be rested — and emits one menu row per value, so the `Action` payload, the row's `ActionCost` and the refusal are the legacy shapes and no `Prompt` kind is added. `priceFor`/`planCost` settle the price at the chosen X; a Unison's markers are already `addMarker(n: X)`.
3. `activate` with an X price (20-5) takes the same line, which is what #149's note beside `activate` waits on.
4. Replace the §18 divergence assertion with agreement (events and menu rows card for card); `assertMenuInvariants` still holds one rejection per card.

**Out of scope.** X as a bound expression in card programs (`s2-03-x-and-expressions.md`); action prices (4-3-3).

**Acceptance.**
- Gate; `npm run arena:fuzz -- 40 --engine rules` 0 crashes with X-cost cards in the decks.
- `scripts/verify/vm.ts` §18: an X-cost Unison is offered on both engines with the same rows, paid at the same price, and arrives with X markers; the `unread` refusal for it is gone.
- `scripts/verify/lang.ts` round-trips the new declaration line; `scripts/verify/rulesets.ts` loads the DBS set.
- `npm run contract:emit` reviewed — no shape change expected; `android:test` if one happens.
