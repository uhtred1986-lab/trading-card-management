---
title: Arena: vm flow runner over STEP programs — turn.rules and the bounded End Phase loop
milestone: Arena M7 — Rules engine core (Stage 4)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, area:arena-rulesets, phase:rules-stage4, model:opus-5
stage: 4
---
**Source:** plan Stage 4 ("the flow runner over `STEP` programs (`turn.rules`, the End-Phase repeat as a bounded loop)"); `exec()` in `src/lib/arena/engine/engine.ts` (~lines 219–443, the phase/step switch) and `state.flow` (the data step list the legacy engine already has); rule manual §7 (turn structure), §8 (phases).

**Problem.** The turn is a TypeScript `switch` over `Phase`. In the rules engine it is a program: `DEFINE PHASE`/`DEFINE STEP` in `rulesets/dbs/turn.rules`, run by an interpreter that knows only *steps*, *prompts* and *events*. Getting this right is what makes a second game a set of files.

**Build.**
1. `turn.rules`: Charge (draw except first turn of P1, charge prompt or skip), Main (loop until `endMain`), End (hand size, the "at end of turn" repeat until nothing pends — a **bounded** loop with a ceiling the definition states, so a mis-declared trigger cannot hang a game), Setup, Over; each step names the prompts it may raise and the events it fires.
2. `vm/flow.ts`: `run(state)` advances `state.flow` (a data program counter, as today) until the next prompt or the game's end; suspension and resumption are the frame, so a game is storable mid-decision and reproducible from seed + actions — the legacy guarantee, kept.
3. `apply(ctx, state, action)` for `pass`, `endMain`, `concede` only; `legalActions` returns exactly those; `rejectedActions` empty.
4. `boardView` and `toBeats` for what exists (phase beats, draw, turn change) so the web board renders a `rules` game.

**Out of scope.** Charging, playing, attacking (Stage 5); battle (Stage 6).

**Acceptance.**
- Gate; `arena-fuzz 40 --engine rules` plays 40 games to the end by passing, 0 crashes.
- `arena:diff` on a pass-only scripted game: identical events on both engines (the phase and draw beats, turn changes, deck-out loss).
- Scenario proof: create a `rules` game from `/arena`, pass through three turns on the board; the beats play back.
