---
title: Arena: counted and conditional prohibitions — forbid with uses and unless (20-14)
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-compiler, area:arena-engine, phase:rules-stage2, model:opus-5
stage: 2
---
**Source:** plan Stage 2 gap table, rows BT3-104 ("can only attack **one more** time") and BT13-030 ("can't do A **unless** B"); rule manual 20-14; `docs/arena-next-stage-spec.md` §6.5.

**Problem.** `forbid` is all-or-nothing. A prohibition with a count ("can attack one more time this turn", "can't attack more than once per turn") or an escape clause ("can't be played unless you have 3 or more energy") cannot be expressed, so those cards are unread — and a partial reading would forbid everything.

**Build.**
1. Extend the `forbid` op with optional `uses: expr` (a budget the interpreter decrements each time the forbidden action happens) and `unless: cond` (evaluated at legality time — in the `whyNot*` twins as well as in `legalActions`, so the refusal sentence explains the escape).
2. `src/lib/arena/wording.ts` and `src/lib/arena/effects.ts` (the only places a rule in force becomes a sentence) learn the two new shapes: "can attack once more this turn", "can't attack unless …".
3. Compile patterns for the motivating wordings; glossary entry under prohibitions.

**Out of scope.** Prohibitions on the opponent's choices that need a prompt (replacement territory, #107).

**Acceptance.**
- Gate + `contract:emit` reviewed.
- `scripts/verify/workflow.ts`: with `uses: 1` the second attack is *rejected* with a worded reason and the first is legal; with `unless` the action turns legal when the condition holds — asserted through `legalActions` and `rejectedActions`, one rejection per card per action type (workflow spec §3.2).
- Tally and readings deltas recorded; language doc example added.
