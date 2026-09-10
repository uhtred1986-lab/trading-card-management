---
title: Arena: arena:diff green on the harness and playthrough games; flip ENGINE_INFO.rules.available
milestone: Arena M8 — Rules engine actions and costs (Stage 5)
labels: backlog, ready-for-agent, enhancement, area:arena-vm, area:arena-ui, phase:rules-stage5, model:opus-5
stage: 5
---
**Source:** plan Stage 5 exit ("`arena-diff` on the `harness.ts` staged games and on `arena:playthrough` scripts shows no divergence"); `ENGINE_INFO` in `src/lib/arena/engines.ts`; the `/arena` new-game form and `/arena/match`; `docs/arena-client-contract.md` (`Snapshot.game.engine`).

**Problem.** The rules engine is listed and greyed until it can play. The moment it plays the actions of Stage 5 identically to the legacy engine on every staged game, it should be selectable — with `legacy` still the default — so the owner can play real games on it and find what the instruments cannot.

**Build.**
1. Run `npm run arena:diff -- --all --engine rules` over every saved game whose action log uses only Stage 5 actions, and `arena:diff` over the harness and playthrough scripts; fix every divergence in `vm/` (or, where the legacy engine is wrong, fix both and record the ruling with `npm run arena:rule`).
2. Flip `ENGINE_INFO.rules.available` to `true`; the form offers it; the "rules engine" badge shows on such games; `POST /api/v1/games` accepts `engine: "rules"`.
3. A game on the rules engine that reaches a `NotYet` (battle, a keyword) must end in a clear, non-crashing state the board can show ("this engine cannot play [Blocker] yet — abandon or continue on legacy is not possible"), with the beat and the debug page recording it.

**Out of scope.** Battle (Stage 6); the default flip (Stage 9).

**Acceptance.**
- `arena:diff` reports 0 divergent games in the set above, listed in the history archive by id.
- Gate; `contract:emit` no change (the engine field exists since Stage 0); `android:test` green.
- Scenario proof: a Sparring game created on the rules engine from `/arena` is played through Charge and Main on the phone.
