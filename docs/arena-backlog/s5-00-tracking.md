---
title: Arena Stage 5 tracking — actions and costs on the rules engine
milestone: Arena M8 — Rules engine actions and costs (Stage 5)
labels: epic, backlog, area:arena-vm, area:arena-rulesets, phase:rules-stage5
stage: 5
tracking: true
---
Stage 5 of the rules-language programme (Opus 5, size XL). The rules engine learns to **act**: `actions.rules` declares every action as `WHEN / FOR / COST / DO / REFUSE`, and the interpreter derives `legalActions` and `rejectedActions` from those declarations instead of from hand-written predicates and their `whyNot*` twins; `costs.rules` parameterises payment.

**Exit criterion:** `npm run arena:diff` shows **no divergence** on the `scripts/verify/harness.ts` staged games and on the `arena:playthrough` scripts replayed on the rules engine; the workflow spec's invariant — one rejection per card per action type, one per skill line for an activation — holds as an interpreter property; then `ENGINE_INFO.rules.available` flips to `true` so a game can be created on it from `/arena`, still with `legacy` as the default.

**Rules that hold throughout:** the tracking issue for Stage 4 applies unchanged; a refusal sentence on the rules engine is produced by `src/lib/arena/wording.ts` from the same `Requirement` shapes, never by a second wording table.

Child issues:

{{children}}
