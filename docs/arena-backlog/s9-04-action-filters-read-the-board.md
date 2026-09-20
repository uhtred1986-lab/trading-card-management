---
title: "Arena: an action's FOR and REFUSE filters read a card's printed attributes, not the board's"
milestone: Arena M12 — Parity and the flip (Stage 9)
labels: backlog, ready-for-agent, bug, area:arena-vm, phase:rules-stage9, model:sonnet-5
stage: 9
issue: 326
touches: src/lib/arena/vm/actions.ts, scripts/verify/vm.ts
---
**Source:** `src/lib/arena/vm/actions.ts` (`select`, `counted`); `src/lib/arena/vm/program.ts` (`attrsNow`); found by #166's pre-flip review.

**Problem.** Every filter on the rules engine is answered against the attributes *as they stand* — `attrsNow`, which applies 9-9-1's declared layers and 20-21's reductions — except two, and they are the two a menu is built from. `select()` (the cards a `DEFINE ACTION`'s `FOR` finds) and `counted()` (a `REFUSE` condition's `count(FROM $card …)`) both build their bag with `attrsOf(def, game).attrs`: the catalog adapter, the printed row, nothing else. So a declared candidate filter cannot see a continuous effect, a [Permanent]'s `gains` (20-1) or a cost reduction in force.

Nothing is wrong today, and that is the whole risk: the four `FOR`s and the six `REFUSE`s `actions.rules` declares measure card *type* only, which no effect moves. The first declaration that measures a number or a colour reads the wrong one — `FOR 1 IN you.hand "battle card with an energy cost of 2 or less"` would offer a card whose reducer has already brought it into range and refuse one it has taken out, with no test failing and no coverage number moving. It is exactly the "compiles and reads wrongly" shape `docs/arena-next-session-prompt.md` §3 is about, one level up from a card's text.

`resolveSelector` (`vm/program.ts`) is the reading these two should share: it goes through `attrsNow` and honours `hidden`, 20-4's "can't be chosen" and [Barrier] besides. What stops them sharing it today is that a `FOR` is read before a candidate exists, so `frame.card` is not yet bound — the `FROM $card` case `counted()` handles by hand.

**Build.**
1. Give `select()` and `counted()` the same reading every other filter gets: build the predicate's bag with `attrsNow(ctx, game, state, id)` rather than `attrsOf(def, game).attrs`.
2. Check what that widens. `attrsNow` is the layered bag, so a filter measuring `costMin`/`costMax` will start reading `energyCost` where `resolveSelector` reads it too — confirm the two agree on the same board rather than assuming it, and say in the PR which measures moved.
3. Decide, and write down, whether a `FOR` should also honour `resolveSelector`'s other readings (23-5-2's hidden cards, 20-4's prohibitions) or whether a candidate list is deliberately wider than a skill's choice. Either answer is fine; an undocumented difference is not.
4. Keep the refusal shapes untouched: this is which cards a move is offered for, not what a player is told when it is not.

**Acceptance.** `npm run typecheck && npm run lint && npm test && npm run build` clean, plus `npx tsx --env-file-if-exists=.env.local scripts/arena-fuzz.mts 40 --engine rules` at 0 crashes. A new `scripts/verify/vm.ts` case stages a card whose energy cost a [Permanent] has reduced and asserts a `FOR` measuring that cost offers it on the rules engine and on the legacy engine alike. The owner runs `npm run arena:diff -- --all --engine rules` for the replay half.
