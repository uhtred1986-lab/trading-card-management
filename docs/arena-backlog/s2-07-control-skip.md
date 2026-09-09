---
title: Arena: control and skip primitives — gain control of a card, skip a phase or step (20-9, 20-13)
milestone: Arena M1 — Rules correctness and parser coverage
labels: backlog, ready-for-agent, enhancement, area:arena-compiler, area:arena-engine, phase:rules-stage2, model:opus-5
stage: 2
---
**Source:** plan Stage 2 gap table, rows "gain control" (20-9) and "skip a phase" (20-13); rule manual §20.

**Problem.** Neither mechanism exists in the language: a card that takes control of an opponent's Battle Card, or that makes a player skip their next Charge Phase or Main Phase, is unread. Both are small in card count and large in engine reach — control touches every `owner`/`master` read in `engine/engine.ts`, and skip touches the flow step list in `state.flow`.

**Build.**
1. `control(target, to: side, until)`: the card's *master* changes while its *owner* does not (the manual distinguishes them; cite the rule). Audit every site in `engine.ts` and `state.ts` that reads ownership to decide which one it means — the audit itself is a deliverable, written into the glossary entry — and make legality, attacks, KO-to-Drop ("its owner's Drop Area") and end-of-effect return follow the manual.
2. `skip(what: phase | step, side, when: next | this)`: a flag consumed by the flow runner (`exec()` in `engine.ts`) when the step would begin; the `phase` beat should say the phase was skipped so the board and narration can show it.
3. Compile patterns for the wordings `npm run arena:tally -- --show "gain control"` and `--show "skip"` list; `sentence`, `effects.ts` label ("controlled by you until end of turn"), glossary entries.

**Out of scope.** Control of Leader or Unison cards (refuse with a note); "if declared" (20-15).

**Acceptance.**
- Gate + `contract:emit` reviewed.
- `verify/keywords.ts`: a controlled card attacks for its new master and returns at `until`; a KO sends it to its *owner's* Drop. A skipped Charge Phase produces no charge prompt and the `phase` beat says so.
- `arena:reprobe` = 0 moved; tally and readings deltas recorded; language doc examples added.
