---
title: Arena Stage 6 tracking — battle, counters and combo on the rules engine
milestone: Arena M9 — Rules engine battle (Stage 6)
labels: epic, backlog, area:arena-vm, area:arena-rulesets, phase:rules-stage6
stage: 6
tracking: true
---
Stage 6 of the rules-language programme (Opus 5, size L). The battle sub-flow — attack declaration, the blocker window, the counter windows, combo, power comparison, damage, KO, Z-Energy — written as `rulesets/dbs/battle.rules` and run by the Stage 4 flow runner.

**Exit criterion:** `scripts/verify/battles.ts` and the battle scenarios of `harness.ts` and `workflow.ts` are green on the rules engine; `arena:diff` on `contract/fixtures/attack.json`, `ko.json` and `over.json`'s games shows no divergence; the duel band renders a rules-engine battle from the same `view.battle` (`counters`, `contributions`, `inBattle`).

Child issues:

{{children}}
