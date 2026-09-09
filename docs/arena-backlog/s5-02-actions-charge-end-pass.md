---
title: Arena: actions.rules — charge, endMain, pass and concede on the rules engine
milestone: Arena M8 — Rules engine actions and costs (Stage 5)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, area:arena-rulesets, phase:rules-stage5, model:opus-5
stage: 5
---
**Source:** plan Stage 5; the `charge`, `endMain`, `pass`, `concede` handlers in `src/lib/arena/engine/engine.ts` (`apply()`) and their `whyNot*` twins; rule manual 8-2 (Charge Phase), 8-3 (Main Phase end).

**Problem.** The first four actions, chosen because they need no payment and no battle: they prove the `ACTION` machinery on the real turn.

**Build.**
1. `rulesets/dbs/actions.rules`: `ACTION charge` (FOR a card in hand; the declined charge `card: null` as its own candidate; the once-per-turn `REFUSE`; `DO` move to energy face-up and fire `charged`), `ACTION endMain`, `ACTION pass`, `ACTION concede`, each with the manual section as a comment.
2. The declined charge stays a distinct legal action so the board's ghost-button rule (`docs/arena-hud-spec.md` §2.3) keeps working; `rejectedActions` says why a card cannot be charged (a Leader, a card already charged this turn) in the existing `Requirement` shapes.
3. Remove the corresponding `NotYet` throws from the Stage 4 skeleton.

**Out of scope.** Cards that alter the charge (keywords, Stage 7); Energy-Exhaust and charge limits.

**Acceptance.**
- Gate; `arena-fuzz 40 --engine rules` plays with charging, 0 crashes.
- `arena:diff` on a scripted game of charges and passes: identical events; `harness.ts` charge scenarios green on both engines.
