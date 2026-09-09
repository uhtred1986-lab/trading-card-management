---
title: Arena: battle.rules — the battle sub-flow with blocker and counter windows
milestone: Arena M9 — Rules engine battle (Stage 6)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, area:arena-rulesets, phase:rules-stage6, model:opus-5
stage: 6
---
**Source:** plan Stage 6; the battle sub-flow in `src/lib/arena/engine/engine.ts` (attack, block, counter, combo, resolve) and `state.flow`'s battle steps; rule manual §9-7 (battle), 9-8 (counter timing), 22 ([Blocker], [Barrier]); `docs/arena-battle-staging-spec.md` §3.1 for what a battle must expose.

**Problem.** Battle is the most sequenced part of the game and the one the board stages most carefully. On the rules engine it must be a `STEP` program with the same windows, in the same order, producing the same events, so the beats and the duel band are unchanged.

**Build.**
1. `battle.rules`: `ACTION attack` (FOR active Battle Cards and the Leader; targets; `REFUSE` for a rested attacker, a first-turn attack, a prohibition; `DO` open the battle and fire `attacked`), then the steps: blocker window (the guard's `block` action, `card: null` decline), the counter windows at each 9-8 moment (`counter` action from hand or field, the declined counter), combo (`combo` action with its cost), triggers in battle firing with `inBattle` set, power comparison, damage/KO, battle end.
2. `view.battle` — `attacker`, `guard`, `step`, `attackPower`, `guardPower`, `counters`, `contributions` — built from the battle record on the rules engine, computed in one place.
3. Redirected attacks (`redirectAttack`), negated attacks and counters (`negateAttack`, `negateCounter`) through the shared `stepScript`.

**Out of scope.** Keyword semantics in battle ([Blocker] as a macro, [Critical], [Double Strike] — Stage 7); the engine offers the *window*, the keyword decides who may use it.

**Acceptance.**
- Gate; `arena-fuzz 40 --engine rules` with attacks, 0 crashes.
- `arena:diff` on `attack.json`, `ko.json`, `over.json`: identical events; the same `view.battle` on both engines at every prompt of those games.
- Scenario proof: the duel band plays a rules-engine battle with a combo and a counter on the phone.
