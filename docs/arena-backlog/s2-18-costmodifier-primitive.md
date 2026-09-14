---
title: Arena: the costModifier primitive — costReduction and altCost as one structured price change (spec §2.5-4)
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-lang, area:arena-engine, area:arena-vm, area:arena-rulesets, phase:rules-stage2, model:opus-5
stage: 2
issue: 277
---
**Source:** #137 (owner's decision of 13 Sep 2026); `docs/arena-ruleset-spec.md` §2.5-4 ("a price is not a number"); `src/lib/arena/rulesets/dbs/ops.rules` (`costReduction`, `altCost` waiting on `cost`); the `costReduction` row in `src/lib/arena/engine/script-schema.ts` (its `doc` carries the owner's BT19-039 ruling) and `altCost`; `src/lib/arena/vm/costs.ts` (`LAYER_KINDS`, `costLayerGaps`) and `permanents` in `src/lib/arena/vm/effects.ts`; the legacy `playCost`/`orbTotals` in `src/lib/arena/engine/state.ts`; #96, #97, #255.

**Problem.** A cost is structured — orbs, a life payment, or a whole program — and the specified cost never touches a total (owner's ruling of 9 Sep 2026), which is why it is not a `modifyAttr`. The primitive that carries that structure does not exist, so `costReduction` and `altCost` cannot be declared.

**Build.**
1. `costModifier(target, of: play | skill, total?, specified?, alt?: program, until)` as one primitive row; the rules engine reads it through the `costOf`/`specifiedCost` layers (`LAYER_KINDS` pairs it with the layer, `costLayerGaps` checks the pairing at load), the legacy engine maps it to its existing branches.
2. Schema row, printer, parser, round trip; `wording.ts`'s price sentence unchanged.
3. Declare `costReduction` and `altCost` in `ops.rules` (with `$name` holes); update the header table; the glossary's `costReduction what: specified` entry moves with it.

**Out of scope.** The specified-cost baseline data (#255); skill-cost reduction's readings (#97, merged); [Warrior of Universe 7] (a keyword, Stage 7).

**Acceptance.**
- Gate; `npm run arena:fuzz -- 40` on both engines; `npm run contract:emit` reviewed.
- `scripts/verify/vm.ts` §20 (reducers on both engines) unchanged; `scripts/verify/keywords.ts` specified-cost scenario unchanged.
- `scripts/verify/language.ts` lowering sweep for the two declared rows; `scripts/verify/lang.ts` round-trip.
- `npm run arena:readings` diff empty; `arena:reprobe` 0 moved.
