---
title: Arena: an Extra used from the hand pays both halves in colour — fix the legacy activatable (4-2, 12-2-2)
milestone: Arena M8 — Rules engine actions and costs (Stage 5)
labels: backlog, ready-for-agent, enhancement, area:arena-engine, area:arena-vm, phase:rules-stage5, model:opus-5
stage: 5
issue: 271
touches: src/lib/arena/engine/state.ts, src/lib/arena/vm/activate.ts, scripts/verify/vm.ts, src/lib/arena/glossary.ts
---
**Source:** #147 (owner's ruling of 13 Sep 2026: "if it can't be played because an energy color or token isn't available it can't play as it can't pay the cost"); `src/lib/arena/vm/activate.ts` header ("One reading that is deliberately not the legacy engine's") and `boundFor`; the legacy `activatable` in `src/lib/arena/engine/state.ts` (`planPayment(c.total + orbTotal, c.specified)`); `scripts/verify/vm.ts` §19 item 7 (`A-EXTRA-ORB`, "both halves"); rule manual 1-2-3, 4-2, 12-2-2.

**Problem.** An Extra Card used from the hand pays its own energy cost *and* the skill's orbs (4-2, 12-2-2). The legacy `activatable` adds the two totals but plans the colours against the play cost alone, so on a board short of the skill's own colour it offers a skill whose orbs cannot be paid. Real cards: **BT17-080** *A Hopeless Sight* (green, cost 1, `[Activate: Main] {g}{y}{2}, …`) is offered on an all-green board with five energy; **BT16-017** *Erase a Universe* (red, cost 0, `[Activate: Main] {r}{u}{g}{y}{1}, …`) is offered to a mono-red board. The rules engine plans the two halves as one price, colours included. The owner ruled the rules engine right; the legacy engine is frozen for bug fixes, and this is one.

**Build.**
1. `activatable`: plan against the play cost's coloured requirement **plus** the skill's orbs (and its either-orbs, `eitherOrbsIn`), one `planPayment` over the merged price, so the first `Requirement` (`energy` short / colour short) is the one `vm/activate.ts` gives.
2. Turn the recorded divergence in `vm/activate.ts`'s header and `verify/vm.ts` §19 into an agreement: both engines refuse `A-EXTRA-ORB` on a board with the total but not the colour, with the same first requirement, and both offer it when the colour is there.
3. `src/lib/arena/glossary.ts` if it describes the old approximation; `wording.ts` unchanged.

**Out of scope.** Anything else on #147 ([Activate: Battle] windows #150, keyword activations Stage 7, X and action prices).

**Acceptance.**
- Gate; `npm run arena:fuzz -- 40` on both engines, 0 crashes.
- `scripts/verify/vm.ts` §19 asserts agreement where it asserted divergence.
- `npm run arena:reprobe`: the only rules whose answer moves are Extras with a coloured skill orb their play cost does not cover — list them in the PR.
- `npm run contract:emit` no change.
