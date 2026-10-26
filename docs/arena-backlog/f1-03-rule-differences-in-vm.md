---
title: "Arena F1-03: the Fusion World rule differences in the engine — combo without a price, power 0 is not a KO"
issue: 1186
milestone: Arena F1 — Fusion World: the four launch starter decks
labels: backlog, ready-for-agent, area:arena-vm, phase:fusion-world, model:sonnet-5
stage: fusion-world
priority: P2
status: closed
closed_at: 2026-10-26
touches: src/lib/arena/vm/battle.ts, src/lib/arena/vm/effects.ts, src/lib/arena/vm/zones.ts, scripts/verify/arena-fusion-world.mts
---
Tracking: Arena F1. Depends on F1-02 (the `fusion` definition declares no combo price). Plan:
`docs/arena-fusion-world-plan.md` §2, §6. Priority P2, size M, Sonnet, with a `/code-review` pass on
Opus before merge (engine semantics).

## Why

Two rules of Fusion World are not expressible as a `.rules` line today, because the code that does
them is native in `vm/`:

1. **Combo has no price** (manual p. 10: "By placing a Battle Card from your hand or an Active Mode
   Battle Card in the Battle Area into the Combo Area, you can add the combo power"). `vm/battle.ts`
   reads `attrsNow(...).comboCostOf ?? def.comboCost ?? 0` at three sites (the combo offer, the combo
   action, the combo-eligibility check) and plans an `energy` payment for it. Fusion World cards have
   `comboCost` null, so the fallback is already 0 — **verify that a null combo cost offers the combo
   for free with no payment prompt**, and make it explicit: when the loaded definition declares no
   `COST` that `consumes: combo` (the dbs one does), the combo path skips payment planning entirely
   rather than planning a zero price.
2. **Power reduced to 0 is not a KO** (manual p. 11: "When a card's power is reduced to 0 by a card's
   skill, it's placed in its owner's Drop, but this processing is different from being KO'd, therefore
   'when KO'd' skills don't trigger"). Find what the engine does today when a skill lowers a battle
   card's power to 0 or below (grep `vm/effects.ts`, `vm/zones.ts`, `vm/state.ts` for the power check;
   if there is none, the original game's engine never removes such a card and this issue adds the
   Fusion World behaviour only). For a `fusion` state: at the next checkpoint after a power change, a
   battle card whose current power is ≤ 0 moves to its owner's Drop with a `moved` event whose reason
   is `powerZero`, no `koed` trigger pends, and `yourCardKoed`/`opponentCardKoed` do not fire. The
   `dbs` behaviour, whatever it is, is unchanged (ruling 1 in the plan §6 is the owner's to give; this
   issue records what the dbs engine does in the PR body).

Both are guarded by what the **definition** declares (a combo price exists / the game id), never by a
card. The starters that make this matter: every Battle Card with a combo power (combo from hand), and
FS01-02 Whis, FS01-08 Son Goku, FS01-09 Gohan, FS02-13 Vegeta, FS04 cards with "-N power for the
turn" (power to 0).

## Build

- `src/lib/arena/vm/battle.ts`: a helper `comboPriceOf(game)` that returns the declared combo `COST`
  or null; the three sites plan payment only when it is non-null. Keep `comboCostOf` for dbs.
- Power zero: one function in `vm/zones.ts` or `vm/effects.ts` run from the checkpoint that already
  handles KO cleanup (`vm/flow.ts`'s checkpoint, see the `cleanup` stages in `capability-inventory.ts`
  for the names), guarded on `state.game === "fusion"`.
- Tests: start `scripts/verify/arena-fusion-world.mts` (F1-07 grows it) with two scenarios on
  synthetic Fusion World cards (built the way `scripts/verify/arena-policy-choices.mts` builds
  synthetic cards): (a) attacker combos a 10000-combo-power card from hand with 0 energy rested —
  offered, no `payCost` prompt, power added, card in the Drop at battle end; (b) a 5000-power card gets
  -5000 for the turn — in the Drop at the next checkpoint, no `koed` event, a "when KO'd" Auto on it
  does not pend. Add the suite to `scripts/verify-arena.ts`.

## Out of scope

Attack-the-turn-played (the original game allows it too; nothing to change). [Blocker], [Critical],
[Double Strike] (the dbs hooks apply unchanged). Any dbs behaviour change.

## Acceptance

- `npm run checks`, `npm test`, `npm run arena:fuzz -- 200` (dbs, unchanged), `npm run contract:emit`
  reviewed (no `Snapshot` change expected; a new `moved` reason is a contract change and must be
  called out).
- The two scenarios above pass in `npm test`.
- PR body: what the dbs engine does today at power 0, with the file and function, so the owner can
  rule (plan §6.1).
