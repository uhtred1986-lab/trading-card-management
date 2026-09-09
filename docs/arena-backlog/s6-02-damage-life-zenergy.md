---
title: Arena: combo, damage, life and Z-Energy on the rules engine
milestone: Arena M9 — Rules engine battle (Stage 6)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, area:arena-rulesets, phase:rules-stage6, model:opus-5
stage: 6
---
**Source:** plan Stage 6; `damage`, life handling (face-up life cards, worklist 5 Sep 2026), Z-Energy in `src/lib/arena/engine/engine.ts`/`state.ts`; rule manual 9-7-7 (damage), 3-4 (Life Area), 23 (Z-Energy).

**Problem.** The consequences of a battle: combo power adding to a side, damage moving life cards to hand (face-up or not), the game ending at life 0, Z-Energy paid from the Z-Energy Area. Each is small and each is a place the two engines could quietly diverge.

**Build.**
1. Combo: `ACTION combo` cost (combo cost from the derived attribute), the combo card's power added to `contributions`, [Super Combo] left to Stage 7.
2. Damage as a generic `damage(side, n)` primitive over the declared `life` zone with the face-up rule and the `lifeDownTo`/`addLife` ops through the shared `stepScript`; the `WIN` conditions from `game.rules` checked at the declared checkpoints.
3. Z-Energy as a declared cost kind in `costs.rules` and the `zEnergy` zone; `playZ` from Stage 5 pays it.

**Out of scope.** Keywords.

**Acceptance.**
- Gate; `verify/battles.ts` damage and life cases green on both engines; `arena:diff` on a scripted game that ends by damage: identical, including the `over` beat.
